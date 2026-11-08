import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type {
	AbstractServiceOptions,
	Accountability,
	ActionEventParams,
	Aggregate,
	Alterations,
	FieldOverview,
	Item,
	MutationOptions,
	PayloadAction,
	PayloadServiceProcessO2MResult,
	PayloadServiceProcessRowsResult,
	PrimaryKey,
	Query,
	Relation,
	SchemaOverview,
} from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import { parseJSON, toArray } from '@directus/utils';
import { unflatten } from 'flat';
import Joi from 'joi';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { parse as wktToGeoJSON } from 'wellknown';
import type { Helpers } from '../database/helpers/index.js';
import { getHelpers } from '../database/helpers/index.js';
import getDatabase from '../database/index.js';
import { format, isValid, parseISO } from '../utils/date-fns-used.js';
import { generateHash } from '../utils/generate-hash.js';
import { isMissingPrimaryKey, isPrimaryKey } from '../utils/is-primary-key.js';
import {
	chunk,
	clone,
	cloneDeep,
	isNil,
	isObject,
	isPlainObject,
	pick,
} from '../utils/lodash-es-used.js';
import { primaryKeyNameOf } from '../utils/primary-key-name.js';
import { resolveMutationBatching } from '../utils/resolve-mutation-batching.js';
import { validateKeys } from '../utils/validate-keys.js';
import type { ItemsService } from './items.js';

// One read names at most this many keys, under every dialect's bind limit
const RELATED_READ_CHUNK_SIZE = 10_000;

// a record a row nests in one of its fields
type NestedReference = { rowIndex: number; field: string };

type Transformers = {
	[type: string]: (context: {
		action: PayloadAction;
		value: any;
		payload: Partial<Item>;
		accountability: Accountability | null;
		specials: string[];
		helpers: Helpers;
	}) => Promise<any>;
};

/**
 * Process a given payload for a collection to ensure the special fields (hash, uuid, date etc) are
 * handled correctly.
 */
export class PayloadService {
	accountability: Accountability | null;
	knex: Knex;
	helpers: Helpers;
	collection: string;
	schema: SchemaOverview;
	nested: string[];

	constructor(collection: string, options: AbstractServiceOptions) {
		this.accountability = options.accountability || null;
		this.knex = options.knex || getDatabase();
		this.helpers = getHelpers(this.knex);
		this.collection = collection;
		this.schema = options.schema;
		this.nested = options.nested ?? [];

		return this;
	}

	public transformers: Transformers = {
		async hash({ action, value }) {
			if (!value) return;

			if (action === 'create' || action === 'update') {
				return await generateHash(String(value));
			}

			return value;
		},
		async uuid({ action, value }) {
			if (action === 'create' && !value) {
				return randomUUID();
			}

			return value;
		},
		async 'cast-boolean'({ action, value }) {
			if (action === 'read') {
				if (value === true || value === 1 || value === '1') {
					return true;
				} else if (value === false || value === 0 || value === '0') {
					return false;
				} else if (value === null || value === '') {
					return null;
				}
			}

			return value;
		},
		async 'cast-json'({ action, value }) {
			if (action === 'read') {
				if (typeof value === 'string') {
					try {
						return parseJSON(value);
					} catch {
						return value;
					}
				}
			}

			return value;
		},
		async conceal({ action, value }) {
			if (action === 'read') return value ? '**********' : null;
			return value;
		},
		async 'user-created'({ action, value, accountability }) {
			if (action === 'create') return accountability?.user || null;
			return value;
		},
		async 'user-updated'({ action, value, accountability }) {
			if (action === 'update') return accountability?.user || null;
			return value;
		},
		async 'role-created'({ action, value, accountability }) {
			if (action === 'create') return accountability?.role || null;
			return value;
		},
		async 'role-updated'({ action, value, accountability }) {
			if (action === 'update') return accountability?.role || null;
			return value;
		},
		async 'date-created'({ action, value, helpers }) {
			if (action === 'create') return new Date(helpers.date.writeTimestamp(new Date().toISOString()));
			return value;
		},
		async 'date-updated'({ action, value, helpers }) {
			if (action === 'update') return new Date(helpers.date.writeTimestamp(new Date().toISOString()));
			return value;
		},
		async 'cast-csv'({ action, value }) {
			if (Array.isArray(value) === false && typeof value !== 'string') return;

			if (action === 'read') {
				if (Array.isArray(value)) return value;

				if (value === '') return [];

				return value.split(',');
			}

			if (Array.isArray(value)) {
				return value.join(',');
			}

			return value;
		},
	};

	processValues(action: PayloadAction, payloads: Partial<Item>[]): Promise<Partial<Item>[]>;
	processValues(action: PayloadAction, payload: Partial<Item>): Promise<Partial<Item>>;
	processValues(
		action: PayloadAction,
		payloads: Partial<Item>[],
		aliasMap: Record<string, string>,
		aggregate: Aggregate,
	): Promise<Partial<Item>[]>;

	processValues(
		action: PayloadAction,
		payload: Partial<Item>,
		aliasMap: Record<string, string>,
		aggregate: Aggregate,
	): Promise<Partial<Item>>;

