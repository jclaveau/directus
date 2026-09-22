import type {
	Accountability,
	EventContext,
	Item,
	PrimaryKey,
	Query,
	ScopedCacheCollector,
	ScopedCachePath,
	ScopedCacheTag,
	SchemaOverview,
} from '@directus/types';
import type Keyv from 'keyv';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import emitter from '../emitter.js';
import {
	joinFilterWithCases,
} from '../database/run-ast/lib/apply-query/join-filter-with-cases.js';
import type {
	FieldMap,
} from '../permissions/modules/process-ast/types.js';
import {
	collectionsInFieldMap,
} from '../permissions/modules/process-ast/utils/collections-in-field-map.js';
import type { AST } from '../types/ast.js';
import {
	scopedCacheOwnershipInjections,
	type ScopedCacheOwnershipInjection,
} from './ownership-injection.js';
import {
	composeScopedCachePaths,
	resolveScopedCacheM2oJoinChainFromPath,
	type ScopedCacheM2oJoin,
} from './paths.js';
import { ScopedCacheReadPlan } from './read-plan.js';
import {
	scopedCachePurgeEnabled,
} from './config.js';
import {
	scopedCacheFingerprintFromTags,
	type ScopedCacheFingerprint,
} from './fingerprint.js';
import {
	purgeScopedCache,
} from './purge.js';
import {
	pinnedScopedCacheTagsFromFilter,
	scopedCacheNestedCollections,
	scopedCachePathReversesChain,
} from './read-tags.js';
import {
	scopedCacheMaxPinsPerCollection,
	scopedCacheTagKey,
	scopedCacheTagsFromRows,
	type FieldTypesByField,
} from './tags.js';


export type ScopedCacheReadInputs = {
	ast: AST;
	plan: ScopedCacheReadPlan;
	updatedQuery: Query;
	filteredRecords: Item[];
	collector: ScopedCacheCollector;
};

/**
 * Stateless read-side metadata for a collection's scoped cache. Derives the flat
 * fields, dotted paths, terminal types and related primary keys the snapshot and
 * read-tag assembly consume. Every member is a pure function of (collection,
 * schema), both fixed for the owning ItemsService, so the getters memoize on
 * first access.
 */
export class ItemScopedCacheService {
	private collection: string;
	private schema: SchemaOverview;
	private knex: Knex;
	private cache: Keyv<any> | null;
	private accountability: Accountability | null;

	private fieldsMemo?: string[];
	private flatFieldsMemo?: string[];
	private pathsMemo?: ScopedCachePath[];
	private fieldTypesMemo?: FieldTypesByField;
	private relatedPksMemo?: Record<string, string>;

	constructor(
		collection: string,
		schema: SchemaOverview,
		knex: Knex,
		cache: Keyv<any> | null,
		accountability: Accountability | null,
	) {
		this.collection = collection;
		this.schema = schema;
		this.knex = knex;
		this.cache = cache;
		this.accountability = accountability;
	}

	get fields(): string[] {
		return this.fieldsMemo ??=
			this.schema.collections[this.collection]?.scopedCacheFields ?? [];
	}

	// Direct-column scope fields (no dot): they project into the snapshot SELECT and
	// feed the pinner's flat + one-hop logic. Dotted paths are handled separately.
	get flatFields(): string[] {
		return this.flatFieldsMemo ??=
			this.fields.filter((field) => !field.includes('.'));
	}

	// The multi-hop paths this collection pins by: explicit dotted entries PLUS paths
	// auto-derived from local scope fields (see `composeScopedCachePaths`). Each is
	// re-resolved so a to-many/unknown hop drops it → bare tag both sides. Deduped.
	get paths(): ScopedCachePath[] {
		if (this.pathsMemo) {
			return this.pathsMemo;
		}

		const byField = new Map<string, ScopedCachePath>();

		const addPath = (field: string) => {
			if (byField.has(field)) {
				return;
			}

			const resolved = this.resolvePath(field);

			if (resolved) {
				byField.set(field, { field, segments: resolved.segments });
			}
		};

		for (const field of this.fields) {
			if (field.includes('.')) {
				addPath(field);
			}
		}

		for (const { field } of composeScopedCachePaths(this.schema, this.collection)) {
			addPath(field);
		}

		return this.pathsMemo = [...byField.values()];
	}

	// Resolve a dotted scope field into the M2O join chain reaching its terminal.
	// Every INTERMEDIATE segment must be M2O (a row maps to exactly one parent); a
	// to-many hop or unknown field returns null → the caller degrades to the bare
	// tag. The terminal is a plain column on the last collection (scalar or fk).
	resolvePath(path: string): {
		segments: string[];
		joins: ScopedCacheM2oJoin[];
		terminalCollection: string;
		terminalField: string;
	} | null {
		const segments = path.split('.');

		if (segments.length < 2) {
			return null;
		}

		const joins = resolveScopedCacheM2oJoinChainFromPath(
			this.schema,
			this.collection,
			segments.slice(0, -1),
		);

		if (joins === null) {
			return null;
		}

		return {
			segments,
			joins,
			// At least one hop, since a path shorter than two segments returned above.
			terminalCollection: joins[joins.length - 1]!.relatedCollection,
			terminalField: segments[segments.length - 1]!,
		};
	}

