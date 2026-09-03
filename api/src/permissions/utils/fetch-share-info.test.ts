import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readResult } from '../../__utils__/read-result.js';
import { ItemsService } from '../../services/items.js';
import { _fetchShareInfo } from './fetch-share-info.js';

vi.mock('../../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_shares', (c) => {
		c.field('id').id();
	})
	.build();

let db: Knex;

beforeAll(() => {
	db = knex.default({ client: MockClient });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('fetchShareInfo', () => {
	it('reads the fields a share grant is resolved from', async () => {
		const share = {
			collection: 'articles',
			item: 'item-id',
			role: null,
			user_created: { id: 'user-1', role: 'role-1' },
		};

		const readOne = vi
			.spyOn(ItemsService.prototype, 'readOne')
			.mockResolvedValue(readResult(share));

		const info = await _fetchShareInfo('share-1', { knex: db, schema });

		expect(info).toEqual(share);

		expect(readOne).toHaveBeenCalledWith('share-1', {
			fields: ['collection', 'item', 'role', 'user_created.id', 'user_created.role'],
		});
	});
});
