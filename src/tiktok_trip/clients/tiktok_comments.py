"""Browser fallback for TikTok comments and photo-post slides, which yt-dlp does not return.

The page calls TikTok's internal comment endpoints; their JSON responses are captured while the
comment panel is opened, scrolled and its replies expanded. DOM text is read only when no JSON was
captured. Photo-post image URLs come from the page's rehydration JSON (`imagePost.images`), or from
the item-detail API response when the page loads the post client-side. Never logs in.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable, Collection, Iterable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

from tiktok_trip.errors import UserFacingError
from tiktok_trip.extraction.raw import (
    PostPage,
    RawComment,
    int_or_none,
    parse_count,
    video_id_from_url,
    video_page_url,
)

if TYPE_CHECKING:
    from playwright.sync_api import Browser, Locator, Page, Playwright, Response

log = logging.getLogger(__name__)

COMMENT_API = "/api/comment/list/"
REPLY_API = "/api/comment/list/reply/"
ITEM_API = "/api/item/detail/"
POI_KEYS = ("name", "address", "city", "province", "country", "category")
CREATOR_LABELS = {"creator", "tác giả", "author", "người sáng tạo"}
STALL_ROUNDS = 4
SCROLL_PAUSE_MS = 1200
MAX_REPLY_CLICKS_PER_ROUND = 8
HANDLE = re.compile(r"tiktok\.com/@([\w.-]+)")
STATE_SCRIPT = "#__UNIVERSAL_DATA_FOR_REHYDRATION__"
INSTALL_HINT = (
    "Comment scraping needs Playwright. Run `uv sync` (playwright is a project dependency) and "
    "either install Google Chrome or run `uv run playwright install chromium`. "
    "Or set fetch.comments: none in config.yaml."
)

COMMENT_PANEL_BUTTONS = ('[data-e2e="comment-icon"]', '[data-e2e="browse-comment-icon"]')
MODAL_CLOSERS = (
    '[data-e2e="modal-close-inner-button"]',
    '[data-e2e="modal-close-button"]',
    '#login-modal [aria-label="Close"]',
    'div[role="dialog"] [aria-label="Close"]',
    'div[role="dialog"] [aria-label="Đóng"]',
)
MODAL_TEXT_BUTTONS = re.compile(
    r"^(got it|đã hiểu|not now|để sau|decline optional cookies|từ chối cookie không bắt buộc|"
    r"allow all|cho phép tất cả|continue as guest|tiếp tục với tư cách khách|"
    r"stay on browser|ở lại trình duyệt|close|đóng)$",
    re.IGNORECASE,
)
COMMENTS_TAB = re.compile(r"^(comments|bình luận)$", re.IGNORECASE)
MORE_REPLIES = re.compile(
    r"^(view|xem)\s+(\d+\s+)?(more\s+|thêm\s+)?(repl|câu trả lời|phản hồi|trả lời)", re.IGNORECASE
)
CAPTCHA = ".captcha-verify-container, #captcha-verify-container-main-page"
LOGIN_WALL = '#login-modal, [data-e2e="login-modal"]'

DOM_SCRIPT = """
() => {
  const rows = [];
  const nodes = document.querySelectorAll('[data-e2e^="comment-level-"]');
  for (const node of nodes) {
    const level = parseInt(node.getAttribute('data-e2e').split('-').pop(), 10) || 1;
    let item = node.parentElement;
    for (let i = 0; i < 6 && item; i++) {
      if (item.querySelector('[data-e2e^="comment-username-"]')) break;
      item = item.parentElement;
    }
    const name = item && item.querySelector('[data-e2e^="comment-username-"]');
    const likes = item && item.querySelector('[data-e2e="comment-like-count"]');
    const label = item ? item.innerText : '';
    rows.push({
      level,
      author: name ? name.innerText.trim() : '',
      text: node.innerText.trim(),
      likes: likes ? likes.innerText.trim() : '',
      creator_label: /(^|\\n)\\s*(Creator|Tác giả)\\s*(\\n|$)/.test(label),
    });
  }
  return rows;
}
"""

SCROLL_SCRIPT = """
() => {
  const first = document.querySelector('[data-e2e^="comment-level-"]');
  let el = first ? first.parentElement : null;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) {
      el.scrollTop = el.scrollHeight;
      return true;
    }
    el = el.parentElement;
  }
  return false;
}
"""


@dataclass(frozen=True)
class _Entry:
    key: str
    author: str
    text: str
    user_ids: frozenset[str]
    labelled_creator: bool
    like_count: int
    parent: str | None
    timestamp: int | None


class CommentCollector:
    """Accumulates comments from TikTok comment-API payloads, deduplicated by comment id."""

    def __init__(self, creator_ids: Iterable[str] = (), video_id: str | None = None) -> None:
        self.creator_ids = {i for i in creator_ids if i}
        self.video_id = video_id
        self._entries: dict[str, _Entry] = {}

    def __len__(self) -> int:
        return len(self._entries)

    def add_payload(self, payload: Mapping[str, Any], *, parent: str | None = None) -> int:
        before = len(self._entries)
        for item in payload.get("comments") or []:
            if isinstance(item, Mapping):
                self._add_item(item, parent)
        return len(self._entries) - before

    def _add_item(self, item: Mapping[str, Any], parent: str | None) -> None:
        aweme_id = item.get("aweme_id")
        if self.video_id and aweme_id and str(aweme_id) != self.video_id:
            return
        cid = str(item.get("cid") or "")
        reply_to = str(item.get("reply_id") or "")
        parent = reply_to if reply_to not in ("", "0") else parent
        text = str(item.get("text") or "").strip()
        if text:
            user = item.get("user") or {}
            author = str(user.get("nickname") or user.get("unique_id") or "")
            key = cid or f"{author}\x00{text}"
            self._entries.setdefault(
                key,
                _Entry(
                    key=key,
                    author=author,
                    text=text,
                    user_ids=frozenset(
                        str(user[k]) for k in ("uid", "sec_uid", "unique_id") if user.get(k)
                    ),
                    labelled_creator=_has_creator_label(item),
                    like_count=parse_count(item.get("digg_count")),
                    parent=parent,
                    timestamp=int_or_none(item.get("create_time")),
                ),
            )
        for reply in item.get("reply_comment") or []:
            if isinstance(reply, Mapping):
                self._add_item(reply, cid or parent)

    def comments(self, limit: int | None = None) -> list[RawComment]:
        result = [
            RawComment(
                author=e.author,
                text=e.text,
                is_creator=e.labelled_creator or bool(e.user_ids & self.creator_ids),
                like_count=e.like_count,
                parent=e.parent,
                timestamp=e.timestamp,
            )
            for e in self._entries.values()
        ]
        return sort_comments(result)[:limit]


def sort_comments(comments: Iterable[RawComment]) -> list[RawComment]:
    return sorted(comments, key=lambda c: (not c.is_creator, -c.like_count))


def comments_from_dom(
    rows: Iterable[Mapping[str, Any]], creator_ids: Collection[str]
) -> list[RawComment]:
    """Map rows read by DOM_SCRIPT; replies point at the preceding top-level comment's author."""
    comments: list[RawComment] = []
    last_top: str | None = None
    for row in rows:
        text = str(row.get("text") or "").strip()
        author = str(row.get("author") or "")
        if not text:
            continue
        is_reply = int(row.get("level") or 1) > 1
        if not is_reply:
            last_top = author or None
        comments.append(
            RawComment(
                author=author,
                text=text,
                is_creator=bool(row.get("creator_label")) or author in creator_ids,
                like_count=parse_count(row.get("likes")),
                parent=last_top if is_reply else None,
            )
        )
    return sort_comments(comments)


