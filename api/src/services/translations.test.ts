import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withMeta } from '../utils/read-meta.js';
import { ItemsService } from './items.js';
import { TranslationsService } from './translations.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_translations', (c) => {
		c.field('id').uuid()
			.primary();
	})
	.build();

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Services / Translations', () => {
	describe('updateBatch', () => {
		it('refuses a row setting both key and language', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['translation-id-1']);

			await expect(new TranslationsService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch([
				{ id: 'translation-id-1', key: 'greeting', language: 'en-US' },
			])).rejects.toThrowError('Duplicate key and language combination');

			expect(updateGroups).not.toHaveBeenCalled();
		});

		it('refuses two rows renamed to the same key in one language', async () => {
			vi.spyOn(ItemsService.prototype, 'readMany')
				.mockResolvedValueOnce(withMeta(
					[{ key: 'hello', language: 'en-US' }],
					{ scopedCacheFingerprints: [] },
				))
				.mockResolvedValueOnce(withMeta(
					[{ key: 'hi', language: 'en-US' }],
					{ scopedCacheFingerprints: [] },
				));

			vi.spyOn(TranslationsService.prototype as any, 'translationKeyExists')
				.mockResolvedValue(false);

			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['translation-id-2', 'translation-id-3']);

			await expect(new TranslationsService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch([
				{ id: 'translation-id-2', key: 'greeting' },
				{ id: 'translation-id-3', key: 'greeting' },
			])).rejects.toThrowError('Duplicate key and language combination');

			expect(updateGroups).not.toHaveBeenCalled();
		});
	});
});
