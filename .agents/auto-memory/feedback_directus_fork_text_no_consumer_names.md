---
name: feedback_directus_fork_text_no_consumer_names
description: the fork is public, so code comments, commit messages, PR bodies and scenario titles carry no consumer table or issue names either — not just memories; squash a commit whose message does
metadata:
  type: feedback
---

[[feedback_directus_no_consumer_data_in_fork_memories]] covers `.agents/`. The same bar
applies to every other text this repo publishes: code comments, commit messages, PR
titles and bodies, and blackbox scenario titles. Say "a consumer" and name no consumer
table, account, host or issue number.

**Why:** seen three times in the 2026-11-13 autoreview round — #501 had consumer
mentions stripped from its added comments, its commit message and its body; #530 was
squashed because the original commit message named consumer data; #598's body dropped a
consumer table name. A redacted tree does not redact history, so the cheap moment is
before the commit.

**How to apply:** before opening or merging a PR, grep the added lines, the commit
messages and the body for the consumer's name; rewrite, or squash if it is in a message
already pushed. Three trunk comments still carry it and are not yet cleaned:
`autoscale-release.test.ts:18`, `rig.ts:337`, `worker.cjs:24`. Inferred from review
behaviour, not a verbatim jean ruling.
