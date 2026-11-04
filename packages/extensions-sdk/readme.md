# @directus/extensions-sdk

A toolkit to develop extensions to extend Directus

## Description

This package is a toolkit to help developers create extensions for use in Directus, an open-source headless CMS.

For more information about Directus, visit the [official website](https://directus.io).

## Bundles declaring their entries in code (Scalabus)

A bundle whose `package.json` lists no `entries` declares them in code instead:

```json
{
	"name": "@consumer/domain",
	"directus:extension": {
		"type": "bundle",
		"path": { "app": "dist/app.js", "api": "dist/api.js" },
		"host": "^11.10.0"
	}
}
```

`directus-extension build` builds `src/app.ts` and `src/api.ts`, skipping a side whose
file is missing.

```ts
// src/api.ts
import {
	defineBundleApi,
	defineEndpointEntry,
	defineMigrationEntry,
} from '@directus/extensions-sdk/scalabus';

export default defineBundleApi([
	defineEndpointEntry('orders-report', (router) => {
		router.get('/', (_req, res) => res.json({ data: [] }));
	}),
	defineMigrationEntry('20261103A-add-orders', {
		up: async (knex) => knex.schema.createTable('orders', (table) => table.increments()),
		down: async (knex) => knex.schema.dropTable('orders'),
	}),
	defineMigrationEntry('20261104A-fill-orders', {
		phase: 'after-schema',
		up: async (knex) => {
			await knex('orders').insert({});
		},
		down: async (knex) => {
			await knex('orders').delete();
		},
	}),
]);
```

```ts
// src/app.ts
import { defineBundleApp, definePanelEntry } from '@directus/extensions-sdk/scalabus';

export default defineBundleApp([definePanelEntry('orders-chart', { /* PanelConfig */ })]);
```

### Migrations

A migration entry is named `<YYYYMMDD><letter>-<kebab-name>` and recorded in
`directus_migrations` as `<bundle>:<YYYYMMDD><letter>`:

| entry                                   | recorded version             |
| --------------------------------------- | ---------------------------- |
| `20261103A-add-orders` of `@consumer/domain` | `@consumer/domain:20261103A` |

The core and bundle migrations run in date order; on the same date the core runs first.
Two entries of a bundle with the same date and letter are refused when the migrations
are listed.

A file in `MIGRATIONS_PATH` follows the same `<YYYYMMDD><letter>-<name>.js` name; any
other name stops the listing with `Migration "20220501-x.js" in MIGRATIONS_PATH has no
date: name it "<YYYYMMDD><letter>-<name>.js"`. A file already applied under such a name
needs both a rename and its recorded version moved before `migrate:latest`, or it runs
again:

```sql
-- 20220501-x.js renamed 20220501A-x.js
UPDATE directus_migrations SET version = '20220501A' WHERE version = '20220501';
```

| command                                               | runs                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `directus database migrate:latest`                    | before-schema; refuses while an after-schema one is pending |
| `directus database migrate:latest --snapshot s.yaml`  | before-schema, then the snapshot, then after-schema     |
| `directus bootstrap --snapshot s.yaml`                | same, on a fresh or existing database                   |

`directus database migrate:down` on a migration whose bundle is no longer installed
fails with `Migration "@consumer/domain:20261103A" was applied by "@consumer/domain",
which is not installed`.

In development, `EXTENSIONS_AUTO_MIGRATE=true` (with `EXTENSIONS_AUTO_RELOAD=true`, refused
under `NODE_ENV=production`) runs the pending before-schema migrations on the reload a
rebuilt bundle triggers.

### App entries

The server never runs a bundle's `app.js`, so an app entry has no settings row until an
admin toggles it: the settings page lists the entries of the app chunk it runs, and
`PATCH /extensions/<bundle id>/entries/<name>` creates or updates the entry's row. A tab
running an app chunk the server no longer serves shows a reload prompt.

## License

This package is licensed under the MIT License. See the
[LICENSE](https://github.com/directus/directus/blob/main/packages/composables/license) file for more information.

## Additional Resources

- [Directus Website](https://directus.io)
- [Directus GitHub Repository](https://github.com/directus/directus)
