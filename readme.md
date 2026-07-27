# Scalabus

A performance- and scalability-focused fork of
[Directus](https://github.com/directus/directus), tuned for **SaaS workloads**.

Where Directus optimizes for feature breadth on agency-built sites, Scalabus
optimizes the data layer for scale — batch inserts, no-op write skipping,
awaited/cancelable hooks, cross-DB DDL, and read/write filter events.

It tracks only Directus's **BSL-1.1** releases — the line *before* the
MSCL-1.0-GPL relicense at `v12.0.0-rc.1`. Every published branch stays on a
Business Source License version whose Change License is **GPLv3**; nothing from
the MSCL line is carried here.

## Published versions

| Upstream version | GPL date (BSL Change Date) | Integration branch |
|------------------|----------------------------|--------------------|
| v11.10.1         | 2028-08-11                 | [`v11.10.1-hhh-dev`](https://github.com/jclaveau/directus/tree/v11.10.1-hhh-dev) |

Each row = a pinned upstream BSL tag + Scalabus's features composed on top
(the `<version>-feat/*` PRs), rebuilt by `.github/workflows/compose-hhh-v11.yml`.

## Licensing

- **Upstream Directus code** — BSL-1.1 ([`license`](license)). Change License
  GPLv3, Change Date three years from each release.
- **Scalabus's own additions** — GPLv3 ([`LICENSE.fork`](LICENSE.fork)).

The published artifact is GPL-aligned: the BSL portions convert to GPLv3 on
their Change Date, and every Scalabus contribution is GPLv3 from day one.