	async processValues(
		action: PayloadAction,
		payload: Partial<Item> | Partial<Item>[],
		aliasMap: Record<string, string> = {},
		aggregate: Aggregate = {},
	): Promise<Partial<Item> | Partial<Item>[]> {
		const processedPayload = toArray(payload);

		if (processedPayload.length === 0) return [];

		const fieldsInPayload = Object.keys(processedPayload[0]!);
		const fieldEntries = Object.entries(this.schema.collections[this.collection]!.fields);
		const aliasEntries = Object.entries(aliasMap);

		let specialFields: [string, FieldOverview][] = [];

		for (const [name, field] of fieldEntries) {
			if (field.special && field.special.length > 0) {
				specialFields.push([name, field]);

				for (const [aliasName, fieldName] of aliasEntries) {
					if (fieldName === name) {
						specialFields.push([aliasName, { ...field, field: aliasName }]);
					}
				}
			}
		}

		if (action === 'read') {
			specialFields = specialFields.filter(([name]) => {
				return fieldsInPayload.includes(name);
			});
		}

		for (const record of processedPayload) {
			for (const [name, field] of specialFields) {
				const newValue = await this.processField(field, record, action, this.accountability);
				if (newValue !== undefined) record[name] = newValue;
			}
		}

		this.processGeometries(fieldEntries, processedPayload, action);
		this.processDates(fieldEntries, processedPayload, action, aliasMap, aggregate);

		if (['create', 'update'].includes(action)) {
			processedPayload.forEach((record) => {
				for (const [key, value] of Object.entries(record)) {
					if (Array.isArray(value) || (typeof value === 'object' && !(value instanceof Date) && value !== null)) {
						if (!value.isRawInstance) {
							record[key] = JSON.stringify(value);
						}
					}
				}
			});
		}

		if (action === 'read') {
			this.processAggregates(processedPayload, aggregate);
		}

		if (Array.isArray(payload)) {
			return processedPayload;
		}

		return processedPayload[0]!;
	}

	processAggregates(payload: Partial<Item>[], aggregate: Aggregate = {}) {
		/**
		 * Build access path with -> delimiter
		 *
		 * input: { min: [ 'date', 'datetime', 'timestamp' ] }
		 * output: [ 'min->date', 'min->datetime', 'min->timestamp' ]
		 */
		const aggregateKeys = Object.entries(aggregate).reduce<string[]>((acc, [key, values]) => {
			acc.push(...values.map((value) => `${key}->${value}`));
			return acc;
		}, []);

		/**
		 * Expand -> delimited keys in the payload to the equivalent expanded object
		 *
		 * before: { "min->date": "2025-04-09", "min->datetime": "2025-04-08T12:00:00", "min->timestamp": "2025-04-17T23:18:00.000Z" }
		 * after: { "min": { "date": "2025-04-09", "datetime": "2025-04-08T12:00:00", "timestamp": "2025-04-17T23:18:00.000Z" } }
		 */
		if (aggregateKeys.length) {
			for (const item of payload) {
				Object.assign(item, unflatten(pick(item, aggregateKeys), { delimiter: '->' }));
				aggregateKeys.forEach((key) => delete item[key]);
			}
		}
	}

	async processField(
		field: SchemaOverview['collections'][string]['fields'][string],
		payload: Partial<Item>,
		action: PayloadAction,
		accountability: Accountability | null,
	): Promise<any> {
		if (!field.special) return payload[field.field];
		const fieldSpecials = field.special ? toArray(field.special) : [];

		let value = clone(payload[field.field]);

		for (const special of fieldSpecials) {
			if (special in this.transformers) {
				value = await this.transformers[special]!({
					action,
					value,
					payload,
					accountability,
					specials: fieldSpecials,
					helpers: this.helpers,
				});
			}
		}

		return value;
	}

	/**
	 * Native geometries are stored in custom binary format. We need to insert them with
	 * the function st_geomfromtext. For this to work, that function call must not be
	 * escaped. It's therefore placed as a Knex.Raw object in the payload. Thus the need
	 * to check if the value is a raw instance before stringifying it in the next step.
	 */
	processGeometries<T extends Partial<Record<string, any>>[]>(
		fieldEntries: [string, FieldOverview][],
		payloads: T,
		action: PayloadAction,
	): T {
		const process =
			action == 'read'
				? (value: any) => (typeof value === 'string' ? wktToGeoJSON(value) : value)
				: (value: any) => this.helpers.st.fromGeoJSON(typeof value == 'string' ? parseJSON(value) : value);

		const geometryColumns = fieldEntries.filter(([_, field]) => field.type.startsWith('geometry'));

		for (const [name] of geometryColumns) {
			for (const payload of payloads) {
				if (payload[name]) {
					payload[name] = process(payload[name]);
				}
			}
		}

		return payloads;
	}

