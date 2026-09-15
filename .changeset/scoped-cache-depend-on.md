---
'@directus/types': patch
'@directus/api': minor
---

Add `context.scopedCache.dependOn(lookup)` to the `items.read` filter hook: hand it the lookup a hook ran — still pending, a `Promise.all` batch, or `Promise.allSettled` verdicts — and the read is scoped to every fulfilled lookup's tags together with the purge counters that lookup took before its query, then the lookup comes back resolved so the call wraps it where it happens. `scopeTo(tags, { epochs })` takes the same pair spelled out, and a hook that forgets the counters costs no error, only the response's cacheability (`unguarded_scope`); `dependOn` is the form that cannot forget them. A rejected verdict is passed through untouched for the caller to judge.
