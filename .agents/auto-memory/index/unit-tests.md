# unit-tests — vitest mocks, typecheck, local test env

Full hooks for this area. The routing keys live in `../MEMORY.md`.

- [Worktree vitest barrel/stream-json fail](../reference_directus_worktree_vitest_barrel.md) — symlinked-node_modules worktree can't resolve stream-json subpath via services barrel; mock the barrel-reaching import or import concrete module
- [api vitest typecheck blocked by pre-existing debt](../reference_api_typecheck_blocked.md) — \*.test-d.ts never run; enabling typecheck surfaces ~203 src type errors (and emitter graph pulls in untyped pino-http-print) → needs a dedicated cleanup PR
- [cache-events.test.ts shares ONE mock builder](../project_directus_cache_events_mock_builder.md) — resolved by `lastTable` at await time, so two builders held before either awaits both read the last table; never Promise.all two queries there; real SQL belongs in blackbox
- [knex-mock matches raw SQL](../reference_directus_knex_mock_sql_matching.md) — a column name steals another table's query; register the narrower handler first; RELATIONAL_BATCH_SIZE loop
- [app.test.ts cannot pass locally](../project_directus_local_api_test_env.md) — it needs a built `@directus/app`, whose build dies with SIGHUP under the Bash tool; read the failure text before calling any api-suite failure environmental
- [vitest typecheck gate behaviour](../project_directus_vitest_typecheck_gate.md) — per-file runs hide the ambient `Errors N` line; the gate SELF-DISABLES in a package with no *.test-d.ts (exit 0, measured) so a guard test pins it; `tsc -p api` is the clean 0-error instrument
- [useEnv mock needs vi.hoisted, not automock](../reference_directus_useenv_mock_hoisted.md) — automock evals real module first → useEnv() undefined; concurrent mocked replays need dispatch-by-path not FIFO Once
- [v-dialog's focus trap breaks app tests](../reference_directus_vdialog_focus_trap_tests.md) — jsdom reports nothing tabbable, so the hand-back rejects and the job fails with every test passing; mock `@vueuse/integrations/useFocusTrap`
