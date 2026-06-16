- [Directus DB clients & batch-insert RETURNING support](project_directus_db_clients.md) — canonical list in
  `api/src/types/database.ts`; MariaDB rides under `mysql`; mysql/mariadb/sqlite hit the fallback loop
- [Amending the prior commit is OK on this feature branch](feedback_amend_ok.md) — for upstream-bound PR work, prefer
  `git commit --amend` + `git push --force-with-lease` over layered fix-up commits
- [Don't ask before pnpm install / build in this repo](feedback_no_ask_for_build_install.md) — project override of the
  global ask-before-install rule; routine install/build steps run silently, dep-modifying commands still ask
- [Fork integration branches (main overlay + hhh-main)](project_directus_fork_integration_branches.md) — main =
  upstream + compose-hhh-main.yml overlay; hhh-main auto-composed from open PRs; blackbox/e2e label-gated;
  blackbox-pr.yml is name:Check; CI gates = build+eslint+stylelint (no tsc); mssql dropped (fork-runner saturation)
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
