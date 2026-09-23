import type {
	Accountability,
	EventContext,
	Item,
	PrimaryKey,
	Query,
	ScopedCacheCollector,
	ScopedCacheFingerprint,
	ScopedCachePath,
	ScopedCacheScopePin,
	ScopedCacheCollectionPin,
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
	scopedCacheFingerprintOf,
	scopedCacheFingerprintsByCollection,
} from './fingerprint.js';
import { scopedCacheIndexPath } from './index-path.js';
import type {
	ScopedCacheMutatedWrite,
	ScopedCacheSnapshot,
} from './mutated-rows.js';
import {
	purgeScopedCache,
} from './purge.js';
import {
	pinnedScopedCacheQueryCasesFromFilter,
	scopedCachePinsFromFilter,
	scopedCacheNestedCollections,
	scopedCachePathReversesChain,
	scopedCachePinsOfQueryCases,
} from './read-pins.js';
import {
	scopedCacheMaxPinsPerCollection,
	scopedCachePinKey,
	scopedCacheCollectionPinsFromRows,
	type FieldTypesByField,
} from './pins.js';


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
 * read-fingerprint assembly consume. Every member is a pure function of (collection,
 * schema), both fixed for the owning ItemsService, so the getters memoize on
 * first access.
 */
/**
 * The alias each scope path's terminal is selected under, since two paths ending
 * on the same field would collide under their own name. Prefixed with a character
 * no column of a Directus collection carries, because the select beside it now
 * projects every column and a plain `value0` could be one of them.
 */
