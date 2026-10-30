---
name: project_directus_bench_cache_status_misread
description: The `Bench / cache` status line lists headline figures, not the gates that breached; read the OVER rows in the Cache job log
metadata:
  type: project
---
The `Bench / cache` commit-status description ("2 gate(s) OVER — flat hit …, 1.0 redis cmd/hit, fan fill 1.56x cpu") names headline figures, NOT the breached gates. On 2026-09-29 I read "fan fill 1.56x cpu" as the breach and blamed #534 for a CPU regression; the real breaches were the absolute Redis-command ceilings #562 added knowingly red (scoped fill 8.98 > 7, scoped fan fill 809.09 > 7), tracked by #560.

**Why:** a wrong breach sends an issue at the wrong PR.

**How to apply:** `gh api repos/jclaveau/directus/actions/jobs/<Cache job id>/logs | grep OVER` before naming a breach; then `git merge-base --is-ancestor <gate commit> <pre-merge trunk>` to tell a new gate from a regression. Until the fan-fill fix, every PR's `Bench / cache` reads red. See [[project_directus_bench_workflow_traps]].
