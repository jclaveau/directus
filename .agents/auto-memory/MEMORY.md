- [Directus DB clients & batch-insert RETURNING support](project_directus_db_clients.md) — canonical list in
  `api/src/types/database.ts`; MariaDB rides under `mysql`; mysql/mariadb/sqlite hit the fallback loop
- [Amending the prior commit is OK on this feature branch](feedback_amend_ok.md) — for upstream-bound PR work, prefer
  `git commit --amend` + `git push --force-with-lease` over layered fix-up commits
- [Don't ask before pnpm install / build in this repo](feedback_no_ask_for_build_install.md) — project override of the
  global ask-before-install rule; routine install/build steps run silently, dep-modifying commands still ask
- [Fork integration branches (pr-controle topology)](project_directus_fork_integration_branches.md) — pr-controle =
  default/trunk (all fork CI); main = clean upstream base; hhh-main = derived from the copy stack; supersedes old
  main-overlay model; blackbox/e2e label-gated; blackbox-pr.yml is name:Check; CI gates = build+eslint+stylelint (no
  tsc)
- [Compose copy-stack architecture](project_directus_compose_copy_stack.md) — upstream-draft PRs isolated for upstream;
  parallel hhh-main-root/stacked copies resolve overlaps once; compose consumes the copies; SSH deploy key for
  workflow-file pushes; cla-bot reads contributors.yml from head ref → inject hhh-bot
- [Stacked copy rebuild gotchas](project_directus_stacked_rebuild_gotchas.md) — cherry-pick branches independent (fix
  low → rebuild above); divergent stacked history ≠ rebase (#52); merge-tree forced-base lies when behind main;
  test-file two-block merge must close the first block; semantic interactions (#50 vs #58) only surface in the full api
  test
- [Directus v12 license → dual-target compose](project_directus_v12_license_dual_compose.md) — v12+ needs a license key;
  v11.9.2 = last license-free release Hippocast runs; fork keeps last-v11 + main lines; compose infra (#64/#65) targets
  main only for now, last-v11 is a deferred phase; `upstream-diff:` = fork-permanent, lands on main, never upstream
- [Compose stack order rubric](project_directus_compose_stack_order_rubric.md) — hhh-main rebased-copy tree: roots =
  only isolated PRs; order root→leaf bugfix → perf → light contract consistency (payload/reasons) → contract changes
  (light→heavy) → refused-upstream; deps override rank only when a branch carries another's code
- [knex >=3.2 breaks Directus deep sort](project_directus_knex_deepsort_regression.md) — knex 3.2.10 #6392 wraps window
  aliases; Directus pre-wraps directus_row_number → double-escape → 500 on every o2m/m2m/m2a sort; pin knex 3.1.0
- [Codecov per-package flags; blackbox not in api unit flag](project_directus_codecov_flags.md) — codecov/patch/<pkg>
  target=auto≈project; blackbox-only api code fails patch/api → needs knex-mock-client unit tests; constants barrel line
  needs import-through-index
- [Directus ForbiddenError conventions](project_directus_forbidden_error_conventions.md) — 403 for missing items
  (anti-enumeration), pre-access validation → 400, ForbiddenError({reason}) is upstream + always-visible, status never
  env-gated; PRs #61/#62
- [api vitest typecheck blocked by pre-existing debt](reference_api_typecheck_blocked.md) — \*.test-d.ts never run;
  enabling typecheck surfaces ~203 src type errors (and emitter graph pulls in untyped pino-http-print) → needs a
  dedicated cleanup PR
