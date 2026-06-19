# Scalabus

A performance- and scalability-focused fork of
[Directus](https://github.com/directus/directus), tuned for **SaaS workloads**.

Where Directus optimizes for feature breadth on agency-built sites, Scalabus
optimizes the data layer for scale — batch inserts, no-op write skipping,
awaited/cancelable hooks, cross-DB DDL, and read/write filter events.

It tracks only Directus's **BSL-1.1** releases — the line *before* the
MSCL-1.0-GPL relicense at `v12.0.0-rc.1`. Everything published here stays on a
Business Source License version whose Change License is **GPLv3**; nothing from
the MSCL line is carried here.

## Published versions

| Upstream version | GPL date (BSL Change Date) |
|------------------|----------------------------|
| v11.10.1         | 2028-08-11                 |

Each row = a pinned upstream BSL tag with Scalabus's features composed on top,
rebuilt by `.github/workflows/compose-hhh-v11.yml`.

## Licensing

- **Upstream Directus code** — BSL-1.1 ([`license`](license)), Copyright ©
  Monospace, Inc. Change License GPLv3, Change Date three years from each
  release.
- **Scalabus's own additions** — BSL-1.1 under a separate grant
  ([`LICENSE.fork`](LICENSE.fork)), Copyright © 2026 Jean Claveau. Additional
  Use Grant: None — production use needs a grant from the Licensor, which may
  be given on request. Change License GPLv3, Change Date four years.

Using the composed work means complying with both: Monospace's terms for the
Directus code, and the Licensor's for Scalabus's additions. Both convert to
GPLv3 on their respective Change Dates.

> **Not the final licensing.** Scalabus's additions are held under a
> production-restricted grant while the fork is pre-publication. Once it is
> ready to publish properly, the intent is to move them to
> [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0)
> — free for every use except competing with the Licensor — or to GPLv3.
> Relicensing applies going forward: versions already distributed keep the
> terms they shipped with.
