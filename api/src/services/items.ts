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
	Item as AnyItem,
	EventContext,
	MutationTracker,
	MutationOptions,
	PrimaryKey,
	Query,
	QueryOptions,
	SchemaOverview,
	ScopedCacheTag,
	WithMeta,
} from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import type Keyv from 'keyv';
import type { Knex } from 'knex';
import { assign, clone, cloneDeep, isPlainObject, omit, pick, without } from 'lodash-es';
import { getCache } from '../cache.js';
import {
	pinnedScopeTagsFromFilter,
	purgeScopedCache,
	scopedCacheTagsFromRows,
	scopedCachePurgeEnabled,
} from '../scoped-cache.js';
import { translateDatabaseError } from '../database/errors/translate.js';
import { getAstFromQuery } from '../database/get-ast-from-query/get-ast-from-query.js';
import { getHelpers } from '../database/helpers/index.js';
import getDatabase from '../database/index.js';
import { runAst } from '../database/run-ast/run-ast.js';
import emitter from '../emitter.js';
import { fieldMapFromAst } from '../permissions/modules/process-ast/lib/field-map-from-ast.js';
import { processAst } from '../permissions/modules/process-ast/process-ast.js';
import { collectionsInFieldMap } from '../permissions/modules/process-ast/utils/collections-in-field-map.js';
import { processPayload } from '../permissions/modules/process-payload/process-payload.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { readMeta, withMeta } from '../utils/read-meta.js';
import { shouldClearCache } from '../utils/should-clear-cache.js';
import { transaction } from '../utils/transaction.js';
import { validateKeys } from '../utils/validate-keys.js';
import { validateUserCountIntegrity } from '../utils/validate-user-count-integrity.js';
import { PayloadService } from './payload.js';

const env = useEnv();

/**
 * Emit a mutation's action events (the item's own event plus any queued nested ones) in parallel.
 * They run together, so a slow handler on one event doesn't serialize the rest. By default the
 * mutation does not wait for them (Directus' historical fire-and-forget behaviour); pass
 * `awaitActionHooks` to block until every handler has settled.
 */
