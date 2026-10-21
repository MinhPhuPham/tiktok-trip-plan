---
description: Add one or more TikTok links and update every output
argument-hint: "<tiktok url> [<tiktok url> ...]"
---

Add new links: `$ARGUMENTS`

1. If no URL was given, ask the user for one. Do not guess links.
2. Run `uv run tiktok-trip add $ARGUMENTS`. This appends to `input/links.txt`, fetches only the new
   videos (existing `data/raw/<id>` folders are reused) and rebuilds the downstream steps.
3. Extraction loop (you do the extraction yourself, in this session): if extract reports
   `data/extract/<id>/prompt.md` files, read each prompt and the frame images it lists, write
   `data/extract/<id>/candidates.json` per the schema in the prompt (evidence required for every
   address), run `uv run tiktok-trip extract` to collect them, then
   `uv run tiktok-trip run --from resolve`.
4. If the run stops after `resolve` with pending review rows, follow `/review`, then
   `uv run tiktok-trip run --from resolve`.
5. Report which places were added or changed and where the refreshed `output/` files are.