@dataclass
class PostScrape:
    comments: list[RawComment] = field(default_factory=list)
    images: list[list[str]] = field(default_factory=list)
    """One list of alternative CDN URLs per slide, in post order."""
    page: PostPage | None = None


def item_from_detail(detail: Mapping[str, Any]) -> Mapping[str, Any]:
    """The post (`itemInfo.itemStruct`) of a webapp.video-detail scope or item-detail response."""
    item = (detail.get("itemInfo") or {}).get("itemStruct") or {}
    return item if isinstance(item, Mapping) else {}


def item_from_state(state: Mapping[str, Any]) -> Mapping[str, Any]:
    scope = state.get("__DEFAULT_SCOPE__") or {}
    return item_from_detail(scope.get("webapp.video-detail") or {})


def creator_ids_from_item(item: Mapping[str, Any]) -> set[str]:
    author = item.get("author") or {}
    return {str(author[k]) for k in ("id", "uniqueId", "secUid", "nickname") if author.get(k)}


def creator_ids_from_state(state: Mapping[str, Any]) -> set[str]:
    """Video author ids from the page's rehydration JSON (webapp.video-detail item)."""
    return creator_ids_from_item(item_from_state(state))


def image_urls_from_item(item: Mapping[str, Any]) -> list[list[str]]:
    """Slide URLs of a photo post (`imagePost.images[].imageURL.urlList`), in post order."""
    slides: list[list[str]] = []
    for image in (item.get("imagePost") or {}).get("images") or []:
        if not isinstance(image, Mapping):
            continue
        urls = (image.get("imageURL") or {}).get("urlList") or []
        usable = [u for u in urls if isinstance(u, str) and u.startswith("http")]
        if usable:
            slides.append(usable)
    return slides


