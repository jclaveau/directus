import { createInspector } from '@directus/schema';
import { oneLine } from '@directus/utils';
import type { Knex } from 'knex';
import { expect, test, vi } from 'vitest';

test('the postgres overview flags a column of a unique index', async () => {
	class Client_PG {
		config = {};
	}

	const overview = await createInspector({
		client: new Client_PG(),
		raw: vi.fn()
			.mockResolvedValueOnce({
				rows: [
					{
						table_name: 'posts',
						column_name: 'id',
						default_value: null,
						data_type: 'integer',
						max_length: null,
						is_identity: true,
						is_nullable: false,
						is_generated: false,
					},
					{
						table_name: 'posts',
						column_name: 'slug',
						default_value: null,
						data_type: 'character varying',
						max_length: 255,
						is_identity: false,
						is_nullable: true,
						is_generated: false,
					},
				],
			})
			.mockResolvedValueOnce({ rows: [{ table_name: 'posts', column_name: 'id' }] })
			.mockResolvedValueOnce({
				rows: [{ table_name: 'posts', column_name: 'slug' }],
			})
			.mockResolvedValueOnce({ rows: [] }),
	} as unknown as Knex).overview();

	expect(overview).toStrictEqual({
		posts: {
			primary: 'id',
			columns: {
				id: {
					table_name: 'posts',
					column_name: 'id',
					default_value: 'AUTO_INCREMENT',
					data_type: 'integer',
					max_length: null,
					is_identity: true,
					is_nullable: false,
					is_generated: false,
				},
				slug: {
					table_name: 'posts',
					column_name: 'slug',
					default_value: null,
					data_type: 'character varying',
					max_length: 255,
					is_identity: false,
					is_nullable: true,
					is_generated: false,
					in_unique_index: true,
				},
			},
		},
	});
});

test(oneLine`
	the postgres overview names a unique column its columns read lacks
`, async () => {
	class Client_PG {
		config = {};
	}

	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

	try {
		await createInspector({
			client: new Client_PG(),
			raw: vi.fn()
				.mockResolvedValueOnce({
					rows: [
						{
							table_name: 'posts',
							column_name: 'id',
							default_value: null,
							data_type: 'integer',
							max_length: null,
							is_identity: true,
							is_nullable: false,
							is_generated: false,
						},
					],
				})
				.mockResolvedValueOnce({
					rows: [{ table_name: 'posts', column_name: 'id' }],
				})
				.mockResolvedValueOnce({
					rows: [{ table_name: 'posts', column_name: 'secret' }],
				})
				.mockResolvedValueOnce({ rows: [] }),
		} as unknown as Knex).overview();

		expect(consoleError.mock.calls).toStrictEqual([[
			'Could not flag unique column "secret" of table "posts":'
			+ ' information_schema.columns lists only the columns'
			+ ' the user holds a privilege on',
		]]);
	}
	finally {
		consoleError.mockRestore();
	}
});
