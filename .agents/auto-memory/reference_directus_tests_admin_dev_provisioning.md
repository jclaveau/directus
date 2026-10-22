---
name: reference_directus_tests_admin_dev_provisioning
description: How to add tests-admin@hiphiphip.fr to planner's dev DB safely — targeted user restore only, never the PR-seed pipeline
metadata:
  author: Jean Claveau
  type: reference
---

`tests-admin@hiphiphip.fr` has exactly two creation paths, and **neither ever touches
dev**: (1) CI/local restore via `pnpm db:restore:user:local tests-admin@hiphiphip.fr
--backup-dir test-utils`, applying the checked-in
`apps/test-utils/user_export.tests-admin@hiphiphip.fr.sql`; (2) PR-preview seeding via
`cd_seed_pr_env.sh`, which **hard-refuses** `production|prod|dev|develop|development|
staging|main|master` by name before its positive `*pr-[0-9]*` allowlist even runs — its
own header says why: "the reseed drops every table, so a false match against
production/dev would be catastrophic", safe only because each PR env owns its own
Postgres, never a shared one.

**The trap:** dev's Api service *does* carry `TESTS_ADMIN_EMAIL`/`TESTS_ADMIN_PASSWORD`
as inputs for that seeding script — their presence looks like proof the account exists,
but it doesn't, and auth against dev with the CI secrets 401s.

**The safe fix, confirmed on dev:** the *targeted* user-restore path,
`pnpm db:restore:user:railway tests-admin@hiphiphip.fr --backup-dir test-utils`
(`-e dev` pinned explicitly — `railway-postgres-cmd.sh`'s bare `railway environment;`
trusts the directory link, which can point at production). This applies only the one
export file: an `INSERT ... ON CONFLICT (id) DO NOTHING` plus a set of `DELETE`s scoped
to `user_created = '<export's fixture user>'`, who owns nothing on dev — verified all
14 DELETEs return `DELETE 0` before running for real. The export's `role` id happens to
equal dev's real Administrator role id, so it lands as a working admin with the same
argon2 hash CI uses. **Do not** run `cd_seed_pr_env.sh` itself even though its gate
technically allows dev for the sub-parts that don't hard-refuse — reading further in, it
also runs `reset_serial_sequences.sql` (every table) and
`shift_academic_year_to_current.sql` unconditionally, piped through
`docker compose exec hhh-database`; that's a shared-DB blast radius far beyond "add one
admin row".

**Why:** dev's Postgres (`Postgres-HipHipHip-test`) is shared across the whole dev
environment, unlike a PR env's disposable one.

**How to apply:** whenever `logginAsTestsAdmin()` or `.env.test.secrets` 401s against a
shared Railway environment (dev, and by the same logic never prod), reach for the
targeted restore command above, not the seeding pipeline — and read a seed script's full
body before trusting its own gate comment to describe everything it does.
