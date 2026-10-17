import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import getDatabase from '../database/index.js';
import { InvalidPayloadError } from '@directus/errors';
import { ItemsService } from './items.js';

export class TranslationsService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_translations', options);

		this.knex = options.knex || getDatabase();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}

	private async translationKeyExists(
		key: string,
		language: string,
		excludeKeys: PrimaryKey[] = [],
	) {
		const result = await this.knex
			.select('id')
			.from(this.collection)
			.where({ key, language })
			.whereNotIn('id', excludeKeys);

		return result.length > 0;
	}

	override async createMany(
		data: Partial<Item>[],
		opts?: MutationOptions,
	): Promise<PrimaryKey[]> {
		for (const translationRow of data) {
			for (const requiredField of ['key', 'language']) {
				if (translationRow[requiredField] === undefined) {
					throw new InvalidPayloadError({
						reason: `"${requiredField}" is required`,
					});
				}
			}
		}

		const claimedCombos = new Set<string>();

		for (const translationRow of data) {
			const keyCombo = JSON.stringify([
				translationRow['key'],
				translationRow['language'],
			]);

			if (
				claimedCombos.has(keyCombo)
				|| await this.translationKeyExists(
					translationRow['key'],
					translationRow['language'],
				)
			) {
				throw new InvalidPayloadError({
					reason: 'Duplicate key and language combination',
				});
			}

			claimedCombos.add(keyCombo);
		}

		return await super.createMany(data, opts);
	}

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts?: MutationOptions,
	): Promise<PrimaryKey[]> {
		const claimedCombos = new Set<string>();

		// A row the batch moves frees its old combination; claimedCombos still
		// refuses two rows claiming one.
		const movedKeys = groups
			.filter(({ data }) => {
				return 'key' in data || 'language' in data;
			})
			.flatMap(({ keys }) => {
				return keys;
			});

		for (const { data, keys } of groups) {
			// One key and language for several rows is a duplicate whatever the
			// table holds; a single row is checked like any other move below.
			if (keys.length > 1 && 'key' in data && 'language' in data) {
				throw new InvalidPayloadError({
					reason: 'Duplicate key and language combination',
				});
			}
			else if ('key' in data || 'language' in data) {
				const items = await this.readMany(keys);

				for (const item of items) {
					const updatedData = { ...item, ...data };

					const keyCombo = JSON.stringify([
						updatedData['key'],
						updatedData['language'],
					]);

					if (
						claimedCombos.has(keyCombo)
						|| await this.translationKeyExists(
							updatedData['key'],
							updatedData['language'],
							movedKeys.filter((movedKey) => {
								return String(movedKey) !== String(item['id']);
							}),
						)
					) {
						throw new InvalidPayloadError({
							reason: 'Duplicate key and language combination',
						});
					}

					claimedCombos.add(keyCombo);
				}
			}
		}

		return await super.updateGroups(groups, opts);
	}
}
