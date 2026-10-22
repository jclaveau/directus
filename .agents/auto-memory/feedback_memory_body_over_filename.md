---
name: feedback_memory_body_over_filename
description: Reading only a memory's filename/slug instead of its body inverted a granted permission and blocked work the user had already authorized
metadata:
  type: feedback
---

A memory filename is a label, not the rule. Renamed or stale slugs can say the
opposite of the current body — always read the body before acting on what a
memory "says."

**Why:** refused to start a consumer app locally for tests, citing a memory named
`feedback_defer_dev_stack_start_to_user.md`. The user had already granted
permission to start it locally to run the tests on 2026-09-07,
and the memory's own body recorded that grant — only the filename still said
defer-to-user. Read the name, stopped there, acted on the opposite of what was
written. Cost the user a repeated "i already told you."

**How to apply:** when a memory's filename and its prose disagree, or when
about to refuse/gate an action "because memory says so," open the file and
read the body before acting — never decide from the slug alone. If a memory's
intent changed, rename it in the same edit that updates the body, and repoint
its MEMORY.md index line and any [[backlinks]] so the two never drift apart
again.