	get fieldTypes(): FieldTypesByField {
		if (this.fieldTypesMemo) {
			return this.fieldTypesMemo;
		}

		const rootFields = this.schema.collections[this.collection]?.fields ?? {};
		const types: FieldTypesByField = {};

		// The primary key pins implicitly on every collection, so its type travels with
		// the declared ones — both sides canonicalize the key the same way.
		const primaryKeyField = this.schema.collections[this.collection]?.primary;

		if (primaryKeyField !== undefined) {
			types[primaryKeyField] = rootFields[primaryKeyField]?.type;
		}

		for (const field of this.flatFields) {
			types[field] = rootFields[field]?.type;
		}

		for (const { field } of this.paths) {
			const resolved = this.resolvePath(field);

			if (!resolved) {
				continue;
			}

			const terminal = this.schema.collections[resolved.terminalCollection];
			types[field] = terminal?.fields[resolved.terminalField]?.type;
		}

		return this.fieldTypesMemo = types;
	}

	// A scope field's related primary key, so the read side can unwrap the
	// `{ fk: { <pk>: { _eq } } }` shape queries/permissions use — for a flat one-hop
	// relation, and for a path whose terminal is itself an M2O (`{ user: { id } }`).
	get relatedPks(): Record<string, string> {
		if (this.relatedPksMemo) {
			return this.relatedPksMemo;
		}

		const map: Record<string, string> = {};

		const addRelatedPk = (
			field: string,
			fromCollection: string,
			fromField: string,
		) => {
			const relatedCollection = this.schema.relations.find((rel) => {
				return rel.collection === fromCollection && rel.field === fromField;
			})?.related_collection;

			const primaryKey = relatedCollection
				? this.schema.collections[relatedCollection]?.primary
				: undefined;

			if (primaryKey) {
				map[field] = primaryKey;
			}
		};

		for (const field of this.flatFields) {
			addRelatedPk(field, this.collection, field);
		}

		for (const { field } of this.paths) {
			const resolved = this.resolvePath(field);

			if (resolved) {
				addRelatedPk(field, resolved.terminalCollection, resolved.terminalField);
			}
		}

		return this.relatedPksMemo = map;
	}

	/**
	 * Snapshot the current scope values for the given keys as scoped cache tags,
	 * before a mutation runs. Snapshots the *old* values an update/delete is
	 * about to change so their slices get purged (an update that moves a row from
	 * `student=A` to `student=B` must drop both). Returns an empty list when
	 * there are no keys (a collection-level purge then suffices).
	 *
	 * Always emits the primary-key slice of every key, on every collection, whether it
	 * declares scope fields or not: the read side pins that axis on every collection,
	 * and a read pinning an axis the write never emits is never purged — stale, which
	 * is worse than any hit ratio. It costs no query, since the keys are already here.
	 */
	async snapshot(keys: PrimaryKey[]): Promise<ScopedCacheTag[] | null> {
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

		const fieldTypes = this.fieldTypes;

		const tags: ScopedCacheTag[] = keys.map((key) => {
			return {
				collection: this.collection,
				field: primaryKeyField,
				value: key,
				type: fieldTypes[primaryKeyField],
			};
		});

		const valueSliceTags = await this.snapshotValueSliceTags(keys, fieldTypes);

		if (valueSliceTags === null) {
			return null;
		}

		tags.push(...valueSliceTags);

		return tags;
	}

	/**
	 * Every value slice the mutated rows sit in right now: the flat columns the
	 * collection scopes on, plus the terminal value each path scope resolves to.
	 *
	 * Dedups per field across the rows, so a batch touching a hundred rows of one
	 * owner emits that owner's slice once. Which is also why it cannot say which
	 * row sat in which slice — `fingerprintsFromPks` keeps the rows apart.
	 */
	private async snapshotValueSliceTags(
		keys: PrimaryKey[],
		fieldTypes: FieldTypesByField,
	): Promise<ScopedCacheTag[] | null> {
		const flatFields = this.flatFields;
		const pathFields = this.resolvablePathFields();

		if (flatFields.length === 0 && pathFields.length === 0) {
			return [];
		}

		const rows = await this.scopeValueRows(keys);
		const tags: ScopedCacheTag[] = [];

		if (flatFields.length > 0) {
			const flatTags = scopedCacheTagsFromRows(
				this.collection,
				flatFields,
				rows,
				'coarse',
				fieldTypes,
			);

			// A flat field is always projected, so 'coarse' only nulls on a caller
			// feeding unprojected rows — never here; propagate it regardless.
			//
			// Which leaves this return, and the `=== null` arms in the three
			// callers, unreachable today. They stay on purpose:
			// - null is the fail-safe: scope unresolvable, so purge coarsely.
			// - it is unreachable only because the select above projects exactly
			//   the fields `scopedCacheTagsFromRows` reads, and nothing ties those
			//   two lists together.
			// - so a later edit to either side makes it reachable again, and
			//   without the arms the purge would silently narrow rather than
			//   widen: a stale cache instead of a slow one.
			if (flatTags === null) {
				return null;
			}

			tags.push(...flatTags);
		}

		for (const field of pathFields) {
			tags.push(...scopedCacheTagsFromRows(
				this.collection,
				[field],
				rows,
				'skip',
				{ [field]: fieldTypes[field] },
			));
		}

		return tags;
	}