def post_page_from_item(item: Mapping[str, Any]) -> PostPage:
    title = str((item.get("imagePost") or {}).get("title") or "").strip()
    poi = item.get("poi") or {}
    fields = {k: str(v).strip() for k in POI_KEYS if isinstance(poi, Mapping) and (v := poi.get(k))}
    return PostPage(title=title or None, poi={k: v for k, v in fields.items() if v})


def reply_parent(url: str) -> str | None:
    """Parent comment id of a reply-list request (its `comment_id` query parameter)."""
    if REPLY_API not in url:
        return None
    ids = parse_qs(urlparse(url).query).get("comment_id")
    return ids[0] if ids else None


def handle_from_url(url: str) -> str | None:
    match = HANDLE.search(url)
    return match.group(1) if match else None


def fetch_comments(
    url: str,
    *,
    max_comments: int,
    headless: bool,
    timeout_s: float,
    creator_ids: Collection[str] = (),
    video_id: str | None = None,
) -> list[RawComment]:
    """Open the video page in Chrome/Chromium and return its comments, creator first."""
    return scrape_post(
        url,
        comments=True,
        images=False,
        max_comments=max_comments,
        headless=headless,
        timeout_s=timeout_s,
        creator_ids=creator_ids,
        video_id=video_id,
    ).comments


def scrape_post(
    url: str,
    *,
    comments: bool,
    images: bool,
    max_comments: int,
    headless: bool,
    timeout_s: float,
    creator_ids: Collection[str] = (),
    video_id: str | None = None,
) -> PostScrape:
    """Open the post page once and read what is asked: comments and/or photo-post slide URLs.

    Headless browsers often get a captcha; then comments come back [] at once. With headless=False
    a captcha is left for the user to solve in the window while the timeout runs.
    """
    sync_playwright = _load_playwright()
    handle = handle_from_url(url)
    collector = CommentCollector(
        {*creator_ids, *([handle] if handle else [])}, video_id or video_id_from_url(url)
    )
    deadline = time.monotonic() + timeout_s
    result = PostScrape()
    with sync_playwright() as pw:
        browser = _launch(pw, headless=headless)
        try:
            page = browser.new_context(
                locale="vi-VN", viewport={"width": 1366, "height": 900}
            ).new_page()
            pending: list[Response] = []
            details: list[Response] = []

            def on_response(response: Response) -> None:
                if COMMENT_API in response.url:
                    pending.append(response)
                elif ITEM_API in response.url:
                    details.append(response)

            page.on("response", on_response)
            target = video_page_url(url) if images else url
            page.goto(target, wait_until="domcontentloaded", timeout=timeout_s * 1000)
            item = item_from_state(_page_state(page))
            collector.creator_ids |= creator_ids_from_item(item)
            page.wait_for_timeout(2500)
            if images:
                if not image_urls_from_item(item):
                    item = _item_from_responses(details) or item
                result.images = image_urls_from_item(item)
                result.page = post_page_from_item(item)
                if not result.images:
                    log.warning("No slide images in the page data of %s (%s)", url, _describe(page))
            if comments:
                result.comments = _scrape_comments(
                    page,
                    collector,
                    pending,
                    url=url,
                    max_comments=max_comments,
                    deadline=deadline,
                    headless=headless,
                )
            return result
        finally:
            browser.close()


def _scrape_comments(
    page: Page,
    collector: CommentCollector,
    pending: list[Response],
    *,
    url: str,
    max_comments: int,
    deadline: float,
    headless: bool,
) -> list[RawComment]:
    _dismiss_modals(page)
    _open_comment_panel(page)
    _scroll_until_stalled(
        page,
        collector,
        pending,
        max_comments=max_comments,
        deadline=deadline,
        headless=headless,
    )
    if len(collector):
        return collector.comments(max_comments)
    rows = page.evaluate(DOM_SCRIPT)
    comments = comments_from_dom(rows, collector.creator_ids)[:max_comments]
    if comments:
        log.info("No comment JSON captured; read %d comments from the page", len(comments))
    else:
        log.warning("No comments on %s (page shows: %s)", url, _describe(page))
    return comments


def _item_from_responses(responses: list[Response]) -> Mapping[str, Any]:
    for response in responses:
        try:
            payload = response.json()
        except Exception as exc:
            log.debug("Unreadable item response %s: %s", response.url, exc)
            continue
        if isinstance(payload, Mapping) and (item := item_from_detail(payload)):
            return item
    return {}


def _load_playwright() -> Callable[[], Any]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise UserFacingError(INSTALL_HINT) from exc
    return sync_playwright