	/**
	 * Knex returns `datetime` and `date` columns as Date.. This is wrong for date / datetime, as those
	 * shouldn't return with time / timezone info respectively
	 */
	processDates(
		fieldEntries: [string, FieldOverview][],
		payloads: Partial<Record<string, any>>[],
		action: PayloadAction,
		aliasMap: Record<string, string> = {},
		aggregate: Aggregate = {},
	): Partial<Record<string, any>>[] {
		// Include aggegation e.g. "count->id" in alias map
		const aggregateMapped = Object.fromEntries(
			Object.entries(aggregate).reduce<string[][]>((acc, [key, values]) => {
				acc.push(...values.map((value) => [`${key}->${value}`, value]));
				return acc;
			}, []),
		);

		const aliasFields = { ...aliasMap, ...aggregateMapped };

		for (const aliasField in aliasFields) {
			const schemaField = aliasFields[aliasField];
			const field = this.schema.collections[this.collection]!.fields[schemaField!];

			if (field) {
				fieldEntries.push([
					aliasField,
					{
						...field,
						field: aliasField,
					},
				]);
			}
		}

		const dateColumns = fieldEntries.filter(([_name, field]) => ['dateTime', 'date', 'timestamp'].includes(field.type));

		const timeColumns = fieldEntries.filter(([_name, field]) => {
			return field.type === 'time';
		});

		if (dateColumns.length === 0 && timeColumns.length === 0) return payloads;

		for (const [name, dateColumn] of dateColumns) {
			for (const payload of payloads) {
				let value: number | string | Date = payload[name];

				if (value === null || (typeof value === 'string' && /^[.0 :-]{10,}$/.test(value))) {
					payload[name] = null;
					continue;
				}

				if (!value) continue;

				if (action === 'read') {
					if (typeof value === 'number' || typeof value === 'string') {
						value = new Date(value);
					}

					if (dateColumn.type === 'timestamp') {
						const newValue = this.helpers.date.readTimestampString(value.toISOString());
						payload[name] = newValue;
					}

					if (dateColumn.type === 'dateTime') {
						const year = String(value.getFullYear()).padStart(4, '0');
						const month = String(value.getMonth() + 1).padStart(2, '0');
						const day = String(value.getDate()).padStart(2, '0');
						const hours = String(value.getHours()).padStart(2, '0');
						const minutes = String(value.getMinutes()).padStart(2, '0');
						const seconds = String(value.getSeconds()).padStart(2, '0');

						const newValue = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
						payload[name] = newValue;
					}

					if (dateColumn.type === 'date') {
						const year = String(value.getFullYear()).padStart(4, '0');
						const month = String(value.getMonth() + 1).padStart(2, '0');
						const day = String(value.getDate()).padStart(2, '0');

						// Strip off the time / timezone information from a date-only value
						const newValue = `${year}-${month}-${day}`;
						payload[name] = newValue;
					}
				} else {
					if (value instanceof Date === false && typeof value === 'string') {
						if (dateColumn.type === 'date') {
							const parsedDate = parseISO(value);

							if (!isValid(parsedDate)) {
								throw new InvalidPayloadError({ reason: `Invalid Date format in field "${dateColumn.field}"` });
							}

							payload[name] = parsedDate;
						}

						if (dateColumn.type === 'dateTime') {
							const parsedDate = parseISO(value);

							if (!isValid(parsedDate)) {
								throw new InvalidPayloadError({ reason: `Invalid DateTime format in field "${dateColumn.field}"` });
							}

							payload[name] = parsedDate;
						}

						if (dateColumn.type === 'timestamp') {
							const newValue = this.helpers.date.writeTimestamp(value);
							payload[name] = newValue;
						}
					}
				}
			}
		}

		/**
		 * Some DB drivers (MS SQL f.e.) return time values as Date objects. For consistencies sake,
		 * we'll abstract those back to hh:mm:ss
		 */
		for (const [name] of timeColumns) {
			for (const payload of payloads) {
				const value = payload[name];

				if (!value) continue;

				if (action === 'read') {
					if (value instanceof Date) payload[name] = format(value, 'HH:mm:ss');
				}
			}
		}

		return payloads;
	}

