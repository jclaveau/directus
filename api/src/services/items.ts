import { Action, ALTERATIONS_KEYS } from '@directus/constants';
import { useEnv } from '@directus/env';
import {
	ErrorCode,
	ForbiddenError,
	InvalidPayloadError,
	isDirectusError,
	ItemNotFoundError,
} from '@directus/errors';
import { isSystemCollection } from '@directus/system-data';
import type {
	AbstractService,
	AbstractServiceOptions,
	Accountability,
	ActionEventParams,
	Alterations,
	CreateEntries,
	CreateEntry,
	Item as AnyItem,
	MutationTracker,
	MutationOptions,
	PrimaryKey,
	Query,
	QueryOptions,
	SchemaOverview,
	ScopedCacheFingerprint,
	UpdateEntries,
	UpdateEntry,
	UpdateGroup,
	WithMeta,
} from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import { oneLine } from '@directus/utils';
import type Keyv from 'keyv';
import type { Knex } from 'knex';
import { getCache } from '../cache.js';
import {
	createScopedCacheHookDeclarations,
	foldScopedCacheEpochsFromHookDeclarations,
	ItemScopedCacheService,
	readScopedCacheEpochs,
	scopedCacheCollectionsChangedByOnDelete,
	scopedCacheMutatedFingerprints,
	scopedCacheUpdatedRows,
	scopedCacheWrittenRows,
	type ScopedCacheSnapshot,
	stripScopedCacheOwnershipInjections,
	takenOverScopedCacheKey,
	withScopedCacheOwnershipInjections,
} from '../scoped-cache/index.js';
import { translateDatabaseError } from '../database/errors/translate.js';
import { getAstFromQuery } from '../database/get-ast-from-query/get-ast-from-query.js';
import { getHelpers } from '../database/helpers/index.js';
import getDatabase, { getDatabaseForAccountability } from '../database/index.js';
import { runAst } from '../database/run-ast/run-ast.js';
import emitter from '../emitter.js';
import { processAst } from '../permissions/modules/process-ast/process-ast.js';
import { processPayload } from '../permissions/modules/process-payload/process-payload.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { readMeta, withMeta } from '../utils/read-meta.js';
import { shouldClearCache } from '../utils/should-clear-cache.js';
import { transaction } from '../utils/transaction.js';
import {
	isMissingPrimaryKey,
	isPrimaryKey,
} from '../utils/is-primary-key.js';
import {
	assign,
	clone,
	cloneDeep,
	isEqual,
	isPlainObject,
	omit,
	pick,
	without,
} from '../utils/lodash-es-used.js';
import { validateKeys } from '../utils/validate-keys.js';
import { validateUserCountIntegrity } from '../utils/validate-user-count-integrity.js';
import { PayloadService } from './payload.js';

const env = useEnv();

/**
 * The options `upsertMany` hands the updates it defers its purge for. Only the
 * update sees the rows an `items.update` filter added, so it reports them, with
 * the slices they sat in before it wrote them.
 */
type DeferredPurgeOptions = MutationOptions & {
	onHookAddedRows?: (
		hookAddedKeys: PrimaryKey[],
		oldScopedCacheSnapshot: ScopedCacheSnapshot,
	) => void;
};

/**
 * Emit a mutation's action events in parallel. This fork awaits them by default so a
 * mutation read-back sees rows its action hooks create (e.g. the notifying fan-out).
 * Pass `awaitActionHooks: false` for the historical fire-and-forget behaviour.
 */
async function emitActionEvents(actionEvents: ActionEventParams[], opts: MutationOptions): Promise<void> {
	const emitting = Promise.all(
		actionEvents.map((actionEvent) =>
			opts.bypassEmitAction
				? opts.bypassEmitAction(actionEvent)
				: emitter.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context),),
	);

	if (opts.awaitActionHooks !== false) {
		await emitting;
	}
	else {
		// Per-event errors are already caught and logged inside emitter.emitAction; swallow here so
		// an un-awaited rejection (e.g. from a bypassEmitAction handler) doesn't go unhandled.
		emitting.catch(() => {});
	}
}

/**
 * Whether a list holds nothing but its entries, with no hole among them. A hook
 * written for one payload sets `payload.field = x` on the list itself, where no
 * write ever reads it, and `every` skips a hole.
 */
function carriesOnlyIndices(answeredList: unknown[]): boolean {
	for (let index = 0; index < answeredList.length; index++) {
		if (!(index in answeredList)) {
			return false;
		}
	}

	return Object.keys(answeredList).length === answeredList.length;
}

/**
 * The list a grouped filter receives, refusing any touch of one of its
 * collection's fields: a hook written for one payload deletes or checks a field
 * on the list itself, where the write never reads it, and would let the write
 * through unchecked.
 */
function refuseFieldAccess<AnsweredList extends unknown[]>(
	answeredList: AnsweredList,
	fieldNames: string[],
	createRefusal: () => Error,
): AnsweredList {
	// An index, an Array member, `then` and `toJSON` win over a field of the same
	// name, so iterating, cloning, serializing and awaiting the list keep working.
	const refusedNames = new Set(fieldNames.filter((fieldName) => {
		return !/^\d+$/.test(fieldName)
			&& !(fieldName in answeredList)
			&& fieldName !== 'then'
			&& fieldName !== 'toJSON';
	}));

	function guardProperty(property: string | symbol) {
		if (typeof property === 'string' && refusedNames.has(property)) {
			throw createRefusal();
		}
	}

	return new Proxy(answeredList, {
		get(target, property, receiver) {
			guardProperty(property);

			return Reflect.get(target, property, receiver);
		},
		has(target, property) {
			guardProperty(property);

			return Reflect.has(target, property);
		},
		set(target, property, value, receiver) {
			guardProperty(property);

			return Reflect.set(target, property, value, receiver);
		},
		deleteProperty(target, property) {
			guardProperty(property);

			return Reflect.deleteProperty(target, property);
		},
		defineProperty(target, property, descriptor) {
			guardProperty(property);

			return Reflect.defineProperty(target, property, descriptor);
		},
	});
}

/**
 * Whether a grouped `items.create` filter answered one entry per row it received,
 * each a `CreateEntry` or `null`, a `sameRowAs` pointing at an earlier position.
 */
function isCreateEntryList(
	entriesAfterHooks: unknown,
	rowCount: number,
): entriesAfterHooks is CreateEntries {
	if (!Array.isArray(entriesAfterHooks) || entriesAfterHooks.length !== rowCount) {
		return false;
	}

	if (!carriesOnlyIndices(entriesAfterHooks)) {
		return false;
	}

	return entriesAfterHooks.every((entry, index) => {
		if (entry === null) {
			return true;
		}

		if (!isPlainObject(entry) || Object.keys(entry).length !== 1) {
			return false;
		}

		if ('data' in entry) {
			return isPlainObject(entry.data);
		}

		if ('key' in entry) {
			return isPrimaryKey(entry.key);
		}

		return 'sameRowAs' in entry
			&& Number.isInteger(entry.sameRowAs)
			&& entry.sameRowAs >= 0
			&& entry.sameRowAs < index;
	});
}

function isUpdateGroup<Item extends AnyItem>(
	entry: UpdateEntry<Item>,
): entry is UpdateGroup<Item> {
	return isPlainObject(entry)
		&& isPlainObject((entry as UpdateGroup<Item>).data)
		&& Array.isArray((entry as UpdateGroup<Item>).keys);
}

/**
 * A row a filter hook wrote itself, answered with its key as `{ key }`. Directus
 * writes nothing for it, so it skips the access check, the revision and activity,
 * the action event, the action flows and the websocket messages; the mutation
 * returns its key. A created row a hook answers with a key skips the same.
 */
function isTakenOverRow<Item extends AnyItem>(
	entry: UpdateEntry<Item>,
): entry is { key: PrimaryKey } {
	return isPlainObject(entry)
		&& Object.keys(entry).length === 1
		&& isPrimaryKey((entry as { key: PrimaryKey }).key);
}

/**
 * Merge each group into the one before it when both carry the same change, so one
 * statement writes rows sent side by side. Rows apart are never merged: a row in
 * between may take a value the earlier row frees, or free one the later row takes,
 * so the rows are written in the order the caller sent them.
 *
 * A group writing a nested item creates it once per group and walks its O2M rows
 * per group, so it never merges: two groups merged would create one related item
 * where the caller asked for two.
 *
 * TODO(#606): merge them when their nested items share an identity, once #337
 * brings the by-unique-identity dedup to the fork.
 */
function mergeUpdateGroups<Item extends AnyItem>(
	candidateGroups: UpdateGroup<Item>[],
	writesNestedItems: (groupData: Partial<Item>) => boolean,
	keyNameOf: (key: PrimaryKey) => string,
): UpdateGroup<Item>[] {
	const mergedGroups: UpdateGroup<Item>[] = [];
	let lastSerializedData: string | null = null;
	let lastKeyNames = new Set<string>();

	for (const candidateGroup of candidateGroups) {
		const serializedData = JSON.stringify(
			candidateGroup.data,
			(_field, value) => {
				return typeof value === 'bigint'
					? value.toString()
					: value;
			},
		);

		const lastGroup = mergedGroups.at(-1);

		if (
			lastGroup === undefined ||
			writesNestedItems(candidateGroup.data) ||
			serializedData !== lastSerializedData ||
			!isEqual(lastGroup.data, candidateGroup.data)
		) {
			mergedGroups.push({ data: candidateGroup.data, keys: [] });
			lastSerializedData = serializedData;
			lastKeyNames = new Set();
		}

		const targetGroup = mergedGroups.at(-1)!;

		// The access check counts the stored rows against the keys, so a row the
		// caller sent twice with one change is written, and checked, once.
		for (const key of candidateGroup.keys) {
			if (!lastKeyNames.has(keyNameOf(key))) {
				lastKeyNames.add(keyNameOf(key));
				targetGroup.keys.push(key);
			}
		}
	}

	return mergedGroups;
}

