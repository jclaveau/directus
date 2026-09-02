---
name: project_directus_blackbox_spawn_own_instance
description: A blackbox spec can spawn its own Directus on a free port with a custom env — the only way to test boot-state behaviour, and readiness is /server/ping not /server/health
metadata:
  type: project
---

`tests/db/routes/flows/webhook.test.ts` is the pattern: `spawn('node', [paths.cli,
'start'], { cwd: paths.cwd, env })` with `getPort()` and `cloneDeep(config.envs)`, then
`awaitDirectusConnection(port)`.

That makes boot-state behaviour testable without touching the shared instance:

- Point `EXTENSIONS_PATH` at a temp dir holding `migrations/<version>-x.js` and the
  instance sees a migration the database never recorded — no other instance in the run
  can see the file, and the shared database is untouched.
- `MIGRATIONS_PATH` + `spawnSync(node, [cli, 'database', 'migrate:latest'])` runs the real
  runner against the vendor database. Keep versions far in the future, and clean up in
  `afterAll` (drop the table, delete the version rows) — extra committed rows are
  harmless to other instances, which do not have the files.

**Readiness is `/server/ping`**, not `/server/health` (`utils/await-connection.ts`), so a
guard that reds health cannot wedge bb boot.

**Why:** the migrations health guard only holds before the watch's first clean reading, so
there is no way to push a correctly-migrated instance back into the red state from
outside. Without a spawned instance that behaviour is untestable end to end.

Related: [[reference_blackbox_extensions_are_global]] — repointing `EXTENSIONS_PATH` also
unloads the shared test extensions for that instance, which is fine for a health-only spec.