	/**
	 * Save/update the nested M2O and A2O items of several rows.
	 *
	 * Per related collection, the records the rows nest in any of its fields,
	 * M2O or A2O, go through one upsertMany in payload order, and each payload
	 * comes back with its record replaced by the record's key. A collection
	 * another one references is written first. The collections of a foreign
	 * key cycle are written one record at a time in payload order, as before
	 * batching: no single collection order fits every batch inside a cycle.
	 */
	async processM2OAndA2O(
		rows: Partial<Item>[],
		opts?: MutationOptions,
	): Promise<PayloadServiceProcessRowsResult> {
		// a single row would otherwise fail on a TypeError
		if (!Array.isArray(rows)) {
			throw new Error(
				'processM2OAndA2O takes the rows as an array,'
				+ ` got ${JSON.stringify(rows)}`,
			);
		}

		const rowsResult: PayloadServiceProcessRowsResult = {
			payloads: rows.map((row) => cloneDeep(row)),
			revisionsByParent: rows.map(() => []),
			nestedActionEvents: [],
			userIntegrityCheckFlags: UserIntegrityCheckFlag.None,
		};

		// Many to one relations that exist on the current collection
		const relations = this.schema.relations.filter((relation) => {
			return relation.collection === this.collection;
		});

		const fieldsOfCollections = new Map<string, string[]>();

		for (const relation of relations) {
			// If no "one collection" exists, this is a A2O, not a M2O
			if (!relation.related_collection) {
				continue;
			}

			const collectionFields =
				fieldsOfCollections.get(relation.related_collection) ?? [];

			// a schema can list one relation twice
			if (!collectionFields.includes(relation.field)) {
				collectionFields.push(relation.field);
			}

			fieldsOfCollections.set(relation.related_collection, collectionFields);
		}

		const referencesOfCollections = new Map<string, NestedReference[]>();

		for (const [collectionName, collectionFields] of fieldsOfCollections) {
			// Only process related records that are actually in the payload
			const references = [...rowsResult.payloads.entries()]
				.flatMap(([rowIndex, payload]) => {
					return collectionFields
						.filter((field) => field in payload && isObject(payload[field]))
						.map((field) => ({ rowIndex, field }));
				});

			if (references.length > 0) {
				referencesOfCollections.set(collectionName, references);
			}
		}

		const a2oFields = new Set<string>();

		for (const relation of relations) {
			// If the required a2o configuration fields are missing, this is a m2o
			// instead of an a2o
			if (
				!relation.meta?.one_collection_field
				|| !relation.meta?.one_allowed_collections
				|| a2oFields.has(relation.field)
			) {
				continue;
			}

			a2oFields.add(relation.field);

			const collectionField = relation.meta.one_collection_field;
			const allowedCollections = relation.meta.one_allowed_collections;

			for (const [rowIndex, payload] of rowsResult.payloads.entries()) {
				// Only process related records that are actually in the payload
				if (
					!(relation.field in payload)
					|| !isPlainObject(payload[relation.field])
				) {
					continue;
				}

				const relatedCollection = payload[collectionField];

				if (!relatedCollection) {
					throw new InvalidPayloadError({
						reason: `Can't update nested record`
							+ ` ${JSON.stringify(`${relation.collection}.${relation.field}`)}`
							+ ' without field'
							+ ` ${JSON.stringify(`${relation.collection}.${collectionField}`)}`
							+ ' being set',
					});
				}

				if (allowedCollections.includes(relatedCollection) === false) {
					throw new InvalidPayloadError({
						reason: `${JSON.stringify(`${relation.collection}.${relation.field}`)}`
							+ ' can\'t be linked to collection'
							+ ` ${JSON.stringify(relatedCollection)}`,
					});
				}

				const collectionReferences =
					referencesOfCollections.get(relatedCollection) ?? [];

				collectionReferences.push({ rowIndex, field: relation.field });
				referencesOfCollections.set(relatedCollection, collectionReferences);
			}
		}

		const orderedCollections: string[] = [];
		const visitedCollections = new Set<string>();

		const visitCollection = (collectionName: string) => {
			if (visitedCollections.has(collectionName)) {
				return;
			}

			visitedCollections.add(collectionName);

			for (const relation of this.schema.relations) {
				if (
					relation.collection === collectionName
					&& relation.related_collection
				) {
					visitCollection(relation.related_collection);
				}
			}

			if (referencesOfCollections.has(collectionName)) {
				orderedCollections.push(collectionName);
			}
		};

		for (const collectionName of referencesOfCollections.keys()) {
			visitCollection(collectionName);
		}

		const reachableCollectionsOf = (collectionName: string) => {
			const reachedCollections = new Set<string>();
			const pendingCollections = [collectionName];

			while (pendingCollections.length > 0) {
				const currentCollection = pendingCollections.pop()!;

				for (const relation of this.schema.relations) {
					if (
						relation.collection === currentCollection
						&& relation.related_collection
						&& !reachedCollections.has(relation.related_collection)
					) {
						reachedCollections.add(relation.related_collection);
						pendingCollections.push(relation.related_collection);
					}
				}
			}

			return reachedCollections;
		};

		const reachableCollections = new Map(orderedCollections.map((name) => {
			return [name, reachableCollectionsOf(name)];
		}));

		// as before batching: a row's M2O records in relation order, then its A2O
		const relationRankOf = (field: string) => {
			const relationIndex = relations
				.findIndex((relation) => relation.field === field);

			return a2oFields.has(field)
				? relations.length + relationIndex
				: relationIndex;
		};

		for (const collectionName of orderedCollections) {
			const cycleCollections = orderedCollections.filter((otherName) => {
				return otherName === collectionName
					|| (reachableCollections.get(collectionName)!.has(otherName)
						&& reachableCollections.get(otherName)!.has(collectionName));
			});

			if (cycleCollections.length === 1) {
				await this.saveNestedReferences(
					collectionName,
					// payload order: a row's M2O records come before its A2O ones
					referencesOfCollections.get(collectionName)!
						.sort((left, right) => left.rowIndex - right.rowIndex),
					rowsResult,
					opts,
				);

				continue;
			}

			// the last collection of a cycle in post-order comes after every
			// collection the cycle references
			if (cycleCollections.at(-1) !== collectionName) {
				continue;
			}

			const cycleReferences = cycleCollections
				.flatMap((cycleCollection) => {
					return referencesOfCollections.get(cycleCollection)!
						.map((reference) => ({ cycleCollection, reference }));
				})
				.sort((left, right) => {
					return left.reference.rowIndex - right.reference.rowIndex
						|| relationRankOf(left.reference.field)
						- relationRankOf(right.reference.field);
				});

			for (const { cycleCollection, reference } of cycleReferences) {
				await this.saveNestedReferences(
					cycleCollection,
					[reference],
					rowsResult,
					opts,
				);
			}
		}

		return rowsResult;
	}

	/**
	 * Under preserveMutationOrder, cut the records into one upsert each time a
	 * record holding only its key follows one holding fields, or the reverse:
	 * a key alone is then read after the records sent before it are written.
	 */
	private async saveNestedReferences(
		relatedCollection: string,
		references: NestedReference[],
		rowsResult: PayloadServiceProcessRowsResult,
		opts?: MutationOptions,
	): Promise<void> {
		if (resolveMutationBatching(opts ?? {}) !== 'preserveMutationOrder') {
			return this.saveNestedRecords(
				relatedCollection,
				references,
				rowsResult,
				opts,
			);
		}

		const relatedPrimaryKeyField =
			this.schema.collections[relatedCollection]!.primary;

		const holdsKeyOnly = ({ rowIndex, field }: NestedReference) => {
			const record: Partial<Item> = rowsResult.payloads[rowIndex]![field];
			const recordFields = Object.keys(record);

			return recordFields.length === 1
				&& recordFields[0] === relatedPrimaryKeyField
				&& !isMissingPrimaryKey(record[relatedPrimaryKeyField]);
		};

		// a key alone names a row a record of an earlier segment writes, too
		const upsertedKeyNames = new Set<string>();
		let segmentReferences: NestedReference[] = [];

		for (const reference of references) {
			if (
				segmentReferences.length > 0
				&& holdsKeyOnly(segmentReferences[0]!) !== holdsKeyOnly(reference)
			) {
				await this.saveNestedRecords(
					relatedCollection,
					segmentReferences,
					rowsResult,
					opts,
					upsertedKeyNames,
				);

				segmentReferences = [];
			}

			segmentReferences.push(reference);
		}

		await this.saveNestedRecords(
			relatedCollection,
			segmentReferences,
			rowsResult,
			opts,
			upsertedKeyNames,
		);
	}

