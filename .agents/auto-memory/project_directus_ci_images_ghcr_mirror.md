---
name: project_directus_ci_images_ghcr_mirror
description: CI pulls postgres/redis/pgbouncer/timescale/saml images from ghcr.io/jclaveau mirror (mirror-images.yml), not Docker Hub, after Bench "unauthorized" failures
metadata:
  author: Jean Claveau
  type: project
---

Bench Cache job failed with `unauthorized: authentication required` on `docker compose up` (Docker Hub pull limit), and its cache gates then read "the measurement did not finish". Fix landed in PR #616 (folded in from closed #618): `mirror-images.yml` mirrors `timescaledb-ha:pg18`, `valkey:9.1.2-alpine`, `postgres:16-alpine`, `pgbouncer:1.25.2` (by pinned digest), `test-saml-idp:latest` (+ existing minio) to `ghcr.io/jclaveau/…`; blackbox compose, `acceptance.yml`, `preview-admin.yml` services point at them. Root `docker-compose.yml` (local dev) and dialect images CI doesn't run stay on Docker Hub.

**Why:** a PR's Bench reads the compose file from ITS OWN branch, so a mirror switch in a separate PR does nothing for an already-open PR until merged.
**How to apply:** a Bench red with "measurement did not finish" → read the `docker compose up` step log for `unauthorized` first (infra, not a gate breach). New CI image → add to mirror-images.yml, make the package public, verify anonymous pull. See [[project_directus_bench_deep_miss_gate_noise]], [[project_directus_ci_runner_saturation_prebuilds_benchmark]].
