from __future__ import annotations

import httpx


class UserFacingError(RuntimeError):
    """Operator mistake such as a missing key or tool. The CLI prints it without a traceback."""

    exit_code = 1


class GateError(UserFacingError):
    """The pipeline waits for Claude Code or a human (exit code 2, like the review gate)."""

    exit_code = 2


class ApiError(UserFacingError, httpx.HTTPStatusError):
    """An external API answered with an error status after retries.

    Still an `httpx.HTTPStatusError`, so callers with a fallback (geocoders) keep working.
    """

    def __init__(self, service: str, url: str, response: httpx.Response, body: str) -> None:
        self.service = service
        self.url = url
        self.status_code = response.status_code
        self.body = body
        message = f"{service} API error {response.status_code} for {url}: {body}"
        httpx.HTTPStatusError.__init__(self, message, request=response.request, response=response)
