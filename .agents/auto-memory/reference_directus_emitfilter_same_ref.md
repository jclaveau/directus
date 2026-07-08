---
name: reference_directus_emitfilter_same_ref
description: directus emitFilter returns the SAME payload ref when no listener; clear-and-refill that ref aliases & wipes the data
metadata:
  type: reference
---

`emitter.emitFilter(event, payload, …)` returns `payload` **unchanged and by the same reference** when no extension listens (loops listeners, `if (result !== undefined) updatedPayload = result`, else returns the original). The common deployment has zero listeners → you get back the exact array you passed in.

Trap (real bug, PR #205 scoped-cache read tagging):

```js
const tags = await emitter.emitFilter('cache.scope', myTags, …); // tags === myTags (same ref)
myTags.length = 0;        // empties the array tags ALSO points to
myTags.push(...tags);     // push(...[]) → nothing → data wiped
```

A clear-and-refill of the passed array silently empties the filter result. Reads ended up untagged → scoped purge never invalidated → stale HIT after every mutation. Unit tests missed it (read-integration path uncovered; mocks also return same ref but nothing asserted post-filter).

Fix: don't mutate-in-place around emitFilter. Use `let x = …; x = (await emitFilter('e', x, …)) as T;` (reassign), or pass a copy `emitFilter('e', [...x], …)`. The sibling `cache.purge` call was safe because it built a fresh `[{collection}, ...]` array each time.

Process lesson cross-linked: [[feedback_aliasing_smell_not_style]] — I flagged this exact `const`-mutation as "minor/style" in review; it was the load-bearing bug. Repro recipe that found it: real redis (docker) + real sqlite + bootstrapped directus on a spare port, GET→POST→GET on `x-cache-status`, inspect `redis keys '<ns>:tag:*'` (empty tag sets = read never tagged).
