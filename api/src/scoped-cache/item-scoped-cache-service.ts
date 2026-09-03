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
import {
	collectionsInFieldMap,
} from '../permissions/modules/process-ast/utils/collections-in-field-map.js';
import type {
	CollectionKey,
	FieldMap,
} from '../permissions/modules/process-ast/types.js';
import type { AST } from '../types/ast.js';
import {
	composeScopedCachePaths,
	pinnedScopedCacheTagsFromFilter,
	purgeScopedCache,
	resolveScopedCacheM2oJoinChainFromPath,
	scopedCacheAncestorSliceCandidates,
	scopedCacheNestedCollections,
	scopedCachePurgeEnabled,
	scopedCacheTagKey,
	scopedCacheTagsFromRows,
	type FieldTypesByField,
	type ScopedCacheFilterKeying,
	type ScopedCacheM2oJoin,
} from '../scoped-cache.js';


export type ScopedCacheReadInputs = {
	ast: AST;
	fieldMap: FieldMap;
	updatedQuery: Query;
	filterKeying: Map<CollectionKey, ScopedCacheFilterKeying>;
	keyedFilterPins: Map<CollectionKey, ScopedCacheTag[]>;
	m2oParentPins: Map<CollectionKey, ScopedCacheTag[]>;
	o2mChildPins: Map<CollectionKey, ScopedCacheTag[]>;
	o2mConflicted: Set<CollectionKey>;
	beyondNestedRows: Set<CollectionKey>;
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
	async snapshot(
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

		const flatFields = this.flatFields;
		const fieldTypes = this.fieldTypes;

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

		tags.push(...(await this.snapshotPathTags(this.paths, keys, fieldTypes)));

		return tags;
	}

	/**
	 * Resolve every path scope field to its terminal value per mutated row via its M2O
	 * join chain, then reuse the row-tag builder for canonicalization + dedup. The
	 * mutated row carries only the first-hop fk, so the ancestor joins recover the
	 * SAME terminals the read side pinned — the identical `field=<path>` slices.
	 *
	 * One query for every path, not one per path: composition derives the paths by
	 * extending each other (`teaching_unit.discipline`, then
	 * `teaching_unit.discipline.enrollment`), so a join keyed by the segments leading
	 * to it is shared and each further path costs at most one more join. On
	 * `student_course` that turns four round trips into one, per snapshot, and a
	 * mutation snapshots twice.
	 */
	private async snapshotPathTags(
		paths: ScopedCachePath[],
		keys: PrimaryKey[],
		fieldTypes: FieldTypesByField,
	): Promise<ScopedCacheTag[]> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;
		const aliasByLeadingSegments = new Map<string, string>();
		const terminalRefByPath: { field: string; terminalRef: string }[] = [];

		let query = this.knex.from({ root: this.collection });

		for (const { field } of paths) {
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

		if (terminalRefByPath.length === 0) {
			return [];
		}

		// Positional column names: a path spells its own name with dots, and two paths
		// ending on the same terminal field would collide under that name.
		const rows = await query
			.select(
				terminalRefByPath.map(({ terminalRef }, index) => {
					return this.knex.ref(terminalRef).as(`value${index}`);
				}),
			)
			.whereIn(`root.${primaryKeyField}`, keys);

		const tags: ScopedCacheTag[] = [];

		terminalRefByPath.forEach(({ field }, index) => {
			tags.push(...scopedCacheTagsFromRows(
				this.collection,
				[field],
				rows.map((row) => ({ [field]: row[`value${index}`] })),
				'skip',
				{ [field]: fieldTypes[field] },
			));
		});

		return tags;
	}

	/**
	 * Slices a delete vacates through a DIRECT self-relation whose `on_delete`
	 * rewrites the fk (SET NULL / SET DEFAULT). Deleting key X leaves surviving
	 * children with `<field> = X` rewritten to null, so a read pinned to
	 * `<field>=X` would go stale. Emitted only for a self-relation field the
	 * collection scopes on (else no read pins it). Keyed by the deleted keys.
	 */
	vacatedSelfRelationTags(deletedKeys: PrimaryKey[]): ScopedCacheTag[] {
		if (!scopedCachePurgeEnabled() || deletedKeys.length === 0) {
			return [];
		}

		const tags: ScopedCacheTag[] = [];

		for (const relation of this.schema.relations) {
			const rule = relation.schema?.on_delete;

			if (
				relation.collection !== this.collection ||
				relation.related_collection !== this.collection ||
				!this.flatFields.includes(relation.field) ||
				(rule !== 'SET NULL' && rule !== 'SET DEFAULT')
			) {
				continue;
			}

			for (const key of deletedKeys) {
				tags.push({
					collection: this.collection,
					field: relation.field,
					value: key,
					type: this.fieldTypes[relation.field],
				});
			}
		}

		return tags;
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
		// `false` leaves this collection's bare tag warm (a filter-cancel wrote nothing,
		// so its global reads stay), purging only the tags a hook declared.
		{ includeCollectionTag = true }: { includeCollectionTag?: boolean } = {},
	): Promise<ScopedCacheTag[] | null> {
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

			if (includeCollectionTag) {
				return purgeScopedCache(
					this.cache,
					this.collection,
					ownAndHookTags,
					context,
				);
			}

			return purgeScopedCache(
				this.cache,
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
			fieldMap,
			updatedQuery,
			filterKeying,
			keyedFilterPins,
			m2oParentPins,
			o2mChildPins,
			o2mConflicted,
			beyondNestedRows,
			filteredRecords,
			collector: scopedCacheCollector,
		} = inputs;

		let tags: ScopedCacheTag[] = [];
		let unautopurgeable: ScopedCacheTag[] = [];

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

		// Rows the response actually carried. A keyed filter bounds the JOINED rows,
		// not necessarily the fetched ones — a declined O2M/A2O path nests rows no
		// filter bounded — so it cannot stand in for a parent-key pin below. A
		// filter-only collection is absent here, so its keyed slice is sound.
		const collectionsFetchedAsRows = new Set(
			[...fieldMap.other].map(([, entry]) => entry.collection),
		);

		// Prefer, over a would-be-bare collection tag, the nearest slice to an
		// ancestor its ownership chain reaches that is pinned in this read: a write to
		// the collection purges that same key (every hop is an ownership edge), so the
		// slice invalidates the read where the bare tag only over-purged.
		const ancestorSliceTagsFor = (collection: string): ScopedCacheTag[] => {
			const pinsOf = (ancestor: string): ScopedCacheTag[] => {
				if (ancestor === this.collection) {
					return rootScopedCacheTags;
				}

				return [
					...m2oParentPins.get(ancestor) ?? [],
					...keyedFilterPins.get(ancestor) ?? [],
				];
			};

			for (
				const candidate of scopedCacheAncestorSliceCandidates(
					this.schema,
					collection,
				)
			) {
				const matched = pinsOf(candidate.ancestor).filter((pin) => {
					return pin.field === candidate.terminalField;
				});

				if (matched.length > 0) {
					return matched.map((pin) => {
						return {
							collection,
							field: candidate.field,
							value: pin.value,
							type: pin.type,
						};
					});
				}
			}

			return [];
		};

		const pushAncestorSliceOrBare = (collection: string): void => {
			// A would-be-bare collection takes its ancestor slice unless it was reached
			// by two disagreeing reverse fks: only that o2m conflict leaves rows no
			// single ownership slice can name. Every other bare is soundly covered by
			// the owner's slice the whole read is bounded to.
			const ancestorSliceTags = o2mConflicted.has(collection)
				? []
				: ancestorSliceTagsFor(collection);

			tags.push(
				...(ancestorSliceTags.length > 0
					? ancestorSliceTags
					: [{ collection }]),
			);
		};

		for (const collection of taggedCollections) {
			if (collection === this.collection && rootScopedCacheTags.length > 0) {
				tags.push(...rootScopedCacheTags);
				continue;
			}

			// Conflicted reverse fks: a branch's M2O/keyed pin misses the rows nested
			// through the conflict, so only the bare tag is sound.
			if (o2mConflicted.has(collection)) {
				tags.push({ collection });
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

			// A collection the response NESTED is depended on for the rows it
			// carried, which only a parent-key pin can name — the M2O ancestor's
			// key, or the O2M child's parent-fk key. Where BOTH declined — an A2O
			// hop, an O2M nested under another to-many, or no row to read a key
			// from — the filter's keys cover one half of the dependency and say
			// nothing about the other, so the bare tag is the honest answer. The
			// exception is a collection reached ONLY through a filter that keyed it
			// (nowhere fetched): the join reads only rows that key bounds, so its
			// keyed slice covers the whole dependency and stands in for the pin.
			if (
				nestedCollections.has(collection) &&
				!m2oParentPins.has(collection) &&
				!o2mChildPins.has(collection) &&
				!(
					keyedFilterPins.has(collection) &&
					!collectionsFetchedAsRows.has(collection)
				)
			) {
				pushAncestorSliceOrBare(collection);
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

			if (pins.size === 0) {
				pushAncestorSliceOrBare(collection);
				continue;
			}

			tags.push(...pins.values());
		}

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

		// A scopeTo tag on a field its collection isn't scoped on can't be reproduced
		// by that collection's auto-purge — the read would go stale — unless the hook
		// marked it `manuallyPurged` (it reproduces the tag via its own purgeBy). List
		// them so respond.ts leaves the read uncached + names them in the anomaly.
		unautopurgeable = scopedCacheCollector.tags.filter((tag) => {
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

		return { tags, unautopurgeable };
	}
}
