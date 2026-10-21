from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT_ENV = "TIKTOK_TRIP_ROOT"


@dataclass(frozen=True)
class Paths:
    root: Path

    @classmethod
    def discover(cls) -> Paths:
        return cls(Path(os.environ.get(ROOT_ENV, Path.cwd())).resolve())

    @property
    def config_file(self) -> Path:
        return self.root / "config.yaml"

    @property
    def env_file(self) -> Path:
        return self.root / ".env"

    @property
    def links_file(self) -> Path:
        return self.root / "input" / "links.txt"

    @property
    def manual_places_file(self) -> Path:
        return self.root / "input" / "places.yaml"

    @property
    def preferences_file(self) -> Path:
        return self.root / "input" / "preferences.yaml"

    @property
    def data(self) -> Path:
        return self.root / "data"

    @property
    def raw(self) -> Path:
        return self.data / "raw"

    @property
    def cache(self) -> Path:
        return self.data / "cache"

    @property
    def extract_dir(self) -> Path:
        return self.data / "extract"

    @property
    def candidates_file(self) -> Path:
        return self.data / "candidates.json"

    @property
    def places_file(self) -> Path:
        return self.data / "places.json"

    @property
    def review_file(self) -> Path:
        return self.data / "review.json"

    @property
    def review_csv(self) -> Path:
        return self.data / "review.csv"

    @property
    def excluded_file(self) -> Path:
        return self.data / "excluded.json"

    @property
    def spatial_file(self) -> Path:
        return self.data / "spatial.json"

    @property
    def nearby_file(self) -> Path:
        return self.data / "nearby.json"

    @property
    def routes_file(self) -> Path:
        return self.data / "routes.json"

    @property
    def plan_dir(self) -> Path:
        return self.data / "plan"

    @property
    def plan_prompt(self) -> Path:
        return self.plan_dir / "prompt.md"

    @property
    def plan_matrix(self) -> Path:
        return self.plan_dir / "travel_minutes.csv"

    @property
    def plan_json(self) -> Path:
        return self.plan_dir / "plan.json"

    @property
    def plan_validation(self) -> Path:
        return self.plan_dir / "validation.md"

    @property
    def api_log(self) -> Path:
        return self.data / "api_log.csv"

    @property
    def fetch_failures(self) -> Path:
        return self.data / "fetch_failures.json"

    @property
    def output(self) -> Path:
        return self.root / "output"

    @property
    def trips_dir(self) -> Path:
        return self.output / "trips"

    def trip_dir(self, language: str) -> Path:
        return self.trips_dir / language

    def trip_xlsx(self, language: str) -> Path:
        return self.trip_dir(language) / "trip.xlsx"

    @property
    def map_html(self) -> Path:
        return self.output / "map.html"

    @property
    def app_dir(self) -> Path:
        """map.html as separate files plus a service worker, for `tiktok-trip serve`."""
        return self.output / "app"

    @property
    def mymaps_dir(self) -> Path:
        return self.output / "mymaps"

    @property
    def media_dir(self) -> Path:
        return self.output / "media"

    @property
    def media_index(self) -> Path:
        return self.media_dir / "index.json"

    @property
    def stale_outputs(self) -> list[Path]:
        """Files earlier layouts wrote that the current export no longer produces."""
        return [
            self.output / "trip.xlsx",
            *sorted(self.output.glob("mymaps_*.csv")),
            *sorted(self.trips_dir.glob("*/dashboard.xlsx")),
            *sorted(self.trips_dir.glob("*/plan-to-go.xlsx")),
        ]

    def raw_video(self, video_id: str) -> Path:
        return self.raw / video_id

    def ensure(self) -> None:
        for directory in (
            self.raw,
            self.cache,
            self.extract_dir,
            self.output,
            self.links_file.parent,
        ):
            directory.mkdir(parents=True, exist_ok=True)