export class ItemsService<Item extends AnyItem = AnyItem, Collection extends string = string>
implements AbstractService<Item> {
	collection: Collection;
	knex: Knex;
	accountability: Accountability | null;
	eventScope: string;
	schema: SchemaOverview;
	cache: Keyv<any> | null;
	nested: string[];

	// The fingerprints the latest mutation on this (per-request) service purged,
	// surfaced by the controllers as the CACHE_PURGED_TAGS_HEADER response header
	// (rendered to labels there). Mutation
	// methods return bare primary keys — no object for a `withMeta` rider (as reads
	// use) — so the purged set rides the instance. `null` until a mutation purges.
	scopedCachePurged: ScopedCacheFingerprint[] | null = null;

	scopedCache: ItemScopedCacheService;

	constructor(collection: Collection, options: AbstractServiceOptions) {
		this.collection = collection;
		this.knex = options.knex || getDatabaseForAccountability(options.accountability);
		this.accountability = options.accountability || null;

		this.eventScope = isSystemCollection(this.collection)
			? this.collection.substring(9)
			: 'items';

		this.schema = options.schema;
		this.cache = getCache().cache;
		this.nested = options.nested ?? [];

		this.scopedCache = new ItemScopedCacheService(
			this.collection,
			this.schema,
			this.knex,
			this.cache,
			this.accountability,
		);

		return this;
	}

	/**
	 * Create a fork of the current service, allowing instantiation with different options.
	 */
	private fork(options?: Partial<AbstractServiceOptions>): ItemsService<AnyItem> {
		const Service = this.constructor;

		// ItemsService expects `collection` and `options` as parameters,
		// while the other services only expect `options`
		const isItemsService = Service.length === 2;

		const newOptions = {
			knex: this.knex,
			accountability: this.accountability,
			schema: this.schema,
			nested: this.nested,
			...options,
		};

		if (isItemsService) {
			return new ItemsService(this.collection, newOptions);
		}

		return new (Service as new (options: AbstractServiceOptions) => this)(newOptions);
	}

	createMutationTracker(initialCount = 0): MutationTracker {
		const maxCount = Number(env['MAX_BATCH_MUTATION']);
		let mutationCount = initialCount;
		return {
			trackMutations(count: number) {
				mutationCount += count;

				if (mutationCount > maxCount) {
					throw new InvalidPayloadError({ reason: `Exceeded max batch mutation limit of ${maxCount}` });
				}
			},
			getCount() {
				return mutationCount;
			},
			snapshot() {
				const savedCount = mutationCount;

				return () => {
					mutationCount = savedCount;
				};
			},
		};
	}

	async getKeysByQuery(query: Query): Promise<PrimaryKey[]> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		const readQuery = cloneDeep(query);
		readQuery.fields = [primaryKeyField];

		// Allow unauthenticated access
		const itemsService = new ItemsService(this.collection, {
			knex: this.knex,
			schema: this.schema,
		});

		// We read the IDs of the items based on the query, and then run `updateMany`. `updateMany` does it's own
		// permissions check for the keys, so we don't have to make this an authenticated read
		//
		// No response is built from these keys, so the purge counters this read would
		// snapshot are read by nobody. Every other `readByQuery` keeps snapshotting
		// them: a missed snapshot costs staleness, and only a call site owning the whole
		// round trip can know its rows never reach the cache.
		const items = await itemsService.readByQuery(readQuery, {
			skipScopedCacheEpochs: true,
		});

		return items.map((item: AnyItem) => item[primaryKeyField]).filter((pk) => pk);
	}

	/**
	 * Create a single new item.
	 */
	async createOne(data: Partial<Item>, opts: MutationOptions & { allowFilterCancel: true }): Promise<PrimaryKey | null>;
	async createOne(data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey>;
	async createOne(data: Partial<Item>, opts: MutationOptions = {}): Promise<PrimaryKey | null> {
		const [primaryKey] = await this.createMany([data], opts);
		return primaryKey ?? null;
	}

	/**
	 * Create one or more new items at once, wrapped in a transaction. Uses a single batchInsert
	 * where the vendor preserves RETURNING order, otherwise falls back to per-row inserts.
	 */
	async createMany(
		data: Partial<Item>[],
		opts: MutationOptions & { allowFilterCancel: true },
	): Promise<(PrimaryKey | null)[]>;

	async createMany(data: Partial<Item>[], opts?: MutationOptions): Promise<PrimaryKey[]>;
	async createMany(data: Partial<Item>[], opts: MutationOptions = {}): Promise<(PrimaryKey | null)[]> {
		if (!opts.mutationTracker) {
			opts.mutationTracker = this.createMutationTracker();
		}

		if (data.length === 0) {
			return [];
		}

		if (!opts.bypassLimits) {
			opts.mutationTracker.trackMutations(data.length);
		}

		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		const fields = Object.keys(this.schema.collections[this.collection]!.fields);

		const aliases = Object.values(this.schema.collections[this.collection]!.fields)
			.filter((field) => field.alias === true)
			.map((field) => field.field);

		const pkField = this.schema.collections[this.collection]!.fields[primaryKeyField];

		const resetsAutoIncrementSequence =
			pkField !== undefined &&
			!opts.bypassAutoIncrementSequenceReset &&
			['integer', 'bigInteger'].includes(pkField.type) &&
			pkField.defaultValue === 'AUTO_INCREMENT';

		// Index-aligned results: a filter hook can take over a row (returns its own PK) or cancel
		// it (returns null), in which case that row is never inserted but still occupies its slot.
		const results: (PrimaryKey | null)[] = new Array(data.length);

		const createEvent = this.eventScope === 'items'
			? ['items.create', `${this.collection}.items.create`]
			: `${this.eventScope}.create`;

		type ActionPayload = { primaryKey: PrimaryKey; actionHookPayload: AnyItem };

		// An `items.create` hook can declare its own purge via
		// `context.scopedCache.purgeBy`; drained into the purge below. Declared outside
		// the transaction to outlive it.
		// TODO(#610): one set for every attempt, so a `skipPurgeFor` a failed attempt
		// declared still skips the row on the retry, whose hook may have written it.
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations
			?? createScopedCacheHookDeclarations(this.schema);

		// Baseline so the nothing-to-purge return (below) keys off THIS call's own
		// hook declarations, not ones a parent's injected declarations already held.
		const declaredPurgesAtStart =
			scopedCacheHookDeclarations.purgeFingerprints.length;

		// The rows the failed attempt's hooks took over, which the catch purges.
		// TODO(#610): only the last attempt's, so a row a retried attempt's hook took
		// over through a connection of its own, and the retry did not, stays cached.
		let attemptTakenOverKeys: PrimaryKey[] = [];

		const {
			nestedActionEvents,
			actionPayloads,
			takenOverRowKeys,
		} = await transaction(this.knex, async (trx) => {
			const nestedActionEvents: ActionEventParams[] = [];
			const takenOverRowKeys: PrimaryKey[] = [];
			attemptTakenOverKeys = takenOverRowKeys;
			let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
			let autoIncrementSequenceNeedsToBeReset = false;

			type PreparedRow = {
				index: number;
				actionHookPayload: AnyItem;
				payloadAfterHooks: AnyItem;
				payloadWithPresets: AnyItem;
				payloadWithoutAliases: Record<string, unknown>;
				revisionPayload: AnyItem;
				primaryKey: PrimaryKey | undefined;
				revisionsM2O: Awaited<ReturnType<PayloadService['processM2O']>>['revisions'];
				revisionsA2O: Awaited<ReturnType<PayloadService['processA2O']>>['revisions'];
				nestedActionEventsM2O: ActionEventParams[];
				nestedActionEventsA2O: ActionEventParams[];
				userIntegrityCheckFlagsM2O: UserIntegrityCheckFlag;
				userIntegrityCheckFlagsA2O: UserIntegrityCheckFlag;
				payloadService: PayloadService;
			};

			const prepared: PreparedRow[] = [];

			// Resolved once every other row has its key.
			const sameRowPositions: { index: number; sameRowAs: number }[] = [];

			const filterContext = {
				transaction: trx,
				database: trx,
				schema: this.schema,
				accountability: this.accountability,
				scopedCache: scopedCacheHookDeclarations.purgeHandleFor(this.collection),
			};

			const entries = data.map((row): CreateEntry<Item> => {
				return { data: cloneDeep(row) };
			});

			const createEntryListRefusal = () => {
				return new InvalidPayloadError({
					reason: oneLine`
						A "${this.eventScope}.create" filter hook must return one
						{ data } | { key } | { sameRowAs } | null per row it received, a
						sameRowAs pointing at an earlier row; a hook that handles one row
						maps them with mapCreateRows
					`,
				});
			};

			const guardedEntries = refuseFieldAccess(
				entries,
				Object.keys(this.schema.collections[this.collection]!.fields),
				createEntryListRefusal,
			);

			// Once for the whole create, so a hook sees every row it is about to insert,
			// stored duplicates and same-request twins alike.
			const answeredEntries =
				opts.emitEvents !== false
					? await emitter.emitFilter<CreateEntry<Item>[], null>(
						createEvent,
						guardedEntries,
						{ collection: this.collection },
						filterContext,
					)
					: entries;

			const entriesAfterHooks = answeredEntries === guardedEntries
				? entries
				: answeredEntries;

			const createEntries = entriesAfterHooks === null
				? data.map(() => null)
				: entriesAfterHooks;

			if (!isCreateEntryList(createEntries, data.length)) {
				throw createEntryListRefusal();
			}

			for (const [index, entry] of createEntries.entries()) {
				if (entry !== null && 'sameRowAs' in entry) {
					sameRowPositions.push({ index, sameRowAs: entry.sameRowAs });
					continue;
				}

				let payloadAfterHooks: AnyItem | PrimaryKey | null = null;

				if (entry !== null && 'key' in entry) {
					payloadAfterHooks = entry.key;
				}
				else if (entry !== null) {
					payloadAfterHooks = entry.data;
				}

				if (
					typeof payloadAfterHooks === 'string'
					|| typeof payloadAfterHooks === 'number'
				) {
					validateKeys(
						this.schema,
						this.collection,
						primaryKeyField,
						payloadAfterHooks,
					);

					// A filter hook returned a primary key instead of a payload: it has taken over the
					// creation of this row. Surface that key, insert nothing, and let the hook that took
					// over own the action event.
					scopedCacheHookDeclarations.takenOverKeys.add(
						takenOverScopedCacheKey(this.collection, payloadAfterHooks),
					);

					results[index] = payloadAfterHooks;
					takenOverRowKeys.push(payloadAfterHooks);
					continue;
				}

				if (payloadAfterHooks === null) {
					if (!opts.allowFilterCancel) {
						throw new InvalidPayloadError({
							reason: `A filter hook cancelled the creation, but this operation requires a created item`,
						});
					}

					// The filter cancelled this row: nothing is inserted; the null slot keeps the result
					// index-aligned with the input.
					results[index] = null;
					continue;
				}

				const payloadWithPresets = this.accountability
					? await processPayload(
						{
							accountability: this.accountability,
							action: 'create',
							collection: this.collection,
							payload: payloadAfterHooks,
							nested: this.nested,
						},
						{ knex: trx, schema: this.schema },
					)
					: payloadAfterHooks;

				if (opts.preMutationError) {
					throw opts.preMutationError;
				}

				// Ensure the action hook payload has the post filter hook + preset changes
				const actionHookPayload = payloadWithPresets;

				// We're creating new services instances so they can use the transaction as their Knex interface
				const payloadService = new PayloadService(this.collection, {
					accountability: this.accountability,
					knex: trx,
					schema: this.schema,
					nested: this.nested,
				});

				const {
					payload: payloadWithM2O,
					revisions: revisionsM2O,
					nestedActionEvents: nestedActionEventsM2O,
					userIntegrityCheckFlags: userIntegrityCheckFlagsM2O,
				} = await payloadService.processM2O(payloadWithPresets, opts);

				const {
					payload: payloadWithA2O,
					revisions: revisionsA2O,
					nestedActionEvents: nestedActionEventsA2O,
					userIntegrityCheckFlags: userIntegrityCheckFlagsA2O,
				} = await payloadService.processA2O(payloadWithM2O, opts);

				const payloadWithoutAliases = pick(payloadWithA2O, without(fields, ...aliases));
				const payloadWithTypeCasting = await payloadService.processValues('create', payloadWithoutAliases);

				const nestedRowFields = this.schema.relations
					.filter((relation) => relation.collection === this.collection)
					.map((relation) => relation.field)
					.filter((field) => field in payloadAfterHooks);

				const revisionPayload = {
					...payloadAfterHooks,
					...pick(payloadWithA2O, nestedRowFields),
				};

				// The primary key can already exist in the payload.
				// In case of manual string / UUID primary keys it's always provided at this point.
				// In case of an (big) integer primary key, it might be provided as the user can specify the value manually.
				const primaryKey: PrimaryKey | undefined = payloadWithTypeCasting[primaryKeyField];

				// Stored as is, an empty key reads back as another row's: off max(id).
				if (primaryKey === '') {
					throw new InvalidPayloadError({
						reason: `Primary key of ${this.collection} can't be empty`,
					});
				}

				if (!isMissingPrimaryKey(primaryKey)) {
					validateKeys(this.schema, this.collection, primaryKeyField, primaryKey);
				}

				// If a PK of type number was provided, although the PK is set the auto_increment,
				// depending on the database, the sequence might need to be reset to protect future PK collisions.
				if (primaryKey && resetsAutoIncrementSequence) {
					autoIncrementSequenceNeedsToBeReset = true;
				}

				prepared.push({
					index,
					actionHookPayload,
					payloadAfterHooks,
					payloadWithPresets,
					payloadWithoutAliases,
					revisionPayload,
					primaryKey,
					revisionsM2O,
					revisionsA2O,
					nestedActionEventsM2O,
					nestedActionEventsA2O,
					userIntegrityCheckFlagsM2O,
					userIntegrityCheckFlagsA2O,
					payloadService,
				});
			}

			await this.validateRowsToCreate(
				prepared.map((preparedRow) => preparedRow.payloadWithPresets),
				trx,
			);

			// The rows that leave their key to the sequence draw it in the same
			// statement as the rows that provide one, so the sequence has to clear
			// the provided keys before the insert runs, not only after it.
			if (autoIncrementSequenceNeedsToBeReset) {
				const providedPrimaryKeys = prepared
					.map((p) => Number(p.primaryKey))
					.filter((key) => Number.isFinite(key));

				if (providedPrimaryKeys.length < prepared.length) {
					await getHelpers(trx).sequence.raiseAutoIncrementSequence(
						this.collection,
						primaryKeyField,
						Math.max(...providedPrimaryKeys),
					);
				}
			}

			const useBatchInsert =
				prepared.length > 1 && (await getHelpers(trx).capabilities.preservesInsertOrderInReturning());

			// The row the translator reads the duplicate's value off; a batch insert
			// cannot tell which of its rows the database refused.
			let insertingRowInput: Partial<Item> = {};

			try {
				if (useBatchInsert) {
					const chunkSize = env['DB_BATCH_INSERT_CHUNK_SIZE'] as number | undefined;

					const rowsToInsert = getHelpers(trx).capabilities.padRowsForBatchInsert(
						prepared.map((p) => p.payloadWithoutAliases),
						{
							fields: this.schema.collections[this.collection]!.fields,
							primaryKeyField,
						},
					);

					const insertedRows = (await trx
						.batchInsert(this.collection, rowsToInsert, chunkSize)
						.returning(primaryKeyField)) as unknown as Array<Record<string, unknown> | PrimaryKey>;

					if (insertedRows.length !== prepared.length) {
						throw new Error(`batchInsert returned ${insertedRows.length} rows but expected ${prepared.length}`);
					}

					for (let i = 0; i < prepared.length; i++) {
						const row = insertedRows[i]!;
						const p = prepared[i]!;

						const returnedKey =
							typeof row === 'object' && row !== null
								? (row as Record<string, unknown>)[primaryKeyField]
								: row;

						if (pkField?.type === 'uuid') {
							p.primaryKey = getHelpers(trx).schema.formatUUID((p.primaryKey ?? (returnedKey as string)) as string);
						}
						else {
							p.primaryKey = (p.primaryKey ?? returnedKey) as PrimaryKey;
						}

						p.actionHookPayload[primaryKeyField] = p.primaryKey;
					}
				}
				else {
					const returningOptions = getHelpers(trx).capabilities.insertReturningOptions();

					for (const p of prepared) {
						insertingRowInput = p.payloadWithoutAliases as Partial<Item>;

						const result = await trx
							.insert(p.payloadWithoutAliases)
							.into(this.collection)
							.returning(primaryKeyField, returningOptions)
							.then((rows) => rows[0]);

						const returnedKey =
							typeof result === 'object' && result !== null
								? (result as Record<string, unknown>)[primaryKeyField]
								: result;

						if (pkField?.type === 'uuid') {
							p.primaryKey = getHelpers(trx).schema.formatUUID((p.primaryKey ?? (returnedKey as string)) as string);
						}
						else {
							p.primaryKey = (p.primaryKey ?? returnedKey) as PrimaryKey;
						}

						// Most database support returning, those who don't tend to return the PK anyways
						// (MySQL/SQLite). In case the primary key isn't know yet, we'll do a best-attempt at
						// fetching it based on the last inserted row
						if (isMissingPrimaryKey(p.primaryKey)) {
							// Fetching it with max should be safe, as we're in the context of the current transaction
							const maxResult = await trx.max(primaryKeyField, { as: 'id' })
								.from(this.collection)
								.first();

							p.primaryKey = maxResult?.id;
						}

						// Set the primary key on the input item, in order for the "after" event hook to be able
						// to read from it
						p.actionHookPayload[primaryKeyField] = p.primaryKey;
					}
				}
			}
			catch (err: any) {
				const dbError = await translateDatabaseError(
					err,
					insertingRowInput,
					this.knex,
					{ collection: this.collection, operation: 'create' },
				);

				if (isDirectusError(dbError, ErrorCode.RecordNotUnique) && dbError.extensions.primaryKey) {
					// This is a MySQL specific thing we need to handle here, since MySQL does not return the field name
					// if the unique constraint is the primary key
					dbError.extensions.field = pkField?.field ?? null;
					delete dbError.extensions.primaryKey;
				}

				throw dbError;
			}

			type PostRow = PreparedRow & {
				primaryKey: PrimaryKey;
				revisionsO2M: Awaited<ReturnType<PayloadService['processO2M']>>['revisions'];
				nestedActionEventsO2M: ActionEventParams[];
			};

			const postPrepared: PostRow[] = [];

			for (const p of prepared) {
				// At this point, the primary key is guaranteed to be set.
				const primaryKey = p.primaryKey as PrimaryKey;

				const {
					revisions: revisionsO2M,
					nestedActionEvents: nestedActionEventsO2M,
					userIntegrityCheckFlags: userIntegrityCheckFlagsO2M,
				} = await p.payloadService.processO2M(p.payloadWithPresets, primaryKey, opts);

				userIntegrityCheckFlags |=
					p.userIntegrityCheckFlagsM2O | p.userIntegrityCheckFlagsA2O | userIntegrityCheckFlagsO2M;

				nestedActionEvents.push(...p.nestedActionEventsM2O, ...p.nestedActionEventsA2O, ...nestedActionEventsO2M);

				postPrepared.push({
					...p,
					primaryKey,
					revisionsO2M,
					nestedActionEventsO2M,
				});
			}

			if (userIntegrityCheckFlags) {
				if (opts.onRequireUserIntegrityCheck) {
					opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
				}
				else {
					await validateUserCountIntegrity({
						flags: userIntegrityCheckFlags,
						knex: trx,
					});
				}
			}

			// If this is an authenticated action, and accountability tracking is enabled, save activity row
			if (this.accountability && this.schema.collections[this.collection]!.accountability !== null) {
				const { ActivityService } = await import('./activity.js');
				const { RevisionsService } = await import('./revisions.js');

				const activityService = new ActivityService({ knex: trx, schema: this.schema });

				const activityIds = await activityService.createMany(
					postPrepared.map((p) => ({
						action: Action.CREATE,
						user: this.accountability!.user,
						collection: this.collection,
						ip: this.accountability!.ip,
						user_agent: this.accountability!.userAgent,
						origin: this.accountability!.origin,
						item: p.primaryKey,
					})),
				);

				// If revisions are tracked, create revisions record
				if (this.schema.collections[this.collection]!.accountability === 'all') {
					const revisionsService = new RevisionsService({ knex: trx, schema: this.schema });

					const revisionInputs = await Promise.all(
						postPrepared.map(async (p, index) => {
							const revisionPayload = await p.payloadService
								.prepareDelta(p.revisionPayload);

							return {
								activity: activityIds[index]!,
								collection: this.collection,
								item: p.primaryKey,
								data: revisionPayload,
								delta: revisionPayload,
							};
						}),
					);

					const revisionIds = await revisionsService.createMany(revisionInputs);

					for (let i = 0; i < postPrepared.length; i++) {
						const p = postPrepared[i]!;
						const revisionId = revisionIds[i]!;
						// Make sure to set the parent field of the child-revision rows
						const childrenRevisions = [...p.revisionsM2O, ...p.revisionsA2O, ...p.revisionsO2M];

						if (childrenRevisions.length > 0) {
							await revisionsService.updateMany(childrenRevisions, { parent: revisionId });
						}

						if (opts.onRevisionCreate) {
							opts.onRevisionCreate(revisionId);
						}
					}
				}
			}

			if (autoIncrementSequenceNeedsToBeReset) {
				await getHelpers(trx).sequence.resetAutoIncrementSequence(this.collection, primaryKeyField);
			}

			// Fill the index-aligned result with the keys of the rows that were actually inserted;
			// taken-over / cancelled slots were already set in the prepare loop.
			for (const p of postPrepared) {
				results[p.index] = p.primaryKey;
			}

			// Ascending, so a position pointing at another `sameRowAs` finds it resolved.
			for (const { index, sameRowAs } of sameRowPositions) {
				results[index] = results[sameRowAs]!;
			}

			return {
				nestedActionEvents,
				actionPayloads: postPrepared.map(
					(p): ActionPayload => ({ primaryKey: p.primaryKey, actionHookPayload: p.actionHookPayload }),
				),
				takenOverRowKeys,
			};
		}, opts.mutationTracker.snapshot()).catch(async (error) => {
			if (!shouldClearCache(this.cache, opts, this.collection)) {
				throw error;
			}

			// On the caller's transaction, the rows created before the failure commit
			// with it, and nothing tells which they are.
			if (this.knex.isTransaction) {
				this.scopedCachePurged = await this.scopedCache.purge(
					null,
					scopedCacheHookDeclarations,
					[],
					{ includeBareFingerprint: opts.purgeBareFingerprint !== false },
				);

				await this.purgeHookWrittenScopedCache(
					attemptTakenOverKeys,
					scopedCacheHookDeclarations,
					opts,
				);
			}
			// The inserts rolled back; a takeover was written by its hook, outside
			// the transaction.
			else {
				await this.purgeCreatedScopedCache(
					[...new Set(attemptTakenOverKeys)],
					attemptTakenOverKeys,
					scopedCacheHookDeclarations,
					declaredPurgesAtStart,
					opts,
				);
			}

			throw error;
		});

		if (opts.emitEvents !== false && actionPayloads.length > 0) {
			const actionContext = {
				database: getDatabase(),
				schema: this.schema,
				accountability: this.accountability,
			};

			// Route through emitActionEvents so the create path honours `awaitActionHooks` (#58) and
			// `bypassEmitAction` (nested mutations), instead of an un-awaited raw emit.
			await emitActionEvents(
				[
					{
						event: createEvent,
						meta: {
							payload: actionPayloads.map(({ actionHookPayload }) => {
								return actionHookPayload;
							}),
							keys: actionPayloads.map(({ primaryKey }) => primaryKey),
							collection: this.collection,
						},
						context: actionContext,
					},
					...nestedActionEvents,
				],
				opts,
			);
		}

		if (shouldClearCache(this.cache, opts, this.collection)) {
			// A `sameRowAs` position repeats its row's key; counted twice it would read
			// as a takeover.
			const liveKeys = [
				...new Set(results.filter((key): key is PrimaryKey => key !== null)),
			];

			await this.purgeCreatedScopedCache(
				liveKeys,
				takenOverRowKeys,
				scopedCacheHookDeclarations,
				declaredPurgesAtStart,
				opts,
			);
		}

		return results;
	}

	/**
	 * Get items by query.
	 */
	async readByQuery(query: Query, opts?: QueryOptions): Promise<WithMeta<Item[]>> {
		const updatedQuery =
			opts?.emitEvents !== false
				? await emitter.emitFilter(
					this.eventScope === 'items'
						? ['items.query', `${this.collection}.items.query`]
						: `${this.eventScope}.query`,
					query,
					{
						collection: this.collection,
					},
					{
						database: this.knex,
						schema: this.schema,
						accountability: this.accountability,
					},
				)
				: query;

		const ownershipInjections =
			this.scopedCache.ownershipInjections(updatedQuery);

		let ast = await getAstFromQuery(
			{
				collection: this.collection,
				query: withScopedCacheOwnershipInjections(
					updatedQuery,
					ownershipInjections,
				),
				accountability: this.accountability,
			},
			{
				schema: this.schema,
				knex: this.knex,
			},
		);

		ast = await processAst(
			{ ast, action: 'read', accountability: this.accountability },
			{ knex: this.knex, schema: this.schema },
		);

		const scopedCachePlan = this.scopedCache.planRead(
			ast,
			ownershipInjections,
		);

		// Before the query, so it predates any purge racing this read.
		const scopedCacheEpochs = opts?.skipScopedCacheEpochs === true
			? {}
			: await readScopedCacheEpochs(scopedCachePlan.collectionsToGuard());

		const records = await runAst(ast, this.schema, this.accountability, {
			knex: this.knex,
			// GraphQL requires relational keys to be returned regardless
			stripNonRequested: opts?.stripNonRequested !== undefined
				? opts.stripNonRequested
				: true,
			// `run-ast` injects every level's primary key for the nesting to work and
			// strips it again before the response. The scope pins each parent row BY
			// that key, so it reads them from the one place they still exist. Not
			// called for an empty result, which needs no pin: with no row nested,
			// the bare fingerprint is already what each collection deserves.
			onRowsWithTemporaryFields: (rows) => scopedCachePlan.pinFromRows(rows),
		});

		// Unreachable on a real driver: a select resolves a list, empty or not.
		if (records === null) {
			throw new ForbiddenError(); // 404 / InvalidPayload ?
		}

		// An `items.read` hook adds fingerprints via `context.scopedCache.scopeTo`, same
		// channel as `cache.scope`; drained below.
		const scopedCacheHookDeclarations =
			createScopedCacheHookDeclarations(this.schema);

		const filteredRecords =
			opts?.emitEvents !== false
				? await emitter.emitFilter(
					this.eventScope === 'items'
						? ['items.read', `${this.collection}.items.read`]
						: `${this.eventScope}.read`,
					records,
					{
						query: updatedQuery,
						collection: this.collection,
					},
					{
						database: this.knex,
						schema: this.schema,
						accountability: this.accountability,
						scopedCache: scopedCacheHookDeclarations.scope,
					},
				)
				: records;

		// emitFilter hands back whatever a listener returned; anything but a list
		// would be cast to one below and filed under every key that asked for it.
		if (!Array.isArray(filteredRecords)) {
			const answerType = filteredRecords === null
				? 'null'
				: typeof filteredRecords;

			throw new Error(
				`A read filter on "${this.collection}" answered with ${answerType}`
				+ ` instead of the list of items it was given.`,
			);
		}

		// Scope this read for cache purging (see
		// ItemScopedCacheService.readFingerprints); bounded to this read — it rides
		// the result via `getMeta()`, not a field.
		const {
			fingerprints: scopedCacheFingerprints,
			unautopurgeable: scopedCacheUnautopurgeableFingerprints,
		} = await this.scopedCache.readFingerprints({
				ast,
				plan: scopedCachePlan,
				updatedQuery,
				filteredRecords: filteredRecords as Item[],
				hookDeclarations: scopedCacheHookDeclarations,
			});

		if (opts?.emitEvents !== false) {
			// Read action hooks stay fire-and-forget; the await opt-in (`awaitActionHooks`) is for mutations.
			void emitter.emitAction(
				this.eventScope === 'items'
					? ['items.read', `${this.collection}.items.read`]
					: `${this.eventScope}.read`,
				{
					payload: filteredRecords,
					query: updatedQuery,
					collection: this.collection,
				},
				{
					database: this.knex || getDatabase(),
					schema: this.schema,
					accountability: this.accountability,
				},
			);
		}

		stripScopedCacheOwnershipInjections(
			filteredRecords as Item[],
			ownershipInjections,
		);

		return withMeta(filteredRecords as Item[], {
			scopedCacheFingerprints,
			scopedCacheUnautopurgeableFingerprints,
			// A `scopeTo` names a collection the before-query reading could not know
			// about, and hands over the counter its own dependent read took.
			scopedCacheEpochs: foldScopedCacheEpochsFromHookDeclarations(
				scopedCacheEpochs,
				scopedCacheHookDeclarations.epochs,
			),
		});
	}

	/**
	 * Get single item by primary key.
	 *
	 * Uses `this.readByQuery` under the hood.
	 */
	async readOne(
		key: PrimaryKey,
		query: Query = {},
		opts?: QueryOptions,
	): Promise<WithMeta<Item>> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		validateKeys(this.schema, this.collection, primaryKeyField, key);

		const filterWithKey = assign({}, query.filter, { [primaryKeyField]: { _eq: key } });
		const queryWithKey = assign({}, query, { filter: filterWithKey });

		const results = await this.readByQuery(queryWithKey, opts);

		if (results.length === 0) {
			// A row the query's own filter excludes still exists, and stays a 403.
			await this.refuseMissingKeyForAdmin(key);

			throw new ForbiddenError({
				reason: `No result found for key ${key} in ${this.collection} during items.readOne()`,
			});
		}

		// Carry the read's metadata onto the single returned item.
		return withMeta(
			results[0]!,
			readMeta(results) ?? { scopedCacheFingerprints: [] },
		);
	}

	/**
	 * Get multiple items by primary keys.
	 *
	 * Uses `this.readByQuery` under the hood.
	 */
	async readMany(
		keys: PrimaryKey[],
		query: Query = {},
		opts?: QueryOptions,
	): Promise<WithMeta<Item[]>> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);

		const filterWithKey = { _and: [{ [primaryKeyField]: { _in: keys } }, query.filter ?? {}] };
		const queryWithKey = assign({}, query, { filter: filterWithKey });

		// Set query limit as the number of keys
		if (Array.isArray(keys) && keys.length > 0 && !queryWithKey.limit) {
			queryWithKey.limit = keys.length;
		}

		const results = await this.readByQuery(queryWithKey, opts);

		return results;
	}

	/**
	 * Update multiple items by query.
	 *
	 * Uses `this.updateMany` under the hood.
	 */
	async updateByQuery(query: Query, data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey[]> {
		const keys = await this.getKeysByQuery(query);

		return keys.length
			? await this.updateMany(keys, data, opts)
			: [];
	}

	/**
	 * Update a single item by primary key.
	 *
	 * Uses `this.updateMany` under the hood.
	 */
	async updateOne(key: PrimaryKey, data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		validateKeys(this.schema, this.collection, primaryKeyField, key);

		await this.refuseMissingKeyForAdmin(key);
		await this.updateMany([key], data, opts);
		return key;
	}

	/**
	 * Update multiple items in a single transaction.
	 */
	async updateBatch(data: Partial<Item>[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		if (!Array.isArray(data)) {
			throw new InvalidPayloadError({ reason: 'Input should be an array of items' });
		}

		if (data.length === 0) {
			return [];
		}

		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		// Each row is its own group: the payloads differ per row, which is
		// exactly what one `keys`-plus-one-payload update cannot express.
		return await this.updateGroups(
			data.map((item): UpdateGroup<Item> => {
				const primaryKey = item[primaryKeyField];

				if (isMissingPrimaryKey(primaryKey)) {
					throw new InvalidPayloadError({
						reason: `Item in update misses primary key`,
					});
				}

				return {
					data: omit(item, primaryKeyField) as Partial<Item>,
					keys: [primaryKey as PrimaryKey],
				};
			}),
			opts,
		);
	}

	/**
	 * Update many items by primary key, setting all items to the same change.
	 */
	async updateMany(
		keys: PrimaryKey[],
		data: Partial<Item>,
		opts: MutationOptions & { allowFilterCancel: true },
	): Promise<(PrimaryKey | null)[]>;

	async updateMany(keys: PrimaryKey[], data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey[]>;

	async updateMany(
		keys: PrimaryKey[],
		data: Partial<Item>,
		opts: MutationOptions = {},
	): Promise<(PrimaryKey | null)[]> {
		return await this.updateGroups(
			[{ data, keys }],
			opts as MutationOptions & { allowFilterCancel: true },
		);
	}

	/**
	 * A uuid names one row whatever the case of its letters (RFC 9562), an integer
	 * or a bigInteger whatever zeros lead it.
	 */
	protected primaryKeyNameOf(key: PrimaryKey): string {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		const primaryKeyType = this.schema.collections[this.collection]!
			.fields[primaryKeyField]!.type;

		if (primaryKeyType === 'uuid') {
			return String(key).toLowerCase();
		}

		if (primaryKeyType === 'integer') {
			return String(Number(key));
		}

		// Past 2^53 a Number would round two rows onto one name.
		return primaryKeyType === 'bigInteger' && /^[+-]?\d+$/.test(String(key))
			? String(BigInt(key))
			: String(key);
	}

	/**
	 * The rows of this collection a hook declared inert through `skipPurgeFor`,
	 * named as primaryKeyNameOf names them, so any spelling of a key finds its row.
	 */
	private purgeSkippedKeyNames(
		declarations: NonNullable<MutationOptions['scopedCacheHookDeclarations']>,
	): Set<string> {
		const skippedKeys = declarations.purgeSkippedKeys.get(this.collection);

		return new Set([...skippedKeys ?? []].map((skippedKey) => {
			return this.primaryKeyNameOf(skippedKey);
		}));
	}

	/**
	 * The rows of this collection whose slices a hook declared through
	 * `purgeBy(…, { forKey })`, named as primaryKeyNameOf names them.
	 */
	private purgeDeclaredKeyNames(
		declarations: NonNullable<MutationOptions['scopedCacheHookDeclarations']>,
	): Set<string> {
		const declaredKeys = declarations.purgeDeclaredKeys.get(this.collection);

		return new Set([...declaredKeys ?? []].map((declaredKey) => {
			return this.primaryKeyNameOf(declaredKey);
		}));
	}

	/**
	 * Whether a group would write nothing: an empty payload, a primary-key-only one,
	 * or one whose every field is an alterations object carrying no item. Decided
	 * before any write, so a no-op update writes no row, activity or revision.
	 */
	private groupChangesNothing(group: UpdateGroup<Item>, aliases: string[]): boolean {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		const payloadAfterHooks = group.data as Partial<AnyItem>;

		const isEmptyAlterations = (value: unknown): boolean => {
			// A bare `[]` is not empty here: for o2m it removes every existing
			// child (see processO2M), so only the `{ create, update, delete }`
			// object form can count as no change.
			if (!isPlainObject(value)) {
				return false;
			}

			const alterations = value as Partial<Alterations>;

			// Guard against a JSON column that merely looks like an alterations object.
			if (Object.keys(alterations).some(
				(key) => !ALTERATIONS_KEYS.includes(key as keyof Alterations),
			)) {
				return false;
			}

			// None of create / update / delete carries an item.
			return ALTERATIONS_KEYS.every((operation) => !alterations[operation]?.length);
		};

		const changesNothing = (field: string): boolean => {
			if (field === primaryKeyField) {
				return true;
			}

			if (aliases.includes(field)) {
				return isEmptyAlterations(payloadAfterHooks![field]);
			}

			return false;
		};

		// Nothing to write: no transaction, no activity or revision rows, and no
		// integrity check.
		return Object.keys(payloadAfterHooks ?? {}).every(changesNothing);
	}

	/**
	 * Refuses a change that names an existing o2m child for several rows: each row
	 * would take the child from the one before, leaving it on the last. A child
	 * created inline is each row's own, and so is an m2m's junction row. Rows are
	 * counted over every group, so two rows of a batch can't share a child either.
	 */
	private refuseChildJoiningSeveralRows(writingGroups: UpdateGroup<Item>[]): void {
		for (const relation of this.schema.relations) {
			const childrenField = relation.meta?.one_field;

			if (
				relation.related_collection !== this.collection
				|| !childrenField
				|| relation.meta?.junction_field
			) {
				continue;
			}

			const childPrimaryKeyField = this.schema.collections[relation.collection]!
				.primary;

			const joiningRowCounts = new Map<string, number>();

			for (const group of writingGroups) {
				const groupData = group.data as Partial<AnyItem>;

				if (!(childrenField in groupData)) {
					continue;
				}

				const childrenValue = groupData[childrenField];

				let namedChildren: unknown[] = [childrenValue].flat();

				// The `{ create, update, delete }` form moves only what `update` names.
				if (!Array.isArray(childrenValue)) {
					namedChildren = [childrenValue?.update].filter(Array.isArray).flat();
				}

				const joiningChildKeys = new Set(namedChildren
					.map((namedChild) => {
						if (isPlainObject(namedChild)) {
							return (namedChild as AnyItem)[childPrimaryKeyField];
						}

						return namedChild;
					})
					.filter((childKey) => !isMissingPrimaryKey(childKey))
					.map(String));

				for (const joiningChildKey of joiningChildKeys) {
					const joiningRowCount = (joiningRowCounts.get(joiningChildKey) ?? 0)
						+ group.keys.length;

					if (joiningRowCount > 1) {
						throw new InvalidPayloadError({
							reason: oneLine`
								"${joiningChildKey}" can't join more than one
								"${this.collection}"
							`,
						});
					}

					joiningRowCounts.set(joiningChildKey, joiningRowCount);
				}
			}
		}
	}

	/**
	 * The user integrity checks writing these groups calls for. Handed the groups
	 * the hooks left, so a field a hook adds counts like the caller's own.
	 */
	protected requiredIntegrityChecks(
		_groups: UpdateGroup<Item>[],
	): UserIntegrityCheckFlag {
		return UserIntegrityCheckFlag.None;
	}

	/**
	 * Refuses rows a create would insert. Handed them after the hooks and the
	 * permission presets, inside the create's transaction.
	 */
	protected async validateRowsToCreate(
		_rows: Partial<Item>[],
		_trx: Knex,
	): Promise<void> {}

	/**
	 * Refuses groups an update would write. Handed the groups the hooks left,
	 * inside the update's transaction.
	 */
	protected async validateGroupsToUpdate(
		_groups: UpdateGroup<Item>[],
		_trx: Knex,
	): Promise<void> {}

	/**
	 * What writing these groups sets off once they are written — a cache clear,
	 * a logout. Handed the groups the hooks left.
	 */
	protected async applyUpdateSideEffects(
		_groups: UpdateGroup<Item>[],
		_opts: MutationOptions,
	): Promise<void> {}

	async updateGroups(
		groups: UpdateGroup<Item>[],
		opts: DeferredPurgeOptions & { allowFilterCancel: true },
	): Promise<(PrimaryKey | null)[]>;

	async updateGroups(
		groups: UpdateGroup<Item>[],
		opts?: DeferredPurgeOptions,
	): Promise<PrimaryKey[]>;

	/**
	 * Update rows in groups, each group one change applied to the keys it names.
	 *
	 * Every update entrypoint funnels through here so the `items.update` events fire
	 * once for the whole update, carrying every group, rather than once per row.
	 */
	async updateGroups(
		groups: UpdateGroup<Item>[],
		opts: DeferredPurgeOptions = {},
	): Promise<(PrimaryKey | null)[]> {
		// Captured, so the transaction callback below still sees it set.
		const mutationTracker = opts.mutationTracker ?? this.createMutationTracker();

		opts.mutationTracker = mutationTracker;

		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		const inputKeys = groups.flatMap((group) => group.keys);

		const keyNameOf = (key: PrimaryKey) => this.primaryKeyNameOf(key);

		// Checked before any hook runs, so a malformed or oversized update never
		// reaches one.
		if (!opts.bypassLimits) {
			mutationTracker.trackMutations(inputKeys.length);
		}

		validateKeys(this.schema, this.collection, primaryKeyField, inputKeys);

		// Refused here, so a missing change is not blamed on a hook's answer.
		if (groups.some((group) => !isPlainObject(group.data))) {
			throw new InvalidPayloadError({
				reason: `Each update group needs a "data" object`,
			});
		}

		// Answered like an empty batch or a query matching nothing: no row, no hook.
		if (inputKeys.length === 0) {
			return [];
		}

		const updateEvent = this.eventScope === 'items'
			? ['items.update', `${this.collection}.items.update`]
			: `${this.eventScope}.update`;

		// An `items.update` hook can add purge fingerprints via
		// `context.scopedCache.purgeBy`;
		// drained into the purge below.
		let scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations
			?? createScopedCacheHookDeclarations(this.schema);

		const refusesRepeatedPks = opts.onRepeatedPk !== 'lastWins';
		const sentKeyNames = new Set<string>();

		const sentGroups: UpdateGroup<Item>[] = groups.map((group) => {
			if (!refusesRepeatedPks) {
				return group;
			}

			const groupKeyNames = new Set<string>();
			const uniqueKeys: PrimaryKey[] = [];

			for (const key of group.keys) {
				const keyName = keyNameOf(key);

				if (sentKeyNames.has(keyName)) {
					throw new InvalidPayloadError({
						reason: opts.onRepeatedPk === undefined
							? `Row ${keyName} is sent more than once; send each row once`
							: oneLine`
								Row ${keyName} is sent more than once; send each row once, or
								pass ${opts.lastWinsSpelling ?? 'onRepeatedPk=lastWins'}
							`,
					});
				}

				// One change naming a row twice writes it once.
				if (!groupKeyNames.has(keyName)) {
					groupKeyNames.add(keyName);
					uniqueKeys.push(key);
				}
			}

			groupKeyNames.forEach((keyName) => sentKeyNames.add(keyName));

			return { data: group.data, keys: uniqueKeys };
		});

		const groupListRefusal = () => {
			return new InvalidPayloadError({
				reason: oneLine`
					A "${this.eventScope}.update" filter hook must return the
					{ data, keys }[] it received, a row it wrote itself as { key }, no
					key both; a hook that handles one row maps them with mapUpdateRows
				`,
			});
		};

		const aliasFields = Object.values(
			this.schema.collections[this.collection]!.fields,
		)
			.filter((field) => field.alias === true)
			.map((field) => field.field);

		// A row sent changing nothing is left unread: most never get written.
		const changedInputKeys = groups.flatMap((group) => {
			return this.groupChangesNothing(group, aliasFields)
				? []
				: group.keys;
		});

		const readKeyNames = new Set(changedInputKeys.map((key) => keyNameOf(key)));
		const inputKeyNames = new Set(inputKeys.map((key) => keyNameOf(key)));

		// The slice a taken-over row left is known only for a row read before the
		// hooks, or one its hook declared via `purgeBy(…, { forKey })`.
		const takeoverUndeclaredAmong = (changedKeys: PrimaryKey[]) => {
			const declaredKeyNames = this.purgeDeclaredKeyNames(
				scopedCacheHookDeclarations,
			);

			return changedKeys.some((key) => {
				return !readKeyNames.has(keyNameOf(key))
					&& !declaredKeyNames.has(keyNameOf(key));
			});
		};

		// Set by the latest attempt, for the purge its failure still owes.
		let refusedAnswer: {
			groupsAfterHooks: unknown;
			inputScopedCacheSnapshot: ScopedCacheSnapshot;
		} | null = null;

		let failedWrite: {
			writtenKeys: PrimaryKey[];
			changedTakenOverKeys: PrimaryKey[];
			oldScopedCacheSnapshot: ScopedCacheSnapshot;
			takeoverUndeclared: boolean;
		} | null = null;

		// One transaction around the hooks and every group, so a hook writing through
		// `context.transaction` commits with the update or rolls back with it, the
		// snapshots read the state the write starts from, and the integrity check
		// sees the finished state once rather than once per group. Everything built
		// here is per attempt: sqlite and cockroach re-run the handler, hooks
		// included, after a retryable error.
		const {
			rowKeys,
			writingGroups,
			writtenKeys,
			oldScopedCacheSnapshot,
			takeoverUndeclared,
			applied,
			nestedActionEvents,
		} = await transaction(
			this.knex,
			async (trx) => {
				refusedAnswer = null;
				failedWrite = null;

				// What a retried attempt's hooks declare replaces what the failed one's
				// did. Declarations a caller handed in also hold what its other
				// mutations declared, so they are kept.
				// TODO(#610): replacing them drops the failed attempt's `purgeBy` too,
				// though a hook writing through its own connection committed that write.
				if (opts.scopedCacheHookDeclarations === undefined) {
					scopedCacheHookDeclarations = createScopedCacheHookDeclarations(
						this.schema,
					);
				}

				const service = this.fork({ knex: trx });
				const applied: UpdateGroup<Item>[] = [];
				const nestedActionEvents: ActionEventParams[] = [];

				const attemptSentGroups: UpdateEntries<Item> = sentGroups.map((group) => {
					return { data: cloneDeep(group.data), keys: [...group.keys] };
				});

				const guardedPayload = refuseFieldAccess(
					attemptSentGroups,
					Object.keys(this.schema.collections[this.collection]!.fields),
					groupListRefusal,
				);

				// Read before any hook, so a row a hook takes over still shows the slice
				// it leaves: old ∪ new purges it narrow, whatever the hook declared.
				const inputScopedCacheSnapshot = await service.scopedCache.snapshot(
					changedInputKeys,
				);

				// Run all hooks that are attached to this event so the end user has the
				// chance to augment the items that are about to be saved
				const answeredGroups =
					opts.emitEvents !== false
						? await emitter.emitFilter<UpdateEntries<Item>, null>(
							updateEvent,
							guardedPayload,
							{
								collection: this.collection,
							},
							{
								transaction: trx,
								database: trx,
								schema: this.schema,
								accountability: this.accountability,
								scopedCache: scopedCacheHookDeclarations
									.purgeHandleFor(this.collection),
							},
						)
						: attemptSentGroups;

				const groupsAfterHooks = answeredGroups === guardedPayload
					? attemptSentGroups
					: answeredGroups;

				// A row a hook took over may have been written through a connection of
				// its own, which the rollback leaves standing, so refusing its answer
				// still purges it, once the transaction settles.
				const refuseHookAnswer = (refusal: unknown) => {
					refusedAnswer = { groupsAfterHooks, inputScopedCacheSnapshot };

					return refusal;
				};

				if (groupsAfterHooks === null) {
					if (!opts.allowFilterCancel) {
						// A filter hook cleared the payload to null. Treating that as an
						// explicit, opt-in cancellation (returning a null per key) is owned
						// by the `allowFilterCancel` mutation option; on its own a null
						// payload is invalid rather than a silent no-op.
						throw refuseHookAnswer(new InvalidPayloadError({
							reason: oneLine`
								A filter hook cancelled the update, but this operation
								requires it
							`,
						}));
					}

					// The filter cancelled the update: nothing is written; a null per key
					// keeps the result index-aligned with the input keys.
					return {
						rowKeys: inputKeys.map(() => null),
						writingGroups: [],
						writtenKeys: [],
						oldScopedCacheSnapshot: inputScopedCacheSnapshot,
						takeoverUndeclared: false,
						applied,
						nestedActionEvents,
					};
				}

				// A hook written before the event carried groups returns one payload,
				// which would otherwise reach the write as a list of nothing.
				const isEntryList = Array.isArray(groupsAfterHooks)
					&& carriesOnlyIndices(groupsAfterHooks)
					&& groupsAfterHooks.every((entry) => {
						return isUpdateGroup(entry) || isTakenOverRow(entry);
					});

				if (!isEntryList) {
					throw refuseHookAnswer(groupListRefusal());
				}

				const dataGroups = groupsAfterHooks.filter(isUpdateGroup<Item>);

				const takenOverKeys = groupsAfterHooks
					.filter(isTakenOverRow<Item>)
					.map((entry) => entry.key);

				const answeredKeys = [
					...dataGroups.flatMap((group) => group.keys),
					...takenOverKeys,
				];

				const hookAddedKeys = answeredKeys.filter((key) => {
					return !inputKeyNames.has(keyNameOf(key));
				});

				// Keys a hook added are counted and validated like the caller's own,
				// before any of them is compared with another.
				try {
					if (!opts.bypassLimits && hookAddedKeys.length > 0) {
						mutationTracker.trackMutations(hookAddedKeys.length);
					}

					validateKeys(
						this.schema,
						this.collection,
						primaryKeyField,
						answeredKeys,
					);
				}
				catch (error) {
					throw refuseHookAnswer(error);
				}

				const groupedKeyNames = new Set(dataGroups.flatMap((group) => {
					return group.keys.map((key) => keyNameOf(key));
				}));

				// Written by the hook and by Directus both, the row would hold
				// whichever write lands last.
				const doublyAnsweredKey = takenOverKeys.find((key) => {
					return groupedKeyNames.has(keyNameOf(key));
				});

				if (doublyAnsweredKey !== undefined) {
					throw refuseHookAnswer(new InvalidPayloadError({
						reason: oneLine`
							A "${this.eventScope}.update" filter hook took row
							${keyNameOf(doublyAnsweredKey)} over as { key } but also left it
							in a { data, keys } group; answer each row one way
						`,
					}));
				}

				const answeredKeyCounts = new Map<string, number>();

				for (const key of answeredKeys) {
					const keyName = keyNameOf(key);
					const answeredCount = (answeredKeyCounts.get(keyName) ?? 0) + 1;

					if (refusesRepeatedPks && answeredCount > 1) {
						throw refuseHookAnswer(new InvalidPayloadError({
							reason: oneLine`
								A "${this.eventScope}.update" filter hook answered with row
								${keyName} more than once
							`,
						}));
					}

					answeredKeyCounts.set(keyName, answeredCount);
				}

				// One entry per row, in the caller's order: its key, or null for a row
				// the hook dropped, which cancels it. This is what the update returns.
				// Under lastWins a key sent twice is matched by count, so a hook
				// dropping one of its copies cancels the later one.
				// TODO: if a caller needs the dropped copy itself cancelled, match each
				// answered row to its input row by position instead of counting keys.
				const rowKeys: (PrimaryKey | null)[] = inputKeys.map((key) => {
					const keyName = keyNameOf(key);
					const answeredCount = answeredKeyCounts.get(keyName) ?? 0;

					if (!refusesRepeatedPks) {
						answeredKeyCounts.set(keyName, answeredCount - 1);
					}

					return answeredCount > 0
						? key
						: null;
				});

				if (!opts.allowFilterCancel && rowKeys.includes(null)) {
					throw refuseHookAnswer(new InvalidPayloadError({
						reason: oneLine`
							A filter hook cancelled a row of the update, but this operation
							requires it
						`,
					}));
				}

				const relationalFields = new Set(this.schema.relations
					.filter((relation) => relation.collection === this.collection)
					.map((relation) => relation.field));

				const mergedGroups = mergeUpdateGroups(
					dataGroups,
					(groupData) => {
						return Object.entries(groupData).some(([field, value]) => {
							const nestsAnItem = typeof value === 'object' && value !== null;

							return aliasFields.includes(field)
								|| (relationalFields.has(field) && nestsAnItem);
						});
					},
					keyNameOf,
				);

				const writingGroups = mergedGroups.filter((group) => {
					return group.keys.length > 0
						&& !this.groupChangesNothing(group, aliasFields);
				});

				// TODO(#610): these are this attempt's takeovers only. A row a hook
				// takes over on an attempt that fails, and not on the retry, is never
				// purged, though a hook writing through its own connection left that
				// write committed.
				for (const key of takenOverKeys) {
					scopedCacheHookDeclarations.takenOverKeys.add(
						takenOverScopedCacheKey(this.collection, key),
					);
				}

				const skippedKeyNames = this.purgeSkippedKeyNames(
					scopedCacheHookDeclarations,
				);

				// A takeover the hook declared inert wrote nothing, so it moved no slice.
				const changedTakenOverKeys = takenOverKeys.filter((key) => {
					return !skippedKeyNames.has(keyNameOf(key));
				});

				// A row not read above was written by its hook before the read below,
				// which sees only the slice it moved the row to: purged whole unless
				// the hook declared the one it left.
				const takeoverUndeclared = takeoverUndeclaredAmong(changedTakenOverKeys);

				const directusWrittenKeys = writingGroups.flatMap((group) => group.keys);

				// The scope values these rows hold before the update, so an update that
				// moves a row to a new scope value purges both slices (old ∪ new). Read
				// here only for the rows not read before the hooks.
				// Empty when the collection isn't scoped.
				const writtenKeys = [...directusWrittenKeys, ...changedTakenOverKeys];
				const writtenKeyNames = new Set(writtenKeys.map((key) => keyNameOf(key)));

				// A read that fails leaves the rows' slices unknown: purged whole.
				const hookAddedScopedCacheSnapshot = await service.scopedCache
					.snapshot(
						writtenKeys.filter((key) => !readKeyNames.has(keyNameOf(key))),
					)
					.catch((): ScopedCacheSnapshot => {
						return { canResolveSlicesFromRows: false, rows: [] };
					});

				const oldScopedCacheSnapshot: ScopedCacheSnapshot = {
					canResolveSlicesFromRows:
						inputScopedCacheSnapshot.canResolveSlicesFromRows
						&& hookAddedScopedCacheSnapshot.canResolveSlicesFromRows,
					rows: [
						...inputScopedCacheSnapshot.rows.filter((snapshotRow) => {
							return writtenKeyNames.has(keyNameOf(snapshotRow.key));
						}),
						...hookAddedScopedCacheSnapshot.rows,
					],
				};

				const hookAddedWrittenKeys = directusWrittenKeys.filter((key) => {
					return !inputKeyNames.has(keyNameOf(key));
				});

				if (opts.onHookAddedRows && hookAddedWrittenKeys.length > 0) {
					opts.onHookAddedRows(hookAddedWrittenKeys, {
						canResolveSlicesFromRows:
							oldScopedCacheSnapshot.canResolveSlicesFromRows,
						rows: oldScopedCacheSnapshot.rows.filter((snapshotRow) => {
							return !inputKeyNames.has(keyNameOf(snapshotRow.key));
						}),
					});
				}

				const answeredUpdate = {
					rowKeys,
					writingGroups,
					writtenKeys,
					oldScopedCacheSnapshot,
					takeoverUndeclared,
					applied,
					nestedActionEvents,
				};

				// Set before the early return too: a commit failing after a hook took
				// every row over still owes those rows their purge.
				failedWrite = {
					writtenKeys,
					changedTakenOverKeys,
					oldScopedCacheSnapshot,
					takeoverUndeclared,
				};

				// Directus writes nothing — every group was a no-op, the per-row filter
				// cancelled every row, or a hook took every row over.
				if (writingGroups.length === 0) {
					return answeredUpdate;
				}

				let userIntegrityCheckFlags =
					(opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None)
					| this.requiredIntegrityChecks(writingGroups);

				this.refuseChildJoiningSeveralRows(writingGroups);
				await this.validateGroupsToUpdate(writingGroups, trx);

				// Every group before any is applied, so a row the caller may not update
				// is refused whatever error a guard stored for another row.
				if (this.accountability) {
					for (const group of writingGroups) {
						await validateAccess(
							{
								accountability: this.accountability,
								action: 'update',
								collection: this.collection,
								primaryKeys: [...group.keys].sort(),
								fields: Object.keys(group.data),
							},
							{
								schema: this.schema,
								knex: trx,
							},
						);
					}
				}

				for (const group of writingGroups) {
					const result = await service.applyUpdateGroup(
						group,
						aliasFields,
						{
							...opts,
							mutationTracker,
							onRequireUserIntegrityCheck: (flags) => {
								userIntegrityCheckFlags |= flags;
							},
						},
						nestedActionEvents,
					);

					applied.push(result as UpdateGroup<Item>);
				}

				if (userIntegrityCheckFlags) {
					if (opts.onRequireUserIntegrityCheck) {
						opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
					}
					else {
						await validateUserCountIntegrity({
							flags: userIntegrityCheckFlags,
							knex: trx,
						});
					}
				}

				return answeredUpdate;
			},
			mutationTracker.snapshot(),
		).catch(async (error) => {
			if (failedWrite !== null) {
				// On a transaction this call opened, the failure rolled every group back,
				// leaving only what a hook wrote through a connection of its own. On the
				// caller's, the groups written before the failure commit with it.
				const {
					writtenKeys,
					changedTakenOverKeys,
					oldScopedCacheSnapshot,
					takeoverUndeclared,
				} = failedWrite;

				if (this.knex.isTransaction) {
					await this.purgeUpdatedScopedCache(
						writtenKeys,
						oldScopedCacheSnapshot,
						scopedCacheHookDeclarations,
						opts,
						takeoverUndeclared,
					);

					await this.purgeHookWrittenScopedCache(
						changedTakenOverKeys,
						scopedCacheHookDeclarations,
						opts,
					);
				}
				else if (changedTakenOverKeys.length > 0) {
					await this.purgeUpdatedScopedCache(
						changedTakenOverKeys,
						oldScopedCacheSnapshot,
						scopedCacheHookDeclarations,
						opts,
						takeoverUndeclared,
					);
				}
				else {
					await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
				}
			}
			else if (refusedAnswer !== null) {
				const { groupsAfterHooks, inputScopedCacheSnapshot } = refusedAnswer;

				const skippedKeyNames = this.purgeSkippedKeyNames(
					scopedCacheHookDeclarations,
				);

				const changedKeys = Array.isArray(groupsAfterHooks)
					? groupsAfterHooks
						.filter(isTakenOverRow<Item>)
						.map((entry) => entry.key)
						.filter((key) => !skippedKeyNames.has(keyNameOf(key)))
					: [];

				if (changedKeys.length > 0) {
					const changedKeyNames = new Set(changedKeys.map((key) => keyNameOf(key)));

					await this.purgeUpdatedScopedCache(
						changedKeys,
						{
							canResolveSlicesFromRows:
								inputScopedCacheSnapshot.canResolveSlicesFromRows,
							rows: inputScopedCacheSnapshot.rows.filter((snapshotRow) => {
								return changedKeyNames.has(keyNameOf(snapshotRow.key));
							}),
						},
						scopedCacheHookDeclarations,
						opts,
						takeoverUndeclaredAmong(changedKeys),
					);
				}
				else {
					await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
				}

				await this.purgeHookWrittenScopedCache(
					changedKeys,
					scopedCacheHookDeclarations,
					opts,
				);
			}
			// A hook threw before the update had an answer: what it wrote through a
			// connection of its own is known only by what it declared.
			else {
				await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);

				await this.purgeHookWrittenScopedCache(
					[],
					scopedCacheHookDeclarations,
					opts,
				);
			}

			throw error;
		});

		if (writtenKeys.length === 0) {
			await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
		}
		else {
			await this.purgeUpdatedScopedCache(
				writtenKeys,
				oldScopedCacheSnapshot,
				scopedCacheHookDeclarations,
				opts,
				takeoverUndeclared,
			);
		}

		if (writingGroups.length === 0) {
			return rowKeys;
		}

		if (opts.emitEvents !== false) {
			const actionContext = {
				database: getDatabase(),
				schema: this.schema,
				accountability: this.accountability,
			};

			await emitActionEvents(
				[
					{
						event: updateEvent,
						meta: {
							payload: applied,
							collection: this.collection,
						},
						context: actionContext,
					},
					...nestedActionEvents,
				],
				opts,
			);
		}

		await this.applyUpdateSideEffects(writingGroups, opts);

		// Every row the caller sent, in its order — a row whose change turned out to be
		// a no-op included. The REST layer reads these keys back to build the response
		// body, so dropping a no-op row would omit an item the caller named from its
		// own PATCH response.
		return rowKeys;
	}

	/**
	 * Purge the slices the written rows sat in before the update and the ones they
	 * sit in now (old ∪ new), re-read from the stored rows rather than the post-hook
	 * payload: a DB trigger or type coercion can rewrite the scope column on write
	 * (same rule as createMany). "Now" is committed only when this call owns the
	 * transaction; from a hook it shares the caller's and this purge runs pre-commit
	 * — https://github.com/jclaveau/directus/issues/363
	 *
	 * A re-read that fails, as any read does on a Postgres transaction an error
	 * aborted, leaves the new slices unknown, so the collection is purged whole.
	 */
	private async purgeUpdatedScopedCache(
		writtenKeys: PrimaryKey[],
		oldScopedCacheSnapshot: ScopedCacheSnapshot,
		declarations: NonNullable<MutationOptions['scopedCacheHookDeclarations']>,
		opts: MutationOptions,
		takeoverUndeclared: boolean,
	): Promise<void> {
		if (!shouldClearCache(this.cache, opts, this.collection)) {
			return;
		}

		if (takeoverUndeclared) {
			this.scopedCachePurged = await this.scopedCache.purge(
				null,
				declarations,
				[],
				{ includeBareFingerprint: opts.purgeBareFingerprint !== false },
			);

			return;
		}

		const newScopedCacheSnapshot = await this.scopedCache
			.snapshot(writtenKeys)
			.catch(() => null);

		this.scopedCachePurged = await this.scopedCache.purge(
			scopedCacheMutatedFingerprints(
				oldScopedCacheSnapshot,
				newScopedCacheSnapshot,
			),
			declarations,
			[],
			{
				includeBareFingerprint: opts.purgeBareFingerprint !== false,
				rows: newScopedCacheSnapshot === null
					? undefined
					: scopedCacheUpdatedRows(
						oldScopedCacheSnapshot,
						newScopedCacheSnapshot,
					),
			},
		);
	}

	/**
	 * Purge what a create wrote: the rows it inserted or a hook took over, and
	 * whatever its hooks declared.
	 */
	private async purgeCreatedScopedCache(
		writtenKeys: PrimaryKey[],
		takenOverRowKeys: PrimaryKey[],
		declarations: NonNullable<MutationOptions['scopedCacheHookDeclarations']>,
		declaredPurgesAtStart: number,
		opts: MutationOptions,
	): Promise<void> {
		// Scope off the committed rows' stored values (re-read by returned key), not
		// the raw input: a create hook can rewrite a scope field, a value left to a DB
		// default is only knowable after the insert, and a DB trigger/coercion can
		// diverge from the payload — the row is authoritative, the payload isn't.
		//
		// A row a hook *took over* (returned an existing PK) is the unsafe case: it
		// can be an update-in-disguise — the hook moved that row between slices — and
		// the create path has no old∪new snapshot, so the post-commit re-read sees
		// only the NEW slice; the OLD slice would leak (stale HIT). So a takeover
		// falls back to a coarse collection-wide purge BY DEFAULT. A hook that knows
		// its footprint opts back into a precise purge by declaring it for the key
		// via `scopedCache.purgeBy(…, { forKey })` (a read-only dedup declares its
		// one slice; an upsert-move declares old + new) — then we trust it and
		// narrow to the snapshot ∪ declared fingerprints. Every take-over needs its
		// own: a declaration for one row says nothing of another's old slice.
		//
		// That holds on a collection declaring no scope field too. A takeover cannot
		// move a row between primary-key slices — the key it returned IS the slice —
		// but the key it returned is not the only row it may have written, and every
		// OTHER row's key slice is now pinnable, so an undeclared takeover leaves
		// them stale.
		const takenOverKeyNames = new Set(takenOverRowKeys.map((key) => {
			return this.primaryKeyNameOf(key);
		}));

		const skippedKeyNames = this.purgeSkippedKeyNames(declarations);
		const declaredKeyNames = this.purgeDeclaredKeyNames(declarations);

		const changedKeys = writtenKeys.filter((key) => {
			const keyName = this.primaryKeyNameOf(key);

			// A take-over the hook declared inert wrote nothing, so it moved no
			// slice; a row this create inserted is written whatever was declared.
			return !takenOverKeyNames.has(keyName) || !skippedKeyNames.has(keyName);
		});

		if (changedKeys.length === 0) {
			// Nothing written and nothing declared: no entry can have gone stale.
			// Returning rather than purging nothing, which would still take this
			// collection's bare fingerprint and drop its global reads.
			if (declarations.purgeFingerprints.length === declaredPurgesAtStart) {
				return;
			}

			// Nothing written, so only what the hooks declared: this collection's
			// global reads stay.
			await this.purgeDeclaredScopedCache(declarations, opts);

			return;
		}

		// Counted off the take-overs themselves: one returning a key another row of
		// this call inserts adds no key to the set above.
		// No `scopedCacheFields.length > 0` guard: the primary key pins on every
		// collection, so an undeclared take-over leaves the other rows' key slices
		// stale even where no scope field is declared.
		// A read that fails leaves the slices unknown: purged whole.
		const scopedCacheSnapshot = takenOverRowKeys.some((key) => {
			const keyName = this.primaryKeyNameOf(key);

			return !skippedKeyNames.has(keyName) && !declaredKeyNames.has(keyName);
		})
			? null
			: await this.scopedCache.snapshot(changedKeys).catch(() => null);

		this.scopedCachePurged = await this.scopedCache.purge(
			scopedCacheMutatedFingerprints(scopedCacheSnapshot),
			declarations,
			[],
			{
				includeBareFingerprint: opts.purgeBareFingerprint !== false,
				rows: scopedCacheWrittenRows(scopedCacheSnapshot),
			},
		);
	}

	/**
	 * Purge only what a hook declared via `purgeBy`, for an update that wrote
	 * nothing of its own: a cancel, a no-op, or a failure. A cancel or a failure can
	 * follow a hook's out-of-band write, so the declaration stands, while
	 * `includeBareFingerprint: false` leaves this collection's own bare fingerprint
	 * warm. A plain no-op declares nothing and so purges nothing.
	 */
	private async purgeDeclaredScopedCache(
		declarations: NonNullable<MutationOptions['scopedCacheHookDeclarations']>,
		opts: MutationOptions,
	): Promise<void> {
		if (
			declarations.purgeFingerprints.length === 0 ||
			!shouldClearCache(this.cache, opts, this.collection)
		) {
			return;
		}

		this.scopedCachePurged = await this.scopedCache.purge(
			[],
			declarations,
			[],
			{ includeBareFingerprint: false },
		);
	}

	/**
	 * Purge, now and through the pool, what a failed mutation's hooks wrote through a
	 * connection of their own: the rows they took over, and what they declared. On
	 * the caller's transaction, the mutation's own purge waits for that transaction
	 * to commit, and its rollback drops the purge while those writes have landed.
	 *
	 * A takeover purges the collection whole: its old slice is unknown.
	 */
	private async purgeHookWrittenScopedCache(
		takenOverKeys: PrimaryKey[],
		declarations: NonNullable<MutationOptions['scopedCacheHookDeclarations']>,
		opts: MutationOptions,
	): Promise<void> {
		if (
			!this.knex.isTransaction ||
			!shouldClearCache(this.cache, opts, this.collection)
		) {
			return;
		}

		const skippedKeyNames = this.purgeSkippedKeyNames(declarations);

		const poolScopedCache = new ItemScopedCacheService(
			this.collection,
			this.schema,
			getDatabase(),
			this.cache,
			this.accountability,
		);

		if (takenOverKeys.some((key) => {
			return !skippedKeyNames.has(this.primaryKeyNameOf(key));
		})) {
			await poolScopedCache.purge(
				null,
				declarations,
				[],
				{ includeBareFingerprint: opts.purgeBareFingerprint !== false },
			);
		}
		else if (declarations.purgeFingerprints.length > 0) {
			await poolScopedCache.purge(
				[],
				declarations,
				[],
				{ includeBareFingerprint: false },
			);
		}
	}

	/**
	 * Apply one group's change to the rows it names, in its own transaction.
	 *
	 * The `items.update` events belong to the whole update and are emitted by
	 * `updateGroups` around the loop, never here. Returns what was written: the
	 * payload after presets, and the keys it reached. A group that changes nothing
	 * never gets here — `updateGroups` filters those out before the transaction —
	 * and `updateGroups` has checked the caller may update every group's rows.
	 */
	private async applyUpdateGroup(
		group: UpdateGroup<Item>,
		aliases: string[],
		opts: MutationOptions & { mutationTracker: MutationTracker },
		nestedActionEvents: ActionEventParams[],
	): Promise<UpdateGroup<Item>> {
		const { ActivityService } = await import('./activity.js');
		const { RevisionsService } = await import('./revisions.js');

		// Sorted for the work below only. `group.keys` stays in the caller's row order,
		// which is what `updateGroups` returns and what the per-row action events walk.
		const keys = [...group.keys].sort();
		const payloadAfterHooks = group.data as Partial<AnyItem>;

		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		const fields = Object.keys(this.schema.collections[this.collection]!.fields);

		const payloadWithPresets = this.accountability
			? await processPayload(
				{
					accountability: this.accountability,
					action: 'update',
					collection: this.collection,
					payload: payloadAfterHooks,
					nested: this.nested,
				},
				{
					knex: this.knex,
					schema: this.schema,
				},
			)
			: payloadAfterHooks;

		const preMutationError = opts.preMutationError ?? group.keys
			.map((key) => opts.preMutationErrorsByKey?.get(String(key)))
			.find((keyError) => keyError !== undefined);

		if (preMutationError) {
			throw preMutationError;
		}

		await transaction(this.knex, async (trx) => {
			const payloadService = new PayloadService(this.collection, {
				accountability: this.accountability,
				knex: trx,
				schema: this.schema,
				nested: this.nested,
			});

			const {
				payload: payloadWithM2O,
				revisions: revisionsM2O,
				nestedActionEvents: nestedActionEventsM2O,
				userIntegrityCheckFlags: userIntegrityCheckFlagsM2O,
			} = await payloadService.processM2O(payloadWithPresets, opts);

			const {
				payload: payloadWithA2O,
				revisions: revisionsA2O,
				nestedActionEvents: nestedActionEventsA2O,
				userIntegrityCheckFlags: userIntegrityCheckFlagsA2O,
			} = await payloadService.processA2O(payloadWithM2O, opts);

			const payloadWithoutAliasAndPK = pick(payloadWithA2O, without(fields, primaryKeyField, ...aliases));
			const payloadWithTypeCasting = await payloadService.processValues('update', payloadWithoutAliasAndPK);

			if (Object.keys(payloadWithTypeCasting).length > 0) {
				try {
					await trx(this.collection).update(payloadWithTypeCasting)
						.whereIn(primaryKeyField, keys);
				}
				catch (err: any) {
					throw await translateDatabaseError(err, payloadAfterHooks, this.knex, {
						collection: this.collection,
						operation: 'update',
					});
				}
			}

			const childrenRevisions = [...revisionsM2O, ...revisionsA2O];

			let userIntegrityCheckFlags =
				opts.userIntegrityCheckFlags ??
				UserIntegrityCheckFlag.None | userIntegrityCheckFlagsM2O | userIntegrityCheckFlagsA2O;

			nestedActionEvents.push(...nestedActionEventsM2O);
			nestedActionEvents.push(...nestedActionEventsA2O);

			for (const key of keys) {
				const {
					revisions,
					nestedActionEvents: nestedActionEventsO2M,
					userIntegrityCheckFlags: userIntegrityCheckFlagsO2M,
				} = await payloadService.processO2M(payloadWithA2O, key, opts);

				childrenRevisions.push(...revisions);
				nestedActionEvents.push(...nestedActionEventsO2M);
				userIntegrityCheckFlags |= userIntegrityCheckFlagsO2M;
			}

			if (userIntegrityCheckFlags) {
				if (opts?.onRequireUserIntegrityCheck) {
					opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
				}
				else {
					// Having no onRequireUserIntegrityCheck callback indicates that
					// this is the top level invocation of the nested updates, so perform the user integrity check
					await validateUserCountIntegrity({ flags: userIntegrityCheckFlags, knex: trx });
				}
			}

			// If this is an authenticated action, and accountability tracking is enabled, save activity row
			if (this.accountability && this.schema.collections[this.collection]!.accountability !== null) {
				const activityService = new ActivityService({
					knex: trx,
					schema: this.schema,
				});

				const activity = await activityService.createMany(
					keys.map((key) => ({
						action: Action.UPDATE,
						user: this.accountability!.user,
						collection: this.collection,
						ip: this.accountability!.ip,
						user_agent: this.accountability!.userAgent,
						origin: this.accountability!.origin,
						item: key,
					})),
					{ bypassLimits: true },
				);

				if (this.schema.collections[this.collection]!.accountability === 'all') {
					const itemsService = new ItemsService(this.collection, {
						knex: trx,
						schema: this.schema,
					});

					const snapshots = await itemsService.readMany(keys);

					// `readMany` applies no ordering, so pairing its rows
					// with `keys` by position files a revision under one item
					// holding another item's data, which `revert` would then
					// write straight back onto the wrong row.
					const snapshotJsonByKey = new Map<string, string>();

					for (const snapshot of snapshots) {
						snapshotJsonByKey.set(
							String(snapshot[primaryKeyField]),
							JSON.stringify(snapshot),
						);
					}

					const revisionsService = new RevisionsService({
						knex: trx,
						schema: this.schema,
					});

					const revisions = (
						await Promise.all(
							activity.map(async (activity, index) => ({
								activity: activity,
								collection: this.collection,
								item: keys[index],
								data: snapshotJsonByKey.get(String(keys[index])),
								delta: await payloadService.prepareDelta(payloadWithTypeCasting),
							})),
						)
					).filter((revision) => revision.delta);

					const revisionIDs = await revisionsService.createMany(revisions);

					for (let i = 0; i < revisionIDs.length; i++) {
						const revisionID = revisionIDs[i]!;

						if (opts.onRevisionCreate) {
							opts.onRevisionCreate(revisionID);
						}

						if (i === 0) {
							// In case of a nested relational creation/update in a updateMany, the nested m2o/a2o
							// creation is only done once. We treat the first updated item as the "main" update,
							// with all other revisions on the current level as regular "flat" updates, and
							// nested revisions as children of this first "root" item.
							if (childrenRevisions.length > 0) {
								await revisionsService.updateMany(childrenRevisions, { parent: revisionID });
							}
						}
					}
				}
			}
		}, opts.mutationTracker.snapshot());

		return { data: payloadWithPresets, keys: group.keys };
	}

	/**
	 * Upsert a single item.
	 *
	 * Uses `this.createOne` / `this.updateOne` under the hood.
	 */
	async upsertOne(payload: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		const primaryKey: PrimaryKey | undefined = payload[primaryKeyField];

		if (!isMissingPrimaryKey(primaryKey)) {
			validateKeys(this.schema, this.collection, primaryKeyField, primaryKey);
		}

		const exists =
			!isMissingPrimaryKey(primaryKey) &&
			!!(await this.knex
				.select(primaryKeyField)
				.from(this.collection)
				.where({ [primaryKeyField]: primaryKey })
				.first());

		if (exists) {
			const { [primaryKeyField]: _, ...data } = payload;
			return await this.updateOne(primaryKey as PrimaryKey, data as Partial<Item>, opts);
		}
		else {
			return await this.createOne(payload, opts);
		}
	}

	/**
	 * Upsert many items.
	 *
	 * Uses `this.upsertOne` under the hood.
	 */
	async upsertMany(payloads: Partial<Item>[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		if (!opts.mutationTracker) {
			opts.mutationTracker = this.createMutationTracker();
		}

		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		// Old scope values for the update subset — any payload carrying an existing key. A
		// pure-insert payload has no key (or points at no row yet), so it contributes nothing
		// here; its new slice is picked up from the committed rows below (old ∪ new).
		const inputKeys = payloads.flatMap((payload) => {
			const key = payload[primaryKeyField];

			return isPrimaryKey(key)
				? [key]
				: [];
		});

		const oldScopedCacheSnapshot = await this.scopedCache.snapshot(inputKeys);

		// Shared hook declarations: child upserts run with autoPurgeCache off, so a
		// create/update hook's `purgeBy` reaches the deferred purge only through them.
		// TODO(#610): one set for every attempt, so a `skipPurgeFor` a failed attempt
		// declared still skips the row on the retry, whose hook may have written it.
		const scopedCacheHookDeclarations =
			createScopedCacheHookDeclarations(this.schema);

		const inputKeyNames = new Set(inputKeys.map((key) => {
			return this.primaryKeyNameOf(key);
		}));

		const takenOverPrefix = takenOverScopedCacheKey(this.collection, '');

		// The rows of this collection a hook took over, written by the hook itself;
		// one it declared inert wrote nothing.
		const changedTakenOverKeys = (): PrimaryKey[] => {
			const skippedKeyNames = this.purgeSkippedKeyNames(
				scopedCacheHookDeclarations,
			);

			return [...scopedCacheHookDeclarations.takenOverKeys]
				.filter((takenOverName) => takenOverName.startsWith(takenOverPrefix))
				.map((takenOverName) => takenOverName.slice(takenOverPrefix.length))
				.filter((takenOverKey) => {
					return !skippedKeyNames.has(this.primaryKeyNameOf(takenOverKey));
				});
		};

		// An insert-shaped payload routes to createOne, where a filter hook can take
		// the row over and return an existing key — an update in disguise, whose OLD
		// slice was never snapshotted (the key wasn't in `inputKeys`), so an old ∪ new
		// purge leaks it → coarse, unless the hook declared the row via
		// `purgeBy(…, { forKey })`. An update hook can take over a row no payload
		// sent, which no returned key names, so every row taken over in this
		// collection counts.
		const takeoverUndeclaredAmong = (takenOverKeys: PrimaryKey[]): boolean => {
			const declaredKeyNames = this.purgeDeclaredKeyNames(
				scopedCacheHookDeclarations,
			);

			return takenOverKeys.some((takenOverKey) => {
				const keyName = this.primaryKeyNameOf(takenOverKey);

				return !inputKeyNames.has(keyName) && !declaredKeyNames.has(keyName);
			});
		};

		// Per attempt, like the keys: sqlite and cockroach re-run the handler after a
		// retryable error.
		const { primaryKeys, hookAddedKeys, hookAddedSnapshots } = await transaction(
			this.knex,
			async (knex) => {
				const service = this.fork({ knex });

				const primaryKeys: PrimaryKey[] = [];
				const hookAddedKeys: PrimaryKey[] = [];
				const hookAddedSnapshots: ScopedCacheSnapshot[] = [];

				const childOpts: DeferredPurgeOptions = {
					...(opts || {}),
					autoPurgeCache: false,
					scopedCacheHookDeclarations,
					onHookAddedRows: (addedKeys, addedSnapshot) => {
						for (const addedKey of addedKeys) {
							hookAddedKeys.push(addedKey);
						}

						hookAddedSnapshots.push(addedSnapshot);
					},
				};

				for (const payload of payloads) {
					primaryKeys.push(await service.upsertOne(payload, childOpts));
				}

				return { primaryKeys, hookAddedKeys, hookAddedSnapshots };
			},
			opts.mutationTracker.snapshot(),
		).catch(async (error) => {
			if (!shouldClearCache(this.cache, opts, this.collection)) {
				throw error;
			}

			const takenOverKeys = changedTakenOverKeys();

			// On the caller's transaction, the rows upserted before the failure commit
			// with it, and nothing tells which they are.
			if (this.knex.isTransaction) {
				this.scopedCachePurged = await this.scopedCache.purge(
					null,
					scopedCacheHookDeclarations,
					[],
					{ includeBareFingerprint: opts.purgeBareFingerprint !== false },
				);
			}
			// A takeover was written by its hook, outside the rolled-back transaction.
			else if (takenOverKeys.length > 0) {
				await this.purgeUpdatedScopedCache(
					takenOverKeys,
					oldScopedCacheSnapshot,
					scopedCacheHookDeclarations,
					opts,
					takeoverUndeclaredAmong(takenOverKeys),
				);
			}
			else {
				await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
			}

			throw error;
		});

		if (shouldClearCache(this.cache, opts, this.collection)) {
			const takenOverKeys = changedTakenOverKeys();

			// New scope values for every committed row (inserts + moved updates), re-read
			// by returned key so a hook's take-over shows as whatever is now stored,
			// plus the rows an update filter added or took over, which no returned key
			// names. A read that fails leaves the slices unknown: purged whole.
			const newScopedCacheSnapshot = await this.scopedCache
				.snapshot(
					primaryKeys
						.filter((key): key is PrimaryKey => key !== null && key !== undefined)
						.concat(hookAddedKeys, takenOverKeys),
				)
				.catch(() => null);

			const oldSnapshots = [oldScopedCacheSnapshot, ...hookAddedSnapshots];

			const oldScopedCacheRows: ScopedCacheSnapshot = {
				canResolveSlicesFromRows: oldSnapshots.every((oldSnapshot) => {
					return oldSnapshot.canResolveSlicesFromRows;
				}),
				rows: oldSnapshots.flatMap((oldSnapshot) => oldSnapshot.rows),
			};

			const takeoverUndeclared = takeoverUndeclaredAmong(takenOverKeys);

			const scopedCacheFingerprints = takeoverUndeclared
				? null
				: scopedCacheMutatedFingerprints(
					oldScopedCacheRows,
					newScopedCacheSnapshot,
				);

			this.scopedCachePurged = await this.scopedCache.purge(
				scopedCacheFingerprints,
				scopedCacheHookDeclarations,
				[],
				{
					includeBareFingerprint: opts.purgeBareFingerprint !== false,
					// An upsert's two sides never line up — an inserted row has no old
					// side — so the diff reads as every field, which is what an insert
					// means anyway.
					rows: scopedCacheFingerprints === null || newScopedCacheSnapshot === null
						? undefined
						: scopedCacheUpdatedRows(
							oldScopedCacheRows,
							newScopedCacheSnapshot,
						),
				},
			);
		}

		return primaryKeys;
	}

	/**
	 * Delete multiple items by query.
	 *
	 * Uses `this.deleteMany` under the hood.
	 */
	async deleteByQuery(query: Query, opts?: MutationOptions): Promise<PrimaryKey[]> {
		const keys = await this.getKeysByQuery(query);

		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);

		return keys.length
			? await this.deleteMany(keys, opts)
			: [];
	}

	/**
	 * Delete a single item by primary key.
	 *
	 * Uses `this.deleteMany` under the hood.
	 */
	async deleteOne(key: PrimaryKey, opts?: MutationOptions): Promise<PrimaryKey> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		validateKeys(this.schema, this.collection, primaryKeyField, key);

		await this.refuseMissingKeyForAdmin(key);
		await this.deleteMany([key], opts);
		return key;
	}

	/**
	 * An admin reaches every item, so a key no row holds is a 404 for them. For
	 * anyone else the permissions decide, and a missing item stays as forbidden
	 * as a hidden one.
	 */
	private async refuseMissingKeyForAdmin(key: PrimaryKey): Promise<void> {
		if (this.accountability?.admin !== true) {
			return;
		}

		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		const existingRow = await this.knex
			.select(primaryKeyField)
			.from(this.collection)
			.where(primaryKeyField, key)
			.first();

		if (!existingRow) {
			throw new ItemNotFoundError({
				collection: this.collection,
				primaryKey: key,
			});
		}
	}

	/**
	 * Delete multiple items by primary key.
	 */
	async deleteMany(
		keys: PrimaryKey[],
		opts: MutationOptions & { allowFilterCancel: true },
	): Promise<(PrimaryKey | null)[]>;

	async deleteMany(keys: PrimaryKey[], opts?: MutationOptions): Promise<PrimaryKey[]>;
	async deleteMany(keys: PrimaryKey[], opts: MutationOptions = {}): Promise<(PrimaryKey | null)[]> {
		if (!opts.mutationTracker) {
			opts.mutationTracker = this.createMutationTracker();
		}

		if (!opts.bypassLimits) {
			opts.mutationTracker.trackMutations(keys.length);
		}

		const { ActivityService } = await import('./activity.js');

		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);

		// An `items.delete` hook can add purge fingerprints via
		// `context.scopedCache.purgeBy`;
		// drained into the purge below.
		// One set for every attempt: a delete reads no `skipPurgeFor`, so what a
		// failed attempt's hook declared only adds to the purge, which still owes
		// the write that hook committed through its own connection.
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations
			?? createScopedCacheHookDeclarations(this.schema);

		const deleteEvent = this.eventScope === 'items'
			? ['items.delete', `${this.collection}.items.delete`]
			: `${this.eventScope}.delete`;

		// One transaction around the hooks and the delete, so a hook writing through
		// `context.transaction` commits with the delete or rolls back with it. Per
		// attempt: sqlite and cockroach re-run the handler, hooks included, after a
		// retryable error.
		const deletion = await transaction(this.knex, async (trx) => {
			const service = this.fork({ knex: trx });

			// NB: this is the sole `items.delete` filter emit and it runs BEFORE
			// `validateAccess` (below) — deliberately, so a hook can cancel the delete
			// and snapshot old scope values before the rows go. Upstream emitted it
			// after the access check; a hook that assumed the keys were already
			// authorized should read that here (see the PR's disclosure note).
			const keysAfterHooks =
				opts.emitEvents !== false
					? await emitter.emitFilter<PrimaryKey[], null>(
						deleteEvent,
						[...keys],
						{
							collection: this.collection,
						},
						{
							transaction: trx,
							database: trx,
							schema: this.schema,
							accountability: this.accountability,
							scopedCache: scopedCacheHookDeclarations
								.purgeHandleFor(this.collection),
						},
					)
					: keys;

			if (keysAfterHooks === null) {
				if (!opts.allowFilterCancel) {
					throw new InvalidPayloadError({
						reason: oneLine`
							A filter hook cancelled the deletion, but this operation
							requires it
						`,
					});
				}

				return null;
			}

			// Snapshot the scope values of the rows about to be deleted; after the
			// delete they're gone and can't be read, so a later purge couldn't tell
			// which slices to drop. Off `keys`, not the filter's return: the statement
			// below, the access check and the activity rows all target `keys`, so a
			// hook that returned a REWRITTEN array (rather than null to cancel) would
			// otherwise purge rows that survive and leave the deleted ones cached.
			//
			// With them, the rows the delete rewrites through a self-relation: the
			// database moves those between slices under the delete, so they take an
			// update's old ∪ new snapshot, the new half re-read once the rows are
			// committed.
			const selfRelationSurvivorKeys =
				await service.scopedCache.selfRelationSurvivorKeys(keys);

			const oldScopedCacheSnapshot = await service.scopedCache.snapshot([
				...keys,
				...selfRelationSurvivorKeys,
			]);

			if (this.accountability) {
				await validateAccess(
					{
						accountability: this.accountability,
						action: 'delete',
						collection: this.collection,
						primaryKeys: keys,
					},
					{
						knex: trx,
						schema: this.schema,
					},
				);
			}

			if (opts.preMutationError) {
				throw opts.preMutationError;
			}

			try {
				await trx(this.collection).whereIn(primaryKeyField, keys)
					.delete();
			}
			catch (err: any) {
				// Parity with createOne/updateMany: a direct delete's FK/constraint
				// violation must surface as a translated Directus error, not raw knex.
				throw await translateDatabaseError(err, {}, this.knex, {
					collection: this.collection,
					operation: 'delete',
				});
			}

			if (opts.userIntegrityCheckFlags) {
				if (opts.onRequireUserIntegrityCheck) {
					opts.onRequireUserIntegrityCheck(opts.userIntegrityCheckFlags);
				}
				else {
					await validateUserCountIntegrity({
						flags: opts.userIntegrityCheckFlags,
						knex: trx,
					});
				}
			}

			if (
				this.accountability
				&& this.schema.collections[this.collection]!.accountability !== null
			) {
				const activityService = new ActivityService({
					knex: trx,
					schema: this.schema,
				});

				await activityService.createMany(
					keys.map((key) => ({
						action: Action.DELETE,
						user: this.accountability!.user,
						collection: this.collection,
						ip: this.accountability!.ip,
						user_agent: this.accountability!.userAgent,
						origin: this.accountability!.origin,
						item: key,
					})),
					{ bypassLimits: true },
				);
			}

			return { selfRelationSurvivorKeys, oldScopedCacheSnapshot };
		}, opts.mutationTracker.snapshot()).catch(async (error) => {
			// The rollback leaves standing what a hook wrote through a connection of
			// its own, so the slices it declared are purged whatever failed.
			if (
				scopedCacheHookDeclarations.purgeFingerprints.length > 0
				&& shouldClearCache(this.cache, opts, this.collection)
			) {
				this.scopedCachePurged = await this.scopedCache.purge(
					[],
					scopedCacheHookDeclarations,
					[],
					{ includeBareFingerprint: false },
				);
			}

			await this.purgeHookWrittenScopedCache(
				[],
				scopedCacheHookDeclarations,
				opts,
			);

			throw error;
		});

		if (deletion === null) {
			// A hook that declared a purge via `purgeBy` before cancelling still gets
			// it (parity with create's cancel); a plain validation cancel is a no-op
			// (the guard keeps empty declarations from reaching the purge). The cancel
			// purges only the declared fingerprints — `includeBareFingerprint: false`
			// leaves this collection's own bare one warm, nothing changed; a declared
			// value pin still reaches the global reads of the collection it names.
			if (
				scopedCacheHookDeclarations.purgeFingerprints.length > 0 &&
				shouldClearCache(this.cache, opts, this.collection)
			) {
				this.scopedCachePurged = await this.scopedCache.purge(
					[],
					scopedCacheHookDeclarations,
					[],
					{ includeBareFingerprint: false },
				);
			}

			// The filter cancelled the deletion: nothing is deleted; a null per key
			// keeps the result index-aligned with the input keys.
			return keys.map(() => null);
		}

		const { selfRelationSurvivorKeys, oldScopedCacheSnapshot } = deletion;

		if (shouldClearCache(this.cache, opts, this.collection)) {
			const survivorScopedCacheSnapshot =
				await this.scopedCache.snapshot(selfRelationSurvivorKeys);

			this.scopedCachePurged = await this.scopedCache.purge(
				scopedCacheMutatedFingerprints(
					oldScopedCacheSnapshot,
					survivorScopedCacheSnapshot,
				),
				scopedCacheHookDeclarations,
				scopedCacheCollectionsChangedByOnDelete(
					this.schema,
					this.collection,
				),
				{
					includeBareFingerprint: opts.purgeBareFingerprint !== false,
					// The deleted rows as they last were, plus both sides of the rows
					// the delete rewrote through a self-relation. No `changed`: a row
					// leaving the result set takes every field with it.
					rows: scopedCacheWrittenRows(
						oldScopedCacheSnapshot,
						survivorScopedCacheSnapshot,
					),
				},
			);
		}

		if (opts.emitEvents !== false) {
			const actionEvent = {
				event: deleteEvent,
				meta: {
					payload: keys,
					keys: keys,
					collection: this.collection,
				},
				context: {
					database: getDatabase(),
					schema: this.schema,
					accountability: this.accountability,
				},
			};

			await emitActionEvents([actionEvent], opts);
		}

		return keys;
	}

	/**
	 * Read/treat collection as singleton.
	 */
	async readSingleton(query: Query, opts?: QueryOptions): Promise<WithMeta<Partial<Item>>> {
		query = clone(query);

		query.limit = 1;

		const records = await this.readByQuery(query, opts);
		const singletonMeta = readMeta(records) ?? { scopedCacheFingerprints: [] };
		const record = records[0];

		if (!record) {
			let fields = Object.entries(this.schema.collections[this.collection]!.fields);
			const defaults: Record<string, any> = {};

			if (query.fields && query.fields.includes('*') === false) {
				fields = fields.filter(([name]) => {
					return query.fields!.includes(name);
				});
			}

			for (const [name, field] of fields) {
				if (this.schema.collections[this.collection]!.primary === name) {
					defaults[name] = null;
					continue;
				}

				if (field.defaultValue !== null) {
					defaults[name] = field.defaultValue;
				}
			}

			return withMeta(defaults as Partial<Item>, singletonMeta);
		}

		return withMeta(record, singletonMeta);
	}

	/**
	 * Upsert/treat collection as singleton.
	 *
	 * Uses `this.createOne` / `this.updateOne` under the hood.
	 */
	async upsertSingleton(data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		const record = await this.knex.select(primaryKeyField).from(this.collection)
			.limit(1)
			.first();

		if (record) {
			return await this.updateOne(record[primaryKeyField], data, opts);
		}

		return await this.createOne(data, opts);
	}
}
