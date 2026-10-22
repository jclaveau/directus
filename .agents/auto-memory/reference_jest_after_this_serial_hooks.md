---
name: reference_jest_after_this_serial_hooks
description: jest-after-this runs every registered afterEach callback serially in one hook — N cascading cleanups sum their time against ONE hookTimeout, not the max
metadata:
  type: reference
---

Planner's `jest-after-this` utility collects callbacks registered mid-test and
fires them from a single `afterEach`, but awaits them **one at a time, LIFO**
— not concurrently. Three independent cleanup calls (e.g. delete-file,
delete-user, delete-user) each get their own network round-trip, but all three
share one `hookTimeout` (20000ms in the planner's domain suite), so their
durations sum rather than max. Under load, that budget can blow even when
every individual call would finish well inside it.

**Symptom:** `Hook timed out in 20000ms` on a test whose own assertions were
fine, appearing intermittently and worse under parallel/full-suite runs than
in isolation.

**Fix pattern:** don't register N separate afterThis callbacks for
independent cleanups. Collect them and register ONE callback that
`Promise.all`s the batch:
```ts
const removals = [useDirectusAdminInstance().request(deleteFile(avatarFileId))]
if (createdUserId) removals.push(...)
await Promise.all(removals.map((r) => r.catch(...)))
```
Only safe when the underlying deletes have no ordering dependency (check DB
FKs first — `directus_users` has exactly one, `role`; `avatar` isn't
constrained).
