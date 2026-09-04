---
name: project_directus_blackbox_cache_local_repro
description: how to reproduce a directus blackbox cache (HIT/MISS) bug locally without the full harness, + the gotchas
metadata:
  type: project
---

The blackbox harness is hard to run locally (dep drift), but a scoped-cache HIT/MISS bug reproduces with a single hand-run server:

1. `docker run -d --name dbg-redis -p 6399:6379 public.ecr.aws/docker/library/redis:7-alpine` (ECR mirror dodges Docker Hub timeouts).
2. `node api/dist/cli/run.js bootstrap` then `start` with env: `DB_CLIENT=sqlite3 DB_FILENAME=/tmp/x.db`, `CACHE_ENABLED=true CACHE_STORE=redis CACHE_AUTO_PURGE=true CACHE_AUTO_PURGE_MODE=scoped`, `REDIS_HOST/PORT=6399`, `CACHE_STATUS_HEADER=x-cache-status`, `CACHE_NAMESPACE=dbg`, `STORAGE_LOCATIONS=local`.
3. login → create collection via `/collections` (needs `schema:{},meta:{},fields:[{id pk autoinc}]`) → `GET` → `POST` → `GET`, read `x-cache-status`.
4. **Smoking gun**: `redis-cli -p 6399 keys 'dbg:tag:*'` — empty tag sets = the read never tagged ⇒ scoped purge has nothing to drop ⇒ stale HIT. Cache value lives at `dbg::dbg:<hash>` (Keyv double-namespace); tag-set members are the raw response key.

Gotchas (all bit me):
- **Port 8055 = jean's planner directus** ("HipHipHip"). Verify `curl /server/info` / `ss -ltnp | grep :PORT` before any POST — use a spare port (8077).
- **`pkill -f "dbg-directus.db"` does NOT match** — DB_FILENAME is in env, not cmdline. Kill by port: `ss -ltnp | grep :8077 → kill <pid>`.
- **api/dist staleness** — `grep -c scopedCachePurgeEnabled api/dist/...` to confirm the build has your change before trusting a run.
- See [[project_directus_blackbox_seed_mechanics]] for the harness, [[reference_local_build_env_version_mismatch]] for PR-branch dep drift.
