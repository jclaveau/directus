---
name: feedback_directus_oos_features_to_their_issue
description: Anything noticed about an out-of-scope feature (non-Postgres dialects, LDAP, SSO, runtime extension reloads, Flows, Comments, Redis cluster, Shares) goes as a point in its "oos feature:" issue, never into a PR review or report
metadata:
  type: feedback
---

Features jean doesn't use are "out of scope", each with one gathering issue whose title starts with `oos feature: `:

- non-Postgres dialects (SQLite, MariaDB, CockroachDB) → #610
- LDAP login (`api/src/auth/drivers/ldap.ts`, `ldapjs`) → #619
- SSO login (OAuth2 / OpenID drivers, the bb mock IdP) → #622
- runtime extension reloads (marketplace install/uninstall, `enabled` toggle, `ExtensionManager.reload()`) → #627; extensions only change by deploy in prod. jean's view (2026-10-24): these reloads should be forbidden by an env var
- Flows (`api/src/flows.ts` FlowManager, flow/operation reloads, `utils/job-queue.ts` as flows uses it) → #651 (opened 2026-10-30)
- Comments (`directus_comments`, CommentsService) → #647
- Redis cluster → #646
- Shares (`directus_shares`, SharesService, share access checks) → #657 (opened 2026-11-01)

Every bug, gap, dead code path, missing test or design doubt found on one of these goes into its issue as a new numbered point, using the same `### N. title` + failure scenario shape as the existing points. Edit the issue body with the new point; don't add a comment. Then leave it out of the review, the findings table and the end-of-task report. At most one line, e.g. "2 ldap points filed in #619".

A new feature jean says they don't use → open a new `oos feature: <name>` issue and add it to this list.

**Why:** jean (2026-10-16): file what we notice on these features "in the corresponding bugs hence do not pollute the reviews with it". They are noise in the reviews jean must rule on.

**How to apply:** while reviewing or writing tests, test each finding: does it only matter for an oos feature? If so, file it in the issue, don't number it among the review findings and don't raise it as a choice. Related: [[feedback_directus_pg_only_dialect_focus]], [[project_directus_deferred_dialects]].
