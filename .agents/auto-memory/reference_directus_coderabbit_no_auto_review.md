---
name: reference_directus_coderabbit_no_auto_review
description: CodeRabbit never auto-reviews jclaveau/directus PRs (repo under 10 stars); its only comment is a "Trigger review" checkbox, so a watch for its review on a pushed sha waits forever
metadata:
  type: reference
---

CodeRabbit posts one conversation comment on each jclaveau/directus PR: "This repository does not receive automatic reviews because it has fewer than 10 stars", with a `Trigger review` checkbox. No review ever lands on a pushed sha (seen on PR #673, 2026-11-04, `.coderabbit.yaml` with draft reviews on changes nothing).

**How to apply:** in pr-autoreview step 4b, read that comment first; when it says "fewer than 10 stars", skip the CodeRabbit watch and report "CodeRabbit not auto-reviewing (repo < 10 stars)". Ticking the checkbox or `@coderabbitai review` is jean's call, never unasked.

See [[project_directus_preview_cancelled_by_bot_edit]].
