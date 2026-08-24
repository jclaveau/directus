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
	ScopedCacheCollector,
	ScopedCachePath,
	ScopedCacheTag,
	Type,
	WithMeta,
} from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import type Keyv from 'keyv';
import type { Knex } from 'knex';
import { assign, clone, cloneDeep, isPlainObject, omit, pick, without } from 'lodash-es';
import { randomUUID } from 'node:crypto';
import { getCache } from '../cache.js';
import {
	composeScopedCachePaths,
	createScopedCacheCollector,
	pinnedScopedCacheTagsFromFilter,
	purgeScopedCache,
	scopedCacheCollectionsChangedByOnDelete,
	scopedCacheTagKey,
	scopedCacheTagsFromRows,
	scopedCachePurgeEnabled,
} from '../scoped-cache.js';
import { translateDatabaseError } from '../database/errors/translate.js';
import { getAstFromQuery } from '../database/get-ast-from-query/get-ast-from-query.js';
import { getHelpers } from '../database/helpers/index.js';
import getDatabase, { getDatabaseForAccountability } from '../database/index.js';
import {
	joinFilterWithCases,
} from '../database/run-ast/lib/apply-query/join-filter-with-cases.js';
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

export class ItemsService<Item extends AnyItem = AnyItem, Collection extends string = string>
implements AbstractService<Item> {
	collection: Collection;
	knex: Knex;
	accountability: Accountability | null;
	eventScope: string;
	schema: SchemaOverview;
	cache: Keyv<any> | null;
	nested: string[];

	// Tags purged by the latest mutation on this (per-request) service, surfaced by
	// the controllers as the CACHE_PURGED_TAGS_HEADER response header. Mutation
	// methods return bare primary keys — no object for a `withMeta` rider (as reads
	// use) — so the purged set rides the instance. `null` until a mutation purges.
	scopedCachePurged: ScopedCacheTag[] | null = null;

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

		return this;
	}

	/**
	 * Snapshot the current scope values for the given keys as scoped cache tags, before
	 * a mutation runs. Snapshots the *old* values an update/delete is about to change so
	 * their slices get purged (an update that moves a row from `student=A` to `student=B`
	 * must drop both). Returns an empty list when there are no keys (a
	 * collection-level purge then suffices).
	 *
	 * Always emits the primary-key slice of every key, on every collection, whether it
	 * declares scope fields or not: the read side pins that axis on every collection,
	 * and a read pinning an axis the write never emits is never purged — stale, which
	 * is worse than any hit ratio. It costs no query, since the keys are already here.
	 */
	private async snapshotScopedCacheTags(
		keys: PrimaryKey[],
	): Promise<ScopedCacheTag[] | null> {
		if (!scopedCachePurgeEnabled() || keys.length === 0) {
			return [];
		}

		const primaryKeyField = this.schema.collections[this.collection]?.primary;

		// This ran behind a "no scope fields declared" early return until the key axis
		// made it run for every mutation, so it now meets collections absent from the
		// schema. Such a collection resolves no key and no scope field either, and the
		// bare collection tag the purge always carries still drops its reads.
		if (primaryKeyField === undefined) {
			return [];
		}

		const flatFields = this.collectionScopedCacheFlatFields;
		const paths = this.collectionScopedCachePaths;
		const fieldTypes = this.collectionScopedCacheFieldTypes;

		const tags: ScopedCacheTag[] = keys.map((key) => {
			return {
				collection: this.collection,
				field: primaryKeyField,
				value: key,
				type: fieldTypes[primaryKeyField],
			};
		});

		if (flatFields.length > 0) {
			const rows = await this.knex
				// Deduped: a project that also lists its primary key in
				// `scoped_cache_fields` would otherwise project the column twice.
				.select([...new Set([primaryKeyField, ...flatFields])])
				.from(this.collection)
				.whereIn(primaryKeyField, keys);

			const flatTags = scopedCacheTagsFromRows(
				this.collection,
				flatFields,
				rows,
				'coarse',
				fieldTypes,
			);

			// A flat field is always projected, so 'coarse' only nulls on a caller
			// feeding unprojected rows — never here; propagate it regardless.
			if (flatTags === null) {
				return null;
			}

			tags.push(...flatTags);
		}

		for (const { field } of paths) {
			const pathTags = await this.snapshotScopedCachePathTags(
				field,
				keys,
				fieldTypes[field],
			);

			tags.push(...pathTags);
		}

		return tags;
	}

	/**
	 * Resolve a path scope field to its terminal value per mutated row via its M2O
	 * join chain, then reuse the row-tag builder for canonicalization + dedup. The
	 * mutated row carries only the first-hop fk, so the ancestor join recovers the
	 * SAME terminal the read side pinned — the identical `field=<path>` slice.
	 */
	private async snapshotScopedCachePathTags(
		path: string,
		keys: PrimaryKey[],
		terminalType: Type | undefined,
	): Promise<ScopedCacheTag[]> {
		const resolved = this.resolveScopedCachePath(path);

		if (!resolved) {
			return [];
		}

		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		let query = this.knex.from({ root: this.collection });
		let prevAlias = 'root';

		resolved.joins.forEach((hop, index) => {
			const alias = `p${index}`;

			query = query.leftJoin(
				{ [alias]: hop.relatedCollection },
				`${alias}.${hop.relatedPk}`,
				`${prevAlias}.${hop.field}`,
			);

			prevAlias = alias;
		});

		const rows = await query
			.select(this.knex.ref(`${prevAlias}.${resolved.terminalField}`).as('value'))
			.whereIn(`root.${primaryKeyField}`, keys);

		return scopedCacheTagsFromRows(
			this.collection,
			[path],
			rows.map((row) => ({ [path]: row.value })),
			'skip',
			{ [path]: terminalType },
		);
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

	private async purgeScopedCache(
		tags: ScopedCacheTag[] | null,
		collector?: Pick<ScopedCacheCollector, 'tags'>,
		changedCollections: string[] = [],
	): Promise<void> {
		const context = this.scopedCachePurgeContext();
		const hookTags = collector?.tags ?? [];

		// A rule reaching back into this collection leaves its own slices unresolvable
		// too, so it takes the collection-wide purge — whose reach already covers the
		// tag purge it would otherwise get alongside.
		const ownTags = changedCollections.includes(this.collection)
			? null
			: tags;

		// Outside scoped mode a purge clears the whole namespace, so one is all it
		// takes and the fan-out would be that many more flushes to no effect.
		const otherCollections = scopedCachePurgeEnabled()
			? changedCollections.filter((changedCollection) => {
				return changedCollection !== this.collection;
			})
			: [];

		if (ownTags !== null && otherCollections.length === 0) {
			this.scopedCachePurged = await purgeScopedCache(
				this.cache,
				this.collection,
				[...ownTags, ...hookTags],
				context,
			);

			return;
		}

		// Every operation below serves one mutation, so they share one purge id for
		// the same reason they share one header: they are one purge. Telemetry counts
		// by that id, so without it an entry several of them reach reports several
		// purges for the one mutation that caused them. The single-operation case
		// returns above precisely so it keeps minting its own, being its own purge.
		const scopedCachePurgeId = randomUUID();
		const purgedTagSets: (ScopedCacheTag[] | null)[] = [];

		if (ownTags !== null) {
			purgedTagSets.push(await purgeScopedCache(
				this.cache,
				this.collection,
				[...ownTags, ...hookTags],
				context,
				{ scopedCachePurgeId },
			));
		}
		else {
			// A `null` tag set means this collection's own slices are unresolvable →
			// coarse whole-collection purge (bare tag + every slice).
			purgedTagSets.push(await purgeScopedCache(
				this.cache,
				this.collection,
				null,
				context,
				{ scopedCachePurgeId },
			));

			// Tags a hook added via `context.scopedCache` are often for OTHER collections
			// the coarse pass never reaches, so purge them too — but with
			// `includeCollectionTag: false`, since the coarse pass already owns this
			// collection's bare tag (else it's purged twice and doubled in the header).
			if (hookTags.length > 0) {
				purgedTagSets.push(await purgeScopedCache(
					this.cache,
					this.collection,
					hookTags,
					context,
					{ includeCollectionTag: false, scopedCachePurgeId },
				));
			}
		}

		// A collection the database changed under this mutation. Which of its slices
		// moved is unresolvable — those rows were never read — and its bare tag indexes
		// none of them (a read bounded to one value is filed under that slice alone), so
		// each takes the collection-wide purge rather than a tag that cannot reach it.
		purgedTagSets.push(...await Promise.all(
			otherCollections.map((changedCollection) => {
				return purgeScopedCache(
					this.cache,
					changedCollection,
					null,
					context,
					{ scopedCachePurgeId },
				);
			}),
		));

		// Reflect every purge in the dev debug header; a `null` from any of them means
		// the whole namespace was flushed, which already covers what the others reached.
		this.scopedCachePurged = purgedTagSets.some((tagSet) => tagSet === null)
			? null
			: purgedTagSets.flatMap((tagSet) => tagSet ?? []);
	}

	private get collectionScopedCacheFields(): string[] {
		return this.schema.collections[this.collection]?.scopedCacheFields ?? [];
	}

	// Direct-column scope fields (no dot): they project into the snapshot SELECT and
	// feed the pinner's flat + one-hop logic. Dotted paths are handled separately.
	private get collectionScopedCacheFlatFields(): string[] {
		return this.collectionScopedCacheFields.filter((field) => !field.includes('.'));
	}

	// The multi-hop paths this collection pins by: explicit dotted entries PLUS paths
	// auto-derived from local scope fields (see `composeScopedCachePaths`). Each is
	// re-resolved so a to-many/unknown hop drops it → bare tag both sides. Deduped.
	private get collectionScopedCachePaths(): ScopedCachePath[] {
		const byField = new Map<string, ScopedCachePath>();

		const addPath = (field: string) => {
			if (byField.has(field)) {
				return;
			}

			const resolved = this.resolveScopedCachePath(field);

			if (resolved) {
				byField.set(field, { field, segments: resolved.segments });
			}
		};

		for (const field of this.collectionScopedCacheFields) {
			if (field.includes('.')) {
				addPath(field);
			}
		}

		for (const { field } of composeScopedCachePaths(this.schema, this.collection)) {
			addPath(field);
		}

		return [...byField.values()];
	}

	// Resolve a dotted scope field into the M2O join chain reaching its terminal.
	// Every INTERMEDIATE segment must be M2O (a row maps to exactly one parent); a
	// to-many hop or unknown field returns null → the caller degrades to the bare
	// tag. The terminal is a plain column on the last collection (scalar or fk).
	private resolveScopedCachePath(path: string): {
		segments: string[];
		joins: { field: string; relatedCollection: string; relatedPk: string }[];
		terminalCollection: string;
		terminalField: string;
	} | null {
		const segments = path.split('.');

		if (segments.length < 2) {
			return null;
		}

		const joins: {
			field: string;
			relatedCollection: string;
			relatedPk: string;
		}[] = [];

		let collection = this.collection;

		for (let index = 0; index < segments.length - 1; index++) {
			const field = segments[index]!;

			const relation = this.schema.relations.find((rel) => {
				return rel.collection === collection && rel.field === field;
			});

			const relatedCollection = relation?.related_collection;

			const relatedPk = relatedCollection
				? this.schema.collections[relatedCollection]?.primary
				: undefined;

			if (!relatedCollection || !relatedPk) {
				return null;
			}

			joins.push({ field, relatedCollection, relatedPk });
			collection = relatedCollection;
		}

		return {
			segments,
			joins,
			terminalCollection: collection,
			terminalField: segments[segments.length - 1]!,
		};
	}

	private get collectionScopedCacheFieldTypes(): Record<string, Type | undefined> {
		const rootFields = this.schema.collections[this.collection]?.fields ?? {};
		const types: Record<string, Type | undefined> = {};

		// The primary key pins implicitly on every collection, so its type travels with
		// the declared ones — both sides canonicalize the key the same way.
		const primaryKeyField = this.schema.collections[this.collection]?.primary;

		if (primaryKeyField !== undefined) {
			types[primaryKeyField] = rootFields[primaryKeyField]?.type;
		}

		for (const field of this.collectionScopedCacheFlatFields) {
			types[field] = rootFields[field]?.type;
		}

		for (const { field } of this.collectionScopedCachePaths) {
			const resolved = this.resolveScopedCachePath(field);

			if (!resolved) {
				continue;
			}

			const terminal = this.schema.collections[resolved.terminalCollection];
			types[field] = terminal?.fields[resolved.terminalField]?.type;
		}

		return types;
	}

	// A scope field's related primary key, so the read side can unwrap the
	// `{ fk: { <pk>: { _eq } } }` shape queries/permissions use — for a flat one-hop
	// relation, and for a path whose terminal is itself an M2O (`{ user: { id } }`).
	private get collectionScopedCacheFieldRelatedPks(): Record<string, string> {
		const map: Record<string, string> = {};

		const addRelatedPk = (
			field: string,
			fromCollection: string,
			fromField: string,
		) => {
			const relation = this.schema.relations.find((rel) => {
				return rel.collection === fromCollection && rel.field === fromField;
			});

			const relatedCollection = relation?.related_collection;

			const primaryKey = relatedCollection
				? this.schema.collections[relatedCollection]?.primary
				: undefined;

			if (primaryKey) {
				map[field] = primaryKey;
			}
		};

		for (const field of this.collectionScopedCacheFlatFields) {
			addRelatedPk(field, this.collection, field);
		}

		for (const { field } of this.collectionScopedCachePaths) {
			const resolved = this.resolveScopedCachePath(field);

			if (resolved) {
				addRelatedPk(field, resolved.terminalCollection, resolved.terminalField);
			}
		}

		return map;
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

		// An `items.create` hook can add purge tags via `context.scopedCache.purgeBy`;
		// drained into the purge below. Declared outside the transaction to outlive it.
		const scopedCacheCollector =
			opts.scopedCacheCollector ?? createScopedCacheCollector(this.schema);

		// Baseline so the take-over fallback (below) keys off THIS call's own hook
		// declarations, not tags an injected shared collector already held.
		const scopedCacheTagsAtStart = scopedCacheCollector.tags.length;

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
								scopedCache: scopedCacheCollector.purge,
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

			return {
				nestedActionEvents,
				actionPayloads: postPrepared.map(
					(p): ActionPayload => ({ primaryKey: p.primaryKey, actionHookPayload: p.actionHookPayload }),
				),
			};
		}, opts.mutationTracker.snapshot());

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
			// Scope off the committed rows' stored values (re-read by returned key), not the
			// raw input: a create hook can rewrite a scope field, a value left to a DB default
			// is only knowable after the insert, and a DB trigger/coercion can diverge from the
			// payload — the row is authoritative, the payload isn't.
			//
			// A row a hook *took over* (returned an existing PK) is the unsafe case: it
			// can be an update-in-disguise — the hook moved that row between slices — and
			// the create path has no old∪new capture, so the post-commit re-read sees
			// only the NEW slice; the OLD slice would leak (stale HIT). So a takeover
			// falls back to a coarse collection-wide purge BY DEFAULT. A hook that knows
			// its footprint opts back into a precise purge by declaring it via
			// `scopedCache.purgeBy` (a read-only dedup declares its one slice; an
			// upsert-move declares old + new) — then we trust it and narrow to the
			// snapshot ∪ declared tags.
			//
			// That holds on a collection declaring no scope field too. A takeover cannot
			// move a row between primary-key slices — the key it returned IS the slice —
			// but the key it returned is not the only row it may have written, and every
			// OTHER row's key slice is now pinnable, so an undeclared takeover leaves
			// them stale. Before the key axis the bare tag covered them by accident.
			const liveKeys = results.filter((key): key is PrimaryKey => key !== null);

			const changedKeys = liveKeys.filter((key) => {
				// A take-over the hook declared inert wrote nothing, so it neither
				// moved a slice nor counts toward the row/payload mismatch.
				return !scopedCacheCollector.purgeSkippedKeys.has(String(key));
			});

			if (
				changedKeys.length === 0 &&
				scopedCacheCollector.tags.length === scopedCacheTagsAtStart
			) {
				// Nothing written and nothing declared: no entry can have gone stale.
				// Returning rather than purging an empty tag set, which would still
				// take this collection's bare tag and drop its global reads.
				return results;
			}

			const someRowTakenOver = changedKeys.length > actionPayloads.length;

			const takeoverUndeclared =
				someRowTakenOver &&
				scopedCacheCollector.tags.length === scopedCacheTagsAtStart;

			// No `scopedCacheFields.length > 0` guard: the primary key pins on every
			// collection, so an undeclared take-over leaves the other rows' key slices
			// stale even where no scope field is declared.
			const scopedCacheTags = takeoverUndeclared
				? null
				: await this.snapshotScopedCacheTags(changedKeys);

			await this.purgeScopedCache(scopedCacheTags, scopedCacheCollector);
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

		// An `items.read` hook adds scope tags via `context.scopedCache.scopeTo`, same
		// channel as `cache.scope`; drained below.
		const scopedCacheCollector = createScopedCacheCollector(this.schema);

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
						scopedCache: scopedCacheCollector.scope,
					},
				)
				: records;

		// Scope this read for cache purging. The root collection gets value slices only
		// when the query filter *bounds* it to those values (`pinnedScopedCacheTagsFromFilter`),
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
		let scopedCacheUnautopurgeableTags: ScopedCacheTag[] = [];

		if (scopedCachePurgeEnabled()) {
			const fieldMap = fieldMapFromAst(ast, this.schema);

			// Self-reference guard: pinning the root to a value slice is sound only while the
			// filter bounds every row the read returns. A self-referential relation (the root
			// collection reached again through a nested field) pulls rows the root filter
			// doesn't bound — a parent/child can belong to any slice — so a write to another
			// slice would leave this read stale. Detect it (the root collection at more than
			// one field-map path) and fall back to the bare collection tag. It guards the
			// implicit primary-key axis too: `readOne(1, { fields: ['*', 'children.*'] })`
			// embeds rows whose own keys the `<pk>._eq 1` filter never bounded.
			const rootPaths = new Set<string>();

			for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
				if (entry.collection === this.collection) {
					rootPaths.add(path);
				}
			}

			// Scope off the read's EFFECTIVE bound = the API filter AND the permission cases,
			// combined by the same `joinFilterWithCases` the SQL WHERE uses (`{ _and: [filter,
			// { _or: cases }] }`) so the pin can't diverge from what the query actually returns. Both
			// are already dynamic-var-resolved before the service runs — the filter by sanitizeQuery,
			// the cases by fetchPermissions → processPermissions → parseFilter — so `$CURRENT_USER` is
			// the concrete user id, matching what a write's row yields. The pinner unions an `_or`'s
			// slices when every branch binds a pinnable field — same field or different ones (the
			// multi-policy case) — else falls back to bare.
			const rootScopedCacheTags = rootPaths.size > 1
				? []
				: pinnedScopedCacheTagsFromFilter(
					this.collection,
					this.collectionScopedCacheFlatFields,
					joinFilterWithCases(updatedQuery.filter, ast.cases),
					this.collectionScopedCacheFieldTypes,
					this.collectionScopedCacheFieldRelatedPks,
					this.collectionScopedCachePaths,
					this.schema.collections[this.collection]?.primary,
				);

			for (const collection of collectionsInFieldMap(fieldMap)) {
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

			// Fold in tags an `items.read` hook added via `context.scopedCache.scopeTo`.
			scopedCacheTags.push(...scopedCacheCollector.tags);

			// A scopeTo tag on a field its collection isn't scoped on can't be reproduced
			// by that collection's auto-purge — the read would go stale — unless the hook
			// marked it `manuallyPurged` (it reproduces the tag via its own purgeBy). List
			// them so respond.ts leaves the read uncached + names them in the anomaly.
			scopedCacheUnautopurgeableTags = scopedCacheCollector.tags.filter((tag) => {
				if (tag.field === undefined) {
					return false;
				}

				const collectionSchema = this.schema.collections[tag.collection];

				// Every collection auto-purges its primary-key slice, so a hook pinning
				// a foreign row by its key needs no `manuallyPurged` claim.
				if (tag.field === collectionSchema?.primary) {
					return false;
				}

				return (
					!collectionSchema?.scopedCacheFields?.includes(tag.field) &&
					!scopedCacheCollector.manuallyPurgedKeys.has(scopedCacheTagKey(tag))
				);
			});
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

		return withMeta(filteredRecords as Item[], {
			scopedCacheTags,
			scopedCacheUnautopurgeableTags,
		});
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

		// One collector shared across the forked child updates so an `items.update`
		// hook's `purgeBy` survives to the single deferred purge below (children run
		// with autoPurgeCache off, so their own drain is suppressed).
		const scopedCacheCollector = createScopedCacheCollector(this.schema);

		try {
			await transaction(this.knex, async (knex) => {
				const service = this.fork({ knex });

				let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;

				for (const item of data) {
					const primaryKey = item[primaryKeyField];

					if (!primaryKey) {
						throw new InvalidPayloadError({
							reason: `Item in update misses primary key`,
						});
					}

					const combinedOpts: MutationOptions = {
						autoPurgeCache: false,
						...opts,
						scopedCacheCollector,
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
			}, opts.mutationTracker.snapshot());
		}
		finally {
			if (shouldClearCache(this.cache, opts, this.collection)) {
				// Per-item hooks can rewrite scope fields inside each forked updateOne, so
				// the raw `data` may not be what's stored. Re-snapshot the now-committed
				// rows for the new values (old ∪ new). Committed only when THIS call owns
				// the transaction: invoked from a hook it shares the caller's, so the
				// purge below lands pre-commit —
				// https://github.com/jclaveau/directus/issues/363
				const newScopedCacheTags = await this.snapshotScopedCacheTags(batchKeys);

				const scopedCacheTags =
					oldScopedCacheTags === null || newScopedCacheTags === null
						? null
						: [...oldScopedCacheTags, ...newScopedCacheTags];

				await this.purgeScopedCache(scopedCacheTags, scopedCacheCollector);
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

		// An `items.update` hook can add purge tags via `context.scopedCache.purgeBy`;
		// drained into the purge below.
		const scopedCacheCollector =
			opts.scopedCacheCollector ?? createScopedCacheCollector(this.schema);

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
						scopedCache: scopedCacheCollector.purge,
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

			// A hook that declared a purge via `purgeBy` before cancelling still gets it
			// (parity with create's cancel); a plain validation cancel is a no-op (the
			// guard keeps an empty collector from reaching the purge). The cancel purges
			// only the declared tags — `includeCollectionTag: false` leaves this
			// collection's own bare tag (its global reads) warm, since nothing changed.
			if (
				scopedCacheCollector.tags.length > 0 &&
				shouldClearCache(this.cache, opts, this.collection)
			) {
				this.scopedCachePurged = await purgeScopedCache(
					this.cache,
					this.collection,
					scopedCacheCollector.tags,
					this.scopedCachePurgeContext(),
					{ includeCollectionTag: false },
				);
			}

			// The filter cancelled the update: nothing is written; return a null per key
			// so the result stays index-aligned with the input keys.
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
					throw await translateDatabaseError(err, data, this.knex, {
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

		if (shouldClearCache(this.cache, opts, this.collection)) {
			// Old slices from the pre-update capture, plus the new value re-read from the
			// now-committed rows (old ∪ new) — not the post-hook payload: a DB trigger or
			// type coercion can rewrite the scope column on write, so the stored row is
			// authoritative, the payload isn't (same rule as createMany). "Committed"
			// holds only when this call owns the transaction; from a hook it shares the
			// caller's and this purge runs pre-commit —
			// https://github.com/jclaveau/directus/issues/363
			const newScopedCacheTags = await this.snapshotScopedCacheTags(keys);

			const scopedCacheTags =
				oldScopedCacheTags === null || newScopedCacheTags === null
					? null
					: [...oldScopedCacheTags, ...newScopedCacheTags];

			await this.purgeScopedCache(scopedCacheTags, scopedCacheCollector);
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

		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		// Old scope values for the update subset — any payload carrying an existing key. A
		// pure-insert payload has no key (or points at no row yet), so it contributes nothing
		// here; its new slice is picked up from the committed rows below (old ∪ new).
		const inputKeys = payloads
			.map((payload) => payload[primaryKeyField])
			.filter((key): key is PrimaryKey => key !== undefined && key !== null);

		const oldScopedCacheTags = await this.snapshotScopedCacheTags(inputKeys);

		// Shared collector: child upserts run with autoPurgeCache off, so a
		// create/update hook's `purgeBy` reaches the deferred purge only via this sink.
		const scopedCacheCollector = createScopedCacheCollector(this.schema);

		const primaryKeys = await transaction(this.knex, async (knex) => {
			const service = this.fork({ knex });

			const primaryKeys: PrimaryKey[] = [];

			for (const payload of payloads) {
				const primaryKey = await service.upsertOne(payload, {
					...(opts || {}),
					autoPurgeCache: false,
					scopedCacheCollector,
				});

				primaryKeys.push(primaryKey);
			}

			return primaryKeys;
		}, opts.mutationTracker.snapshot());

		if (shouldClearCache(this.cache, opts, this.collection)) {
			// Re-snapshot the committed rows for their new scope values (covers both the
			// inserts and the moved updates). Reading by returned key also captures a row a
			// create hook took over — whatever's stored is what gets purged. No
			// `someRowTakenOver` row-count guard is needed here (unlike createMany): upsertMany
			// resolves values off `primaryKeys` returned by upsertOne, so every committed row is
			// already re-read rather than trusted from the input payload count.
			const newScopedCacheTags = await this.snapshotScopedCacheTags(
				primaryKeys.filter((key): key is PrimaryKey => key !== null && key !== undefined),
			);

			const scopedCacheTags =
				oldScopedCacheTags === null || newScopedCacheTags === null
					? null
					: [...oldScopedCacheTags, ...newScopedCacheTags];

			await this.purgeScopedCache(scopedCacheTags, scopedCacheCollector);
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

		// An `items.delete` hook can add purge tags via `context.scopedCache.purgeBy`;
		// drained into the purge below.
		const scopedCacheCollector =
			opts.scopedCacheCollector ?? createScopedCacheCollector(this.schema);

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
						scopedCache: scopedCacheCollector.purge,
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
			// guard keeps an empty collector from reaching the purge). The cancel purges
			// only the declared tags — `includeCollectionTag: false` leaves this
			// collection's own bare tag (its global reads) warm, since nothing changed.
			if (
				scopedCacheCollector.tags.length > 0 &&
				shouldClearCache(this.cache, opts, this.collection)
			) {
				this.scopedCachePurged = await purgeScopedCache(
					this.cache,
					this.collection,
					scopedCacheCollector.tags,
					this.scopedCachePurgeContext(),
					{ includeCollectionTag: false },
				);
			}

			// The filter cancelled the deletion: nothing is deleted; return a null per key
			// so the result stays index-aligned with the input keys.
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
			await this.purgeScopedCache(
				oldScopedCacheTags,
				scopedCacheCollector,
				scopedCacheCollectionsChangedByOnDelete(
					this.schema,
					this.collection,
				),
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
