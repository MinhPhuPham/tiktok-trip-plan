"""Geocoding with provider fallback: Nominatim, then Photon, then Google Places Text Search.

A provider that fails at the transport or HTTP level is skipped for the rest of the run
(one warning); an empty answer falls through to the next provider.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel

from tiktok_trip.clients.google_places import GooglePlacesClient, SearchPlace
from tiktok_trip.context import Context

log = logging.getLogger(__name__)

GeoSource = Literal["nominatim", "photon", "google"]
GOOGLE_CITY_TYPES = ("locality", "administrative_area_level_2", "administrative_area_level_1")
NEAR_BIAS_RADIUS_M = 30_000.0


class GeoPoint(BaseModel):
    lat: float
    lng: float
    display_name: str
    osm_type: str | None = None
    osm_id: int | None = None
    osm_class: str | None = None
    osm_kind: str | None = None
    source: GeoSource = "nominatim"
    google_id: str | None = None

    @property
    def osm_ref(self) -> str | None:
        if self.osm_type and self.osm_id is not None:
            return f"osm:{self.osm_type}/{self.osm_id}"
        return None


class Geocoder(Protocol):
    def search(
        self, query: str, *, limit: int = 5, near: tuple[float, float] | None = None
    ) -> list[GeoPoint]: ...

    def geocode(self, query: str) -> GeoPoint | None: ...

    def city_point(self, city: str) -> GeoPoint | None: ...


class GoogleGeocoder:
    """Places Text Search (regionCode, plus a circle bias when `near` is given) as GeoPoints."""

    def __init__(self, client: GooglePlacesClient) -> None:
        self._client = client

    def search(
        self, query: str, *, limit: int = 5, near: tuple[float, float] | None = None
    ) -> list[GeoPoint]:
        hits = self._client.text_search(query, center=near, radius_m=NEAR_BIAS_RADIUS_M)
        return [_google_point(hit) for hit in hits[:limit]]

    def geocode(self, query: str) -> GeoPoint | None:
        hits = self._client.text_search(query)
        return _google_point(hits[0]) if hits else None

    def city_point(self, city: str) -> GeoPoint | None:
        hits = self._client.text_search(city)
        for kind in GOOGLE_CITY_TYPES:
            for hit in hits:
                if kind in hit.types:
                    return _google_point(hit)
        return _google_point(hits[0]) if hits else None

    def close(self) -> None:
        self._client.close()


def _google_point(hit: SearchPlace) -> GeoPoint:
    parts = [hit.name] if hit.name and not hit.address.startswith(hit.name) else []
    return GeoPoint(
        lat=hit.lat,
        lng=hit.lng,
        display_name=", ".join([*parts, hit.address] if hit.address else parts),
        source="google",
        google_id=hit.google_id,
    )


@dataclass
class Provider:
    name: GeoSource
    client: Geocoder | None
    skip_reason: str | None = None
    warned: bool = False

    def skip(self) -> None:
        if not self.warned:
            log.warning("Geocoder %s skipped: %s", self.name, self.skip_reason)
            self.warned = True


class FallbackGeocoder:
    def __init__(self, providers: Sequence[Provider]) -> None:
        self.providers = list(providers)

    def search(self, query: str, *, limit: int = 5) -> list[GeoPoint]:
        return self._first(lambda g: g.search(query, limit=limit)) or []

    def find(
        self,
        query: str,
        accept: Callable[[GeoPoint], bool],
        *,
        near: tuple[float, float] | None = None,
        limit: int = 5,
    ) -> GeoPoint | None:
        """The first hit `accept` takes; when a provider has none, the next provider is asked."""
        return self._first(
            lambda g: next((p for p in g.search(query, limit=limit, near=near) if accept(p)), None)
        )

    def geocode(self, query: str) -> GeoPoint | None:
        return self._first(lambda g: g.geocode(query))

    def city_point(self, city: str) -> GeoPoint | None:
        return self._first(lambda g: g.city_point(city))

    def osm_only(self) -> FallbackGeocoder:
        """Same providers (and failure state) minus Google, for answers that need an OSM id."""
        return FallbackGeocoder([p for p in self.providers if p.name != "google"])

    def google_first(self) -> FallbackGeocoder:
        """Same providers (and failure state), Google first so the answer carries a listing id."""
        google = [p for p in self.providers if p.name == "google"]
        return FallbackGeocoder([*google, *(p for p in self.providers if p.name != "google")])

    def close(self) -> None:
        for provider in self.providers:
            close = getattr(provider.client, "close", None)
            if close is not None:
                close()

    def _first[T](self, call: Callable[[Geocoder], T | None]) -> T | None:
        for provider in self.providers:
            if provider.client is None or provider.skip_reason is not None:
                provider.skip()
                continue
            try:
                result = call(provider.client)
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                provider.skip_reason = f"{type(exc).__name__}: {exc}"
                provider.skip()
                continue
            if result:
                log.debug("Geocoder %s answered", provider.name)
                return result
        return None


def build(ctx: Context) -> FallbackGeocoder:
    """Nominatim → Photon → Google (only when GOOGLE_MAPS_KEY is set)."""
    from tiktok_trip.clients.nominatim import NominatimClient
    from tiktok_trip.clients.photon import PhotonClient

    google = (
        Provider("google", GoogleGeocoder(GooglePlacesClient(ctx)))
        if ctx.secrets.google_maps_key
        else Provider("google", None, skip_reason="GOOGLE_MAPS_KEY is not set")
    )
    return FallbackGeocoder(
        [
            Provider("nominatim", NominatimClient(ctx)),
            Provider("photon", PhotonClient(ctx)),
            google,
        ]
    )
