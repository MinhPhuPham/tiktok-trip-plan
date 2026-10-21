# Day-by-day trip plan for $city

You are the trip planner for a $days_text trip to $city. Build a smart day-by-day plan from the
places below that follows the rhythm of a day, from early morning to night, with short legs.
You decide WHICH stops go on WHICH day and in WHAT ORDER. You do not compute any times: the code
reads your plan, computes every arrival and departure from the travel matrix, the opening hours
and the service minutes, and checks the rules.

Steps for Claude Code:
1. Read this prompt and the travel matrix `$matrix_path`.
2. Write the plan JSON, and nothing else, to `$output_path`.
3. Run `uv run tiktok-trip route`. It computes the clock and writes `$validation_path`.
   If it exits with code 2, read the hard violations there, fix plan.json and run it again
   until there are none. Fix warnings too when that does not break a hard rule.

## Trip

- City: $city
- Days: $days ($day_lines)
- Day window: $day_start to $day_end (leave the center no earlier, finish the last stop no later)
- Travel mode: $travel_mode. Travel times: $matrix_source
- Center (every day starts and ends here): $center_name, $center_kind.
  Map: $center_url
- Places: $place_count (every one must be used once). Nearby spots: $spot_count (optional fillers).
- Aim for about $per_day places a day$cap_note; at most $max_nearby nearby spots a day.
  Places that do not fit go under `unplaced` with a code; prefer must, then high priority.
- Service minutes (time spent at a stop): $service_text.

## Day rhythm (slots, in order)

Slots are guidance, not hard windows: a stop is never started before its slot begins, and the day
should follow this order. The `rest` slot has no place: it is a `rest` stop back at the center.

| slot | activity | window | suits | ideas |
|------|----------|--------|-------|-------|
$rhythm_table

## Places ($place_count)

`priority`: `must` = on the traveller's own must-go list (input/preferences.yaml); otherwise high,
medium or low from the TikTok recommendations (high = recommended in several posts or singled out
as a must-try; `-` = unknown); the table lists must first, then high.
`dir/zone`: compass direction from the center and zone (places in the same or neighbouring
directions belong on the same day). `km`: straight line from the center. `min`: travel minutes
from the center (matrix). `hours`: opening hours for the trip weekdays ("CLOSED day N" when closed
on that trip day). `best` / `deadline`: best time (source: why; `heuristic` = estimated from the
tags) and the latest start (sells out or closes early). `tags`: what the place is good for, from
its name, dishes, notes and opening hours (breakfast, lunch, dinner, snack, late_night, view,
dessert, garden, work_friendly, sunset, sunrise, cloud_hunting, photo_spot, family, nature,
history, shopping, service).

| id | name | priority | category | dir/zone | km | min | lat,lng | hours | best (source: why) | deadline | price | must try | note | mentions | tags |
|----|------|----------|----------|----------|----|-----|---------|-------|--------------------|----------|-------|----------|------|----------|------|
$places_table

## Nearby spots ($spot_count, optional fillers)

Famous spots near the places (OpenStreetMap / Google). Use them only to fill a gap in a day
(at most $max_nearby a day), never instead of a place. $nearby_service minutes each.

| id | name | kind | zone | km | min | lat,lng |
|----|------|------|------|----|-----|---------|
$spots_table

## Travel matrix

`$matrix_path` is a square CSV of travel minutes, $matrix_shape: the header row is `from` then one
column per id; each following row starts with the `from` id. Row = from, column = to. The id
`center` is the center ($center_name); `rest` stops use the `center` column. Read it with:

```python
import csv

rows = list(csv.reader(open("$matrix_path", encoding="utf-8")))
ids = rows[0][1:]
minutes = {(r[0], to): int(v) for r in rows[1:] for to, v in zip(ids, r[1:])}
```

## Rules

1. Every place appears exactly once across the days, or once under `unplaced` with a `code`
   (see the schema) and an optional short `reason`. Never drop a place silently.
   Never invent ids: use the ids from the tables, or `rest`.
2. You MUST place every `must` place: never leave one under `unplaced` unless it is closed on
   every trip day (code `closed`); give it the day and slot it fits best and plan the rest
   around it. Then place every high-priority place; prefer medium over low when time is short;
   medium and low places left out for time get the code `low_priority`.
3. Respect opening hours and deadlines: put a place in a slot when it is open on that trip day,
   with time for the whole visit before closing, and before its deadline.
4. Follow the rhythm order within a day: $slot_order. Skip slots that have no
   suitable place; do not reorder them. Match meal tags to meal slots (breakfast, lunch,
   dinner; late_night and snack after dinner); cafés with view/sunset to the afternoon café slot;
   sunrise/cloud_hunting to the sunrise slot; garden, nature, family, history and photo_spot to the
   morning; shopping and markets to the evening. Use the best time to break ties.
   At most one breakfast stop a day, unless the second one is a light snack and its reason says
   so ("Light snack: ..."). A second food stop after dinner is a snack or a drink: put it in the
   `evening` slot and say "snack" in its reason, never a second `dinner`. When a day starts with
   a sunrise stop, aim to be back at the center by 21:00.
5. Keep each day inside one or two neighbouring directions (see dir/zone) so legs stay short.
   Prefer the shortest legs from the matrix; avoid legs over $long_leg minutes.
6. Use nearby spots only to fill a gap in a day (at most $max_nearby a day).
7. $rest_rule
8. Give each stop the `slot` id it fills and a short note for the traveller in English
   (`reason`) and in Vietnamese (`reason_vi`): what to do or eat there and why now, at most
   about 12 words, e.g. "Sunrise over the hills, opens 5:00" / "Ngắm bình minh trên đồi, mở cửa
   5:00". Write for the traveller, not for the planner: no "MUST-GO:", no mention counts, no
   "user's own list", no ids, directions or zone codes.
9. Use at most $days days. Number days 1, 2, 3 in order.
10. Do not compute or write any times. The code computes them.
11. Output JSON only: no prose, no markdown, no code fences.

## Output schema

```
{"days": [{"day": <1-based day number>,
           "stops": [{"ref": "<place id | nearby id | rest>",
                      "slot": "<rhythm slot id>",
                      "reason": "<short note for the traveller, English>",
                      "reason_vi": "<the same note in Vietnamese>"}]}],
 "unplaced": [{"ref": "<place id>",
               "code": "<out_of_days | too_far | low_priority | closed | out_of_window | other>",
               "reason": "<optional short detail in English that the code does not say>"}]}
```

Codes: `out_of_days` no room left in the trip days; `too_far` too far from the center for this
trip; `low_priority` medium or low priority, left out for time; `closed` closed on every trip
day; `out_of_window` its hours or best time clash with the slots left (e.g. a morning-only café
when the mornings are full); `other` anything else (say what in `reason`).

```
```

Example (the ids are made up):

```json
$example
```

Write the JSON to: `$output_path`
