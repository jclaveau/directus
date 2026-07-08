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
- [Service-level read-through cache + CACHE_TYPES](project_directus_service_cache.md) — readByQuery caches via service-cache.ts (dual-write, own key namespace, HTTP fast-path intact); CACHE_TYPES array selects api/service consumers; settled decisions (system-collection excluded for security, TTL shared, gql out-of-scope) so review doesn't re-litigate; PR #207
- [Permission-case scoped cache (PR #212)](project_directus_permission_case_cache.md) — pin scoped-cache read tags off ast.cases (permission policy), not just the API filter; generalized `_or` in the filter pinner (union iff all branches bind); reuse joinFilterWithCases; settled: cases pre-resolved so no resolver, DNF rejected, no `_not`, root-cases-only. MERGED.
- [Style (changes) ≠ Lint job](reference_directus_style_changes_vs_lint_split.md) — the changed-line Style gate is WIDTH-only; full-lint rules (padding-line-between-statements) fire in the separate Lint job → a 90-col wrap can pass Style(changes), fail Lint; run full `eslint <file>` after any width wrap
- [Blackbox test sharding](project_directus_blackbox_sharding.md) — vendor×shard matrix + ordering-barrier constraints (before in every shard, guard empty describes, sort() throw); wall-clock floor = prepare + max(biggest file, serial after-chain); build-caching is a NET LOSS with parallel shards; ~18→~10.8min at N=5
- [Batch API ops in blackbox seeds](project_directus_blackbox_batch_seeds.md) — prefer CreateCollections (array POST → createMany, fields folded into the collection payload) / CreateItem array bodies over per-entity loops; no batch collection DELETE endpoint so cleanup stays 1-by-1
- [DB connection priority (PR #213)](project_directus_db_connection_priority.md) — policy grants ranked DB connections; DatabasePoolExhaustedError (429+reason, per-dialect detection); settled decisions (priority on connection, dup-name throws, 429-not-503); CreateItem already batches — MAX_BATCH loops are intentional