	/**
	 * Upsert the records several rows nest, all of one collection, and replace
	 * each by its key in its row's payload. A record naming only the key of a
	 * row that exists writes nothing. That key is compared by its spelling, as
	 * in `upsertRun`: under a column storing another one (char(n) padding,
	 * citext) it reads as no row, and creating it is refused as not unique.
	 *
	 * TODO(#610): the same under a MariaDB `_ci` collation.
	 */
	private async saveNestedRecords(
		relatedCollection: string,
		references: NestedReference[],
		rowsResult: PayloadServiceProcessRowsResult,
		opts?: MutationOptions,
		upsertedKeyNames = new Set<string>(),
	): Promise<void> {
		const { getService } = await import('../utils/get-service.js');

		const service = getService(relatedCollection, {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema,
			nested: [...this.nested, references[0]!.field],
		});

		const relatedPrimaryKeyField =
			this.schema.collections[relatedCollection]!.primary;

		const keyOnlyOf = ({
			rowIndex,
			field,
		}: NestedReference): PrimaryKey | null => {
			const record: Partial<Item> = rowsResult.payloads[rowIndex]![field];
			const recordFields = Object.keys(record);
			const relatedPrimaryKey = record[relatedPrimaryKeyField];

			return recordFields.length === 1
				&& recordFields[0] === relatedPrimaryKeyField
				&& !isMissingPrimaryKey(relatedPrimaryKey)
				? relatedPrimaryKey
				: null;
		};

		const keyOnlyKeys = references.flatMap((reference) => {
			const keyOnly = keyOnlyOf(reference);

			return keyOnly === null
				? []
				: [keyOnly];
		});

		validateKeys(
			this.schema,
			relatedCollection,
			relatedPrimaryKeyField,
			keyOnlyKeys,
		);

		const existingKeyNames = new Set<string>();

		for (const keyChunk of chunk(keyOnlyKeys, RELATED_READ_CHUNK_SIZE)) {
			const existingRows = await this.knex
				.select(relatedPrimaryKeyField)
				.from(relatedCollection)
				.whereIn(relatedPrimaryKeyField, keyChunk);

			for (const existingRow of existingRows) {
				existingKeyNames.add(primaryKeyNameOf(
					existingRow[relatedPrimaryKeyField],
					relatedCollection,
					this.schema,
				));
			}
		}

		const upsertReferences = references.filter(({ rowIndex, field }) => {
			const relatedPrimaryKey =
				rowsResult.payloads[rowIndex]![field][relatedPrimaryKeyField];

			if (isMissingPrimaryKey(relatedPrimaryKey)) {
				return true;
			}

			const keyName = primaryKeyNameOf(
				relatedPrimaryKey,
				relatedCollection,
				this.schema,
			);

			if (
				keyOnlyOf({ rowIndex, field }) !== null
				&& (existingKeyNames.has(keyName) || upsertedKeyNames.has(keyName))
			) {
				return false;
			}

			upsertedKeyNames.add(keyName);

			return true;
		});

		const upsertReferenceSet = new Set(upsertReferences);

		for (const reference of references) {
			const keyOnly = keyOnlyOf(reference);

			if (keyOnly !== null && !upsertReferenceSet.has(reference)) {
				rowsResult.payloads[reference.rowIndex]![reference.field] = keyOnly;
			}
		}

		if (upsertReferences.length === 0) {
			return;
		}

		const upsertedKeys = await service.upsertMany(
			upsertReferences.map(({ rowIndex, field }) => {
				return rowsResult.payloads[rowIndex]![field];
			}),
			{
				// a row an update hook adds is refused, like the updateOne this was
				refuseHookAddedRows: true,
				nestedOfPayloads: upsertReferences.map(({ field }) => {
					return [...this.nested, field];
				}),
				onRevisionCreate: (revision, item, recordIndex) => {
					// refuseHookAddedRows leaves every revision a record of its own
					if (recordIndex === undefined) {
						throw new Error(
							`Revision ${JSON.stringify(revision)} of`
							+ ` ${JSON.stringify(item)} in ${JSON.stringify(relatedCollection)}`
							+ ' came from no nested record',
						);
					}

					const { rowIndex } = upsertReferences[recordIndex]!;

					rowsResult.revisionsByParent[rowIndex]!.push(revision);
				},
				onRequireUserIntegrityCheck: (flags) => {
					rowsResult.userIntegrityCheckFlags |= flags;
				},
				bypassEmitAction: (params) => {
					return opts?.bypassEmitAction
						? opts.bypassEmitAction(params)
						: rowsResult.nestedActionEvents.push(params);
				},
				emitEvents: opts?.emitEvents,
				mutationTracker: opts?.mutationTracker,
				mutationBatching: opts?.mutationBatching,
			},
		);

		for (const [recordIndex, upsertedKey] of upsertedKeys.entries()) {
			const { rowIndex, field } = upsertReferences[recordIndex]!;

			rowsResult.payloads[rowIndex]![field] = upsertedKey;
		}
	}

