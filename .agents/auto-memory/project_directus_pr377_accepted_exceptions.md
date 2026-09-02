---
name: project_directus_pr377_accepted_exceptions
description: PR #377 "perf(cache-stats) group the entries listing on the cache key alone" — MERGED 2026-08-21; settled points a fresh review must not re-raise, plus the two follow-ups jean has NOT decided
metadata:
  type: project
---

Merged into `v11.10.1-hhh-dev` as `4682664f45` (2026-08-21). Settled — do NOT re-raise:

- **The PR's own headline claim is refuted and that is documented, not a bug.** The
  description leads with a correction; the body, the code comments and the tests all
  say the real reason. Do not "helpfully" restore the timeout/spill rationale.
  Facts live in [[project_directus_cache_entries_query_perf]].
- **The two-read shape ships with its race.** A descriptor reaped between the
  aggregate and the dimension read drops that key; test `drops a key whose descriptor
  went away between the two reads` pins it. Accepted knowingly.
- **`listedKeys` is a superset of what is listed** (built from the aggregate, not the
  merged rows), so the purge passes query a few dead keys. Flagged, accepted.
- **The 24h default bypasses the retention clamp while the two 10m ones go through
  it** (`clampCacheStatsWindow(undefined)` short-circuits). Pre-existing, flagged.
- **Two constants at the same 10m value** (`DEFAULT_CACHE_ENTRIES_WINDOW`,
  `DEFAULT_CACHE_LATENCIES_WINDOW`) kept separate on purpose, so either listing tunes
  alone. Anomalies + timeseries stay on the shared 24h — measured, they gain nothing.
- **The docblock still says "Recent cache activity"** after jean renamed the variable
  off `activity`. Raised, left as prose.

**Open, jean has NOT ruled** (both live in PR threads, do not decide them yourself):

- The **single-statement CTE** — same cost within noise, one round trip, removes the
  race. Offered, unanswered.
- **`listCacheGroupLatencies` has no `LIMIT` and no `ORDER BY`** — 1,904 unbounded rows
  at 10m, 60,518 at 24h. Capping means choosing which groups get dropped: his call.

**How to apply:** reviewing this area in a clean session, read this first; the
"obvious" findings above are already closed.
