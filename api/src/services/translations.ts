import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import getDatabase from '../database/index.js';
import {
	ForbiddenError,
	InvalidPayloadError,
	ItemNotFoundError,
} from '@directus/errors';
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

	private refuseUnreadableRow(key: PrimaryKey): never {
		// An admin reads every row, so a row missing from its read does not exist.
		if (this.accountability?.admin === true) {
			throw new ItemNotFoundError({
				collection: this.collection,
				primaryKey: key,
			});
		}

		throw new ForbiddenError({
			reason: `You don't have permission to perform "update" for`
				+ ` collection "${this.collection}" or it does not exist.`,
		});
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

				for (const key of keys) {
					const item = items.find((readItem) => {
						return this.primaryKeyNameOf(readItem['id'])
						=== this.primaryKeyNameOf(key);
					});

					if (item === undefined) {
						this.refuseUnreadableRow(key);
					}

					const updatedData = { ...item, ...data };

					// A field the caller cannot read comes back undefined.
					if (
						updatedData['key'] === undefined
						|| updatedData['language'] === undefined
					) {
						this.refuseUnreadableRow(key);
					}

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
								return String(movedKey) !== String(key);
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