async function emitActionEvents(actionEvents: ActionEventParams[], opts: MutationOptions): Promise<void> {
	const emitting = Promise.all(
		actionEvents.map((actionEvent) =>
			opts.bypassEmitAction
				? opts.bypassEmitAction(actionEvent)
				: emitter.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context),),
	);

	if (opts.awaitActionHooks) {
		await emitting;
	}
	else {
		// Per-event errors are already caught and logged inside emitter.emitAction; swallow here so
		// an un-awaited rejection (e.g. from a bypassEmitAction handler) doesn't go unhandled.
		emitting.catch(() => {});
	}
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

	constructor(collection: Collection, options: AbstractServiceOptions) {
		this.collection = collection;
		this.knex = options.knex || getDatabase();
		this.accountability = options.accountability || null;

		this.eventScope = isSystemCollection(this.collection)
			? this.collection.substring(9)
			: 'items';

		this.schema = options.schema;
		this.cache = getCache().cache;
		this.nested = options.nested ?? [];

		return this;
	}

	/**
	 * Snapshot the current scope values for the given keys as scoped cache tags, before
	 * a mutation runs. Snapshots the *old* values an update/delete is about to change so
	 * their slices get purged (an update that moves a row from `student=A` to `student=B`
	 * must drop both). Returns an empty list when the collection has no scoped cache
	 * fields or there are no keys (a collection-level purge then suffices).
	 */
	private async snapshotScopedCacheTags(keys: PrimaryKey[]) {
		if (!scopedCachePurgeEnabled()) {
			return [];
		}

		const scopedCacheFields = this.collectionScopedCacheFields;

		if (scopedCacheFields.length === 0 || keys.length === 0) {
			return [];
		}

		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		const rows = await this.knex
			.select(primaryKeyField, ...scopedCacheFields)
			.from(this.collection)
			.whereIn(primaryKeyField, keys);

		return scopedCacheTagsFromRows(this.collection, scopedCacheFields, rows, true);
	}

	/**
	 * Event context handed to the `cache.purge` filter so extensions can resolve their
	 * own tags.
	 */
	private scopedCachePurgeContext(): EventContext {
		return {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
		};
	}

	private async purgeScopedCache(tags: ScopedCacheTag[] | null): Promise<void> {
		await purgeScopedCache(
			this.cache,
			this.collection,
			tags,
			this.scopedCachePurgeContext(),
		);
	}

	private get collectionScopedCacheFields(): string[] {
		return this.schema.collections[this.collection]?.scopedCacheFields ?? [];
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
		const items = await itemsService.readByQuery(readQuery);
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

		// Index-aligned results: a filter hook can take over a row (returns its own PK) or cancel
		// it (returns null), in which case that row is never inserted but still occupies its slot.
		const results: (PrimaryKey | null)[] = new Array(data.length);

		type ActionPayload = { primaryKey: PrimaryKey; actionHookPayload: AnyItem };

		const { nestedActionEvents, actionPayloads } = await transaction(this.knex, async (trx) => {
			const nestedActionEvents: ActionEventParams[] = [];
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

			for (const [index, payloadInput] of data.entries()) {
				const payload: AnyItem = cloneDeep(payloadInput);

				// Run all hooks that are attached to this event so the end user has the chance to augment the
				// item that is about to be saved
				const payloadAfterHooks =
					opts.emitEvents !== false
						? await emitter.emitFilter<AnyItem, PrimaryKey | null>(
							this.eventScope === 'items'
								? ['items.create', `${this.collection}.items.create`]
								: `${this.eventScope}.create`,
							payload,
							{ collection: this.collection },
							{
								database: trx,
								schema: this.schema,
								accountability: this.accountability,
							},
						)
						: payload;

				if (typeof payloadAfterHooks === 'string' || typeof payloadAfterHooks === 'number') {
					// A filter hook returned a primary key instead of a payload: it has taken over the
					// creation of this row. Surface that key, insert nothing, and let the hook that took
					// over own the action event.
					results[index] = payloadAfterHooks;
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
				if (
					primaryKey &&
					pkField &&
					!opts.bypassAutoIncrementSequenceReset &&
					['integer', 'bigInteger'].includes(pkField.type) &&
					pkField.defaultValue === 'AUTO_INCREMENT'
				) {
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
				const dbError = await translateDatabaseError(err, data);

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

			return {
				nestedActionEvents,
				actionPayloads: postPrepared.map(
					(p): ActionPayload => ({ primaryKey: p.primaryKey, actionHookPayload: p.actionHookPayload }),
				),
			};
		});

		if (opts.emitEvents !== false) {
			const eventName =
				this.eventScope === 'items'
					? ['items.create', `${this.collection}.items.create`]
					: `${this.eventScope}.create`;

			const actionEvents: ActionEventParams[] = actionPayloads.map(({ primaryKey, actionHookPayload }) => ({
				event: eventName,
				meta: {
					payload: actionHookPayload,
					key: primaryKey,
					collection: this.collection,
				},
				context: {
					database: getDatabase(),
					schema: this.schema,
					accountability: this.accountability,
				},
			}));

			// Route through emitActionEvents so the create path honours `awaitActionHooks` (#58) and
			// `bypassEmitAction` (nested mutations), instead of an un-awaited raw emit.
			await emitActionEvents([...actionEvents, ...nestedActionEvents], opts);
		}

		if (shouldClearCache(this.cache, opts, this.collection)) {
			const scopedCacheFields = this.collectionScopedCacheFields;

			// Scope off the post-hook payloads actually inserted, not the raw input:
			//   - a create filter hook can rewrite a scope field, so `data`'s value may
			//     not be what's stored;
			//   - a payload that omits a scoped cache field has an unknown (default) value,
			//     so `scopedCacheTagsFromRows` returns null and purgeScopedCache full-flushes;
			//   - a row a hook *took over* (returned a primary key, inserted itself) has an
			//     unknowable scope value, so its presence forces a full flush too.
			let scopedCacheTags: ScopedCacheTag[] | null = [];

			if (scopedCacheFields.length > 0) {
				const liveKeyCount = results.filter((key) => key !== null).length;
				const someRowTakenOver = liveKeyCount > actionPayloads.length;

				scopedCacheTags = someRowTakenOver
					? null
					: scopedCacheTagsFromRows(
						this.collection,
						scopedCacheFields,
						actionPayloads.map(({ actionHookPayload }) => actionHookPayload),
						true,
					);
			}

			await this.purgeScopedCache(scopedCacheTags);
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

		let ast = await getAstFromQuery(
			{
				collection: this.collection,
				query: updatedQuery,
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

		const records = await runAst(ast, this.schema, this.accountability, {
			knex: this.knex,
			// GraphQL requires relational keys to be returned regardless
			stripNonRequested: opts?.stripNonRequested !== undefined
				? opts.stripNonRequested
				: true,
		});

		// TODO when would this happen?
		if (records === null) {
			throw new ForbiddenError(); // 404 / InvalidPayload ?
		}

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
					},
				)
				: records;

		// Scope this read for cache purging. The root collection gets value slices only
		// when the query filter *bounds* it to those values (`pinnedScopeTagsFromFilter`),
		// so one owner's/partition's later write drops only their entries. An unbounded
		// root (no scope-field filter — e.g. an admin list) and every other touched
		// collection fall back to a bare collection tag, so any write to them invalidates
		// the read (a value-slice tag would miss an insert of a brand-new value). The
		// `cache.scope` filter lets extensions augment these (e.g. resolve M2M owners, or
		// tag a collection an `items.read` hook enriched from); it receives the enriched
		// `records` so data-derived tags are possible. Whatever they add here must be
		// reproducible on the `cache.purge` side or it leaks. Bounded to this read — it
		// rides the result via `getMeta()`, not a service-level field.
		let scopedCacheTags: ScopedCacheTag[] = [];

		if (scopedCachePurgeEnabled()) {
			const scopedCacheFields = this.collectionScopedCacheFields;

			const rootScopedCacheTags = pinnedScopeTagsFromFilter(
				this.collection,
				scopedCacheFields,
				updatedQuery.filter,
			);

			for (const collection of collectionsInFieldMap(fieldMapFromAst(ast, this.schema))) {
				if (collection === this.collection && rootScopedCacheTags.length > 0) {
					scopedCacheTags.push(...rootScopedCacheTags);
				}
				else {
					scopedCacheTags.push({ collection });
				}
			}

			scopedCacheTags = (await emitter.emitFilter(
				'cache.scope',
				scopedCacheTags,
				// `records` are the post-`items.read` rows, so a hook that enriched the response from
				// another collection can derive value-level tags off the actual data it pulled.
				{ collection: this.collection, query: updatedQuery, records: filteredRecords },
				{ database: this.knex, schema: this.schema, accountability: this.accountability },
			)) as ScopedCacheTag[];
		}

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

		return withMeta(filteredRecords as Item[], { scopedCacheTags });
	}

	/**
	 * Get single item by primary key.
	 *
	 * Uses `this.readByQuery` under the hood.
	 */
	async readOne(key: PrimaryKey, query: Query = {}, opts?: QueryOptions): Promise<WithMeta<Item>> {
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
		return withMeta(results[0]!, readMeta(results) ?? { scopedCacheTags: [] });
	}

	/**
	 * Get multiple items by primary keys.
	 *
	 * Uses `this.readByQuery` under the hood.
	 */
	async readMany(keys: PrimaryKey[], query: Query = {}, opts?: QueryOptions): Promise<WithMeta<Item[]>> {
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
	 *
	 * Uses `this.updateOne` under the hood.
	 */
	async updateBatch(data: Partial<Item>[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		if (!Array.isArray(data)) {
			throw new InvalidPayloadError({ reason: 'Input should be an array of items' });
		}

		if (!opts.mutationTracker) {
			opts.mutationTracker = this.createMutationTracker();
		}

		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		const keys: PrimaryKey[] = [];

		// Pre-update scope values for every row this batch touches (old ∪ new on purge,
		// like updateMany).
		const batchKeys = data
			.map((item) => item[primaryKeyField])
			.filter((key): key is PrimaryKey => key !== undefined && key !== null);

		const oldScopedCacheTags = await this.snapshotScopedCacheTags(batchKeys);

		try {
			await transaction(this.knex, async (knex) => {
				const service = this.fork({ knex });

				let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;

				for (const item of data) {
					const primaryKey = item[primaryKeyField];

					if (!primaryKey) {
						throw new InvalidPayloadError({ reason: `Item in update misses primary key` });
					}

					const combinedOpts: MutationOptions = {
						autoPurgeCache: false,
						...opts,
						onRequireUserIntegrityCheck: (flags) => (userIntegrityCheckFlags |= flags),
					};

					keys.push(await service.updateOne(primaryKey, omit(item, primaryKeyField), combinedOpts));
				}

				if (userIntegrityCheckFlags) {
					if (opts.onRequireUserIntegrityCheck) {
						opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
					}
					else {
						await validateUserCountIntegrity({ flags: userIntegrityCheckFlags, knex });
					}
				}
			});
		}
		finally {
			if (shouldClearCache(this.cache, opts, this.collection)) {
				// Per-item hooks can rewrite scope fields inside each forked updateOne, so
				// the raw `data` may not be what's stored. Re-snapshot the now-committed
				// rows for the new values (old ∪ new).
				const newScopedCacheTags = await this.snapshotScopedCacheTags(batchKeys);

				const scopedCacheTags =
					oldScopedCacheTags === null || newScopedCacheTags === null
						? null
						: [...oldScopedCacheTags, ...newScopedCacheTags];

				await this.purgeScopedCache(scopedCacheTags);
			}
		}

		return keys;
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
		if (!opts.mutationTracker) {
			opts.mutationTracker = this.createMutationTracker();
		}

		if (!opts.bypassLimits) {
			opts.mutationTracker.trackMutations(keys.length);
		}

		const { ActivityService } = await import('./activity.js');
		const { RevisionsService } = await import('./revisions.js');

		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);

		// Capture the scope values these rows hold before the update so an update that
		// moves a row to a new scope value purges both slices (old ∪ new). Empty when the
		// collection isn't scoped.
		const oldScopedCacheTags = await this.snapshotScopedCacheTags(keys);

		const fields = Object.keys(this.schema.collections[this.collection]!.fields);

		const aliases = Object.values(this.schema.collections[this.collection]!.fields)
			.filter((field) => field.alias === true)
			.map((field) => field.field);

		const payload: Partial<AnyItem> = cloneDeep(data);
		const nestedActionEvents: ActionEventParams[] = [];

		// Run all hooks that are attached to this event so the end user has the chance to augment the
		// item that is about to be saved
		const payloadAfterHooks =
			opts.emitEvents !== false
				? await emitter.emitFilter<Partial<AnyItem>, null>(
					this.eventScope === 'items'
						? ['items.update', `${this.collection}.items.update`]
						: `${this.eventScope}.update`,
					payload,
					{
						keys,
						collection: this.collection,
					},
					{
						database: this.knex,
						schema: this.schema,
						accountability: this.accountability,
					},
				)
				: payload;

		if (payloadAfterHooks === null) {
			if (!opts.allowFilterCancel) {
				// A filter hook cleared the payload to null. Treating that as an explicit, opt-in
				// cancellation (returning a null per key) is owned by the `allowFilterCancel` mutation
				// option; on its own a null payload is invalid rather than a silent no-op.
				throw new InvalidPayloadError({
					reason: `A filter hook cancelled the update, but this operation requires it`,
				});
			}

			// The filter cancelled the update: nothing is written; return a null per key so the
			// result stays index-aligned with the input keys.
			return keys.map(() => null);
		}

		const isEmptyAlterations = (value: unknown): boolean => {
			// A bare `[]` is not empty here: for o2m it removes every existing child (see processO2M),
			// so only the `{ create, update, delete }` object form can count as no change.
			if (!isPlainObject(value)) {
				return false;
			}

			const alterations = value as Partial<Alterations>;

			// Guard against a JSON column that merely looks like an alterations object.
			const isNotAlterationsShaped = Object.keys(alterations).some(
				(key) => !ALTERATIONS_KEYS.includes(key as keyof Alterations),
			);

			if (isNotAlterationsShaped) {
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

		const changedFields = Object.keys(payloadAfterHooks ?? {}).filter((field) => !changesNothing(field));

		if (changedFields.length === 0) {
			// An empty payload, a PK-only update, or a filter hook that cleared every field to an
			// empty alterations object leaves nothing to change — skip the transaction,
			// activity/revision rows and integrity checks.
			return [];
		}

		// Sort keys to ensure that the order is maintained
		keys.sort();

		if (this.accountability) {
			await validateAccess(
				{
					accountability: this.accountability,
					action: 'update',
					collection: this.collection,
					primaryKeys: keys,
					fields: Object.keys(payloadAfterHooks),
				},
				{
					schema: this.schema,
					knex: this.knex,
				},
			);
		}

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

		if (opts.preMutationError) {
			throw opts.preMutationError;
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
					throw await translateDatabaseError(err, data);
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
										? JSON.stringify(snapshots[index])
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
		});

		if (shouldClearCache(this.cache, opts, this.collection)) {
			const scopedCacheFields = this.collectionScopedCacheFields;

			// Old slices from the pre-update capture, plus the new value the update sets
			// (if it touches a scope field). Derived from the post-hook payload, not the
			// raw input — an update filter hook can rewrite a scope field. An absent scoped
			// cache field means "unchanged", covered by the old capture.
			const newScopedCacheTags =
				scopedCacheTagsFromRows(
					this.collection,
					scopedCacheFields,
					[payloadAfterHooks],
					false,
				) ?? [];

			const scopedCacheTags =
				oldScopedCacheTags === null
					? null
					: [...oldScopedCacheTags, ...newScopedCacheTags];

			await this.purgeScopedCache(scopedCacheTags);
		}

		if (opts.emitEvents !== false) {
			const actionEvent = {
				event:
					this.eventScope === 'items'
						? ['items.update', `${this.collection}.items.update`]
						: `${this.eventScope}.update`,
				meta: {
					payload: payloadWithPresets,
					keys,
					collection: this.collection,
				},
				context: {
					database: getDatabase(),
					schema: this.schema,
					accountability: this.accountability,
				},
			};

			await emitActionEvents([actionEvent, ...nestedActionEvents], opts);
		}

		return keys;
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

		const primaryKeys = await transaction(this.knex, async (knex) => {
			const service = this.fork({ knex });

			const primaryKeys: PrimaryKey[] = [];

			for (const payload of payloads) {
				const primaryKey = await service.upsertOne(payload, { ...(opts || {}), autoPurgeCache: false });
				primaryKeys.push(primaryKey);
			}

			return primaryKeys;
		});

		if (shouldClearCache(this.cache, opts, this.collection)) {
			// Upserts mix inserts and updates per row, so old (pre-update) scope values
			// can't be captured cheaply for the update subset. Fall back to a full flush
			// (`null`) rather than risk leaving a moved-value slice stale.
			// TODO(scoped-cache): resolve per-row once upsert churn is measured.
			await this.purgeScopedCache(null);
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
					},
				)
				: keys;

		if (keysAfterHooks === null) {
			if (!opts.allowFilterCancel) {
				throw new InvalidPayloadError({
					reason: `A filter hook cancelled the deletion, but this operation requires it`,
				});
			}

			// The filter cancelled the deletion: nothing is deleted; return a null per key so the
			// result stays index-aligned with the input keys.
			return keys.map(() => null);
		}

		// Capture the scope values of the rows about to be deleted; after the delete
		// they're gone and can't be read, so a later purge couldn't tell which slices to
		// drop.
		const oldScopedCacheTags = await this.snapshotScopedCacheTags(keysAfterHooks);

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

		if (opts.emitEvents !== false) {
			await emitter.emitFilter(
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
				},
			);
		}

		await transaction(this.knex, async (trx) => {
			await trx(this.collection).whereIn(primaryKeyField, keys)
				.delete();

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
		});

		if (shouldClearCache(this.cache, opts, this.collection)) {
			await this.purgeScopedCache(oldScopedCacheTags);
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
		const meta = readMeta(records) ?? { scopedCacheTags: [] };
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

			return withMeta(defaults as Partial<Item>, meta);
		}

		return withMeta(record, meta);
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
