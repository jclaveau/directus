---
name: directus_useenv_mock_hoisted
description: vitest mocking pattern for @directus/env's useEnv() in api unit tests — vi.hoisted factory, not automock
metadata:
  author: Jean Claveau
  type: reference
---

Automocking `@directus/env` (`vi.mock('@directus/env')` with no factory) makes
`useEnv()` return `undefined` while the module under test (e.g. `cache.ts`) loads,
because automock still evaluates the real module body first. Use a factory mock
backed by a mutable object instead: `vi.mock('@directus/env', () => ({useEnv: () =>
env}))`. Declaring `let env = {...}` normally trips TDZ because the mock factory is
hoisted above it — wrap the mutable state in `vi.hoisted(() => ({env: {...}}))` and
reference `env` through that.

Separately: when a test drives concurrent replays against one mocked HTTP-ish
responder, chaining `.mockResolvedValueOnce(...)` answers assumes call order, but
concurrent replays interleave — the `Once` queue can hand call N's answer to call
M. Dispatch by request path/key instead of FIFO position.

**How to apply:** reuse this pattern for any new `api/src/**/*.test.ts` that mocks
`@directus/env` or drives concurrent mocked replays (seen while testing
[[project_directus_issue498_cache_audit]]'s engine).