	/**
	 * One fingerprint per mutated row: the row written as the same string a read
	 * pins itself with, so deciding whether that read depends on that row is a
	 * substring search rather than a set intersection.
	 *
	 * Where the snapshot above dedups a batch's slices per field, this keeps the
	 * rows apart on purpose. `owner=alpha` and `method=spaced` coming from two
	 * DIFFERENT rows must not read as one row holding both — that combination is
	 * exactly what a composite tag exists to tell apart.
	 */
	async fingerprintsFromPks(
		keys: PrimaryKey[],
	): Promise<ScopedCacheFingerprint[]> {
		if (!scopedCachePurgeEnabled() || keys.length === 0) {
			return [];
		}

		if (this.schema.collections[this.collection]?.primary === undefined) {
			return [];
		}

		const fieldTypes = this.fieldTypes;
		const rows = await this.scopeValueRows(keys);

		return rows.map((row) => {
			// 'skip' over 'coarse': every field below is projected by the select, and
			// a row that somehow lost one is better pinned by the rest of itself than
			// dropped — the fingerprint then matches MORE reads, never fewer.
			const tags = scopedCacheTagsFromRows(
				this.collection,
				Object.keys(row),
				[row],
				'skip',
				fieldTypes,
			);

			return scopedCacheFingerprintFromTags(this.collection, tags);
		});
	}

	/**
	 * The mutated rows, holding every column a read can pin itself to: the primary
	 * key, the flat scope fields, and the terminal each path scope resolves to
	 * through its M2O join chain. The mutated row carries only the first-hop fk, so
	 * the ancestor joins recover the SAME terminals the read side pinned.
	 *
	 * One query for all of it, not one per path and one more for the flat columns.
	 * The joins already select FROM the mutated collection, so its own columns ride
	 * along, and composition derives the paths by extending each other
	 * (`teaching_unit.discipline`, then `teaching_unit.discipline.enrollment`) so a
	 * join keyed by the segments leading to it is shared and each further path costs
	 * at most one more join. A M2O join cannot multiply the rows it is read from, so
	 * the flat columns read the same as they did on their own query.
	 *
	 * Each path terminal comes back under the path's own dotted name, which is what
	 * both callers tag it as. The query selects it positionally instead — two paths
	 * ending on the same terminal field would collide under that name in SQL.
	 */
	private async scopeValueRows(keys: PrimaryKey[]): Promise<Item[]> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		const aliasByLeadingSegments = new Map<string, string>();
		const terminalRefByPath: { field: string; terminalRef: string }[] = [];

		let query = this.knex.from({ root: this.collection });

		for (const { field } of this.paths) {
			const resolved = this.resolvePath(field);

			if (!resolved) {
				continue;
			}

			let leadingSegments = '';
			let prevAlias = 'root';

			for (const join of resolved.joins) {
				leadingSegments = `${leadingSegments}.${join.field}`;

				let alias = aliasByLeadingSegments.get(leadingSegments);

				if (alias === undefined) {
					alias = `p${aliasByLeadingSegments.size}`;
					aliasByLeadingSegments.set(leadingSegments, alias);

					query = query.leftJoin(
						{ [alias]: join.relatedCollection },
						`${alias}.${join.relatedPk}`,
						`${prevAlias}.${join.field}`,
					);
				}

				prevAlias = alias;
			}

			terminalRefByPath.push({
				field,
				terminalRef: `${prevAlias}.${resolved.terminalField}`,
			});
		}

		const rows = await query
			.select([
				// Deduped: a project that also lists its primary key in
				// `scoped_cache_fields` would otherwise project the column twice.
				...[...new Set([primaryKeyField, ...this.flatFields])].map((field) => {
					return this.knex.ref(`root.${field}`).as(field);
				}),
				...terminalRefByPath.map(({ terminalRef }, index) => {
					return this.knex.ref(terminalRef).as(`value${index}`);
				}),
			])
			.whereIn(`root.${primaryKeyField}`, keys);