def _launch(pw: Playwright, *, headless: bool) -> Browser:
    args = ["--disable-blink-features=AutomationControlled"]
    try:
        return pw.chromium.launch(channel="chrome", headless=headless, args=args)
    except Exception as exc:
        log.info("Google Chrome not usable (%s), trying Playwright's Chromium", exc)
    try:
        return pw.chromium.launch(headless=headless, args=args)
    except Exception as exc:
        raise UserFacingError(f"No browser for comment scraping. {INSTALL_HINT}") from exc


def _page_state(page: Page) -> Mapping[str, Any]:
    try:
        raw = page.locator(STATE_SCRIPT).first.text_content(timeout=5000)
        state = json.loads(raw or "{}")
    except Exception as exc:
        log.debug("No page state: %s", exc)
        return {}
    return state if isinstance(state, Mapping) else {}


def _try_click(locator: Locator, timeout_ms: int = 1500) -> bool:
    try:
        if locator.count() and locator.first.is_visible():
            locator.first.click(timeout=timeout_ms)
            return True
    except Exception as exc:
        log.debug("Click failed: %s", exc)
    return False


def _dismiss_modals(page: Page) -> None:
    for selector in MODAL_CLOSERS:
        _try_click(page.locator(selector))
    _try_click(page.get_by_role("button", name=MODAL_TEXT_BUTTONS))
    _try_click(page.locator("tiktok-cookie-banner button").filter(has_text=MODAL_TEXT_BUTTONS))
    page.keyboard.press("Escape")


def _open_comment_panel(page: Page) -> None:
    if page.locator('[data-e2e^="comment-level-"]').count():
        return
    if not any(_try_click(page.locator(selector)) for selector in COMMENT_PANEL_BUTTONS):
        _try_click(page.get_by_text(COMMENTS_TAB))
    page.wait_for_timeout(SCROLL_PAUSE_MS)


def _visible(page: Page, selector: str) -> bool:
    try:
        return page.locator(selector).first.is_visible()
    except Exception:
        return False


def _scroll_until_stalled(
    page: Page,
    collector: CommentCollector,
    pending: list[Response],
    *,
    max_comments: int,
    deadline: float,
    headless: bool,
) -> None:
    stalled = 0
    warned = False
    while stalled < STALL_ROUNDS and time.monotonic() < deadline:
        if _visible(page, CAPTCHA):
            if headless:
                log.warning(
                    "TikTok shows a captcha to the headless browser; try fetch.headless: false"
                )
                return
            if not warned:
                log.warning("TikTok shows a captcha: solve it in the browser window to continue")
                warned = True
            page.wait_for_timeout(SCROLL_PAUSE_MS)
            continue
        before = len(collector)
        _dismiss_modals(page)
        _open_comment_panel(page)
        _expand_replies(page)
        page.evaluate(SCROLL_SCRIPT)
        page.wait_for_timeout(SCROLL_PAUSE_MS)
        _drain(pending, collector)
        if len(collector) >= max_comments:
            return
        stalled = 0 if len(collector) > before else stalled + 1
    if time.monotonic() >= deadline:
        log.warning("Comment scrape timed out with %d comments", len(collector))


def _expand_replies(page: Page) -> int:
    buttons = page.locator('[data-e2e^="view-more"]').or_(page.get_by_text(MORE_REPLIES))
    clicked = 0
    for index in range(min(buttons.count(), MAX_REPLY_CLICKS_PER_ROUND)):
        if _try_click(buttons.nth(index), timeout_ms=1000):
            clicked += 1
            page.wait_for_timeout(400)
    return clicked


def _drain(pending: list[Response], collector: CommentCollector) -> None:
    while pending:
        response = pending.pop(0)
        try:
            payload = response.json()
        except Exception as exc:
            log.debug("Unreadable comment response %s: %s", response.url, exc)
            continue
        if isinstance(payload, Mapping):
            parent = reply_parent(response.url)
            added = collector.add_payload(payload, parent=parent)
            log.debug("Captured %d comments from %s", added, response.url.split("?")[0])


def _describe(page: Page) -> str:
    blockers = {"captcha": CAPTCHA, "login wall": LOGIN_WALL}
    found = [name for name, selector in blockers.items() if _visible(page, selector)]
    title = page.title()
    return f"title={title!r}" + (f", {', '.join(found)} present" if found else "")


def _has_creator_label(item: Mapping[str, Any]) -> bool:
    labels = [item.get("label_text")]
    labels += [
        label.get("text") for label in item.get("label_list") or [] if isinstance(label, Mapping)
    ]
    return any(str(label).strip().casefold() in CREATOR_LABELS for label in labels if label)
