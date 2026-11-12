---
name: project_directus_extension_migrations_653
description: Issue #653 extensions ship their own migrations — why upstream dropped them (2023-24 Marketplace), options A/B/C, the before-schema-sync ordering case to keep in the design; handed to session extensions-migrations-bb
metadata:
  author: Jean Claveau
  type: project
---

Fork issue jclaveau/directus#653: extensions declare migrations (in `package.json`), core runner runs them — no files copied into `MIGRATIONS_PATH`. Filed 2026-10-30, handed to session `ca344f14` (`extensions-migrations-bb`). A consumer also needs it (it copies wrapper files into a migrations folder today); public repo, so the issue names it only "a consumer" ([[feedback_directus_no_consumer_data_in_fork_memories]]).

Why upstream dropped extension migrations (do not re-investigate):
- 2020-12 `d352609a50` read from `$EXTENSIONS_PATH/migrations` → 2023-12 #20627 `$MIGRATIONS_PATH` → 2024-01 #20624 per-type extension folders dropped → 2024-03 Marketplace #21674 → #21719 "Migrations are no longer considered an extension type".
- rijkvanzanten (#20625/#20626): never loaded through the extensions engine; "don't work cross database vendor, no permissions/checks (straight to knex), not something to install from a third-party vendor"; wanted a declarative DB-agnostic format first (never shipped). Open: directus#25605 (custom migrations must be .js/.mjs/.cjs).
- Reasons were Marketplace + untrusted code + portability: none applies to a first-party extension in a PG-first fork.

Options weighed: **A** extension build writes `.js` migrations into the image's `MIGRATIONS_PATH` (0 core diff, versioned; operator copies if installed outside our build) — recommended for v1; **B** core change, non-sandboxed extensions only (small diff, we own it) — what #653 does; **C** create collections at boot via services (no down/ordering, but cross-DB).

Design point to keep: a migration that must run BEFORE the schema-sync import (old case: `directus_activity.user_agent` varchar(255) overflow, upstream #19642). Core now fixes that itself (`20240305A-change-useragent-type`), but an after-schema step (indexes/data on collections the import creates) is still needed; #653 asks whether a before-schema step should exist at all.

**Why:** an earlier answer called extension migrations "the only real gap" for a first-party subscriptions extension ([[project_directus_issue652_subscriptions_stripe_survey]]) — corrected: A covers it with no core change.
**How to apply:** open #653 before touching the migration runner; check #421 (health hold while migrations outstanding) and #452 (scheduled-job hold) cover extension migrations too — unchecked.
