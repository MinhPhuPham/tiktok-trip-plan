"""Site identity and the static <head> tags that link previews read (their crawlers run no JS).

One title everywhere: <title>, og:title, the app's document.title (MapData.site_name) and the
home-screen name are SITE_NAME; the city and the trip size go in the description, the preview
image and the manifest's long name.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from html import escape

from tiktok_trip.clock import EN_DASH

SITE_NAME = "TwLP-Trips"
LANG = "vi"
LOCALE = "vi_VN"
ALTERNATE_LOCALES: tuple[str, ...] = ("en_US",)
OG_IMAGE = "og-image.png"
OG_IMAGE_SIZE = (1200, 630)
ROBOTS_TXT = "User-agent: *\nAllow: /\n"
EM_DASH = "\u2014"


@dataclass(frozen=True)
class TripFacts:
    city: str
    days: int
    places: int

    @property
    def stats(self) -> str:
        """'3 ngày · 184 địa điểm'; without a plan only the places."""
        places = f"{self.places} địa điểm"
        return f"{self.days} ngày · {places}" if self.days else places

    @property
    def description(self) -> str:
        if self.days:
            summary = f"lịch trình {self.days} ngày, {self.places} địa điểm"
            uses = "bản đồ, lộ trình từng ngày, dùng offline"
        else:
            summary = f"{self.places} địa điểm"
            uses = "bản đồ, dùng offline"
        return f"{self.city}: {summary} từ review TikTok {EM_DASH} {uses}."

    @property
    def image_alt(self) -> str:
        return f"{SITE_NAME}: {self.city}, {self.stats}"


def manifest_name(city: str) -> str:
    """The install dialog's long name; short_name stays SITE_NAME (fits under an icon)."""
    return f"{SITE_NAME} {EN_DASH} {city}" if city else SITE_NAME


def page_url(site_url: str) -> str:
    """The one canonical form of the page: the deployed folder with a trailing slash."""
    return f"{site_url}/"


def meta(attribute: str, key: str, value: str) -> str:
    return f'<meta {attribute}="{key}" content="{escape(value)}">'


def json_ld(facts: TripFacts, url: str) -> str:
    data = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE_NAME,
        "url": url,
        "description": facts.description,
        "inLanguage": LANG,
    }
    text = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/ld+json">{text}</script>'


def head_tags(facts: TripFacts, site_url: str = "", image: str | None = None) -> str:
    """The SEO block for index.html: description, Open Graph, Twitter card, canonical.

    `site_url` (no trailing slash) adds the canonical link, og:url and the JSON-LD WebSite;
    `image` is the og:image URL (absolute when `site_url` is known), None for no image.
    """
    url = page_url(site_url) if site_url else ""
    tags = [
        meta("name", "description", facts.description),
        meta("name", "apple-mobile-web-app-title", SITE_NAME),
    ]
    if url:
        tags.append(f'<link rel="canonical" href="{escape(url)}">')
    tags += [
        meta("property", "og:type", "website"),
        meta("property", "og:site_name", SITE_NAME),
        meta("property", "og:title", SITE_NAME),
        meta("property", "og:description", facts.description),
        meta("property", "og:locale", LOCALE),
        *(meta("property", "og:locale:alternate", locale) for locale in ALTERNATE_LOCALES),
    ]
    if url:
        tags.append(meta("property", "og:url", url))
    if image:
        width, height = OG_IMAGE_SIZE
        tags += [
            meta("property", "og:image", image),
            meta("property", "og:image:type", "image/png"),
            meta("property", "og:image:width", str(width)),
            meta("property", "og:image:height", str(height)),
            meta("property", "og:image:alt", facts.image_alt),
        ]
    tags.append(meta("name", "twitter:card", "summary_large_image" if image else "summary"))
    if url:
        tags.append(json_ld(facts, url))
    return "\n".join(tags)
