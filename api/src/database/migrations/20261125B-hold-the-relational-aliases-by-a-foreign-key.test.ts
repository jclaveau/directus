import type { Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	down,
	up,
} from './20261125B-hold-the-relational-aliases-by-a-foreign-key.js';

const dialect = vi.hoisted(() => ({ client: 'postgres' }));

vi.mock('../index.js', () => {
	return { getDatabaseClient: () => dialect.client };
});

describe('holding the relational aliases by a foreign key', () => {
	const rawQuery = vi.fn();
	const database = { raw: rawQuery } as unknown as Knex;

	beforeEach(() => {
		dialect.client = 'postgres';
		rawQuery.mockReset();
	});

	it('adds relation_alias and its deferred foreign key on Postgres', async () => {
		await up(database);

		expect(rawQuery.mock.calls).toEqual([
			[
				'alter table directus_fields add column relation_alias varchar(64)'
				+ ' generated always as (case when special ~'
				+ ' \'(^|,)(o2m|m2m|m2a|translations|files)(,|$)\''
				+ ' then field end) stored',
			],
			[
				'alter table directus_fields add constraint'
				+ ' directus_fields_relation_alias_foreign'
				+ ' foreign key (collection, relation_alias)'
				+ ' references directus_relations (one_collection, one_field)'
				+ ' on delete cascade deferrable initially deferred',
			],
		]);
	});

	it('drops the foreign key, then relation_alias, on Postgres', async () => {
		await down(database);

		expect(rawQuery.mock.calls).toEqual([
			[
				'alter table directus_fields drop constraint'
				+ ' directus_fields_relation_alias_foreign',
			],
			['alter table directus_fields drop column relation_alias'],
		]);
	});

	it('changes nothing on the other dialects', async () => {
		dialect.client = 'sqlite';

		await up(database);
		await down(database);

		expect(rawQuery).not.toHaveBeenCalled();
	});
});
