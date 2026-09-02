import type {
	Accountability,
	EventContext,
	PrimaryKey,
	ScopedCacheCollector,
	ScopedCachePath,
	ScopedCacheTag,
	SchemaOverview,
} from '@directus/types';
import type Keyv from 'keyv';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import {
	composeScopedCachePaths,
	purgeScopedCache,
	resolveScopedCacheM2oJoinChainFromPath,
	scopedCachePurgeEnabled,
	scopedCacheTagsFromRows,
	type FieldTypesByField,
	type ScopedCacheM2oJoin,
} from '../scoped-cache.js';

/**
 * Stateless read-side metadata for a collection's scoped cache. Derives the flat
 * fields, dotted paths, terminal types and related primary keys the snapshot and
 * read-tag assembly consume. Every member is a pure function of (collection,
 * schema), both fixed for the owning ItemsService, so the getters can memoize later.
 */
export class ItemScopedCacheService {
	private collection: string;
	private schema: SchemaOverview;
	private knex: Knex;
	private cache: Keyv<any> | null;
	private accountability: Accountability | null;

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
		return this.schema.collections[this.collection]?.scopedCacheFields ?? [];
	}

	// Direct-column scope fields (no dot): they project into the snapshot SELECT and
	// feed the pinner's flat + one-hop logic. Dotted paths are handled separately.
	get flatFields(): string[] {
		return this.fields.filter((field) => !field.includes('.'));
	}

	// The multi-hop paths this collection pins by: explicit dotted entries PLUS paths
	// auto-derived from local scope fields (see `composeScopedCachePaths`). Each is
	// re-resolved so a to-many/unknown hop drops it → bare tag both sides. Deduped.
	get paths(): ScopedCachePath[] {
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

		return [...byField.values()];
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

		return types;
	}

	// A scope field's related primary key, so the read side can unwrap the
	// `{ fk: { <pk>: { _eq } } }` shape queries/permissions use — for a flat one-hop
	// relation, and for a path whose terminal is itself an M2O (`{ user: { id } }`).
	get relatedPks(): Record<string, string> {
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

		return map;
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
			return purgeScopedCache(
				this.cache,
				this.collection,
				[...ownTags, ...hookTags],
				context,
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
}
