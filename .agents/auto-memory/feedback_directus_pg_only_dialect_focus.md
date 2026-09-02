---
name: feedback_directus_pg_only_dialect_focus
description: on jclaveau/directus, do NOT spend effort on MariaDB or SQLite in the main workflow — postgres is the only dialect that matters for now; they may be revisited in several months
metadata:
  type: feedback
---

**Postgres is the only dialect to consider in the main workflow.** Do not treat missing
MariaDB / SQLite coverage as a gap, do not flag it as a review finding, and do not add
work to close it. jean, 2026-08-17: _"Maria / Sqlite, don't care during the main wf, we
may handle them in several month"_.

**Why:** the blackbox PR matrix already encodes this — `blackbox.yml` runs a
**postgres-only** smoke set on `pull_request`, holding `sqlite3` and `maria` out because
at 8 shards a vendor the matrices queue behind each other and the wait costs more wall
clock than the shards save. They are covered by standing dialect branches that re-run
against each `v11.10.1-hhh-dev` tip. `push` to main and `inputs.full` still use the full
`["sqlite3","postgres","maria"]` set.

**How to apply:**
- A new blackbox suite needs no per-vendor reasoning; it runs on postgres and that is
  enough evidence to merge.
- Never write "sqlite/maria coverage is missing" in a PR body or a review as if it were
  a defect. It is the deliberate configuration.
- **A red `ci-dialect-sqlite3` / `ci-dialect-maria` branch is not a merge blocker and not
  work to schedule**, even when the failing test is one you just wrote. 2026-09-02 I
  root-caused two fresh shard-7 failures there after #421 and offered a fix; jean:
  _"maria and sqlite are out of scope currently"_. Read those branches only to know which
  dialect claims in a PR body are unproven, and say so in the body instead of chasing the
  red ([[project_directus_trunk_full_vendor_matrix]]).
- Vendor-specific behaviour I reason about (postgres trimming whitespace casting text to
  int, sqlite column affinity) is still worth stating when it explains a bug — the rule
  is about not *investing* in the other two, not about pretending they don't exist.
- The fork's supported set is still PostgreSQL + MariaDB + SQLite per AGENTS.md, so do
  not delete their code paths ([[project_directus_db_clients]]).

Related: [[feedback_supported_dialects_need_live_tests]] (the general rule this
project-scopes against), [[project_directus_blackbox_sharding]].
