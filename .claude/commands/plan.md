---
description: Regenerate the day-by-day plan (plan-to-go) from the current places, with validation
argument-hint: "[extra wishes, e.g. 'keep day 2 light']"
---

Build the smart day-by-day plan. Follow CLAUDE.md "Day plan": you choose the days and the order of
the stops; the code computes every time and checks the rules. Never write times, never invent ids.

Extra wishes from the user: `$ARGUMENTS`

1. Run `uv run tiktok-trip route`. It writes `data/plan/prompt.md` and
   `data/plan/travel_minutes.csv` (exit code 2 while plan.json is missing or stale is expected).
   If `config.yaml` has `plan.mode: solver`, tell the user and stop.
2. Read `data/plan/prompt.md` completely, and read the matrix CSV (e.g. with a short Python snippet)
   to compare legs between candidate stops.
3. Plan: group places by direction (one or two neighbouring directions a day), place each one in
   the rhythm slot that suits it (hint, category, opening hours, deadline, best time), keep legs
   short, add a `rest` stop after lunch on long days, use nearby spots only to fill gaps. Every
   place goes into exactly one day or under `unplaced` with a `code`. Every stop gets a short
   traveller note in English and Vietnamese (`reason`, `reason_vi`). Apply the user's wishes when
   they do not break a rule.
4. Write the JSON, and nothing else, to `data/plan/plan.json` (schema in the prompt).
5. Run `uv run tiktok-trip route`. If it exits with code 2, read `data/plan/validation.md`, fix
   every hard violation (and warnings when possible), rewrite plan.json and run it again. Repeat
   until it passes.
6. Run `uv run tiktok-trip export` and summarise per day for the user: the stops with their computed
   times (from `data/plan/validation.md` "Computed clock"), the unplaced places and remaining
   warnings, and the refreshed `output/trips/<en|vi>/trip.xlsx` (Plan-to-go sheet, plus the
   plan at a glance on the Dashboard).
