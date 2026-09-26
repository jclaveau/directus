import { useEnv } from '@directus/env';
import type {
	Filter,
	Item,
	SchemaOverview,
	ScopedCacheCollectionPin,
} from '@directus/types';
import { toArray } from '@directus/utils';
import {
	fieldMapFromAst,
} from '../permissions/modules/process-ast/lib/field-map-from-ast.js';
import {
	collectionsInFieldMap,
} from '../permissions/modules/process-ast/utils/collections-in-field-map.js';
import type {
	CollectionKey,
	FieldMap,
} from '../permissions/modules/process-ast/types.js';
import type { AST } from '../types/ast.js';
import { scopedCachePurgeEnabled } from './config.js';
import type { ScopedCacheOwnershipInjection } from './ownership-injection.js';
import {
	resolveScopedCacheM2oJoinChainFromPath,
	scopedCacheFilterKeyingByCollection,
	type ScopedCacheFilterKeying,
} from './paths.js';
import {
	scopedCachePinsFromKeyedFilters,
	scopedCachePinsFromM2oParents,
	scopedCachePinsFromO2mChildren,
	scopedCacheCollectionsBeyondNestedRows,
	scopedCacheFieldNamesByAliasedPath,
	scopedCacheNestedRowBindings,
	scopedCacheNodeBoundsByCollection,
	scopedCacheRowsAtPathEnd,
	scopedCacheUnaliasedPath,
	scopedCacheViewFieldsBeyondFieldMap,
	type ScopedCacheSortDeferral,
} from './read-pins.js';

const NO_FIELD_MAP: FieldMap = { read: new Map(), other: new Map() };

/**
 * What one read's fingerprints are assembled from, in the two halves the query
 * splits it into: what the AST alone decides, and what only the returned rows can
 * say.
 *
 * The split is why this is an object rather than one call. The pins that read rows
 * have to be filled from INSIDE `run-ast` — it is the only place the temporary
 * primary keys still exist — while everything else must be derived before it,
 * because `run-ast` returns early on an empty result and never reaches that
 * callback. Deriving the field map there too would bare every collection's
 * fingerprint on exactly the reads that returned nothing.
 */
export class ScopedCacheReadPlan {
	readonly fieldMap: FieldMap;
	// What the view depends on beyond the field map: the permission cases.
	readonly viewFieldMap: FieldMap;
	readonly filterKeying: Map<CollectionKey, ScopedCacheFilterKeying>;
	readonly keyedFilterPins: Map<CollectionKey, ScopedCacheCollectionPin[]>;
	readonly beyondNestedRows: Set<CollectionKey>;
	// The field behind each nested path, which the field map files under its alias.
	readonly fieldNames: ReadonlyMap<string, string>;
	// What a to-many node's sort reaches beyond the nested rows only when the
	// node's limit cut them, which `pinFromRows` settles.
	readonly sortDeferred = new Map<CollectionKey, ScopedCacheSortDeferral[]>();
	// The paths the ownership injection nested an ancestor at, minus the pk it
	// reads there: what the field map files that ancestor under.
	readonly injectedAncestorPaths: ReadonlySet<string>;
	// What bounds each node's rows, per collection — its filter and its cases.
	readonly nodeBounds: ReadonlyMap<CollectionKey, Array<Filter | null>>;

	m2oParentPins: Map<CollectionKey, ScopedCacheCollectionPin[]> = new Map();
	o2mChildPins: Map<CollectionKey, ScopedCacheCollectionPin[]> = new Map();
	readonly o2mConflicted = new Set<CollectionKey>();

	constructor(
		private collection: string,
		private schema: SchemaOverview,
		ast: AST,
		injections: ScopedCacheOwnershipInjection[],
	) {
		const enabled = scopedCachePurgeEnabled();

		this.fieldMap = enabled
			? fieldMapFromAst(ast, schema)
			: NO_FIELD_MAP;

		this.viewFieldMap = enabled
			? scopedCacheViewFieldsBeyondFieldMap(schema, ast)
			: NO_FIELD_MAP;

		this.fieldNames = enabled
			? scopedCacheFieldNamesByAliasedPath(ast)
			: new Map();

		// A collection this read's filters name by primary key depends on those
		// rows and no others, so it is pinned even when no row of it was nested.
		this.filterKeying = enabled
			? scopedCacheFilterKeyingByCollection(schema, ast)
			: new Map();

		this.keyedFilterPins = scopedCachePinsFromKeyedFilters(
			schema,
			collection,
			this.filterKeying,
		);

		this.nodeBounds = enabled
			? scopedCacheNodeBoundsByCollection(ast)
			: new Map();

		this.injectedAncestorPaths = new Set(
			injections.map(({ aliasedPath }) => {
				return aliasedPath
					.split('.')
					.slice(0, -1)
					.join('.');
			}),
		);

		// An injected ancestor is nested to pin by key, and the case gating its node
		// is decided on the row that carries the fk — a write to that row purges its
		// own slices — so a partial `whenCase` alone must not bare it. A filter, sort
		// or group reaching the ancestor still does: those depend on its rows beyond
		// the nested ones, whichever way it came to be nested.
		const injectedAncestors = new Set<CollectionKey>();

		for (const { path } of injections) {
			const joins = resolveScopedCacheM2oJoinChainFromPath(
				schema,
				collection,
				path.split('.').slice(0, -1),
			);

			const ancestor = joins?.[joins.length - 1]?.relatedCollection;

			if (ancestor) {
				injectedAncestors.add(ancestor);
			}
		}

		this.beyondNestedRows = enabled
			? scopedCacheCollectionsBeyondNestedRows(
				schema,
				ast,
				this.filterKeying,
				injectedAncestors,
				this.sortDeferred,
			)
			: new Set<string>();
	}

