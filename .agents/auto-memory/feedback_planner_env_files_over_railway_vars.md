---
name: feedback_planner_env_files_over_railway_vars
description: planner configuration belongs in the committed `apps/directus/env/.env.<env>.cd.railway.<svc>` files; a Railway service variable for a key those files declare is an emergency override to REMOVE once the fix ships, never something to set or re-set
metadata:
  author: Jean Claveau
  type: feedback
---

**Rule (jean, 2026-09-16):** privilege the `.env.xxx` files in the planner. A value that
belongs to a service's configuration is edited in
`apps/directus/env/.env.<env>.cd.railway.<service>` and shipped by the deploy PR. A Railway
variable for a key those files declare is a hand override — it beats the file
([[reference_planner_readenv_precedence]]) and no diff shows it.

**Why:** the 2026-09-15 outage was fixed by hand-setting `PM2_AUTOSCALE_PREWARM=0` on the
Api service while the file kept saying 15; a day later "set PM2_AUTOSCALE_PREWARM" was read
as "set the Railway var to 15" — re-creating an override for a value the file already
carried. jean: "why don't you privilege the .env.xxx files in the planner?"

**How to apply:**
- Config change → edit the file on `develop`, ship via the deploy PR. Never `railway
  variable set` for a key a file declares.
- Existing override → plan its DELETION, timed after the deploy that makes it unnecessary
  (`railway variable delete` has no `--skip-deploys`, so deleting redeploys prod on whatever
  pin is live — do it once the pin carries the fix).
- Railway vars stay for what the files cannot hold: secrets, references (`${{…}}`), and a
  genuine emergency — and an emergency override goes into the deploy PR body as a step to
  remove.
