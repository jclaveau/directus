# AGENTS.md

Guidance for AI coding assistants working in this repository.

## This fork (Scalabus)

This is **Scalabus**, a performance/scalability fork of
[Directus](https://github.com/directus/directus) that tracks only Directus's
**BSL-1.1** releases — the line before the MSCL-1.0-GPL relicense at `v12.0.0-rc.1`.
See `readme.md` for scope and published versions.

- **Default / work branch: `v11.10.1-hhh-dev`.** Base new work on it and open PRs
  into it. `main` is a clean upstream mirror, not the work branch.
- **No Prettier.** Formatting and style are owned by `eslint.style.config.js`,
  enforced **diff-scoped** (added lines only) via `pnpm lint:style:changes`. Do not
  add prettier config or run `prettier` — it is not installed.
- `.claude/` ships PostToolUse hooks that auto-`--fix` edited files with eslint and
  stylelint.

## Project Overview

Directus is a real-time API and App dashboard for managing SQL database content.
This is a pnpm monorepo containing:

- **`/api`** - Node.js backend with REST & GraphQL APIs (Express.js, Knex.js)
- **`/app`** - Vue 3 dashboard application (Vite, Pinia)
- **`/sdk`** - TypeScript SDK for Directus API clients
- **`/packages/*`** - 35+ shared packages (types, utils, storage drivers, extensions, etc.)

## Requirements

- Node.js 22
- pnpm >=10 <11

## Common Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm --filter @directus/api build

# Run development servers (API on :8055, App on :8080)
cd api && pnpm dev    # API with hot reload
cd app && pnpm dev    # App with Vite HMR

# Linting and style
pnpm lint                 # ESLint (base config, whole repo)
pnpm lint:style:changes   # STYLE GATE: eslint.style.config.js over lines added vs the base branch
pnpm lint:style           # Stylelint for CSS/SCSS/Vue

# Testing
pnpm test                           # Run all unit tests
pnpm --filter @directus/api test    # Test specific package
cd api && pnpm test:watch           # Watch mode in package
pnpm test:coverage                  # Coverage report

# Blackbox tests (builds a dist first)
pnpm test:blackbox
```

## Architecture

### API (`/api/src`)

- **`controllers/`** - REST API endpoint handlers (40+ controllers)
- **`services/`** - Business logic layer
- **`database/`** - Knex.js database utilities and migrations
- **`middleware/`** - Express middleware (auth, caching, rate limiting)
- **`auth/`** - Authentication providers (LDAP, SAML, OAuth, local)
- **`extensions/`** - Runtime extension loading
- **`websocket/`** - Real-time WebSocket support

### App (`/app/src`)

- **`components/`** - 145+ Vue components
- **`views/`** - Page views
- **`composables/`** - 53+ Vue composables
- **`stores/`** - 24 Pinia stores
- **`interfaces/`** - 45+ field input types
- **`displays/`** - 21 field display renderers
- **`layouts/`** - 8 data layout views
- **`operations/`** - 18 flow operation types
- **`panels/`** - 14 dashboard panel types
- **`modules/`** - Feature modules

### Key Shared Packages

- **`@directus/types`** - Shared TypeScript types
- **`@directus/utils`** - Shared utilities (node/browser/shared)
- **`@directus/schema`** - Database schema utilities
- **`@directus/extensions`** - Extension framework
- **`@directus/storage`** - Abstract storage interface
- **`@directus/storage-driver-*`** - Storage backends (S3, Azure, GCS, Local, etc.)

## Code Style

- TypeScript for all new code
- ES modules (`import/export` syntax)
- Prefer `const` over `let`, avoid `var`
- Two ESLint configs, different jobs:
  - `eslint.config.js` — base rules (close to upstream), applied repo-wide by `pnpm lint`.
  - `eslint.style.config.js` — strict style (e.g. 85-column), applied **only to added
    lines** via `pnpm lint:style:changes`. This is the style authority.
- **No Prettier** — do not add prettier config or run it.
- Keep diffs minimal versus upstream: do not reformat untouched upstream lines. The
  style gate is added-lines-only precisely so fork changes stay small against upstream.
- Test files named `*.test.ts`, placed next to source files

## Testing Conventions

```typescript
import { describe, expect, test, vi } from 'vitest';

describe('function name', () => {
	test('should do something specific', () => {
		// Test implementation
	});
});
```

## Database Support

Directus works with multiple SQL databases via Knex.js: PostgreSQL, MySQL, MariaDB,
SQLite, MS SQL Server, OracleDB, CockroachDB.

## Dependency Management

- Use `workspace:*` for internal package dependencies
- Use `catalog:` for external dependencies (versions defined in `pnpm-workspace.yaml`)
- Add new shared dependencies to the catalog first

## Changesets

`@changesets/cli` is available (`pnpm changeset`), but this fork does **not** currently
gate PRs on changesets — the changeset/publish release flow is parked (see issue #302).
Only add a changeset if explicitly asked.

## Pull Requests

Before opening a PR into `v11.10.1-hhh-dev`, make the gates pass:

```bash
pnpm lint                # ESLint
pnpm lint:style:changes  # style gate (added lines vs base)
pnpm lint:style          # Stylelint
```

`pnpm lint --fix` and `pnpm lint:style --fix` auto-fix most issues; fix the rest by hand.

Use the template at `.github/pull_request_template.md` (Scope / Potential Risks /
Tested Scenarios / Review Notes / Checklist), and reference the related issue with
`Fixes #<num>`.
