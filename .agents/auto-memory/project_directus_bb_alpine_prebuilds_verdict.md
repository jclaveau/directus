---
name: project_directus_bb_alpine_prebuilds_verdict
description: jclaveau/ci-prebuilds alpine job container for blackbox shards saves ~5 s of ~390 s per shard; measured 2026-10-14, not adopted
metadata:
  type: project
---

Measured on blackbox-pr run 38537609203 (postgres shard 3, ~6.5 min):

| step | s |
| --- | --- |
| pnpm/action-setup self-install | 4.4 |
| setup-node + 296 MB pnpm-store cache restore | 6 |
| pnpm install | 10 |
| pnpm run build | 46 |
| pull timescale/timescaledb-ha:pg18 (647 MB) + healthy | 28 |
| pull redis/minio/saml | 14 |
| tests (critical path = slowest shard ~350) | 270 |

`jclaveau/alpine-dood-pnpm:alpine3.24-node24.18-pnpm12.11` (147 MB) replaces only the
first row (and node download, ~0 s from toolcache). The store cache, install, build and
image pulls stay. Image pull + container init eats the gain → net ≈ 0-5 s (~1%).

Blockers if ever tried:
- tests/blackbox/common/config.ts hardcodes `127.0.0.1` for every service; GHA refuses
  `--network` in `container.options`, so dood breaks → needs `-dind` + `--privileged`.
- native deps all ship musl prebuilds (isolated-vm abi137, argon2, sqlite3 napi-v6,
  snappy, sharp) → slim non-gyp image would install.

**Why:** don't re-investigate; the setup steps are not where shard time goes.
**How to apply:** real levers are the 46 s build (but see [[project_directus_blackbox_sharding]]:
build caching measured a net loss), the 647 MB postgres image (an alpine pg18 +
timescale + postgis image, ~200 MB, would save ~12 s), and the test critical path.

**Playwright (acceptance.yml), checked 2026-10-14 against :latest = ci-prebuilds f44c9b8:**
- images ship PW 1.62.1 (chromium-headless-shell rev 1234 / 151.0.7922.34); repo pins
  1.59.1 (rev 1217) → bump the catalog to 1.62.1 before any switch.
- alpine chromium is now BUILT FROM SOURCE at PW's pinned version (promoted chs-1234 from
  chs-fs-sha-6e56156, conformance-gated) — not the apk extract any more; binary reports
  "Chromium", ubuntu reports "Google Chrome for Testing". Runtime metrics on par.
- benchmark-playwright.yml, chromium-only, time until tests start (4 runs): VM 43 s (n=15),
  alpine-dood 40 s, ubuntu-dood 45 s (n=3 each) → no setup gain for one browser.
- all three browsers (same 4 runs): VM 76 s (n=20) vs alpine-dood 41 s / ubuntu-dood 43 s
  (n=4) to first test → ~35 s gain, the case the images are built for. Alpine firefox/webkit
  microbenches also run faster (layout ff 252 vs 714 ms, wk 606 vs 1677 ms; one night).
  acceptance suite is chromium-only today, so this only matters if ff/wk projects are added.
