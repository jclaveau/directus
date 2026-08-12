# AGENTS.md

Guidance for AI coding assistants working in this repository.

## Project memory

Everything this repo has already learned — ports, harness gotchas, settled
decisions, conventions — is indexed here, one line per entry. Read the linked
file before re-deriving anything it covers, and add to it rather than to this
file: a fact belongs in `.agents/auto-memory/`, and only the non-discoverable
conventions below belong here.

@.agents/auto-memory/MEMORY.md

## This fork (Scalabus)

This is **Scalabus**, a performance/scalability fork of
[Directus](https://github.com/directus/directus) that tracks only Directus's
**BSL-1.1** releases — the line before the MSCL-1.0-GPL relicense at `v12.0.0-rc.1`.
See `readme.md` for scope and published versions.

Directus is a real-time API + App dashboard for SQL databases; this is a pnpm monorepo
(`/api` Express+Knex backend, `/app` Vue 3 dashboard, `/sdk`, `/packages/*`).

- **Default / work branch: `v11.10.1-hhh-dev`.** Base new work on it and open PRs into
  it. `main` is a clean upstream mirror, not the work branch.
- **No Prettier.** Formatting and style are owned by `eslint.style.config.js`, enforced
  **diff-scoped** (added lines only) via `pnpm lint:style:changes`. Do not add prettier
  config or run `prettier` — it is not installed.
- `.claude/` ships PostToolUse hooks that auto-`--fix` edited files with eslint and
  stylelint.

## Requirements

- Node.js 22
- pnpm >=10 <11

## Common Commands

```bash
pnpm install                        # install dependencies
pnpm build                          # build all packages
pnpm --filter @directus/api build   # build one package

cd api && pnpm dev                  # API on :8055 (hot reload)
cd app && pnpm dev                  # App on :8080 (Vite HMR)

pnpm lint                           # ESLint (base config, whole repo)
pnpm lint:style:changes             # STYLE GATE: eslint.style over lines added vs base
pnpm lint:style                     # Stylelint for CSS/SCSS/Vue

pnpm test                           # all unit tests
pnpm --filter @directus/api test    # one package
pnpm test:coverage                  # coverage
pnpm test:blackbox                  # blackbox suite (builds a dist first)
```

## Code Style

- TypeScript + ES modules for all new code.
- Two ESLint configs: `eslint.config.js` (base, close to upstream) applied repo-wide by
  `pnpm lint`; `eslint.style.config.js` (strict, e.g. 85-column) applied **only to added
  lines** via `pnpm lint:style:changes` — the style authority.
- **No Prettier** — do not add prettier config or run it.
- Keep diffs minimal versus upstream: never reformat untouched upstream lines (the style
  gate is added-lines-only for exactly this reason).
- Test files `*.test.ts` next to source; vitest (`describe`/`test`/`vi`).

## Database Support

Supported SQL dialects (via Knex.js): **PostgreSQL, MariaDB, SQLite**. **CockroachDB** is
a paused target — excluded from CI for now but may return, so keep its code paths intact.
MySQL, MS SQL Server, and Oracle were dropped — do not add code paths or tests for them.

## Dependency Management

`workspace:*` for internal package deps; `catalog:` for external (versions in
`pnpm-workspace.yaml`). Add new shared deps to the catalog first.

## Changesets

`@changesets/cli` is available (`pnpm changeset`), but this fork does **not** gate PRs on
changesets — the release/publish flow is parked (see issue #302). Add one only if asked.

## Pull Requests

Before opening a PR into `v11.10.1-hhh-dev`, make the gates pass: `pnpm lint`,
`pnpm lint:style:changes`, `pnpm lint:style` (`--fix` auto-fixes most). Use the template
at `.github/pull_request_template.md` and reference the issue with `Fixes #<num>`.
