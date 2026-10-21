from __future__ import annotations

import builtins
import json
from pathlib import Path
from typing import Any

import pytest

from tiktok_trip.clients import tiktok_comments
from tiktok_trip.clients.tiktok_comments import CommentCollector
from tiktok_trip.errors import UserFacingError

FIXTURES = Path(__file__).parent / "fixtures"
TOP_ID = "7401000000000000001"


def load(name: str) -> dict[str, Any]:
    payload: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return payload


def test_collector_parses_comment_list_with_nested_replies() -> None:
    collector = CommentCollector({"6800000000000000000"})
    assert collector.add_payload(load("tiktok_comment_list.json")) == 3

    comments = collector.comments()
    assert [c.author for c in comments] == ["Reviewer Sài Gòn", "fan3", "Fan Hai"]
    creator, liked, asker = comments
    assert creator.is_creator and creator.parent == TOP_ID and creator.timestamp == 1720000200
    assert liked.like_count == 1200 and not liked.is_creator and liked.parent is None
    assert asker.text == "Quán này ở đâu vậy shop?" and asker.parent is None


def test_creator_label_marks_creator_without_ids() -> None:
    collector = CommentCollector()
    collector.add_payload(load("tiktok_comment_list.json"))
    assert [c.author for c in collector.comments() if c.is_creator] == ["Reviewer Sài Gòn"]


def test_reply_payload_dedupes_and_uses_request_parent() -> None:
    collector = CommentCollector({"reviewer"})
    collector.add_payload(load("tiktok_comment_list.json"))
    assert collector.add_payload(load("tiktok_comment_reply.json"), parent=TOP_ID) == 1

    new = next(c for c in collector.comments() if c.author == "Fan Năm")
    assert new.parent == TOP_ID
    assert len(collector.comments(limit=2)) == 2


def test_creator_ids_from_page_state() -> None:
    state = {
        "__DEFAULT_SCOPE__": {
            "webapp.video-detail": {
                "itemInfo": {"itemStruct": {"author": {"id": "68", "uniqueId": "reviewer"}}}
            }
        }
    }
    assert tiktok_comments.creator_ids_from_state(state) == {"68", "reviewer"}
    assert tiktok_comments.creator_ids_from_state({}) == set()


def test_comments_from_dom_links_replies_to_previous_top_level() -> None:
    rows = [
        {"level": 1, "author": "Fan Hai", "text": "Địa chỉ đâu ạ", "likes": "12"},
        {"level": 2, "author": "Reviewer", "text": "Hẻm 12 Phan Đình Phùng", "likes": "1.2K"},
        {"level": 1, "author": "Fan Ba", "text": "", "likes": ""},
        {"level": 2, "author": "Fan Bốn", "text": "Cảm ơn", "creator_label": False},
    ]
    comments = tiktok_comments.comments_from_dom(rows, {"Reviewer"})
    assert [c.author for c in comments] == ["Reviewer", "Fan Hai", "Fan Bốn"]
    assert comments[0].is_creator and comments[0].parent == "Fan Hai"
    assert comments[0].like_count == 1200


def test_reply_parent_from_request_url() -> None:
    base = "https://www.tiktok.com/api/comment/list/"
    assert tiktok_comments.reply_parent(f"{base}reply/?comment_id=77&item_id=1") == "77"
    assert tiktok_comments.reply_parent(f"{base}?aweme_id=1&cursor=0") is None


def test_handle_from_url() -> None:
    url = "https://www.tiktok.com/@cham.di-dau/video/1"
    assert tiktok_comments.handle_from_url(url) == "cham.di-dau"
    assert tiktok_comments.handle_from_url("https://vt.tiktok.com/ZS1/") is None


def test_missing_playwright_is_a_user_facing_error(monkeypatch: pytest.MonkeyPatch) -> None:
    real_import = builtins.__import__

    def no_playwright(name: str, *args: Any, **kwargs: Any) -> Any:
        if name.startswith("playwright"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_playwright)
    with pytest.raises(UserFacingError, match="playwright install chromium"):
        tiktok_comments.fetch_comments(
            "https://www.tiktok.com/@a/video/1", max_comments=5, headless=True, timeout_s=1
        )


def test_photo_post_slides_from_saved_page_state() -> None:
    state = load("tiktok_photo_page_state.json")
    item = tiktok_comments.item_from_state(state)
    slides = tiktok_comments.image_urls_from_item(item)

    assert len(slides) == 6
    assert all(len(urls) == 2 for urls in slides)
    assert slides[0][0].startswith("https://p16-common-sign.tiktokcdn.com/")
    assert "b231340be6f8475eabf00d4b45d871e4" in slides[0][0]
    assert "a734f3195f6b4884a44aea0e7588112a" in slides[5][1]
    assert {"mt.v.i.lun", "Nga Ré Bản"} <= tiktok_comments.creator_ids_from_state(state)

    page = tiktok_comments.post_page_from_item(item)
    assert page.title == "Nửa tiktok em đi Đà Lạt cuối năm nay nhớ lưu lại nhen 🥰"
    assert page.poi["name"] == "Đà Lạt"
    assert page.poi["address"].startswith("110 Đ. Hùng Vương")
    assert "province" not in page.poi


def test_item_detail_api_payload_has_the_same_shape() -> None:
    item = tiktok_comments.item_from_state(load("tiktok_photo_page_state.json"))
    payload = {"itemInfo": {"itemStruct": item}, "statusCode": 0}
    assert tiktok_comments.item_from_detail(payload) == item


def test_video_post_and_empty_state_have_no_slides() -> None:
    assert tiktok_comments.image_urls_from_item({}) == []
    assert tiktok_comments.image_urls_from_item({"imagePost": {"images": [{"imageURL": {}}]}}) == []
    assert tiktok_comments.item_from_state({"__DEFAULT_SCOPE__": {}}) == {}
    assert tiktok_comments.post_page_from_item({}).title is None
