---
description: Walk through pending review rows (ambiguous or low-confidence matches) with the user
argument-hint: "[candidate key]"
---

Resolve flagged candidates by hand. Never pick a match silently; the user decides.

Optional key from the user: `$ARGUMENTS`

1. Run `uv run tiktok-trip review` (or read `data/review.csv`) to list the pending rows.
   If `$ARGUMENTS` is a key, handle only that row.
2. For each pending row show: candidate name, video link, the evidence quotes, the reason
   (`ambiguous_branch`, `low_name_score`, `outside_city`, `not_found`, `closed`, `low_confidence`) and
   each option with place_id, address, distance from the center and name score.
3. Ask the user to choose one option's `place_id`, or `skip`. Recommend an option only when the evidence
   (street, ward, landmark) clearly supports it, and say why. Never invent an address or place_id.
4. Record each decision: `uv run tiktok-trip review "<key>" <place_id|skip>`.
5. When no rows are pending, run `uv run tiktok-trip run --from resolve` and report the result as in `/run`.
