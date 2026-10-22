---
name: feedback_directus_no_consumer_data_in_fork_memories
description: this fork's repo is public, so no memory here may carry a consumer's (planner's) specific data — hosts, services, emails, tables, env values, repo paths, issue numbers; that goes to the consumer's own private repo
metadata:
  type: feedback
---

jclaveau/directus is a **public** repo and `.agents/` is committed. A memory written here
holds only what the fork itself does. Anything specific to an app that runs the fork
(the planner today) lives in that app's private repo, `<consumer>/.agents/auto-memory/`.

| fact | where |
|---|---|
| `kill_timeout` must exceed `SERVER_SHUTDOWN_TIMEOUT` | here |
| the planner's ecosystem sets `kill_timeout: 25000` | consumer repo |
| a `statement_timeout` set on the role shadows one set on the database | here |
| prod PG service name, Railway project/env, hostnames | consumer repo |
| `tests-admin@…` account, api-guard behaviour, table names (`student_*`) | consumer repo |
| a measured prod number that explains a fork design (heap peak, 2700 events lost) | here, as "a consumer's prod", no names |

A fork memory that needs the consumer's context says "a consumer" / "a prod consumer"
and names no host, service, table, account or consumer issue/PR number.

A consumer's prod DB stays SELECT-only from any session, this one included; the how-to
is in the consumer repo.

**Why:** jean, 2026-10-22, on the #624 review: consumer-specific data must not sit in the
fork's memories, for security. The fork is public; the planner is private. 21 memories
moved to the planner repo (the-HipHipHip/Planner#822) and the rest were redacted.

**How to apply:** before writing or editing a memory in this repo, strip consumer
specifics or write it in the consumer's repo instead. A review of a PR that touches
`.agents/` checks for them. Older commits on `v11.10.1-hhh-dev` still carry some of this
data; redacting the tree does not remove it from history.
