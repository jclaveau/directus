import { InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
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
	describe('createMany', () => {
		it('refuses a key already translated in that language', async () => {
			const db = knex.default({ client: MockClient });
			const tracker = createTracker(db);

			tracker.on.select('directus_translations').responseOnce([]);

			tracker.on.select('directus_translations')
				.responseOnce([{ id: 'translation-id-6' }]);

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['translation-id-7']);

			await expect(new TranslationsService({ knex: db, schema }).createMany([
				{ key: 'greeting', language: 'fr-FR' },
				{ key: 'greeting', language: 'en-US' },
			])).rejects.toStrictEqual(new InvalidPayloadError({
				reason: 'Duplicate key and language combination',
			}));

			expect(tracker.history.select[1]?.bindings)
				.toStrictEqual(['greeting', 'en-US', 1]);

			expect(createMany).not.toHaveBeenCalled();
		});

		it('refuses one key and language given to two rows', async () => {
			const db = knex.default({ client: MockClient });
			const tracker = createTracker(db);

			tracker.on.select('directus_translations').response([]);

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['translation-id-9', 'translation-id-10']);

			await expect(new TranslationsService({ knex: db, schema }).createMany([
				{ key: 'greeting', language: 'de-DE' },
				{ key: 'greeting', language: 'de-DE' },
			])).rejects.toStrictEqual(new InvalidPayloadError({
				reason: 'Duplicate key and language combination',
			}));

			expect(createMany).not.toHaveBeenCalled();
		});

		it('creates keys not yet translated in their language', async () => {
			const db = knex.default({ client: MockClient });
			const tracker = createTracker(db);

			tracker.on.select('directus_translations').response([]);

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['translation-id-8', 'translation-id-11']);

			await expect(new TranslationsService({ knex: db, schema }).createMany([
				{ key: 'greeting', language: 'fr-FR' },
				{ key: 'farewell', language: 'fr-FR' },
			])).resolves.toStrictEqual(['translation-id-8', 'translation-id-11']);

			expect(tracker.history.select[0]?.bindings)
				.toStrictEqual(['greeting', 'fr-FR', 1]);

			expect(tracker.history.select[1]?.bindings)
				.toStrictEqual(['farewell', 'fr-FR', 1]);

			expect(createMany).toHaveBeenCalledWith(
				[
					{ key: 'greeting', language: 'fr-FR' },
					{ key: 'farewell', language: 'fr-FR' },
				],
				undefined,
			);
		});
	});

	describe('updateBatch', () => {
		it('moves a row by its key and language onto a free pair', async () => {
			vi.spyOn(ItemsService.prototype, 'readMany')
				.mockResolvedValueOnce(withMeta(
					[{ id: 'translation-id-1', key: 'hello', language: 'de-DE' }],
					{ scopedCacheFingerprints: [] },
				));

			vi.spyOn(TranslationsService.prototype as any, 'translationKeyExists')
				.mockResolvedValue(false);

			vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['translation-id-1']);

			await expect(new TranslationsService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch([
				{ id: 'translation-id-1', key: 'greeting', language: 'en-US' },
			])).resolves.toStrictEqual(['translation-id-1']);
		});

		it('refuses one key and language given to several rows', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['translation-id-1', 'translation-id-9']);

			await expect(new TranslationsService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateMany(
				['translation-id-1', 'translation-id-9'],
				{ key: 'greeting', language: 'en-US' },
			)).rejects.toStrictEqual(new InvalidPayloadError({
				reason: 'Duplicate key and language combination',
			}));

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

		it('applies two rows whose key and language only join alike', async () => {
			vi.spyOn(ItemsService.prototype, 'readMany')
				.mockResolvedValueOnce(withMeta(
					[{ id: 'translation-id-4', key: 'hello', language: 'US' }],
					{ scopedCacheFingerprints: [] },
				))
				.mockResolvedValueOnce(withMeta(
					[{ id: 'translation-id-5', key: 'hi', language: 'en-US' }],
					{ scopedCacheFingerprints: [] },
				));

			vi.spyOn(TranslationsService.prototype as any, 'translationKeyExists')
				.mockResolvedValue(false);

			vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['translation-id-4', 'translation-id-5']);

			await expect(new TranslationsService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch([
				{ id: 'translation-id-4', key: 'greeting-en' },
				{ id: 'translation-id-5', key: 'greeting' },
			])).resolves.toStrictEqual(['translation-id-4', 'translation-id-5']);
		});
	});
});
