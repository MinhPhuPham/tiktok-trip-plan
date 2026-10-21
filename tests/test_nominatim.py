import httpx
import respx

from tiktok_trip.clients.nominatim import BASE_URL, NominatimClient
from tiktok_trip.context import Context

CITY_NODE = {
    "lat": "10.776",
    "lon": "106.701",
    "display_name": "HCMC",
    "osm_type": "node",
    "osm_id": 1,
    "class": "place",
    "type": "city",
}
BOUNDARY = {
    "lat": "10.9",
    "lon": "106.8",
    "display_name": "HCMC",
    "osm_type": "relation",
    "osm_id": 2,
    "class": "boundary",
    "type": "administrative",
}


@respx.mock
def test_city_point_prefers_place_node(ctx: Context) -> None:
    respx.get(f"{BASE_URL}/search").mock(
        return_value=httpx.Response(200, json=[BOUNDARY, CITY_NODE])
    )
    client = NominatimClient(ctx)
    client._client.rate_limiter = None
    point = client.city_point("Ho Chi Minh City")
    assert point is not None
    assert (point.lat, point.lng) == (10.776, 106.701)
    assert point.osm_ref == "osm:node/1"


@respx.mock
def test_geocode_returns_none_when_empty(ctx: Context) -> None:
    respx.get(f"{BASE_URL}/search").mock(return_value=httpx.Response(200, json=[]))
    client = NominatimClient(ctx)
    client._client.rate_limiter = None
    assert client.geocode("nowhere") is None
