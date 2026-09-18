---
'@directus/types': minor
'@directus/api': minor
---

Add `context.scopedCache.dependOn(lookup)` to the `items.read` filter hook: hand it the lookup a hook ran — still pending, a `Promise.all` batch, or `Promise.allSettled` verdicts — and the read is scoped to every fulfilled lookup's tags together with the purge counters that lookup took before its query, then the lookup comes back resolved so the call wraps it where it happens. `scopeTo(tags, { epochs })` takes the same pair spelled out, and a hook that forgets the counters costs no error, only the response's cacheability (`unguarded_scope`); `dependOn` is the form that cannot forget them. A rejected verdict is passed through untouched for the caller to judge.

Type `register.filter` by the event name, so a hook calls the handle without narrowing: a `*.read` handler receives `ReadEventContext` (`scopedCache` is the read handle, always present), a `*.create`/`update`/`delete` handler `MutationEventContext` (the purge handle), and `auth.*`/`fields.*` or a runtime event name the plain `EventContext` as before. A wrong-side call — `purgeBy` in a read hook — is now a compile error (#294).