const PATH_ALIAS = '#path';

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

	// The multi-hop paths this collection pins by: explicit dotted entries PLUS
	// paths auto-derived from local scope fields (see `composeScopedCachePaths`).
	// Each is re-resolved so a to-many/unknown hop drops it → bare fingerprint both
	// sides. Deduped.
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
	// fingerprint. The terminal is a plain column on the last collection (a scalar
	// or a foreign key).
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
	 * What a mutation's purge is built from, read before it runs and again once it
	 * commits: every row it touches, each carrying the fingerprint of the scope it
	 * sits in.
	 *
	 * One fingerprint per ROW, never one per value: `owner=alpha` and
	 * `method=spaced` coming from two DIFFERENT rows must not read as one row
	 * holding both, which is exactly what a read pinned to that pair depends on.
	 *
	 * Always emits the primary-key slice of every key, on every collection, whether it
	 * declares scope fields or not: the read side pins that axis on every collection,
	 * and a read pinning an axis the write never emits is never purged — stale, which
	 * is worse than any hit ratio. It costs no query, since the keys are already here.
	 *
	 * `canResolveSlicesFromRows: false` is the fail-safe: the scope of these rows is
	 * unresolvable, so their collection is purged whole.
	 */
	async snapshot(keys: PrimaryKey[]): Promise<ScopedCacheSnapshot> {
		if (!scopedCachePurgeEnabled() || keys.length === 0) {
			return { canResolveSlicesFromRows: true, rows: [] };
		}

		const primaryKeyField = this.schema.collections[this.collection]?.primary;

		// This ran behind a "no scope fields declared" early return until the key axis
		// made it run for every mutation, so it now meets collections absent from the
		// schema. Such a collection resolves no key and no scope field either, and the
		// bare collection fingerprint the purge always carries still drops its reads.
		if (primaryKeyField === undefined) {
			return { canResolveSlicesFromRows: true, rows: [] };
		}

		const fieldTypes = this.fieldTypes;

		const keyPins: ScopedCacheScopePin[] = keys.map((key) => {
			return {
				field: primaryKeyField,
				value: key,
				type: fieldTypes[primaryKeyField],
			};
		});

		const flatFields = this.flatFields;
		const pathFields = this.resolvablePathFields();

		// A collection scoping on nothing has no slice to read and no query to pay
		// for it — its primary key alone completes each row's fingerprint, since the
		// scope a read can pin there is its keys and nothing else.
		//
		// The columns stay unread: they would only buy the `changed` diff, and
		// buying it here would put a SELECT on every mutation of every collection in
		// the schema. So every update of one reads as touching every field, exactly
		// as it did before.
		if (flatFields.length === 0 && pathFields.length === 0) {
			return {
				canResolveSlicesFromRows: true,
				rows: keyPins.map((keyPin) => {
					return {
						key: keyPin.value as PrimaryKey,
						row: null,
						fingerprint: scopedCacheFingerprintOf(
							this.collection,
							[keyPin],
						),
					};
				}),
			};
		}

		const scopedRows = await this.scopeValueRows(keys);

		const rowsProjectEveryFlatField = scopedRows.every((scopedRow) => {
			return flatFields.every((flatField) => flatField in scopedRow);
		});

		// A flat field is always projected, so this only fails on a caller feeding
		// unprojected rows — never here; propagate it regardless.
		//
		// Which leaves this return, and the unresolvable arms in the callers,
		// unreachable today. They stay on purpose:
		// - it is the fail-safe: scope unresolvable, so purge coarsely.
		// - it is unreachable only because the select above projects exactly
		//   the fields the fingerprints below are built from, and nothing ties
		//   those two lists together.
		// - so a later edit to either side makes it reachable again, and
		//   without the arms the purge would silently narrow rather than
		//   widen: a stale cache instead of a slow one.
		if (rowsProjectEveryFlatField === false) {
			return { canResolveSlicesFromRows: false, rows: [] };
		}

		// The axes a read can pin itself to — a fingerprint's pinned scope.
		// Every OTHER column the row carries stays out of them and rides the row
		// instead: it can only ever be a field the read is bound to, never a slice.
		const pinnableFields = [...new Set([
			primaryKeyField,
			...flatFields,
			...pathFields,
		])];

		return {
			canResolveSlicesFromRows: true,
			rows: scopedRows.map((row) => {
				// 'skip' over 'coarse': every field below is projected by the select,
				// and a row that somehow lost one is better pinned by the rest of
				// itself than dropped — the fingerprint then matches MORE reads,
				// never fewer.
				const rowPins = scopedCacheCollectionPinsFromRows(
					this.collection,
					pinnableFields,
					[row],
					'skip',
					fieldTypes,
				);

				return {
					key: row[primaryKeyField] as PrimaryKey,
					row,
					fingerprint: scopedCacheFingerprintOf(
						this.collection,
						rowPins,
					),
				};
			}),
		};
	}

	/**
	 * The mutated rows, holding every column of the collection — a read binds the
	 * fields it selected, sorted and filtered on, and any of them can be a column
	 * no scope names — plus the terminal each path scope resolves to through its
	 * M2O join chain. The mutated row carries only the first-hop fk, so the
	 * ancestor joins recover the SAME terminals the read side pinned.
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
	 * both callers name it as. The query selects it positionally instead — two paths
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

		const scopedRows = await query
			.select([
				// Deduped: a project that also lists its primary key in
				// `scoped_cache_fields` would otherwise project the column twice.
				...[...new Set([
					primaryKeyField,
					...this.flatFields,
					...this.rootColumns(),
				])].map((field) => {
					return this.knex.ref(`root.${field}`).as(field);
				}),
				...terminalRefByPath.map(({ terminalRef }, index) => {
					return this.knex.ref(terminalRef).as(`${PATH_ALIAS}${index}`);
				}),
			])
			.whereIn(`root.${primaryKeyField}`, keys);

		return scopedRows.map((row: Item) => {
			const namedRow: Item = {};

			for (const [column, value] of Object.entries(row)) {
				namedRow[column] = value;
			}

			terminalRefByPath.forEach(({ field }, index) => {
				delete namedRow[`${PATH_ALIAS}${index}`];
				namedRow[field] = row[`${PATH_ALIAS}${index}`];
			});

			return namedRow;
		});
	}

	/**
	 * Every column of the collection as the schema knows it. An alias field (o2m,
	 * m2m, a presentation block) has no column to read and would break the select.
	 */
	private rootColumns(): string[] {
		const collectionFields = this.schema.collections[this.collection]?.fields ?? {};

		return Object.values(collectionFields)
			.filter(({ alias }) => alias === false)
			.map(({ field }) => field);
	}

	/**
	 * The dotted scope paths that still resolve to a terminal value. A path whose
	 * chain has gained a to-many hop resolves to nothing and pins nothing, which is
	 * what makes it drop to the bare collection fingerprint on both sides.
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
	 * than by the bare fingerprint a `fields: ['*']` read would over-purge on.
	 * Stripped from the response again once the fingerprints are built.
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
	 * Everything this read's fingerprints need that the AST alone decides, resolved
	 * before
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
	 * own fingerprints.
	 */
	purgeContext(): EventContext {
		return {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
		};
	}

	async purge(
		scopedCacheFingerprints: ScopedCacheFingerprint[] | null,
		collector?: Pick<ScopedCacheCollector, 'purgeFingerprints'>,
		changedCollections: string[] = [],
		{
			// `false` leaves this collection's bare fingerprint warm: a
			// filter-cancel wrote nothing, so its global reads stay; a mutation
			// opting out through `purgeBareFingerprint` keeps them on purpose and
			// drops the rows' own slices.
			includeBareFingerprint = true,
			// The rows the mutation wrote, as they were AND as they became, with the
			// fields it rewrote. Given them, an entry of this collection is dropped
			// only when one of those rows satisfies its whole fingerprint — which is
			// the narrowing this whole thing is for. Left out (a purge with no rows
			// to show for it: a hook's declared fingerprints, a collection changed
			// by a cascade), every entry they reach is dropped as before.
			rows,
		}: {
			includeBareFingerprint?: boolean;
			rows?: ScopedCacheMutatedWrite | undefined;
		} = {},
	): Promise<ScopedCacheFingerprint[] | null> {
		// Callers reach here through `shouldClearCache`, which already rules out a
		// null cache — but it narrows `this.cache`, and a mutable field does not
		// carry that narrowing across the awaits below. Read it once. With no cache
		// there is nothing to purge either way.
		const cache = this.cache;

		if (cache === null) {
			return [];
		}

		const context = this.purgeContext();
		const hookFingerprints = collector?.purgeFingerprints ?? [];

		// A rule reaching back into this collection leaves its own slices unresolvable
		// too, so it takes the collection-wide purge — whose reach already covers the
		// pinned purge it would otherwise get alongside.
		const ownFingerprints = changedCollections.includes(this.collection)
			? null
			: scopedCacheFingerprints;

		// Outside scoped mode a purge clears the whole namespace, so one is all it
		// takes and the fan-out would be that many more flushes to no effect.
		const otherCollections = scopedCachePurgeEnabled()
			? changedCollections.filter((changedCollection) => {
				return changedCollection !== this.collection;
			})
			: [];

		// What the rows narrow the purge of THIS collection to. A purge that shows no
		// rows carries none of it and sweeps its pins whole, as it did before.
		const boundToRows = rows === undefined
			? {}
			: {
				rowFingerprints: rows.fingerprints,
				changed: rows.changed,
				indexPath: scopedCacheIndexPath(this.schema, this.collection),
			};

		// What a hook declared rides beside the mutation's own purge rather than in
		// its own list: it names a query case, not a row, so the rows this mutation
		// wrote answer for none of it.
		const declared = { declaredFingerprints: hookFingerprints };

		if (ownFingerprints !== null && otherCollections.length === 0) {
			// Spelled twice rather than passing `{ includeBareFingerprint }`: the option
			// object is what a caller reads as "this purge is doing something unusual",
			// and every assertion on the common call would have to carry a default it
			// never asked for.
			if (includeBareFingerprint) {
				return purgeScopedCache(
					cache,
					this.collection,
					ownFingerprints,
					context,
					{ ...boundToRows, ...declared },
				);
			}

			return purgeScopedCache(
				cache,
				this.collection,
				ownFingerprints,
				context,
				{ ...boundToRows, ...declared, includeBareFingerprint: false },
			);
		}

		// Every operation below serves one mutation, so they share one purge id for
		// the same reason they share one header: they are one purge. Telemetry counts
		// by that id, so without it an entry several of them reach reports several
		// purges for the one mutation that caused them. The single-operation case
		// returns above precisely so it keeps minting its own, being its own purge.
		const scopedCachePurgeId = randomUUID();
		const purgedFingerprintSets: (ScopedCacheFingerprint[] | null)[] = [];

		if (ownFingerprints !== null) {
			purgedFingerprintSets.push(await purgeScopedCache(
				cache,
				this.collection,
				ownFingerprints,
				context,
				includeBareFingerprint
					? { ...boundToRows, ...declared, scopedCachePurgeId }
					: {
						...boundToRows,
						...declared,
						includeBareFingerprint: false,
						scopedCachePurgeId,
					},
			));
		}
		else {
			// A `null` list means this collection's own slices are unresolvable →
			// coarse whole-collection purge (bare fingerprint + every slice).
			purgedFingerprintSets.push(await purgeScopedCache(
				cache,
				this.collection,
				null,
				context,
				{ scopedCachePurgeId },
			));

			// What a hook declared via `context.scopedCache` is often for OTHER
			// collections the coarse pass never reaches, so purge it too — but with
			// `includeBareFingerprint: false`, since the coarse pass already owns
			// this collection's bare fingerprint (else it's purged twice and doubled
			// in the header).
			if (hookFingerprints.length > 0) {
				purgedFingerprintSets.push(await purgeScopedCache(
					cache,
					this.collection,
					[],
					context,
					{ ...declared, includeBareFingerprint: false, scopedCachePurgeId },
				));
			}
		}

		// A collection the database changed under this mutation. Which of its slices
		// moved is unresolvable — those rows were never read — and its bare
		// fingerprint indexes none of them (a read bounded to one value is filed
		// under that slice alone), so each takes the collection-wide purge rather
		// than a fingerprint that cannot reach it.
		purgedFingerprintSets.push(...await Promise.all(
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
		return purgedFingerprintSets.some((purgedSet) => purgedSet === null)
			? null
			: purgedFingerprintSets.flatMap((purgedSet) => purgedSet ?? []);
	}

	/**
	 * The scoped-cache fingerprints this read depends on. The root collection gets
	 * value slices only when the query filter *bounds* it to those values
	 * (`scopedCachePinsFromFilter`), so one owner's/partition's later write
	 * drops only their entries. An unbounded root (no scope-field filter — e.g. an
	 * admin list) and every other touched collection fall back to a bare collection
	 * fingerprint, so any write to them invalidates the read (a value-sliced one
	 * would miss an insert of a brand-new value). The `cache.scope` filter lets
	 * extensions augment these (resolve M2M owners, or name a collection an
	 * `items.read` hook enriched from); it receives the enriched `records`. Whatever
	 * they add must be reproducible on the `cache.purge` side or it leaks. Returns
	 * the fingerprints plus any unautopurgeable scopeTo ones respond.ts leaves the
	 * read uncached for.
	 */
	async readFingerprints(inputs: ScopedCacheReadInputs): Promise<{
		fingerprints: ScopedCacheFingerprint[];
		unautopurgeable: ScopedCacheFingerprint[];
	}> {
		const {
			ast,
			plan,
			updatedQuery,
			filteredRecords,
			collector: scopedCacheCollector,
		} = inputs;

		let readPins: ScopedCacheCollectionPin[] = [];
		let unautopurgeablePins: ScopedCacheCollectionPin[] = [];

		if (!scopedCachePurgeEnabled()) {
			return { fingerprints: [], unautopurgeable: [] };
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
		// the bare collection pin. It guards the implicit primary-key axis too:
		// `readOne(1, { fields: ['*', 'children.*'] })` embeds rows whose own keys
		// the `<pk>._eq 1` filter never bounded.
		const rootPaths = new Set<string>();

		for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
			if (entry.collection === this.collection) {
				rootPaths.add(path);
			}
		}

		// Scope off the read's EFFECTIVE query case = the API filter AND the
		// permission cases, combined by the same `joinFilterWithCases` the SQL WHERE
		// uses (`{ _and: [filter, { _or: cases }] }`) so the pin can't diverge from
		// what the query actually returns. Both are already dynamic-var-resolved
		// before the service runs — the filter by sanitizeQuery, the cases by
		// fetchPermissions → processPermissions → parseFilter — so `$CURRENT_USER`
		// is the concrete user id, matching what a write's row yields. The pinner
		// unions an `_or`'s slices when every branch binds a pinnable field — same
		// field or different ones (the multi-policy case) — else falls back to bare.
		//
		// Kept as query cases as well as pins: the pins say which slices the read sits
		// in, and the query cases say which of them had to hold TOGETHER — an
		// `_and` of two fields is one query case of two pins, an `_or` of them is
		// two query cases.
		const rootScopedCacheQueryCases = rootPaths.size > 1
			? []
			: pinnedScopedCacheQueryCasesFromFilter(
				this.collection,
				this.flatFields,
				joinFilterWithCases(updatedQuery.filter, ast.cases),
				this.fieldTypes,
				this.relatedPks,
				this.paths,
				this.schema.collections[this.collection]?.primary,
			);

		const rootScopedCachePins =
			scopedCachePinsOfQueryCases(rootScopedCacheQueryCases);

		// A filter reaching a collection only through an operator on the
		// relational key itself (`{ rel: { _gt: X } }`) leaves it out of the
		// field map: `flattenFilter` stops at the `_`-prefixed key, so the path
		// never reaches the related context. The join is real either way, so the
		// collections come from the keying too — whether it named keys there or
		// not. Without this such a read carries NO pin for a table it joins,
		// and no write to that table can drop it.
		const fingerprintedCollections = new Set([
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
			: scopedCachePinsFromFilter(
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
		// - the path walks the chain to the slice's scope value backwards from the
		//   root, whose own pin then bounds every row nested that way (`courses` off
		//   a student read by key pins `course:student=<key>`);
		// - the read's own filter binds the path-prefixed slice for every row the root
		//   returns — the root pinner run over that one path, so an `_or` branch
		//   leaving it unbound leaves it unbound. The rows nested under such a path
		//   are in the slice only when the path is to-one, or when a parent-key pin
		//   already names them.
		//
		// A filter that keyed the collection somewhere ELSE cannot stand in: its keys
		// name rows reached by a hop this collection never takes, which is the
		// wrong-scope-value stale hit `cache-ancestor-slice-wrong-value` forbids.
		const slicePinsFor = (collection: string): ScopedCacheCollectionPin[] => {
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

				const queryCase = new Map<string, ScopedCacheCollectionPin>();
				let everyPathBound = true;

				// By field, not alias: a filter names fields, and so do the paths the
				// pinner walks it by.
				for (const path of paths) {
					const fields = plan.unaliased(path);
					const prefixed = `${fields.join('.')}.${slice.field}`;

					const relatedPks = relatedPk === undefined
						? {}
						: { [prefixed]: relatedPk };

					const pathPins = scopedCachePinsFromFilter(
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

					if (pathPins.length === 0) {
						everyPathBound = false;
						break;
					}

					for (const { value } of pathPins) {
						const sliced = { collection, field: slice.field, value, type };
						queryCase.set(scopedCachePinKey(sliced), sliced);
					}
				}

				// Past the ceiling the slice is dropped whole, never trimmed, like a
				// keyed filter's pin: a partial set leaves the rows it omits uncovered.
				if (
					everyPathBound
					&& queryCase.size > 0
					&& queryCase.size <= scopedCacheMaxPinsPerCollection()
				) {
					return [...queryCase.values()];
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
		const nodeBoundPinsFor = (collection: string): ScopedCacheCollectionPin[] => {
			const bounds = plan.nodeBounds.get(collection) ?? [];

			if (collection === this.collection || bounds.length === 0) {
				return [];
			}

			const related = relatedServiceOf(collection);
			const queryCase = new Map<string, ScopedCacheCollectionPin>();

			for (const nodeBound of bounds) {
				const nodePins = nodeBound === null
					? []
					: scopedCachePinsFromFilter(
						collection,
						related.flatFields,
						nodeBound,
						related.fieldTypes,
						related.relatedPks,
						related.paths,
						this.schema.collections[collection]?.primary,
					);

				if (nodePins.length === 0) {
					return [];
				}

				for (const pin of nodePins) {
					queryCase.set(scopedCachePinKey(pin), pin);
				}
			}

			return queryCase.size <= scopedCacheMaxPinsPerCollection()
				? [...queryCase.values()]
				: [];
		};

		// The nodes' slice names the nested rows and rides beside the pins a
		// filter named; short of one, the bare pin stands for both.
		const pushNodeBoundOrBare = (
			collection: string,
			pins: Map<string, ScopedCacheCollectionPin>,
		): void => {
			const nodePins = nodeBoundPinsFor(collection);

			if (nodePins.length === 0) {
				readPins.push({ collection });
				return;
			}

			for (const pin of nodePins) {
				pins.set(scopedCachePinKey(pin), pin);
			}

			readPins.push(...pins.values());
		};

		// A slice bounding the whole collection stands alone, ahead of the nodes'.
		const pushSliceOrBare = (
			collection: string,
			pins: Map<string, ScopedCacheCollectionPin>,
		): void => {
			const slicePins = slicePinsFor(collection);

			if (slicePins.length > 0) {
				readPins.push(...slicePins);
				return;
			}

			pushNodeBoundOrBare(collection, pins);
		};

		for (const collection of fingerprintedCollections) {
			if (collection === this.collection && rootScopedCachePins.length > 0) {
				readPins.push(...rootScopedCachePins);
				continue;
			}

			// A collection the read reached only through M2O hops is pinned by the
			// keys it nested, and one a filter reached by key is pinned by the keys
			// that filter named. Both may hold at once — a collection nested AND
			// filtered depends on the union, since the filter reaches rows the
			// response never carried and vice versa. Named by neither, it keeps the
			// bare pin that any write to it drops.
			//
			// Keyed by pin so a slice both sides name is carried once: the pin
			// index dedups on that key, but the header and its count do not.
			const pins = new Map<string, ScopedCacheCollectionPin>();

			for (const pin of [
				...m2oParentPins.get(collection) ?? [],
				...o2mChildPins.get(collection) ?? [],
				...keyedFilterPins.get(collection) ?? [],
			]) {
				pins.set(scopedCachePinKey(pin), pin);
			}

			// Conflicted reverse fks: a branch's M2O/keyed pin misses the rows nested
			// through the conflict, and so does a slice bound along the paths — the
			// conflict is two paths disagreeing on the key. Only the nodes' own
			// bounds name the rows whichever path nested them, and those name the
			// nested rows alone: depended on beyond them, it is bare.
			if (o2mConflicted.has(collection)) {
				if (beyondNestedRows.has(collection)) {
					readPins.push({ collection });
					continue;
				}

				pushNodeBoundOrBare(collection, pins);
				continue;
			}

			// Named by an M2O filter the near row's own column answers, reached
			// no other way: no write to it can change what this read returns,
			// so it needs no pin at all — not even a bare one. Nested, sorted
			// or grouped on, it is depended on for more than that key and
			// falls through to the pins below.
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
			// so it rides beside them, or the bare pin stands for both halves.
			if (beyondNestedRows.has(collection)) {
				const slicePins = slicePinsFor(collection);

				if (slicePins.length === 0) {
					readPins.push({ collection });
					continue;
				}

				for (const pin of slicePins) {
					pins.set(scopedCachePinKey(pin), pin);
				}

				readPins.push(...pins.values());
				continue;
			}

			// An ancestor the ownership injection alone nested carries nothing the
			// response returns: a chain reaching its rows pins them by key, and one
			// reaching none — a null hop, or a parent the node's case withheld —
			// leaves the response exactly as it was. What a filter or case elsewhere
			// keyed it on is the whole dependency, and no pin at all is the rest.
			const paths = pathsTo(collection);

			if (
				paths.length > 0 &&
				paths.every((path) => plan.injectedAncestorPaths.has(path))
			) {
				readPins.push(...pins.values());
				continue;
			}

			// A collection the response NESTED is depended on for the rows it
			// carried, which a parent-key pin names — the M2O ancestor's key, or
			// the O2M child's parent-fk key. Where BOTH declined — an A2O hop, an
			// O2M nested under another to-many, or no row to read a key from — the
			// filter's keys cover one half of the dependency and say nothing about
			// the other: a slice bounding the rows stands in, or the bare pin.
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

			readPins.push(...pins.values());
		}

		// Keys of what the pinners computed: sound by construction, so the audit below
		// examines only what a HOOK added — and a hook re-stating a computed pin is
		// not flagged for it.
		const computedPinKeys = new Set(readPins.map(scopedCachePinKey));

		readPins = (await emitter.emitFilter(
			'cache.scope',
			readPins,
			// `records` are the post-`items.read` rows, so a hook that enriched the
			// response from another collection can derive value-level pins off the
			// actual data it pulled.
			{ collection: this.collection, query: updatedQuery, records: filteredRecords },
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		)) as ScopedCacheCollectionPin[];

		// Fold in what an `items.read` hook declared through `scopedCache.scopeTo`.
		// Flattened into `readPins` so a declared axis crosses a dotted path and gets
		// audited exactly like a computed one, and sliced back out below by the sizes
		// recorded here: the crossing maps one-to-one, so a declared case's axes stay
		// at the offsets they went in at.
		const declaredCasesStart = readPins.length;

		const declaredCaseSizes = scopedCacheCollector.scopeQueryCases
			.map((queryCase) => queryCase.length);

		for (const queryCase of scopedCacheCollector.scopeQueryCases) {
			readPins.push(...queryCase);
		}

		// A hook naming a dotted slice (`course:unit.owner=O`) declares a dependency
		// the purge answers from the course side only: a unit moved under another
		// owner emits the unit's own slices and nothing of the course's. The read
		// side carries the crossed collections itself when it derives such a pin,
		// so a hook's gets the same: each collection the path crosses, under the
		// suffix slice it emits, or bare when it emits none. The pin's own type is
		// the terminal column's, which a hook rarely knows and the key needs.
		const seenPinKeys = new Set(readPins.map(scopedCachePinKey));
		const crossedPins: ScopedCacheCollectionPin[] = [];

		readPins = readPins.map((pin) => {
			if (
				pin.field === undefined ||
				!pin.field.includes('.') ||
				!slicesOf(pin.collection).some(({ field }) => field === pin.field)
			) {
				return pin;
			}

			const resolved = new ItemScopedCacheService(
				pin.collection,
				this.schema,
				this.knex,
				this.cache,
				this.accountability,
			).resolvePath(pin.field);

			if (resolved === null) {
				return pin;
			}

			const { segments, joins, terminalCollection, terminalField } = resolved;

			const type = pin.type
				?? this.schema.collections[terminalCollection]?.fields[terminalField]?.type;

			for (const [hop, join] of joins.entries()) {
				const crossed = join.relatedCollection;
				const suffix = segments.slice(hop + 1).join('.');

				const crossedPin: ScopedCacheCollectionPin = slicesOf(crossed)
					.some(({ field }) => field === suffix)
					? { collection: crossed, field: suffix, value: pin.value, type }
					: { collection: crossed };

				const crossedKey = scopedCachePinKey(crossedPin);

				if (!seenPinKeys.has(crossedKey)) {
					seenPinKeys.add(crossedKey);
					crossedPins.push(crossedPin);
				}
			}

			return type === undefined
				? pin
				: { ...pin, type };
		});

		readPins.push(...crossedPins);

		// The declared cases back out of `readPins`, each one whole. A hook naming
		// two axes means the rows hold BOTH, so they stay one case: filed apart, the
		// read would die on a write to either.
		const declaredQueryCases: ScopedCacheCollectionPin[][] = [];
		let declaredCaseOffset = declaredCasesStart;

		for (const size of declaredCaseSizes) {
			declaredQueryCases.push(
				readPins.slice(declaredCaseOffset, declaredCaseOffset + size),
			);

			declaredCaseOffset += size;
		}

		// A hook pin on a field its collection isn't scoped on can't be reproduced by
		// that collection's auto-purge — the read would go stale — unless the hook
		// marked it `manuallyPurged` (it reproduces the pin via its own purgeBy). List
		// them so respond.ts leaves the read uncached + names them in the anomaly.
		//
		// Both hook channels are audited: `scopeTo` through the collector, and
		// whatever `cache.scope` returned beyond the computed set. Auditing only the
		// collector let the same unpurgeable pin through the other door.
		const hookAddedPins = new Map<string, ScopedCacheCollectionPin>();

		for (const pin of readPins) {
			const pinKey = scopedCachePinKey(pin);

			if (!computedPinKeys.has(pinKey)) {
				hookAddedPins.set(pinKey, pin);
			}
		}

		// Whether a WRITE to this pin's collection reproduces it, and so drops any
		// entry filed under it.
		const reproducedByAWrite = (pin: ScopedCacheCollectionPin): boolean => {
			// The bare collection pin is what every write to it emits.
			if (pin.field === undefined) {
				return true;
			}

			const collectionSchema = this.schema.collections[pin.collection];

			// Every collection auto-purges its primary-key slice, so a hook pinning
			// a foreign row by its key needs no `manuallyPurged` claim.
			if (pin.field === collectionSchema?.primary) {
				return true;
			}

			// A declared flat scope field auto-purges, and so does every path the write
			// derives — a declared dotted one, or one composed off a flat field into
			// the ancestor's scopes — as long as it resolves to an M2O chain, which is
			// what `paths` already filters on. Anything else is never emitted however
			// the read arrived at it.
			if (pin.field.includes('.')) {
				return slicesOf(pin.collection).some(({ field }) => field === pin.field);
			}

			return collectionSchema?.scopedCacheFields?.includes(pin.field) === true;
		};

		// Per COLLECTION, not per pin: purging is a union, so an entry filed under
		// several pins of one collection goes as soon as a write reproduces any ONE
		// of them. A finer pin no write emits — an ownership-ancestor path a read
		// derived for itself, say — is then harmless freight beside a reproducible
		// sibling, and refusing to cache over it costs the response for nothing.
		//
		// Computed pins count as cover: what matters is that the ENTRY is reachable
		// from a write to that collection, not which channel put the pin there.
		const collectionsAWriteReaches = new Set(
			readPins.filter(reproducedByAWrite).map((pin) => pin.collection),
		);

		unautopurgeablePins = [...hookAddedPins.values()].filter((pin) => {
			return (
				reproducedByAWrite(pin) === false &&
				collectionsAWriteReaches.has(pin.collection) === false &&
				!scopedCacheCollector.manuallyPurgedKeys.has(scopedCachePinKey(pin))
			);
		});

		// The fields each collection is bound to, folded into its fingerprint at
		// fill time. Attached only for a collection whose pins are ALL computed: a
		// hook's pin comes from enrichment outside the AST, so which fields that
		// enrichment read is unknown, and a `fields` pair narrower than the truth
		// would keep an entry a write did change. A collection left out is bound to
		// all of its fields, which every write touches.
		const queryCaseFields = plan.fieldsByCollection();

		for (const pin of hookAddedPins.values()) {
			queryCaseFields.delete(pin.collection);
		}

		// The root's own filter is the one place several pins of a collection have
		// to hold together — everywhere else a pin stands alone, the way the sweep
		// reads it, so each is a query case of its own. Reading those as a
		// conjunction would leave a read cached that a write to any one of their
		// slices staled.
		const rootPinKeys = new Set(readPins.map(scopedCachePinKey));

		const rootQueryCases = rootScopedCacheQueryCases.filter((queryCase) => {
			return queryCase.every((pin) => rootPinKeys.has(scopedCachePinKey(pin)));
		});

		// The pins the kept root query cases already carry. A root query case
		// dropped just above leaves its pins here, each standing alone: losing the
		// AND over-purges, losing the pin would serve stale.
		const rootQueryCasePinKeys = new Set(
			rootQueryCases.flat().map(scopedCachePinKey),
		);

		// Same for the declared cases, except where a pinner computed the same axis:
		// that one stands alone on its own account, and dropping its standalone case
		// would leave it purgeable only as part of the hook's conjunction.
		const declaredCasePinKeys = new Set(
			declaredQueryCases.flat().map(scopedCachePinKey),
		);

		const standaloneQueryCases = readPins
			.filter((pin) => {
				const pinKey = scopedCachePinKey(pin);

				if (rootQueryCasePinKeys.has(pinKey)) {
					return false;
				}

				return declaredCasePinKeys.has(pinKey) === false
					|| computedPinKeys.has(pinKey);
			})
			.map((pin) => [pin]);

		// A query case takes the place of its earliest pin, so the fingerprints come
		// back in the order the read derived them: what it pinned itself, then what a
		// hook declared, then the collections crossing a dotted declaration reached.
		// Concatenating the three groups instead would read a hook's dependency
		// before the collection that was actually read.
		const pinOrder = new Map<string, number>();

		readPins.forEach((pin, index) => {
			const pinKey = scopedCachePinKey(pin);

			if (!pinOrder.has(pinKey)) {
				pinOrder.set(pinKey, index);
			}
		});

		const derivedAt = (queryCase: readonly ScopedCacheCollectionPin[]) => {
			return queryCase.reduce((earliest, pin) => {
				return Math.min(earliest, pinOrder.get(scopedCachePinKey(pin)) ?? Infinity);
			}, Infinity);
		};

		const orderedQueryCases = [
			...rootQueryCases,
			...declaredQueryCases,
			...standaloneQueryCases,
		].sort((left, right) => derivedAt(left) - derivedAt(right));

		const readFingerprints = scopedCacheFingerprintsByCollection(
			orderedQueryCases,
			queryCaseFields,
		);

		return {
			fingerprints: readFingerprints,
			// One pin each: a hook's pin stands alone, and what respond.ts needs off
			// it is the collection and field it names.
			unautopurgeable: unautopurgeablePins.map((pin) => {
				return scopedCacheFingerprintOf(pin.collection, [pin]);
			}),
		};
	}
}
