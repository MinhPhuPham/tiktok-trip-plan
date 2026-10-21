from __future__ import annotations

from dataclasses import dataclass

from tiktok_trip.config import AppConfig, Secrets
from tiktok_trip.paths import Paths
from tiktok_trip.quota import QuotaGuard
from tiktok_trip.storage import ApiLog


@dataclass(frozen=True)
class Context:
    config: AppConfig
    secrets: Secrets
    paths: Paths
    api_log: ApiLog
    quota: QuotaGuard

    @classmethod
    def load(cls, paths: Paths | None = None) -> Context:
        paths = paths or Paths.discover()
        paths.ensure()
        config = AppConfig.load(paths.config_file)
        api_log = ApiLog(paths.api_log)
        return cls(
            config=config,
            secrets=Secrets.load(paths.env_file),
            paths=paths,
            api_log=api_log,
            quota=QuotaGuard(config.quota, api_log),
        )