	/**
	 * Recursively save/update all nested related o2m items of several parent rows.
	 *
	 * Per relation, the lists of parents next to each other go through one
	 * read of the existing children they name and one upsertMany; a deselect
	 * runs only for the parents still holding a child their list leaves out,
	 * once those lists are saved. A child two lists name ends on the last parent
	 * naming it, and a child moving from one parent of the call to another is
	 * not nullified on the way. An alterations object ({ create, update,
	 * delete }) is applied for its parent in its place between the lists.
	 */
	async processO2M(
		parentRows: { data: Partial<Item>; key: PrimaryKey }[],
		opts?: MutationOptions,
	): Promise<PayloadServiceProcessO2MResult> {
		// a caller of the former processO2M(data, key) would get a TypeError
		if (!Array.isArray(parentRows)) {
			throw new Error(
				'processO2M takes the parent rows as [{ data, key }], got'
				+ ` ${JSON.stringify(parentRows)}`,
			);
		}

		const revisionsByParent: PrimaryKey[][] = parentRows.map(() => []);
		let userIntegrityCheckFlags = UserIntegrityCheckFlag.None;

		const nestedActionEvents: ActionEventParams[] = [];

		const nestedMutationOptions: MutationOptions = {
			onRequireUserIntegrityCheck: (flags) => (userIntegrityCheckFlags |= flags),
			bypassEmitAction: (params) => {
				return opts?.bypassEmitAction
					? opts.bypassEmitAction(params)
					: nestedActionEvents.push(params);
			},
			emitEvents: opts?.emitEvents,
			mutationTracker: opts?.mutationTracker,
			mutationBatching: opts?.mutationBatching,
		};

		const relations = this.schema.relations.filter((relation) => {
			return relation.related_collection === this.collection;
		});

		const nestedUpdateSchema = Joi.object({
			create: Joi.array().items(Joi.object().unknown()),
			update: Joi.array().items(Joi.object().unknown()),
			delete: Joi.array().items(Joi.string(), Joi.number()),
		});

		for (const relation of relations) {
			if (!relation.meta?.one_field) {
				continue;
			}

			const oneField = relation.meta.one_field;

			// Only process related records that are actually in the payload. Lists
			// next to each other save at once; an alteration keeps its place between
			// them, so a child two parents name ends where the later one puts it
			const parentRuns: { listsChildren: boolean; parentIndexes: number[] }[] = [];

			for (const [parentIndex, parentRow] of parentRows.entries()) {
				if (!(oneField in parentRow.data)) {
					continue;
				}

				const field = parentRow.data[oneField];
				const listsChildren = !field || Array.isArray(field);
				const lastRun = parentRuns.at(-1);

				if (listsChildren && lastRun?.listsChildren) {
					lastRun.parentIndexes.push(parentIndex);
				}
				else {
					parentRuns.push({ listsChildren, parentIndexes: [parentIndex] });
				}
			}

			if (parentRuns.length === 0) {
				continue;
			}

			const relatedPrimaryKeyField = this.schema.collections[relation.collection]!.primary;

			const { getService } = await import('../utils/get-service.js');

			const service = getService(relation.collection, {
				accountability: this.accountability,
				knex: this.knex,
				schema: this.schema,
				nested: [...this.nested, oneField],
			});

			for (const parentRun of parentRuns) {
				if (parentRun.listsChildren) {
					await this.saveO2MLists(
						relation,
						service,
						parentRun.parentIndexes.map((parentIndex) => parentRows[parentIndex]!),
						parentRun.parentIndexes.map((parentIndex) => {
							return revisionsByParent[parentIndex]!;
						}),
						nestedMutationOptions,
					);

					continue;
				}

				const parentIndex = parentRun.parentIndexes[0]!;
				const parent = parentRows[parentIndex]!.key;
				const field = parentRows[parentIndex]!.data[oneField];
				const revisions = revisionsByParent[parentIndex]!;

				const alterations = field as Alterations;
				const { error } = nestedUpdateSchema.validate(alterations);
				if (error) throw new InvalidPayloadError({ reason: `Invalid one-to-many update structure: ${error.message}` });

				if (alterations.create) {
					const sortField = relation.meta.sort_field;

					let createPayload: Alterations['create'];

					if (sortField !== null) {
						const highestOrderNumber: Record<'max', number | null> | undefined = await this.knex
							.from(relation.collection)
							.where({ [relation.field]: parent })
							.whereNotNull(sortField)
							.max(sortField, { as: 'max' })
							.first();

						createPayload = alterations.create.map((item, index) => {
							const record = cloneDeep(item);

							// add sort field value if it is not supplied in the item
							if (record[sortField] === undefined) {
								record[sortField] = highestOrderNumber?.max ? highestOrderNumber.max + index + 1 : index + 1;
							}

							return {
								...record,
								[relation.field]: parent,
							};
						});
					} else {
						createPayload = alterations.create.map((item) => ({
							...item,
							[relation.field]: parent,
						}));
					}

					await service.createMany(createPayload, {
						onRevisionCreate: (pk) => revisions.push(pk),
						onRequireUserIntegrityCheck: (flags) => (userIntegrityCheckFlags |= flags),
						bypassEmitAction: (params) =>
							opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						emitEvents: opts?.emitEvents,
						mutationTracker: opts?.mutationTracker,
						mutationBatching: opts?.mutationBatching,
					});
				}

				if (alterations.update) {
					for (const item of alterations.update) {
						const { [relatedPrimaryKeyField]: key, ...record } = item;

						const existingRecord = await this.knex
							.select(relatedPrimaryKeyField, relation.field)
							.from(relation.collection)
							.where({ [relatedPrimaryKeyField]: key })
							.first();

						if (!existingRecord || existingRecord[relation.field] != parent) {
							record[relation.field] = parent;
						}

						await service.updateOne(key, record, {
							onRevisionCreate: (pk) => revisions.push(pk),
							onRequireUserIntegrityCheck: (flags) => (userIntegrityCheckFlags |= flags),
							bypassEmitAction: (params) =>
								opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
							emitEvents: opts?.emitEvents,
							mutationTracker: opts?.mutationTracker,
							mutationBatching: opts?.mutationBatching,
						});
					}
				}

				if (alterations.delete) {
					const query: Query = {
						filter: {
							_and: [
								{
									[relation.field]: {
										_eq: parent,
									},
								},
								{
									[relatedPrimaryKeyField]: {
										_in: alterations.delete,
									},
								},
							],
						},
						limit: -1,
					};

					if (relation.meta.one_deselect_action === 'delete') {
						await service.deleteByQuery(query, {
							onRequireUserIntegrityCheck: (flags) => (userIntegrityCheckFlags |= flags),
							bypassEmitAction: (params) =>
								opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
							emitEvents: opts?.emitEvents,
							mutationTracker: opts?.mutationTracker,
							mutationBatching: opts?.mutationBatching,
						});
					} else {
						await service.updateByQuery(
							query,
							{ [relation.field]: null },
							{
								onRevisionCreate: (pk) => revisions.push(pk),
								onRequireUserIntegrityCheck: (flags) => (userIntegrityCheckFlags |= flags),
								bypassEmitAction: (params) =>
									opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
								emitEvents: opts?.emitEvents,
								mutationTracker: opts?.mutationTracker,
								mutationBatching: opts?.mutationBatching,
							},
						);
					}
				}
			}
		}

		return { revisionsByParent, nestedActionEvents, userIntegrityCheckFlags };
	}

