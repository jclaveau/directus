import { UnprocessableContentError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readResult } from '../__utils__/read-result.js';
import { ItemsService } from './items.js';
import { VersionsService } from './versions.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_versions', (c) => {
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

describe('Services / Versions', () => {
	describe('promote', () => {
		it('refuses a version whose delta holds no change', async () => {
			const version = { collection: 'articles', item: '1', delta: null };

			const readOne = vi
				.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(readResult(version));

			const service = new VersionsService({ knex: db, schema });

			await expect(service.promote(1, 'main-hash'))
				.rejects.toThrowError(UnprocessableContentError);

			await expect(service.promote(1, 'main-hash'))
				.rejects.toThrowError('No changes to promote');

			expect(readOne).toHaveBeenCalledWith(1);
		});
	});
});
