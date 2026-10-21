---
description: Run the full TikTok trip pipeline (fetch to export) with the review gate
argument-hint: "[--from <step>] [--to <step>]"
---

Run the whole pipeline for this project. Follow CLAUDE.md rules: steps in order, never re-download, never invent addresses.

Extra arguments from the user: `$ARGUMENTS`

1. Check `config.yaml` (city, center.hotel/override, spatial.sectors, travel.mode, trip.days) and that
   `input/links.txt` has links. If something is clearly unset, ask the user before spending API calls.
2. Run `uv run tiktok-trip run $ARGUMENTS`.
3. Extraction loop (you do the extraction yourself, in this session). If the extract step reports
   prompt files waiting in `data/extract/<id>/prompt.md`:
   - For each listed video, read `prompt.md` and view the frame images it lists.
   - Write `data/extract/<id>/candidates.json` following the schema in the prompt (evidence required for every address).
   - Run `uv run tiktok-trip extract` again to collect the candidates.
   - Then continue with `uv run tiktok-trip run --from resolve`.
4. Review gate. If the run stops after `resolve` (exit code 2) because `data/review.json` has pending rows,
   do not continue on your own. Follow the `/review` command: present each row to the user, record the
   decisions, then `uv run tiktok-trip run --from resolve`.
5. Plan gate (`plan.mode: agent`, the default). If the run stops at `route` with exit code 2
   ("plan prompt waiting for Claude Code" or hard violations), follow `/plan`: read
   `data/plan/prompt.md` and `data/plan/travel_minutes.csv`, write `data/plan/plan.json`, run
   `uv run tiktok-trip route` until `data/plan/validation.md` shows no hard violation, then
   `uv run tiktok-trip run --from export`. Never write times; the code computes them.
6. When export finishes, summarize for the user: number of places and zones, the center source
   (hotel / override / city_default) and any spatial warning, days planned (and the places left unplaced, with reasons), and the files in `output/`
   (`trips/en|vi/trip.xlsx` with the Dashboard and Plan-to-go sheets, `map.html`, `mymaps/mymaps_<SECTOR>.csv`). Mention paid-service usage from `uv run tiktok-trip quota` (per SKU, against the free caps).