		return rows.map((row: Item) => {
			const named: Item = {};

			for (const [column, value] of Object.entries(row)) {
				named[column] = value;
			}

			terminalRefByPath.forEach(({ field }, index) => {
				delete named[`value${index}`];
				named[field] = row[`value${index}`];
			});

			return named;
		});
	}

	/**
	 * The dotted scope paths that still resolve to a terminal value. A path whose
	 * chain has gained a to-many hop resolves to nothing and pins nothing, which is
	 * what makes it drop to the bare collection tag on both sides.
	 */
	private resolvablePathFields(): string[] {
		return this.paths
			.filter(({ field }) => Boolean(this.resolvePath(field)))
			.map(({ field }) => field);
	}

	/**
	 * The rows a delete REWRITES rather than removes: children reaching the deleted
	 * keys through a direct self-relation whose `on_delete` sets the fk to null or
	 * to its default. The database changes them under the delete, so they are
	 * snapshotted like an update — old slices before, new slices after — and none
	 * of the slices they sit in stays warm: their key, every scope field, the
	 * `<fk>=<deleted>` slice they leave and the one they land in.
	 *
	 * A self-relation that CASCADES is not here: its children go with the parent,
	 * and `scopedCacheCollectionsChangedByOnDelete` takes the whole collection.
	 * Nothing to read costs no query.
	 */
	async selfRelationSurvivorKeys(deletedKeys: PrimaryKey[]): Promise<PrimaryKey[]> {
		const primaryKeyField = this.schema.collections[this.collection]?.primary;

		if (
			!scopedCachePurgeEnabled()
			|| deletedKeys.length === 0
			|| primaryKeyField === undefined
		) {
			return [];
		}

		const rewritingFields = this.schema.relations
			.filter((relation) => {
				const rule = relation.schema?.on_delete;

				return relation.collection === this.collection
					&& relation.related_collection === this.collection
					&& (rule === 'SET NULL' || rule === 'SET DEFAULT');
			})
			.map((relation) => relation.field);

		if (rewritingFields.length === 0) {
			return [];
		}

		const rows: Record<string, PrimaryKey>[] = await this.knex
			.select(primaryKeyField)
			.from(this.collection)
			.where((builder) => {
				for (const field of rewritingFields) {
					builder.orWhereIn(field, deletedKeys);
				}
			})
			.whereNotIn(primaryKeyField, deletedKeys);

		return [...new Set(rows.map((row) => row[primaryKeyField]!))];
	}

	/**
	 * Ownership ancestors to nest into the read so the scope pins them by key rather
	 * than by the bare tag a `fields: ['*']` read would over-purge on. Stripped from
	 * the response again once the tags are built.
	 */
	ownershipInjections(query: Query): ScopedCacheOwnershipInjection[] {
		if (!scopedCachePurgeEnabled()) {
			return [];
		}

		return scopedCacheOwnershipInjections(
			this.schema,
			this.collection,
			query.fields ?? [],
		);
	}

	/**
	 * Everything this read's tags need that the AST alone decides, resolved before
	 * the query runs. The plan fills its own row-dependent half from inside it.
	 */
	planRead(
		ast: AST,
		injections: ScopedCacheOwnershipInjection[],
	): ScopedCacheReadPlan {
		return new ScopedCacheReadPlan(
			this.collection,
			this.schema,
			ast,
			injections,
		);
	}

	/**
	 * Event context handed to the `cache.purge` filter so extensions can resolve their
	 * own tags.
	 */
	purgeContext(): EventContext {
		return {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
		};
	}

	async purge(
		tags: ScopedCacheTag[] | null,
		collector?: Pick<ScopedCacheCollector, 'tags'>,
		changedCollections: string[] = [],
		// `false` leaves this collection's bare tag warm: a filter-cancel wrote
		// nothing, so its global reads stay; a mutation opting out through
		// `purgeCollectionTag` keeps them on purpose and drops the rows' own slices.
		{ includeCollectionTag = true }: { includeCollectionTag?: boolean } = {},
	): Promise<ScopedCacheTag[] | null> {
		// Callers reach here through `shouldClearCache`, which already rules out a
		// null cache — but it narrows `this.cache`, and a mutable field does not
		// carry that narrowing across the awaits below. Read it once. With no cache
		// there is nothing to purge either way.
		const cache = this.cache;

		if (cache === null) {
			return [];
		}

		const context = this.purgeContext();
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
			const ownAndHookTags = [...ownTags, ...hookTags];

			// Spelled twice rather than passing `{ includeCollectionTag }`: the option
			// object is what a caller reads as "this purge is doing something unusual",
			// and every assertion on the common call would have to carry a default it
			// never asked for.
			if (includeCollectionTag) {
				return purgeScopedCache(
					cache,
					this.collection,
					ownAndHookTags,
					context,
				);
			}

			return purgeScopedCache(
				cache,
				this.collection,
				ownAndHookTags,
				context,
				{ includeCollectionTag: false },
			);
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
				cache,
				this.collection,
				[...ownTags, ...hookTags],
				context,
				includeCollectionTag
					? { scopedCachePurgeId }
					: { includeCollectionTag: false, scopedCachePurgeId },
			));
		}
		else {
			// A `null` tag set means this collection's own slices are unresolvable →
			// coarse whole-collection purge (bare tag + every slice).
			purgedTagSets.push(await purgeScopedCache(
				cache,
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
					cache,
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
					cache,
					changedCollection,
					null,
					context,
					{ scopedCachePurgeId },
				);
			}),
		));

		// Reflect every purge in the dev debug header; a `null` from any of them means
		// the whole namespace was flushed, which already covers what the others reached.
		return purgedTagSets.some((tagSet) => tagSet === null)
			? null
			: purgedTagSets.flatMap((tagSet) => tagSet ?? []);
	}

	/**
	 * The scoped-cache tags this read depends on. The root collection gets value
	 * slices only when the query filter *bounds* it to those values
	 * (`pinnedScopedCacheTagsFromFilter`), so one owner's/partition's later write
	 * drops only their entries. An unbounded root (no scope-field filter — e.g. an
	 * admin list) and every other touched collection fall back to a bare collection
	 * tag, so any write to them invalidates the read (a value-slice tag would miss
	 * an insert of a brand-new value). The `cache.scope` filter lets extensions
	 * augment these (resolve M2M owners, or tag a collection an `items.read` hook
	 * enriched from); it receives the enriched `records`. Whatever they add must be
	 * reproducible on the `cache.purge` side or it leaks. Returns the tags plus any
	 * unautopurgeable scopeTo tags respond.ts leaves the read uncached for.
	 */
	async readTags(inputs: ScopedCacheReadInputs): Promise<{
		tags: ScopedCacheTag[];
		unautopurgeable: ScopedCacheTag[];
	}> {
		const {
			ast,
			plan,
			updatedQuery,
			filteredRecords,
			collector: scopedCacheCollector,
		} = inputs;

		let tags: ScopedCacheTag[] = [];
		let unautopurgeable: ScopedCacheTag[] = [];

		if (!scopedCachePurgeEnabled()) {
			return { tags, unautopurgeable };
		}

		const {
			fieldMap,
			filterKeying,
			keyedFilterPins,
			m2oParentPins,
			o2mChildPins,
			o2mConflicted,
			beyondNestedRows,
		} = plan;

		const nestedCollections = scopedCacheNestedCollections(ast);

		// Self-reference guard: pinning the root to a value slice is sound only
		// while the filter bounds every row the read returns. A self-referential
		// relation (the root collection reached again through a nested field) pulls
		// rows the root filter doesn't bound — a parent/child can belong to any
		// slice — so a write to another slice would leave this read stale. Detect
		// it (the root collection at more than one field-map path) and fall back to
		// the bare collection tag. It guards the implicit primary-key axis too:
		// `readOne(1, { fields: ['*', 'children.*'] })` embeds rows whose own keys
		// the `<pk>._eq 1` filter never bounded.
		const rootPaths = new Set<string>();

		for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
			if (entry.collection === this.collection) {
				rootPaths.add(path);
			}
		}

		// Scope off the read's EFFECTIVE bound = the API filter AND the permission
		// cases, combined by the same `joinFilterWithCases` the SQL WHERE uses
		// (`{ _and: [filter, { _or: cases }] }`) so the pin can't diverge from what
		// the query actually returns. Both are already dynamic-var-resolved before
		// the service runs — the filter by sanitizeQuery, the cases by
		// fetchPermissions → processPermissions → parseFilter — so `$CURRENT_USER`
		// is the concrete user id, matching what a write's row yields. The pinner
		// unions an `_or`'s slices when every branch binds a pinnable field — same
		// field or different ones (the multi-policy case) — else falls back to bare.
		const rootScopedCacheTags = rootPaths.size > 1
			? []
			: pinnedScopedCacheTagsFromFilter(
				this.collection,
				this.flatFields,
				joinFilterWithCases(updatedQuery.filter, ast.cases),
				this.fieldTypes,
				this.relatedPks,
				this.paths,
				this.schema.collections[this.collection]?.primary,
			);

		// A filter reaching a collection only through an operator on the
		// relational key itself (`{ rel: { _gt: X } }`) leaves it out of the
		// field map: `flattenFilter` stops at the `_`-prefixed key, so the path
		// never reaches the related context. The join is real either way, so the
		// collections come from the keying too — whether it named keys there or
		// not. Without this such a read carries NO tag for a table it joins,
		// and no write to that table can drop it.
		const taggedCollections = new Set([
			...collectionsInFieldMap(fieldMap),
			...filterKeying.keys(),
		]);

		// Every field-map path reaching a collection, deduped: the read and the other
		// group file one path twice when a filter and a nesting share it.
		const pathsTo = (
			collection: string,
			groups: Array<FieldMap['read']> = [fieldMap.read, fieldMap.other],
		): string[] => {
			const paths = new Set<string>();

			for (const group of groups) {
				for (const [path, entry] of group) {
					if (entry.collection === collection) {
						paths.add(path);
					}
				}
			}

			return [...paths];
		};

		const isToOnePath = (path: string): boolean => {
			return resolveScopedCacheM2oJoinChainFromPath(
				this.schema,
				this.collection,
				plan.unaliased(path),
			) !== null;
		};

		const effectiveFilter = joinFilterWithCases(updatedQuery.filter, ast.cases);

		const rootPrimary = this.schema.collections[this.collection]?.primary;

		// The root's key pins on their own, read off a run over the key axis alone:
		// the pinner covers an `_or` only when EVERY branch binds a pinnable field,
		// so with the key the one such field these exist exactly when the key bounds
		// every row the root returned. The full run's key pins say less — an `_or`
		// unions its branches, and a branch bound on another slice returns rows the
		// key never named.
		const rootKeyPins = rootPaths.size > 1 || rootPrimary === undefined
			? []
			: pinnedScopedCacheTagsFromFilter(
				this.collection,
				[],
				effectiveFilter,
				this.fieldTypes,
				{},
				[],
				rootPrimary,
			);

		// The slices the write side emits for a collection — its key, its flat scope
		// fields and its composed paths — read off the same derivation, so a slice
		// pinned here is one a write reproduces.
		type Slice = { field: string; segments: string[] };
		const slicesMemo = new Map<string, Slice[]>();
		const relatedServices = new Map<string, ItemScopedCacheService>();

		const relatedServiceOf = (collection: string): ItemScopedCacheService => {
			const memoized = relatedServices.get(collection);

			if (memoized) {
				return memoized;
			}

			const related = new ItemScopedCacheService(
				collection,
				this.schema,
				this.knex,
				this.cache,
				this.accountability,
			);

			relatedServices.set(collection, related);

			return related;
		};

		const slicesOf = (collection: string): Slice[] => {
			const memoized = slicesMemo.get(collection);

			if (memoized) {
				return memoized;
			}

			const related = relatedServiceOf(collection);

			const primary = this.schema.collections[collection]?.primary;

			const flat = primary === undefined
				? related.flatFields
				: [primary, ...related.flatFields];

			const slices: Slice[] = [
				...flat.map((field) => ({ field, segments: [field] })),
				...related.paths.map(({ field, segments }) => ({ field, segments })),
			];

			slicesMemo.set(collection, slices);

			return slices;
		};

		// The one slice of a would-be-bare collection that names every row this read
		// depends on, or none. Two ways a slice is sound, checked per path the read
		// reaches the collection by, since a path that escapes the bound is a row
		// the slice does not cover:
		//
		// - the path walks the slice's ownership chain backwards from the root, whose
		//   own pin then bounds every row nested that way (`courses` off a student
		//   read by key pins `course:student=<key>`);
		// - the read's own filter binds the path-prefixed slice for every row the root
		//   returns — the root pinner run over that one path, so an `_or` branch
		//   leaving it unbound leaves it unbound. The rows nested under such a path
		//   are in the slice only when the path is to-one, or when a parent-key pin
		//   already names them.
		//
		// A filter that keyed the collection somewhere ELSE cannot stand in: its keys
		// name rows reached by a hop this collection never takes, which is the
		// wrong-owner stale hit `cache-ancestor-slice-wrong-value` forbids.
		const sliceTagsFor = (collection: string): ScopedCacheTag[] => {
			if (collection === this.collection) {
				return [];
			}

			const paths = pathsTo(collection);

			if (paths.length === 0 || paths.includes('')) {
				return [];
			}

			const nestedRowsBounded =
				m2oParentPins.has(collection) ||
				o2mChildPins.has(collection) ||
				pathsTo(collection, [fieldMap.other]).every(isToOnePath);

			const fieldTypes = this.schema.collections[collection]?.fields ?? {};

			for (const slice of slicesOf(collection)) {
				const prefix = slice.segments.slice(0, -1);

				const terminalCollection = prefix.length > 0
					? resolveScopedCacheM2oJoinChainFromPath(
						this.schema,
						collection,
						prefix,
					)?.[prefix.length - 1]?.relatedCollection
					: collection;

				const terminalField = slice.segments[slice.segments.length - 1]!;

				if (terminalCollection === undefined) {
					continue;
				}

				const type = prefix.length > 0
					? this.schema.collections[terminalCollection]?.fields[terminalField]?.type
					: fieldTypes[terminalField]?.type;

				// The slice's fks walked to their end land on the root, whose key pin
				// then bounds every row nested back down that chain.
				const reversesChain = paths.every((path) => {
					return scopedCachePathReversesChain(
						this.schema,
						this.collection,
						plan.unaliased(path),
						collection,
						slice.segments,
					);
				});

				if (reversesChain && rootKeyPins.length > 0) {
					return rootKeyPins.map((pin) => {
						return { collection, field: slice.field, value: pin.value, type };
					});
				}

				if (!nestedRowsBounded) {
					continue;
				}

				// The terminal's related key, so `{ fk: { <pk>: … } }` binds like `_eq`.
				const relatedPk = (() => {
					const target = this.schema.relations.find((rel) => {
						return rel.collection === terminalCollection
							&& rel.field === terminalField;
					})?.related_collection;

					return target
						? this.schema.collections[target]?.primary
						: undefined;
				})();

				const bound = new Map<string, ScopedCacheTag>();
				let everyPathBound = true;

				// By field, not alias: a filter names fields, and so do the paths the
				// pinner walks it by.
				for (const path of paths) {
					const fields = plan.unaliased(path);
					const prefixed = `${fields.join('.')}.${slice.field}`;

					const relatedPks = relatedPk === undefined
						? {}
						: { [prefixed]: relatedPk };

					const tags = pinnedScopedCacheTagsFromFilter(
						this.collection,
						[],
						effectiveFilter,
						{ [prefixed]: type },
						relatedPks,
						[{
							field: prefixed,
							segments: [...fields, ...slice.segments],
						}],
					);

					if (tags.length === 0) {
						everyPathBound = false;
						break;
					}

					for (const { value } of tags) {
						const sliced = { collection, field: slice.field, value, type };
						bound.set(scopedCacheTagKey(sliced), sliced);
					}
				}

				// Past the ceiling the slice is dropped whole, never trimmed, like a
				// keyed filter's pin: a partial set leaves the rows it omits uncovered.
				if (
					everyPathBound
					&& bound.size > 0
					&& bound.size <= scopedCacheMaxPinsPerCollection()
				) {
					return [...bound.values()];
				}
			}

			return [];
		};

		// The slice every node of a collection bounds its rows to, or none. A node's
		// filter and cases gate every row that node returns whichever path reached
		// it — unlike the root's filter, which bounds nothing it nested — so a slice
		// all of them bind, run through the pinner the root's filter runs through
		// over the collection's own scope, names every row the read carries of it:
		// a row entering or leaving the slice is a write that emits it. It names the
		// NESTED rows only; a filter, sort or group reaching the collection depends
		// on rows beyond them, which the caller settles first.
		const nodeBoundTagsFor = (collection: string): ScopedCacheTag[] => {
			const bounds = plan.nodeBounds.get(collection) ?? [];

			if (collection === this.collection || bounds.length === 0) {
				return [];
			}

			const related = relatedServiceOf(collection);
			const bound = new Map<string, ScopedCacheTag>();

			for (const nodeBound of bounds) {
				const nodeTags = nodeBound === null
					? []
					: pinnedScopedCacheTagsFromFilter(
						collection,
						related.flatFields,
						nodeBound,
						related.fieldTypes,
						related.relatedPks,
						related.paths,
						this.schema.collections[collection]?.primary,
					);

				if (nodeTags.length === 0) {
					return [];
				}

				for (const tag of nodeTags) {
					bound.set(scopedCacheTagKey(tag), tag);
				}
			}

			return bound.size <= scopedCacheMaxPinsPerCollection()
				? [...bound.values()]
				: [];
		};

		// The nodes' slice names the nested rows and rides beside the pins a
		// filter named; short of one, the bare tag stands for both.
		const pushNodeBoundOrBare = (
			collection: string,
			pins: Map<string, ScopedCacheTag>,
		): void => {
			const nodeTags = nodeBoundTagsFor(collection);

			if (nodeTags.length === 0) {
				tags.push({ collection });
				return;
			}

			for (const tag of nodeTags) {
				pins.set(scopedCacheTagKey(tag), tag);
			}

			tags.push(...pins.values());
		};

		// A slice bounding the whole collection stands alone, ahead of the nodes'.
		const pushSliceOrBare = (
			collection: string,
			pins: Map<string, ScopedCacheTag>,
		): void => {
			const sliceTags = sliceTagsFor(collection);

			if (sliceTags.length > 0) {
				tags.push(...sliceTags);
				return;
			}

			pushNodeBoundOrBare(collection, pins);
		};

		for (const collection of taggedCollections) {
			if (collection === this.collection && rootScopedCacheTags.length > 0) {
				tags.push(...rootScopedCacheTags);
				continue;
			}

			// A collection the read reached only through M2O hops is pinned by the
			// keys it nested, and one a filter reached by key is pinned by the keys
			// that filter named. Both may hold at once — a collection nested AND
			// filtered depends on the union, since the filter reaches rows the
			// response never carried and vice versa. Named by neither, it keeps the
			// bare tag that any write to it drops.
			//
			// Keyed by tag so a slice both sides name is carried once: the tag
			// index dedups on that key, but the header and its count do not.
			const pins = new Map<string, ScopedCacheTag>();

			for (const pin of [
				...m2oParentPins.get(collection) ?? [],
				...o2mChildPins.get(collection) ?? [],
				...keyedFilterPins.get(collection) ?? [],
			]) {
				pins.set(scopedCacheTagKey(pin), pin);
			}

			// Conflicted reverse fks: a branch's M2O/keyed pin misses the rows nested
			// through the conflict, and so does a slice bound along the paths — the
			// conflict is two paths disagreeing on the key. Only the nodes' own
			// bounds name the rows whichever path nested them, and those name the
			// nested rows alone: depended on beyond them, it is bare.
			if (o2mConflicted.has(collection)) {
				if (beyondNestedRows.has(collection)) {
					tags.push({ collection });
					continue;
				}

				pushNodeBoundOrBare(collection, pins);
				continue;
			}

			// Named by an M2O filter the near row's own column answers, reached
			// no other way: no write to it can change what this read returns,
			// so it needs no tag at all — not even a bare one. Nested, sorted
			// or grouped on, it is depended on for more than that key and
			// falls through to the tags below.
			if (
				collection !== this.collection &&
				filterKeying.get(collection)?.kind === 'independent' &&
				!nestedCollections.has(collection) &&
				!beyondNestedRows.has(collection)
			) {
				continue;
			}

			// Depended on beyond the rows it nested — a filter, sort or group reaching
			// it, or a case gating it per row. The pins name the nested rows and
			// nothing more; only a slice bounding the whole collection names the rest,
			// so it rides beside them, or the bare tag stands for both halves.
			if (beyondNestedRows.has(collection)) {
				const sliceTags = sliceTagsFor(collection);

				if (sliceTags.length === 0) {
					tags.push({ collection });
					continue;
				}

				for (const tag of sliceTags) {
					pins.set(scopedCacheTagKey(tag), tag);
				}

				tags.push(...pins.values());
				continue;
			}

			// An ancestor the ownership injection alone nested carries nothing the
			// response returns: a chain reaching its rows pins them by key, and one
			// reaching none — a null hop, or a parent the node's case withheld —
			// leaves the response exactly as it was. What a filter or case elsewhere
			// keyed it on is the whole dependency, and no tag at all is the rest.
			const paths = pathsTo(collection);

			if (
				paths.length > 0 &&
				paths.every((path) => plan.injectedAncestorPaths.has(path))
			) {
				tags.push(...pins.values());
				continue;
			}

			// A collection the response NESTED is depended on for the rows it
			// carried, which a parent-key pin names — the M2O ancestor's key, or
			// the O2M child's parent-fk key. Where BOTH declined — an A2O hop, an
			// O2M nested under another to-many, or no row to read a key from — the
			// filter's keys cover one half of the dependency and say nothing about
			// the other: a slice bounding the rows stands in, or the bare tag.
			if (
				nestedCollections.has(collection) &&
				!m2oParentPins.has(collection) &&
				!o2mChildPins.has(collection)
			) {
				pushSliceOrBare(collection, pins);
				continue;
			}

			if (pins.size === 0) {
				pushSliceOrBare(collection, pins);
				continue;
			}

			tags.push(...pins.values());
		}

		// Keys of what the pinners computed: sound by construction, so the audit below
		// examines only what a HOOK added — and a hook re-stating a computed tag is
		// not flagged for it.
		const computedTagKeys = new Set(tags.map(scopedCacheTagKey));

		tags = (await emitter.emitFilter(
			'cache.scope',
			tags,
			// `records` are the post-`items.read` rows, so a hook that enriched the
			// response from another collection can derive value-level tags off the
			// actual data it pulled.
			{ collection: this.collection, query: updatedQuery, records: filteredRecords },
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		)) as ScopedCacheTag[];

		// Fold in tags an `items.read` hook added via `context.scopedCache.scopeTo`.
		tags.push(...scopedCacheCollector.tags);

		// A hook naming a dotted slice (`course:unit.owner=O`) declares a dependency
		// the purge answers from the course side only: a unit moved under another
		// owner emits the unit's own slices and nothing of the course's. The read
		// side carries the crossed collections itself when it derives such a tag,
		// so a hook's gets the same: each collection the path crosses, under the
		// suffix slice it emits, or bare when it emits none. The tag's own type is
		// the terminal column's, which a hook rarely knows and the key needs.
		const seenTagKeys = new Set(tags.map(scopedCacheTagKey));
		const crossedTags: ScopedCacheTag[] = [];

		tags = tags.map((tag) => {
			if (
				tag.field === undefined ||
				!tag.field.includes('.') ||
				!slicesOf(tag.collection).some(({ field }) => field === tag.field)
			) {
				return tag;
			}

			const resolved = new ItemScopedCacheService(
				tag.collection,
				this.schema,
				this.knex,
				this.cache,
				this.accountability,
			).resolvePath(tag.field);

			if (resolved === null) {
				return tag;
			}

			const { segments, joins, terminalCollection, terminalField } = resolved;

			const type = tag.type
				?? this.schema.collections[terminalCollection]?.fields[terminalField]?.type;

			for (const [hop, join] of joins.entries()) {
				const crossed = join.relatedCollection;
				const suffix = segments.slice(hop + 1).join('.');

				const crossedTag: ScopedCacheTag = slicesOf(crossed)
					.some(({ field }) => field === suffix)
					? { collection: crossed, field: suffix, value: tag.value, type }
					: { collection: crossed };

				const crossedKey = scopedCacheTagKey(crossedTag);

				if (!seenTagKeys.has(crossedKey)) {
					seenTagKeys.add(crossedKey);
					crossedTags.push(crossedTag);
				}
			}

			return type === undefined
				? tag
				: { ...tag, type };
		});

		tags.push(...crossedTags);

		// A hook tag on a field its collection isn't scoped on can't be reproduced by
		// that collection's auto-purge — the read would go stale — unless the hook
		// marked it `manuallyPurged` (it reproduces the tag via its own purgeBy). List
		// them so respond.ts leaves the read uncached + names them in the anomaly.
		//
		// Both hook channels are audited: `scopeTo` through the collector, and
		// whatever `cache.scope` returned beyond the computed set. Auditing only the
		// collector let the same unpurgeable tag through the other door.
		const hookAddedTags = new Map<string, ScopedCacheTag>();

		for (const tag of tags) {
			const tagKey = scopedCacheTagKey(tag);

			if (!computedTagKeys.has(tagKey)) {
				hookAddedTags.set(tagKey, tag);
			}
		}

		// Whether a WRITE to this tag's collection reproduces it, and so drops any
		// entry filed under it.
		const reproducedByAWrite = (tag: ScopedCacheTag): boolean => {
			// The bare collection tag is what every write to it emits.
			if (tag.field === undefined) {
				return true;
			}

			const collectionSchema = this.schema.collections[tag.collection];

			// Every collection auto-purges its primary-key slice, so a hook pinning
			// a foreign row by its key needs no `manuallyPurged` claim.
			if (tag.field === collectionSchema?.primary) {
				return true;
			}

			// A declared flat scope field auto-purges, and so does every path the write
			// derives — a declared dotted one, or one composed off a flat field into
			// the ancestor's scopes — as long as it resolves to an M2O chain, which is
			// what `paths` already filters on. Anything else is never emitted however
			// the read arrived at it.
			if (tag.field.includes('.')) {
				return slicesOf(tag.collection).some(({ field }) => field === tag.field);
			}

			return collectionSchema?.scopedCacheFields?.includes(tag.field) === true;
		};

		// Per COLLECTION, not per tag: purging is a union, so an entry filed under
		// several tags of one collection goes as soon as a write reproduces any ONE of
		// them. A finer tag no write emits — an ownership-ancestor path a read derived
		// for itself, say — is then harmless freight beside a reproducible sibling,
		// and refusing to cache over it costs the response for nothing.
		//
		// Computed tags count as cover: what matters is that the ENTRY is reachable
		// from a write to that collection, not which channel put the tag there.
		const collectionsAWriteReaches = new Set(
			tags.filter(reproducedByAWrite).map((tag) => tag.collection),
		);

		unautopurgeable = [...hookAddedTags.values()].filter((tag) => {
			return (
				reproducedByAWrite(tag) === false &&
				collectionsAWriteReaches.has(tag.collection) === false &&
				!scopedCacheCollector.manuallyPurgedKeys.has(scopedCacheTagKey(tag))
			);
		});

		return { tags, unautopurgeable };
	}
}
