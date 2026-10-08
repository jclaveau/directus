import { Action, ALTERATIONS_KEYS } from '@directus/constants';
import { useEnv } from '@directus/env';
import { ErrorCode, ForbiddenError, InvalidPayloadError, isDirectusError } from '@directus/errors';
import { isSystemCollection } from '@directus/system-data';
import type {
	AbstractService,
	AbstractServiceOptions,
	Accountability,
	ActionEventParams,
	Alterations,
	CreateEntry,
	Item as AnyItem,
	MutationTracker,
	MutationOptions,
	PrimaryKey,
	Query,
	QueryOptions,
	SchemaOverview,
	ScopedCacheFingerprint,
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
import { isPrimaryKey } from '../utils/is-primary-key.js';
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
): entriesAfterHooks is (CreateEntry | null)[] {
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

/**
 * Merge the groups carrying the same change, wherever they sit, so one statement
 * writes them all. A group never joins one written before a later change to one of
 * its own rows, so two changes to the same row still land in the caller's order.
 *
 * A group writing a nested item creates it once per group and walks its O2M rows
 * per group, so it merges only with the rows split off the same caller group: two
 * caller groups merged would create one related item where the caller asked for
 * two, and one caller group left split would create one per row.
 */
function mergeUpdateGroups<Item extends AnyItem>(
	candidateGroups: UpdateGroup<Item>[],
	callerGroupIndexes: number[],
	writesNestedItems: (groupData: Partial<Item>) => boolean,
): UpdateGroup<Item>[] {
	const mergedGroups: UpdateGroup<Item>[] = [];
	const keyNamesByGroupIndex: Set<string>[] = [];
	const groupIndexByData = new Map<string, number>();
	const lastGroupIndexByKey = new Map<string, number>();

	for (const [candidateIndex, candidateGroup] of candidateGroups.entries()) {
		const serializedChange = JSON.stringify(
			candidateGroup.data,
			(_field, value) => {
				return typeof value === 'bigint'
					? value.toString()
					: value;
			},
		);

		const serializedData = writesNestedItems(candidateGroup.data)
			? `${callerGroupIndexes[candidateIndex]}:${serializedChange}`
			: serializedChange;

		let latestConflictIndex = -1;

		for (const key of candidateGroup.keys) {
			latestConflictIndex = Math.max(
				latestConflictIndex,
				lastGroupIndexByKey.get(String(key)) ?? -1,
			);
		}

		const sameDataIndex = groupIndexByData.get(serializedData);

		let targetIndex: number;

		if (
			sameDataIndex !== undefined &&
			sameDataIndex >= latestConflictIndex &&
			isEqual(mergedGroups[sameDataIndex]!.data, candidateGroup.data)
		) {
			targetIndex = sameDataIndex;
		}
		else {
			targetIndex = mergedGroups.length;

			mergedGroups.push({ data: candidateGroup.data, keys: [] });
			keyNamesByGroupIndex.push(new Set());

			groupIndexByData.set(serializedData, targetIndex);
		}

		// The access check counts the stored rows against the keys, so a row the
		// caller sent twice with one change is written, and checked, once.
		for (const key of candidateGroup.keys) {
			const keyNames = keyNamesByGroupIndex[targetIndex]!;

			if (!keyNames.has(String(key))) {
				keyNames.add(String(key));
				mergedGroups[targetIndex]!.keys.push(key);
			}
		}

		for (const key of candidateGroup.keys) {
			lastGroupIndexByKey.set(String(key), targetIndex);
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

		const rowEvent = this.eventScope === 'items'
			? ['items.create.one', `${this.collection}.items.create.one`]
			: `${this.eventScope}.create.one`;

		type ActionPayload = { primaryKey: PrimaryKey; actionHookPayload: AnyItem };

		// An `items.create` hook can declare its own purge via
		// `context.scopedCache.purgeBy`; drained into the purge below. Declared outside
		// the transaction to outlive it.
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations
			?? createScopedCacheHookDeclarations(this.schema);

		// Baseline so the take-over fallback (below) keys off THIS call's own hook
		// declarations, not ones a parent's injected declarations already held.
		const declaredPurgesAtStart =
			scopedCacheHookDeclarations.purgeFingerprints.length;

		const {
			nestedActionEvents,
			actionPayloads,
			takenOverRowKeys,
		} = await transaction(this.knex, async (trx) => {
			const nestedActionEvents: ActionEventParams[] = [];
			const takenOverRowKeys: PrimaryKey[] = [];
			let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
			let autoIncrementSequenceNeedsToBeReset = false;

			type PreparedRow = {
				index: number;
				actionHookPayload: AnyItem;
				payloadAfterHooks: AnyItem;
				payloadWithPresets: AnyItem;
				payloadWithoutAliases: Record<string, unknown>;
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
				database: trx,
				schema: this.schema,
				accountability: this.accountability,
				scopedCache: scopedCacheHookDeclarations.purge,
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
						belongs on "${this.eventScope}.create.one"
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
				// Then once per row, the seam a hook written for a single item keeps, with
				// its own takeover and cancel.
				else if (entry !== null) {
					const hasRowFilters = opts.emitEvents !== false
						&& emitter.hasFilterListeners(rowEvent);

					payloadAfterHooks = hasRowFilters
						? await emitter.emitFilter<AnyItem, PrimaryKey | null>(
							rowEvent,
							entry.data,
							{ collection: this.collection },
							filterContext,
						)
						: entry.data;
				}

				if (typeof payloadAfterHooks === 'string' || typeof payloadAfterHooks === 'number') {
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

				// The primary key can already exist in the payload.
				// In case of manual string / UUID primary keys it's always provided at this point.
				// In case of an (big) integer primary key, it might be provided as the user can specify the value manually.
				const primaryKey: PrimaryKey | undefined = payloadWithTypeCasting[primaryKeyField];

				if (primaryKey) {
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
						if (!p.primaryKey) {
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
					data,
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
							const revisionPayload = await p.payloadService.prepareDelta(p.payloadAfterHooks);

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
		}, opts.mutationTracker.snapshot());

		if (opts.emitEvents !== false && actionPayloads.length > 0) {
			const actionContext = {
				database: getDatabase(),
				schema: this.schema,
				accountability: this.accountability,
			};

			const rowActionEvents: ActionEventParams[] = emitter
				.hasActionListeners(rowEvent)
				? actionPayloads.map(({ primaryKey, actionHookPayload }) => {
					return {
						event: rowEvent,
						meta: {
							payload: actionHookPayload,
							key: primaryKey,
							collection: this.collection,
						},
						context: actionContext,
					};
				})
				: [];

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
					...rowActionEvents,
					...nestedActionEvents,
				],
				opts,
			);
		}

		if (shouldClearCache(this.cache, opts, this.collection)) {
			// Scope off the committed rows' stored values (re-read by returned key), not the
			// raw input: a create hook can rewrite a scope field, a value left to a DB default
			// is only knowable after the insert, and a DB trigger/coercion can diverge from the
			// payload — the row is authoritative, the payload isn't.
			//
			// A row a hook *took over* (returned an existing PK) is the unsafe case: it
			// can be an update-in-disguise — the hook moved that row between slices — and
			// the create path has no old∪new snapshot, so the post-commit re-read sees
			// only the NEW slice; the OLD slice would leak (stale HIT). So a takeover
			// falls back to a coarse collection-wide purge BY DEFAULT. A hook that knows
			// its footprint opts back into a precise purge by declaring it via
			// `scopedCache.purgeBy` (a read-only dedup declares its one slice; an
			// upsert-move declares old + new) — then we trust it and narrow to the
			// snapshot ∪ declared fingerprints.
			//
			// That holds on a collection declaring no scope field too. A takeover cannot
			// move a row between primary-key slices — the key it returned IS the slice —
			// but the key it returned is not the only row it may have written, and every
			// OTHER row's key slice is now pinnable, so an undeclared takeover leaves
			// them stale. Before the key axis the bare fingerprint covered them by
			// accident.
			// A `sameRowAs` position repeats its row's key; counted twice it would read
			// as a takeover.
			const liveKeys = [
				...new Set(results.filter((key): key is PrimaryKey => key !== null)),
			];

			const changedKeys = liveKeys.filter((key) => {
				// A take-over the hook declared inert wrote nothing, so it moved no
				// slice.
				return !scopedCacheHookDeclarations.purgeSkippedKeys.has(String(key));
			});

			if (
				changedKeys.length === 0 &&
				scopedCacheHookDeclarations.purgeFingerprints.length
					=== declaredPurgesAtStart
			) {
				// Nothing written and nothing declared: no entry can have gone stale.
				// Returning rather than purging nothing, which would still take this
				// collection's bare fingerprint and drop its global reads.
				return results;
			}

			// Counted off the take-overs themselves: one returning a key another row of
			// this call inserts adds no key to the set above.
			const someRowTakenOver = takenOverRowKeys.some((key) => {
				return !scopedCacheHookDeclarations.purgeSkippedKeys.has(String(key));
			});

			const takeoverUndeclared =
				someRowTakenOver &&
				scopedCacheHookDeclarations.purgeFingerprints.length
					=== declaredPurgesAtStart;

			// No `scopedCacheFields.length > 0` guard: the primary key pins on every
			// collection, so an undeclared take-over leaves the other rows' key slices
			// stale even where no scope field is declared.
			const scopedCacheSnapshot = takeoverUndeclared
				? null
				: await this.scopedCache.snapshot(changedKeys);

			this.scopedCachePurged = await this.scopedCache.purge(
				scopedCacheMutatedFingerprints(scopedCacheSnapshot),
				scopedCacheHookDeclarations,
				[],
				{
					includeBareFingerprint: opts.purgeBareFingerprint !== false,
					rows: scopedCacheWrittenRows(scopedCacheSnapshot),
				},
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

		// TODO when would this happen?
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

		// TODO an `items.read` hook returning a non-object (emitFilter propagates a
		// listener's return verbatim, and the cast above asserts rather than checks)
		// makes this throw `Object.defineProperty called on non-object`. That is a
		// 500 raised inside whatever transaction was reading — a write snapshotting
		// its rows for revisions takes the whole update down with it. The write path
		// validates its own filter returns (`payloadAfterHooks === null`); this one
		// does not. Covered as it stands by read-hook-null.test.ts.
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
			throw new ForbiddenError({
				// 404 / InvalidPayload?
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

				if (!primaryKey) {
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
	 * Whether a group would write nothing: an empty payload, a primary-key-only one,
	 * or one whose every field is an alterations object carrying no item. Decided
	 * before the transaction opens, so a no-op update costs no round trip.
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

		// Checked before any hook runs, so a malformed or oversized update never
		// reaches one.
		if (!opts.bypassLimits) {
			mutationTracker.trackMutations(inputKeys.length);
		}

		validateKeys(this.schema, this.collection, primaryKeyField, inputKeys);

		const updateEvent = this.eventScope === 'items'
			? ['items.update', `${this.collection}.items.update`]
			: `${this.eventScope}.update`;

		const rowEvent = this.eventScope === 'items'
			? ['items.update.one', `${this.collection}.items.update.one`]
			: `${this.eventScope}.update.one`;

		const eventContext = {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
		};

		// An `items.update` hook can add purge fingerprints via
		// `context.scopedCache.purgeBy`;
		// drained into the purge below.
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations
			?? createScopedCacheHookDeclarations(this.schema);

		// Run all hooks that are attached to this event so the end user has the chance to augment the
		// items that are about to be saved
		const payload = groups.map((group) => {
			return { data: cloneDeep(group.data), keys: [...group.keys] };
		});

		const groupListRefusal = () => {
			return new InvalidPayloadError({
				reason: oneLine`
					A "${this.eventScope}.update" filter hook must return the
					{ data, keys }[] it received; a hook that handles one row belongs on
					"${this.eventScope}.update.one"
				`,
			});
		};

		const guardedPayload = refuseFieldAccess(
			payload,
			Object.keys(this.schema.collections[this.collection]!.fields),
			groupListRefusal,
		);

		const answeredGroups =
			opts.emitEvents !== false
				? await emitter.emitFilter<UpdateGroup<Item>[], null>(
					updateEvent,
					guardedPayload,
					{
						collection: this.collection,
					},
					{
						...eventContext,
						scopedCache: scopedCacheHookDeclarations.purge,
					},
				)
				: payload;

		const groupsAfterHooks = answeredGroups === guardedPayload
			? payload
			: answeredGroups;

		if (groupsAfterHooks === null) {
			if (!opts.allowFilterCancel) {
				// A filter hook cleared the payload to null. Treating that as an explicit, opt-in
				// cancellation (returning a null per key) is owned by the `allowFilterCancel` mutation
				// option; on its own a null payload is invalid rather than a silent no-op.
				throw new InvalidPayloadError({
					reason: `A filter hook cancelled the update, but this operation requires it`,
				});
			}

			await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);

			// The filter cancelled the update: nothing is written; return a null per key
			// so the result stays index-aligned with the input keys.
			return inputKeys.map(() => null);
		}

		// A hook written before the event carried groups returns one payload, which
		// would otherwise reach the write as a list of nothing.
		const isGroupList = Array.isArray(groupsAfterHooks)
			&& carriesOnlyIndices(groupsAfterHooks)
			&& groupsAfterHooks.every((group) => {
				return isPlainObject(group?.data) && Array.isArray(group?.keys);
			});

		if (!isGroupList) {
			throw groupListRefusal();
		}

		const keys = groupsAfterHooks.flatMap((group) => group.keys);

		// A dropped key would cancel its row with no null in the result, and
		// without allowFilterCancel; cancelling a row is the per-row event's job.
		const unmatchedKeyCounts = new Map<string, number>();

		for (const key of keys) {
			const keyName = String(key);

			unmatchedKeyCounts.set(keyName, (unmatchedKeyCounts.get(keyName) ?? 0) + 1);
		}

		const dropsInputKey = inputKeys.some((key) => {
			const keyName = String(key);
			const unmatchedCount = unmatchedKeyCounts.get(keyName) ?? 0;

			unmatchedKeyCounts.set(keyName, unmatchedCount - 1);

			return unmatchedCount === 0;
		});

		if (dropsInputKey) {
			throw new InvalidPayloadError({
				reason: oneLine`
					A "${this.eventScope}.update" filter hook must keep every key it
					received; a hook that cancels one row belongs on
					"${this.eventScope}.update.one"
				`,
			});
		}

		// Keys a hook added are counted and validated like the caller's own.
		if (!opts.bypassLimits && keys.length > inputKeys.length) {
			mutationTracker.trackMutations(keys.length - inputKeys.length);
		}

		validateKeys(this.schema, this.collection, primaryKeyField, keys);

		// One entry per row, in the caller's order: its key, or null for a row a
		// per-row hook cancelled. This is what the update returns.
		let rowKeys: (PrimaryKey | null)[] = [];
		let candidateGroups: UpdateGroup<Item>[] = [];
		let callerGroupIndexes: number[] = [];

		// Then once per row, so a hook that only ever handled a single item keeps a seam
		// that fires exactly once per row — which the group event, by design, does not.
		// With nothing listening, the per-row copies would be built for nobody.
		if (opts.emitEvents !== false && emitter.hasFilterListeners(rowEvent)) {
			for (const [groupIndex, group] of groupsAfterHooks.entries()) {
				for (const key of group.keys) {
					const rowAfterHooks = await emitter.emitFilter<Partial<AnyItem>, null>(
						rowEvent,
						{
							...cloneDeep(group.data),
							[primaryKeyField]: key,
						} as Partial<AnyItem>,
						{
							collection: this.collection,
						},
						{
							...eventContext,
							scopedCache: scopedCacheHookDeclarations.purge,
						},
					);

					if (rowAfterHooks === null) {
						if (!opts.allowFilterCancel) {
							throw new InvalidPayloadError({
								reason: oneLine`
									A filter hook cancelled a row of the update, but this operation
									requires it
								`,
							});
						}

						rowKeys.push(null);
						continue;
					}

					if (!isPlainObject(rowAfterHooks)) {
						throw new InvalidPayloadError({
							reason: oneLine`
								A "${this.eventScope}.update.one" filter hook must return the row
								it received, or null to cancel it
							`,
						});
					}

					rowKeys.push(key);

					candidateGroups.push({
						data: omit(rowAfterHooks, primaryKeyField) as Partial<Item>,
						keys: [key],
					});

					callerGroupIndexes.push(groupIndex);
				}
			}
		}
		else {
			rowKeys = keys;
			candidateGroups = groupsAfterHooks;
			callerGroupIndexes = groupsAfterHooks.map((_group, groupIndex) => groupIndex);
		}

		const aliases = Object.values(this.schema.collections[this.collection]!.fields)
			.filter((field) => field.alias === true)
			.map((field) => field.field);

		const relationalFields = new Set(this.schema.relations
			.filter((relation) => relation.collection === this.collection)
			.map((relation) => relation.field));

		const mergedGroups = mergeUpdateGroups(
			candidateGroups,
			callerGroupIndexes,
			(groupData) => {
				return Object.entries(groupData).some(([field, value]) => {
					const nestsAnItem = typeof value === 'object' && value !== null;

					return aliases.includes(field)
						|| (relationalFields.has(field) && nestsAnItem);
				});
			},
		);

		const writingGroups = mergedGroups.filter((group) => {
			return !this.groupChangesNothing(group, aliases);
		});

		// Snapshot the scope values these rows hold before the update so an update that
		// moves a row to a new scope value purges both slices (old ∪ new).
		// Empty when the collection isn't scoped.
		const writtenKeys = writingGroups.flatMap((group) => group.keys);
		const oldScopedCacheSnapshot = await this.scopedCache.snapshot(writtenKeys);

		if (opts.onHookAddedRows && keys.length > inputKeys.length) {
			const inputKeyNames = new Set(inputKeys.map((key) => String(key)));

			const hookAddedKeys = writtenKeys.filter((key) => {
				return !inputKeyNames.has(String(key));
			});

			opts.onHookAddedRows(hookAddedKeys, {
				canResolveSlicesFromRows: oldScopedCacheSnapshot.canResolveSlicesFromRows,
				rows: oldScopedCacheSnapshot.rows.filter((snapshotRow) => {
					return !inputKeyNames.has(String(snapshotRow.key));
				}),
			});
		}

		if (writingGroups.length === 0) {
			// Nothing is written — every group was a no-op, or the per-row filter
			// cancelled every row.
			await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);

			return rowKeys;
		}

		// One transaction around every group, so a failure anywhere rolls the whole
		// update back and the integrity check below sees the finished state once
		// rather than once per group. The arrays are per attempt: sqlite and
		// cockroach re-run the handler after a retryable error.
		const { applied, nestedActionEvents } = await transaction(
			this.knex,
			async (trx) => {
				const service = this.fork({ knex: trx });
				const applied: UpdateGroup<Item>[] = [];
				const nestedActionEvents: ActionEventParams[] = [];

				let userIntegrityCheckFlags =
					opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;

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
						aliases,
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

				return { applied, nestedActionEvents };
			},
			mutationTracker.snapshot(),
		).catch(async (error) => {
			// On a transaction this call opened, the failure rolled every group back,
			// leaving only what a hook wrote out of band. On the caller's, the groups
			// written before the failure commit with it.
			if (this.knex.isTransaction) {
				await this.purgeUpdatedScopedCache(
					writtenKeys,
					oldScopedCacheSnapshot,
					scopedCacheHookDeclarations,
					opts,
				);
			}
			else {
				await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
			}

			throw error;
		});

		await this.purgeUpdatedScopedCache(
			writtenKeys,
			oldScopedCacheSnapshot,
			scopedCacheHookDeclarations,
			opts,
		);

		if (opts.emitEvents !== false) {
			const actionContext = {
				database: getDatabase(),
				schema: this.schema,
				accountability: this.accountability,
			};

			// One per written row, after the grouped event, so a per-row consumer sees
			// exactly the rows that were written. Rows a per-row filter cancelled never
			// reach here. `emitActionEvents` starts them together, so they are not
			// ordered against the grouped event.
			const rowActionEvents = emitter.hasActionListeners(rowEvent)
				? applied.flatMap((group) => {
					return group.keys.map((key) => {
						return {
							event: rowEvent,
							meta: {
								payload: { ...group.data, [primaryKeyField]: key },
								collection: this.collection,
							},
							context: actionContext,
						};
					});
				})
				: [];

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
					...rowActionEvents,
					...nestedActionEvents,
				],
				opts,
			);
		}

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
	): Promise<void> {
		if (!shouldClearCache(this.cache, opts, this.collection)) {
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
					//
					// `snapshots` is always an array: a read hook can return
					// anything, but `withMeta` rejects a non-object before
					// `readByQuery` returns (see the TODO there), so this guard
					// and the ternary below it cannot currently fire.
					const snapshotJsonByKey = new Map<string, string>();

					if (Array.isArray(snapshots)) {
						for (const snapshot of snapshots) {
							snapshotJsonByKey.set(
								String(snapshot[primaryKeyField]),
								JSON.stringify(snapshot),
							);
						}
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
								data:
									snapshots && Array.isArray(snapshots)
										? snapshotJsonByKey.get(String(keys[index]))
										: JSON.stringify(snapshots),
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

		if (primaryKey) {
			validateKeys(this.schema, this.collection, primaryKeyField, primaryKey);
		}

		const exists =
			primaryKey &&
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
		const scopedCacheHookDeclarations =
			createScopedCacheHookDeclarations(this.schema);

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
		);

		if (shouldClearCache(this.cache, opts, this.collection)) {
			// New scope values for every committed row (inserts + moved updates), re-read
			// by returned key so a hook's take-over shows as whatever is now stored,
			// plus the rows an update filter added, which no returned key names.
			const newScopedCacheSnapshot = await this.scopedCache.snapshot(
				primaryKeys
					.filter((key): key is PrimaryKey => key !== null && key !== undefined)
					.concat(hookAddedKeys),
			);

			const oldSnapshots = [oldScopedCacheSnapshot, ...hookAddedSnapshots];

			const oldScopedCacheRows: ScopedCacheSnapshot = {
				canResolveSlicesFromRows: oldSnapshots.every((oldSnapshot) => {
					return oldSnapshot.canResolveSlicesFromRows;
				}),
				rows: oldSnapshots.flatMap((oldSnapshot) => oldSnapshot.rows),
			};

			// An insert-shaped payload routes to createOne, where a filter hook can take
			// the row over and return an existing key — an update in disguise, whose OLD
			// slice was never snapshotted (the key wasn't in `inputKeys`), so an old ∪ new
			// purge leaks it → coarse, unless the hook declared its own purgeBy.
			const someRowTakenOver = primaryKeys.some((key) => {
				return key != null && scopedCacheHookDeclarations.takenOverKeys.has(
					takenOverScopedCacheKey(this.collection, key),
				);
			});

			const takeoverUndeclared =
				someRowTakenOver
				&& scopedCacheHookDeclarations.purgeFingerprints.length === 0;

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
					rows: scopedCacheFingerprints === null
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

		await this.deleteMany([key], opts);
		return key;
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
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations
			?? createScopedCacheHookDeclarations(this.schema);

		// NB: this is the sole `items.delete` filter emit and it runs BEFORE
		// `validateAccess` (below) — deliberately, so a hook can cancel the delete and
		// snapshot old scope values before the rows go. Upstream emitted it after the
		// access check; a hook that assumed the keys were already authorized should read
		// that here (see the PR's disclosure note).
		const keysAfterHooks =
			opts.emitEvents !== false
				? await emitter.emitFilter<PrimaryKey[], null>(
					this.eventScope === 'items'
						? ['items.delete', `${this.collection}.items.delete`]
						: `${this.eventScope}.delete`,
					keys,
					{
						collection: this.collection,
					},
					{
						database: this.knex,
						schema: this.schema,
						accountability: this.accountability,
						scopedCache: scopedCacheHookDeclarations.purge,
					},
				)
				: keys;

		if (keysAfterHooks === null) {
			if (!opts.allowFilterCancel) {
				throw new InvalidPayloadError({
					reason: `A filter hook cancelled the deletion, but this operation requires it`,
				});
			}

			// A hook that declared a purge via `purgeBy` before cancelling still gets it
			// (parity with create's cancel); a plain validation cancel is a no-op (the
			// guard keeps empty declarations from reaching the purge). The cancel purges
			// only the declared fingerprints — `includeBareFingerprint: false` leaves
			// this collection's own bare one warm, nothing changed; a declared value
			// pin still reaches the global reads of the collection it names.
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

			// The filter cancelled the deletion: nothing is deleted; return a null per key
			// so the result stays index-aligned with the input keys.
			return keys.map(() => null);
		}

		// Snapshot the scope values of the rows about to be deleted; after the delete
		// they're gone and can't be read, so a later purge couldn't tell which slices to
		// drop. Off `keys`, not the filter's return: the statement below, the access
		// check and the activity rows all target `keys`, so a hook that returned a
		// REWRITTEN array (rather than null to cancel) would otherwise purge rows that
		// survive and leave the deleted ones cached.
		//
		// With them, the rows the delete rewrites through a self-relation: the database
		// moves those between slices under the delete, so they take an update's old ∪
		// new snapshot, the new half re-read once the rows are committed.
		const selfRelationSurvivorKeys =
			await this.scopedCache.selfRelationSurvivorKeys(keys);

		const oldScopedCacheSnapshot = await this.scopedCache.snapshot([
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
					knex: this.knex,
					schema: this.schema,
				},
			);
		}

		if (opts.preMutationError) {
			throw opts.preMutationError;
		}

		await transaction(this.knex, async (trx) => {
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
					await validateUserCountIntegrity({ flags: opts.userIntegrityCheckFlags, knex: trx });
				}
			}

			if (this.accountability && this.schema.collections[this.collection]!.accountability !== null) {
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
		}, opts.mutationTracker.snapshot());

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
				event:
					this.eventScope === 'items'
						? ['items.delete', `${this.collection}.items.delete`]
						: `${this.eventScope}.delete`,
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