	/**
	 * Fill the pins that depend on what came back, from inside the read.
	 *
	 * `run-ast` injects every level's primary key for the nesting to work and strips
	 * it again before the response, so this is the one moment a parent row can be
	 * pinned BY that key. Not called for an empty result, which needs no pin: with
	 * no row nested, the bare fingerprint is already what each collection deserves.
	 */
	pinFromRows(rows: Item | Item[]): void {
		if (!scopedCachePurgeEnabled()) {
			return;
		}

		this.markSortsCutByALimit(toArray(rows));

		this.m2oParentPins = scopedCachePinsFromM2oParents(
			this.schema,
			this.collection,
			this.fieldMap,
			toArray(rows),
			this.fieldNames,
		);

		this.o2mChildPins = scopedCachePinsFromO2mChildren(
			this.schema,
			this.collection,
			this.fieldMap,
			toArray(rows),
			this.o2mConflicted,
			this.fieldNames,
		);
	}

	/**
	 * A to-many node sorted through to-one hops holds its rows whole when every
	 * parent nested fewer than the node's limit — `mergeWithParentItems` cuts each
	 * parent's set at that limit — and then the sort reorders only rows the key
	 * pins name. A parent at the limit may hide a row ahead of the cut, whose write
	 * is named by nothing: the sorted-through collection goes beyond the rows.
	 */
	private markSortsCutByALimit(rows: Item[]): void {
		const env = useEnv();

		for (const [collection, deferrals] of this.sortDeferred) {
			const whole = deferrals.every(({ nodePath, limit, paged }) => {
				const effectiveLimit = limit ?? Number(env['QUERY_LIMIT_DEFAULT']);

				if (paged) {
					return false;
				}

				if (effectiveLimit === -1) {
					return true;
				}

				const alias = nodePath[nodePath.length - 1]!;
				const prefix = nodePath.slice(0, -1);

				const parents = prefix.length === 0
					? rows
					: scopedCacheRowsAtPathEnd(rows, prefix);

				// A parent shown without the field nested nothing under it.
				return parents !== null && parents.every((parent) => {
					const nested = parent[alias];

					return !Array.isArray(nested) || nested.length < effectiveLimit;
				});
			});

			if (!whole) {
				this.beyondNestedRows.add(collection);
			}
		}
	}

	/** A field-map path by the fields behind its aliases, for a schema lookup. */
	unaliased(path: string): string[] {
		return scopedCacheUnaliasedPath(this.fieldNames, path.split('.'));
	}

	/**
	 * Every field each collection this read touched is bound to: what the read
	 * selected of it, sorted on and filtered by. A write touching none of them
	 * cannot change the response, whichever slice it lands in.
	 *
	 * Both halves of the field map, unioned: it splits by the permission each
	 * field needs — `read` holds what the filters and sorts name, `other` what the
	 * selection does — and a read depends on either the same way.
	 *
	 * A collection nested at several paths unions them, and the pins the caller
	 * adds afterwards ride on top: a pinned path is a field the read is bound to
	 * by definition, and the field map files it under the collection it belongs to
	 * rather than the one pinning it.
	 *
	 * The reverse fk of each to-many the read descends joins them: the field map
	 * says which columns of a nested row the read shows, and that one says which
	 * rows it shows at all. So do the fields the view map adds, which bound rows
	 * the same way a filter does.
	 */
	fieldsByCollection(): Map<CollectionKey, string[]> {
		const byCollection = new Map<CollectionKey, Set<string>>();

		const addFields = (
			collection: CollectionKey,
			fields: Iterable<string>,
		): void => {
			const knownFields = byCollection.get(collection) ?? new Set<string>();

			for (const field of fields) {
				knownFields.add(field);
			}

			byCollection.set(collection, knownFields);
		};

		for (const fieldMap of [this.fieldMap, this.viewFieldMap]) {
			const rowBindings = scopedCacheNestedRowBindings(
				this.schema,
				this.collection,
				fieldMap,
				this.fieldNames,
			);

			for (const [collection, fields] of rowBindings) {
				addFields(collection, fields);
			}

			for (const entries of [fieldMap.read, fieldMap.other]) {
				for (const { collection, fields } of entries.values()) {
					addFields(collection, fields);
				}
			}
		}

		return new Map([...byCollection].map(([collection, fields]) => {
			return [collection, [...fields].sort()];
		}));
	}

	/**
	 * The collections whose purge counters this read has to take: the ones its
	 * fingerprints will name. Both are known before the query — the field map is
	 * built off the AST and the keying off the filter — which is what lets the
	 * reading predate any purge racing the read.
	 */
	collectionsToGuard(): string[] {
		return [
			this.collection,
			...collectionsInFieldMap(this.fieldMap),
			...this.filterKeying.keys(),
		];
	}
}
