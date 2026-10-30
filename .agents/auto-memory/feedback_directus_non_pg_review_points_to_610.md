---
name: feedback_directus_non_pg_review_points_to_610
description: on jclaveau/directus, every review point that only bites a non-Postgres dialect (sqlite, cockroach, maria) goes into issue #610 plus a TODO(#610) comment at the code — never fixed in the PR
metadata:
  type: feedback
---

**A review finding reachable only on a non-Postgres dialect is never fixed in the PR.**
It goes to issue https://github.com/jclaveau/directus/issues/610 ("Supporting the
non-Postgres dialects again: gathered points") as a new numbered point, AND a
`TODO(#610): …` comment lands directly above the statement it concerns. jean,
2026-10-15: _"allways store non-pgsql review points into 610 and add todo comments"_.

**Why:** Postgres is the only dialect the main workflow invests in
([[feedback_directus_pg_only_dialect_focus]]), but the sqlite/cockroach paths stay in
the code. #610 gathers what must be done before those dialects are supported again,
so the points don't scatter across PR threads; the TODO keeps the spot findable from
the code.

**How to apply:**
- Typical shape: sqlite busy / cockroach serialization retries in `transaction()`
  (Postgres never retries), sqlite's one-connection pool, maria-only SQL. On #607 this
  was H1/H4/M (per-attempt hook-declaration state across retries).
- A non-PG finding is still HIGH when it serves a stale entry — rank it as such in the
  review, then route it to #610 rather than fixing.
- Read #610's body first, then PATCH it (`gh api -X PATCH … -F body=@<file>`) appending
  a numbered point: failure scenario, the TODO's location, possible fix. Keep the
  `Assisted-by:` footer last.
- This is a standing ruling: no need to ask jean "fix or #610?" for a non-PG point.
- The #330 (sqlite) / #331 (maria) trackers keep the per-dialect blackbox failures;
  #610 is for design/review points.
- **A closed or superseded PR that leaves a SQLite or MariaDB/MySQL gap → link it
  in that dialect's tracker (#330 / #331) AND as a numbered point in #610, without
  asking** (#632 → #610 point 7): failure scenario, the
  dialect's limit, what superseded it on PG, "reopen/cherry-pick when <dialect> is
  supported again". The closing comment names the tracker link back. jean,
  2026-10-26, on #632 (chunking made redundant on PG by knex#4; SQLite still caps
  at 32766 binds): _"memorize to do it in the future for oos mysql / sqlite without
  asking"_. Example comments: #330 issuecomment-6415191191, #331 -6415191586.

Related: [[project_directus_deferred_dialects]], [[project_directus_trunk_full_vendor_matrix]].
