"""trip.xlsx (one per language): the Dashboard sheet and the Plan-to-go sheet."""

from __future__ import annotations

import logging
from pathlib import Path

from openpyxl import Workbook

from tiktok_trip.export.dataset import ExportData
from tiktok_trip.export.excel_dashboard import build_dashboard
from tiktok_trip.export.excel_plan import build_plan
from tiktok_trip.export.i18n import Labels

logger = logging.getLogger(__name__)


def trip_sheets(labels: Labels) -> tuple[str, str]:
    return labels.dashboard_sheet, labels.plan_sheet


def build_trip_workbook(data: ExportData, labels: Labels) -> Workbook:
    workbook = Workbook()
    dashboard = workbook.active
    assert dashboard is not None
    dashboard.title = labels.dashboard_sheet
    build_dashboard(dashboard, data, labels)
    build_plan(workbook.create_sheet(labels.plan_sheet), data, labels)
    workbook.active = 0
    return workbook


def write_trip(data: ExportData, labels: Labels, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    build_trip_workbook(data, labels).save(path)
    logger.info("Wrote %s", path)
    return path
