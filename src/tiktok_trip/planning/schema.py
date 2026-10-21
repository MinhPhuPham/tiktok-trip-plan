"""The plan.json Claude Code writes: stop order per day, no times (the code computes them)."""

from __future__ import annotations

from typing import Any, Literal, get_args

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from tiktok_trip.extraction.parse import ExtractionParseError, parse_json_payload

REST_REF = "rest"

UnplacedCode = Literal["out_of_days", "too_far", "low_priority", "closed", "out_of_window", "other"]
UNPLACED_CODES: tuple[str, ...] = get_args(UnplacedCode)


class PlanStop(BaseModel):
    ref: str = Field(min_length=1, description="place id, nearby spot id, or 'rest'")
    slot: str | None = None
    reason: str | None = None
    """Short note for the traveller in English: why this place, why now."""
    reason_vi: str | None = None
    """The same note in Vietnamese; exports fall back to `reason` without it."""


class PlanDay(BaseModel):
    day: int | None = Field(default=None, ge=1)
    stops: list[PlanStop] = Field(default_factory=list)


class UnplacedRef(BaseModel):
    ref: str = Field(min_length=1)
    code: UnplacedCode | None = None
    """Why it is left out; exports show the code's label in both languages."""
    reason: str = ""
    """Optional short detail in English."""

    @field_validator("code", mode="before")
    @classmethod
    def _unknown_code_is_other(cls, value: object) -> object:
        if value is None or value == "":
            return None
        text = str(value).strip().lower().replace(" ", "_").replace("-", "_")
        return text if text in UNPLACED_CODES else "other"

    @field_validator("reason", mode="before")
    @classmethod
    def _missing_reason_is_empty(cls, value: object) -> object:
        return "" if value is None else value


class AgentPlan(BaseModel):
    days: list[PlanDay] = Field(default_factory=list)
    unplaced: list[UnplacedRef] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _bare_day_list(cls, value: Any) -> Any:
        return {"days": value} if isinstance(value, list) else value


class PlanParseError(ValueError):
    pass


def parse_plan(text: str) -> AgentPlan:
    """Tolerant: code fences and stray prose around the JSON are ignored."""
    try:
        payload = parse_json_payload(text)
    except ExtractionParseError as exc:
        raise PlanParseError(str(exc)) from exc
    try:
        return AgentPlan.model_validate(payload)
    except ValidationError as exc:
        details = "; ".join(
            f"{'.'.join(str(p) for p in err['loc']) or '(root)'}: {err['msg']}"
            for err in exc.errors()[:10]
        )
        raise PlanParseError(f"plan.json does not match the schema: {details}") from exc
