from __future__ import annotations

import hashlib
import json
import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from tiktok_trip.errors import ApiError
from tiktok_trip.storage import ApiLog, read_json, write_json

if TYPE_CHECKING:
    from tiktok_trip.quota import QuotaGuard

log = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}
SECRET_HEADERS = {"authorization", "x-goog-api-key", "x-api-key"}
ERROR_BODY_CHARS = 500


class RateLimiter:
    def __init__(self, min_interval_s: float) -> None:
        self.min_interval_s = min_interval_s
        self._last = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self._last
        if elapsed < self.min_interval_s:
            time.sleep(self.min_interval_s - elapsed)
        self._last = time.monotonic()


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRY_STATUSES
    return isinstance(exc, httpx.TransportError)


def public_url(url: str) -> str:
    """The URL without query string or fragment, which may carry credentials."""
    return str(httpx.URL(url).copy_with(query=None, fragment=None))


def error_body(response: httpx.Response) -> str:
    """The response body on one line (compact JSON when it parses), cut to ERROR_BODY_CHARS."""
    text = response.text
    try:
        text = json.dumps(json.loads(text), ensure_ascii=False, separators=(",", ":"))
    except ValueError:
        text = " ".join(text.split())
    if len(text) > ERROR_BODY_CHARS:
        return text[:ERROR_BODY_CHARS] + "..."
    return text or "(empty body)"


class CachedClient:
    """JSON HTTP client with a file cache, retries, rate limiting and an API log.

    Cache keys include request headers except credentials, so API keys never land on disk.
    Every call names its sku (the billing unit); `paid` clients must name it explicitly, and
    `quota` refuses a real call that would pass that sku's local cap before anything is sent.
    """

    def __init__(
        self,
        service: str,
        cache_dir: Path,
        api_log: ApiLog,
        *,
        rate_limiter: RateLimiter | None = None,
        headers: dict[str, str] | None = None,
        timeout_s: float = 30,
        quota: QuotaGuard | None = None,
        paid: bool = False,
    ) -> None:
        self.service = service
        self.quota = quota
        self.paid = paid
        self.cache_dir = cache_dir / service
        self.api_log = api_log
        self.rate_limiter = rate_limiter
        self._client = httpx.Client(headers=headers, timeout=timeout_s)

    def request_json(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        sku: str | None = None,
        units: int = 1,
        note: str = "",
        use_cache: bool = True,
        cacheable: Callable[[Any], bool] | None = None,
        cache_key_url: str | None = None,
        cache_only: bool = False,
    ) -> Any:
        """`cacheable` rejects 200 responses that are soft errors, so they are retried next run.

        `cache_key_url` replaces `url` in the cache key, so mirrors of one API share answers.
        `cache_only` returns None instead of sending when the cache has no answer.
        """
        if sku is None and self.paid:
            raise ValueError(f"{self.service} is a paid service; pass the sku of this call")
        sku = sku or self.service
        cache_path = self._cache_path(method, cache_key_url or url, params, json_body, headers)
        if use_cache and cache_path.exists():
            self.api_log.record(self.service, url, sku=sku, units=0, cache_hit=True, note=note)
            return read_json(cache_path)
        if cache_only:
            return None
        if self.quota is not None:
            self.quota.check(sku)
        try:
            payload = self._send(method, url, params=params, json_body=json_body, headers=headers)
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            failed_note = f"{note} (error {status})" if note else f"error {status}"
            self._record(url, sku, units=1, note=failed_note)
            error = ApiError(self.service, public_url(url), exc.response, error_body(exc.response))
            log.error("%s", error)
            raise error from None
        self._record(url, sku, units=units, note=note)
        if use_cache and (cacheable is None or cacheable(payload)):
            write_json(cache_path, payload)
        return payload

    def _record(self, url: str, sku: str, *, units: int, note: str) -> None:
        self.api_log.record(self.service, url, sku=sku, units=units, note=note)
        if self.quota is not None:
            self.quota.add(sku)

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=1, max=20),
        reraise=True,
    )
    def _send(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None,
        json_body: dict[str, Any] | None,
        headers: dict[str, str] | None,
    ) -> Any:
        if self.rate_limiter:
            self.rate_limiter.wait()
        response = self._client.request(method, url, params=params, json=json_body, headers=headers)
        response.raise_for_status()
        return response.json()

    def _cache_path(
        self,
        method: str,
        url: str,
        params: dict[str, Any] | None,
        json_body: dict[str, Any] | None,
        headers: dict[str, str] | None,
    ) -> Path:
        public_headers = {
            k: v for k, v in (headers or {}).items() if k.lower() not in SECRET_HEADERS
        }
        raw = json.dumps(
            [method, url, params, json_body, public_headers], sort_keys=True, ensure_ascii=False
        )
        digest = hashlib.sha256(raw.encode()).hexdigest()[:32]
        return self.cache_dir / f"{digest}.json"

    def close(self) -> None:
        self._client.close()