	/**
	 * Saves the O2M lists of several parents for one relation: what processO2M
	 * does to a list, with one read and one upsertMany for every parent.
	 *
	 * The children a list names by their key are read once, then the parent
	 * each holds is followed in JS through the lists in order, so a bare key
	 * already on its parent is still skipped as the per-parent read skipped it.
	 * Each revision goes to the parent whose list wrote its child; a child
	 * two lists name gets its revisions in their order, and a revision of a row
	 * no list names (a hook's) goes to the first parent.
	 */
	private async saveO2MLists(
		relation: Relation,
		service: ItemsService,
		listedParents: { data: Partial<Item>; key: PrimaryKey }[],
		revisionsOfParents: PrimaryKey[][],
		nestedMutationOptions: MutationOptions,
	): Promise<void> {
		const oneField = relation.meta!.one_field!;

		const relatedPrimaryKeyField = this.schema
			.collections[relation.collection]!.primary;

		const childKeyNameOf = (childKey: PrimaryKey) => {
			return primaryKeyNameOf(childKey, relation.collection, this.schema);
		};

		const parentKeyNameOf = (parentKey: PrimaryKey) => {
			return primaryKeyNameOf(parentKey, this.collection, this.schema);
		};

		// treat falsey values as removing all children
		const listsOfParents: (PrimaryKey | Partial<Item>)[][] = listedParents
			.map((parentRow) => parentRow.data[oneField] || []);

		const namedChildKeys = listsOfParents.flat().flatMap((relatedRecord) => {
			const relatedId = isPrimaryKey(relatedRecord)
				? relatedRecord
				: relatedRecord[relatedPrimaryKeyField];

			return isMissingPrimaryKey(relatedId)
				? []
				: [relatedId];
		});

		// A key the column cannot hold, such as '{uuid}' or ' 7', is a 400, not a
		// missing row
		validateKeys(
			this.schema,
			relation.collection,
			relatedPrimaryKeyField,
			namedChildKeys,
		);

		// The children the lists name, by key name: the key a row answers to and the
		// parent it holds as the lists before the current one leave it
		const existingChildren = new Map<
			string,
			{ childKey: PrimaryKey; heldParent: unknown }
		>();

		for (const keyChunk of chunk(namedChildKeys, RELATED_READ_CHUNK_SIZE)) {
			const existingRecords = await this.knex
				.select(relatedPrimaryKeyField, relation.field)
				.from(relation.collection)
				.whereIn(relatedPrimaryKeyField, keyChunk);

			for (const existingRecord of existingRecords) {
				const childKey = existingRecord[relatedPrimaryKeyField];

				existingChildren.set(childKeyNameOf(childKey), {
					childKey,
					heldParent: existingRecord[relation.field],
				});
			}
		}

		const recordsToUpsert: Partial<Item>[] = [];
		const parentOfRecord: number[] = [];
		const savedKeysOfParents: PrimaryKey[][] = listedParents.map(() => []);

		for (const [parentIndex, updates] of listsOfParents.entries()) {
			const parent = listedParents[parentIndex]!.key;

			for (const relatedRecord of updates) {
				const relatedId = isPrimaryKey(relatedRecord)
					? relatedRecord
					: relatedRecord[relatedPrimaryKeyField];

				let record = cloneDeep(relatedRecord) as Partial<Item>;

				// No relatedId means it's a new record
				const relatedKeyName = isMissingPrimaryKey(relatedId)
					? null
					: childKeyNameOf(relatedId);

				const existingRecord = relatedKeyName === null
					? undefined
					: existingChildren.get(relatedKeyName);

				if (isPrimaryKey(relatedRecord)) {
					if (!existingRecord) {
						// 404 / InvalidPayload?
						throw new ForbiddenError({
							reason: `Could not find a '${relation.collection}' record`
								+ ` having the primary key ${relatedRecord}`
								+ ' while processing O2M relation',
						});
					}

					// If the related item is already associated to the current item, and
					// there's no other updates (which is indicated by the fact that this
					// is just the PK, we can ignore updating this item. This makes sure we
					// don't trigger any update logic for items that aren't actually being
					// updated. NOTE: We use == here, as the primary key might be reported
					// as a string instead of number, coming from the http route, and or a
					// bigInteger in the DB
					if (
						isNil(existingRecord.heldParent) === false
						&& existingRecord.heldParent == parent
					) {
						savedKeysOfParents[parentIndex]!.push(existingRecord.childKey);
						continue;
					}

					record = {
						[relatedPrimaryKeyField]: relatedRecord,
					};
				}

				if (!existingRecord || existingRecord.heldParent != parent) {
					record[relation.field] = parent;
				}

				// A later list naming this child finds it where this one leaves it
				if (relatedKeyName !== null) {
					existingChildren.set(relatedKeyName, {
						childKey: existingRecord?.childKey ?? relatedId,
						heldParent: relation.field in record
							? record[relation.field]
							: existingRecord?.heldParent,
					});
				}

				recordsToUpsert.push(record);
				parentOfRecord.push(parentIndex);
			}
		}

		const writtenRevisions: {
			revision: PrimaryKey;
			recordIndex: number | undefined;
		}[] = [];

		const upsertedKeys = await service.upsertMany(recordsToUpsert, {
			...nestedMutationOptions,
			onRevisionCreate: (revision, item, recordIndex) => {
				// a missing key would hand the revision to the first parent
				if (isMissingPrimaryKey(item)) {
					throw new Error(
						`Revision ${JSON.stringify(revision)} of`
						+ ` ${JSON.stringify(relation.collection)} came without the`
						+ ` key of its item: ${JSON.stringify(item)}`,
					);
				}

				writtenRevisions.push({ revision, recordIndex });
			},
		});

		for (const [recordIndex, upsertedKey] of upsertedKeys.entries()) {
			savedKeysOfParents[parentOfRecord[recordIndex]!]!.push(upsertedKey);
		}

		// a row a hook added comes from no record
		for (const { revision, recordIndex } of writtenRevisions) {
			const parentIndex = recordIndex === undefined
				? 0
				: parentOfRecord[recordIndex]!;

			revisionsOfParents[parentIndex]!.push(revision);
		}

		// Nullify all related items that aren't included in the current payload, only
		// for the parents still holding one: most parents hold none after a create.
		// A single parent skips the probe: its deselect query reads as much
		const probesHeldChildren = listedParents.length > 1;
		const savedKeyNamesOfParents = new Map<string, Set<string>>();

		for (const [parentIndex, parentRow] of listedParents.entries()) {
			savedKeyNamesOfParents.set(
				parentKeyNameOf(parentRow.key),
				new Set(savedKeysOfParents[parentIndex]!.flatMap((savedKey) => {
					return isPrimaryKey(savedKey)
						? [childKeyNameOf(savedKey)]
						: [];
				})),
			);
		}

		const parentKeyNamesLeavingChildren = new Set<string>();

		const listedParentKeys = listedParents.map((parentRow) => parentRow.key);

		const probedKeyChunks = probesHeldChildren
			? chunk(listedParentKeys, RELATED_READ_CHUNK_SIZE)
			: [];

		for (const keyChunk of probedKeyChunks) {
			const heldRecords = await this.knex
				.select(relatedPrimaryKeyField, relation.field)
				.from(relation.collection)
				.whereIn(relation.field, keyChunk);

			for (const heldRecord of heldRecords) {
				const parentKeyName = parentKeyNameOf(heldRecord[relation.field]);

				const heldKeyName = childKeyNameOf(
					heldRecord[relatedPrimaryKeyField],
				);

				if (!savedKeyNamesOfParents.get(parentKeyName)?.has(heldKeyName)) {
					parentKeyNamesLeavingChildren.add(parentKeyName);
				}
			}
		}

		for (const [parentIndex, parentRow] of listedParents.entries()) {
			const parentKeyName = parentKeyNameOf(parentRow.key);

			if (
				probesHeldChildren
				&& !parentKeyNamesLeavingChildren.has(parentKeyName)
			) {
				continue;
			}

			const query: Query = {
				filter: {
					_and: [
						{
							[relation.field]: {
								_eq: parentRow.key,
							},
						},
						{
							[relatedPrimaryKeyField]: {
								_nin: savedKeysOfParents[parentIndex]!,
							},
						},
					],
				},
				limit: -1,
			};

			if (relation.meta!.one_deselect_action === 'delete') {
				// There's no revision for a deletion
				await service.deleteByQuery(query, nestedMutationOptions);
			}
			else {
				await service.updateByQuery(
					query,
					{ [relation.field]: null },
					{
						...nestedMutationOptions,
						onRevisionCreate: (pk) => revisionsOfParents[parentIndex]!.push(pk),
					},
				);
			}
		}
	}

	/**
	 * Transforms the input partial payload to match the output structure, to have consistency
	 * between delta and data
	 */
	async prepareDelta(data: Partial<Item>): Promise<string | null> {
		let payload = cloneDeep(data);

		for (const key in payload) {
			if (payload[key]?.isRawInstance) {
				payload[key] = payload[key].bindings[0];
			}
		}

		payload = await this.processValues('read', payload);

		if (Object.keys(payload).length === 0) return null;

		// A filter hook may answer a BigInt, which JSON cannot hold as a number
		// without losing digits.
		return JSON.stringify(payload, (_key, fieldValue) => {
			return typeof fieldValue === 'bigint'
				? fieldValue.toString()
				: fieldValue;
		});
	}
}
