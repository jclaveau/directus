---
name: reference_directus_mock_defining_module
description: A vi.mock of scoped-cache/index.js can miss a helper's scopedCachePurgeEnabled — import it from scoped-cache/config.js and mock config.js
metadata:
  author: Jean Claveau
  type: reference
---

On #772, service tests mocked `scoped-cache/index.js` to switch
`scopedCachePurgeEnabled`, and the mock did not reach
`purgePrimaryIdentityWrites` (`auth/utils/user-identities.ts`): CI unit tests red at
`cf5a52e27f`. Fix `669d6f3b01` (green): the helper imports from
`scoped-cache/config.js`, where the function is defined, and `users.test.ts`,
`users.remove-identity.test.ts`, `sso-identity.test.ts` mock `config.js`.

Cause = an import cycle losing the barrel mock: the reviewer's reading, never
reproduced.

**How to apply:** a new caller of a scoped-cache switch, or a mock of it that has no
effect: import from and mock the defining module. Related:
[[reference_directus_fn_dialect_test_import_cycle]].
