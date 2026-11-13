---
name: feedback_directus_oos_feature_gathered_issue
description: on jclaveau/directus, every point or review finding about a feature the fork does not use for now (flows, comments, Redis cluster, non-PG dialects) goes into ONE "oos feature: X: gathered points" issue per feature, unasked and never addressed in the PR, unless critical or security
metadata:
  author: Jean Claveau
  type: feedback
---

**One gathered issue per out-of-scope feature**, titled `oos feature: <Feature>: gathered points`, body = intro ("<feature> isn't used on this fork for now; add new points here as numbered entries") + numbered sections (failure scenario, code location, proposed fix, tests). Same shape as #610 (non-PG dialects) and #330.

**Review points follow the same route, unasked (jean 2026-11-05, on #679's flow bypass):** "All review points related to an issue marked as oos should go there instead of beeing adressed (unless a critical / security issue)." So no fix, no choice block, no question: file it, link it from the PR's risks, report `filed #N`. Also written into the `pr-autoreview` skill, step 1.

Live ones: #651 (flows: `api/src/flows.ts` FlowManager, flow/operation reloads, `utils/job-queue.ts` as flows uses it), #657 (shares), #627 (runtime extension reloads: marketplace install/uninstall, `enabled` toggle, `ExtensionManager.reload()`; extensions only change by deploy in prod, and jean's view 2026-10-24 is that an env var should forbid these reloads), #622 (SSO: OAuth2/OpenID drivers, the bb mock IdP), #619 (LDAP login: `api/src/auth/drivers/ldap.ts`, `ldapjs`), #709 (file uploads and storage: multipart/JSON/import/tus uploads, replacements, deletes, thumbnails, disk names; opened 2026-11-09, absorbed #635 + #621, see [[project_directus_file_storage_bugs]]), #647 (Comments: `user_updated`/`sender` hand-nulling on user delete → `ON DELETE SET NULL` migration; upstream only lacked it for SQL Server, dropped here), #646 (Redis cluster: SCAN one node, CROSSSLOT, FLUSHDB, readiness, startup message once #644 removes full mode), #610 (non-PG).

**Why:** jean 2026-10-28: "make ONE issue gathering all the comments feature identified issues as comments are oos for now", then "same reshape needed for the unused oos Redis cluster feature". I had first filed a per-point issue (#647 for the user-delete loop, #646 for cluster) — jean wanted them reshaped, not duplicated.

**How to apply:** a finding on an unused feature → read the feature's gathered issue, PATCH a numbered point in (keep `Assisted-by:` footer last); if none exists yet, open it with that title. REWRITE an existing narrow issue into the gathered one rather than opening a second. Search code AND session history for other points before saying "none". Link from the PR risk line, not a fix in the PR. Edit the issue body, never add a comment. Keep the points out of the review's findings table and the end-of-task report: at most one line there, e.g. "2 ldap points filed in #619". See [[feedback_directus_non_pg_review_points_to_610]].
