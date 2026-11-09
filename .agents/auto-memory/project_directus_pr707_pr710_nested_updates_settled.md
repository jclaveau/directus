---
name: project_directus_pr707_pr710_nested_updates_settled
description: PR #707 (batch ordering + nestedUpdates) and its stacked follow-up #710 — jean's rulings on the autoreview choices; do not re-raise
metadata:
  type: project
---

jean's rulings, 2026-11-09. #710 is based on #707's branch (`nestedUpdates` only exists there).

```
#707
4  cycle in a chunked batch      → A: Tarjan SCC, a cycle's rows written together after the rows it names
5  same new key nested twice     → keep: refuse rejects the 2nd record, skip only names the row (documented)
6  skip drops a record's subtree → A: documented, nothing created under a skipped record
7  "fields besides the key"      → alias / O2M list counts (documented); an O2M child's key to its listed parent does not (fixed)
8  WebSocket nestedUpdates       → A: create/update messages take it, like mutationBatching
11 top-level O2M not walked      → B: filed #708 (predates the PR)
#710
1  apply + key-only update alteration on a linked child still calls updateOne(key, {}) and fires hooks
                                 → A (2026-11-10, first ruled B): skipped under every mode, as a key-only
                                   M2O record writes nothing; hooks/activity/date_updated no longer fire
```

**Why:** each was a behaviour choice put to jean as a gherkin block in the autoreview results comment.

**How to apply:** don't re-raise these points in a later review of #707/#710 or of the nestedUpdates code; [[project_directus_pr607_accepted_exceptions]] has the same role for #607.
