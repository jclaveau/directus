---
name: project_directus_schema_diff_mixed_relation
description: validate-diff reads only diff[0] of a relation diff to pick its error message; closed as not a bug (2026-10-16), reopen if a mixed delete+edit relation diff ever surfaces
metadata:
  author: Jean Claveau
  type: project
---

`POST /schema/apply` with a stale hash always 400s, whatever the diff holds. For a relation
diff, validate-diff looks only at `diff[0]` to choose *which* 400 message to give. So a
diff that mixes a delete with edits on the same relation (`articles.author`) gets the
message for its first entry, not one naming the mix.

Ruled 2026-10-16 (PR #614 review point 11): option A, close as not a bug, since no write
goes through either way. The rejected option B was to refuse mixed diffs with
400 `Relation "articles.author" diff mixes a delete with edits`.

**Why:** jean said "keep it in memory in case we get the issue in the future".

**How to apply:** if a user reports a confusing schema-apply message on a relation, or a
mixed relation diff gets applied, this is the known seam. Revisit B then; don't re-raise
it in a review before that. Related: [[project_directus_batched_plumbing_design]].
