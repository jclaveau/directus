import {
	joinFilterWithCases,
} from '../database/run-ast/lib/apply-query/join-filter-with-cases.js';
import {
	extractFieldsFromQuery,
} from '../permissions/modules/process-ast/lib/extract-fields-from-query.js';
import type {
	CollectionKey,
	FieldMap,
	QueryPath,
} from '../permissions/modules/process-ast/types.js';
import type { AST } from '../types/ast.js';
import {
	getRelationInfo,
} from '../utils/get-relation-info.js';
import type {
	Filter,
	Item,
	Query,
	SchemaOverview,
	ScopedCachePath,
	ScopedCacheCollectionPin,
	Type,
} from '@directus/types';
import {
	ScopedCacheFilterKeying,
	m2oParentRowsAtPathEnd,
	resolveScopedCacheM2oJoinChainFromPath,
	scopedCacheFilterKeyingByCollection,
	scopedCacheKeyedFieldType,
} from './paths.js';
import {
	FieldTypesByField,
	canonicalScopedCacheValue,
	isPinnableScopeType,
	scopedCacheMaxPinsPerCollection,
	scopedCacheMaxQueryCases,
	scopedCachePinKey,
	scopedCachePinsFromRows,
} from './pins.js';

/**
 * Whether a keyed filter's keys become pins: a field to canonicalize against
 * that is not date-ish — the write canonicalizes those differently — and a key
 * set within the per-collection ceiling. Past it the pin is dropped rather than
 * trimmed, since a partial key set would leave the rows it omits covered by
 * nothing; either way the collection is then named by no pin, and depended on
 * beyond whatever rows the read nested.
 */
export function keyedFilterPinnable(
	schema: SchemaOverview,
	collection: CollectionKey,
	keying: ScopedCacheFilterKeying,
): keying is Extract<ScopedCacheFilterKeying, { kind: 'keyed' }> {
	if (keying.kind !== 'keyed') {
		return false;
	}

	const type = scopedCacheKeyedFieldType(schema, collection, keying.field);

	return type !== undefined
		&& isPinnableScopeType(type)
		&& keying.keys.size <= scopedCacheMaxPinsPerCollection();
}

/**
 * Scope a read's joined collections off the keys its filters named — the third
 * pinner beside `scopedCachePinsFromFilter`, which bounds the root off the
 * same filter, and `scopedCachePinsFromM2oParents`, which pins the nested
 * ones off the rows they carried.
 *
 * A collection reached ONLY through a filter is nested nowhere, so neither of those
 * two can say anything about it and it has always fallen through to the bare
 * fingerprint — one write anywhere in it dropping every read that merely joined it.
 * When the filter named its rows by key, the read depends on those rows and no
 * others, so `<collection>:<pk>=<key>` is exactly right and the write side already
 * emits it: `snapshotScopedCachePins` writes the key slice of every mutated row of
 * every collection, declared scope fields or not.
 *
 * The root is left out: its own filter bounds it through
 * `scopedCachePinsFromFilter`, under a self-reference guard this analysis
 * does not reproduce.
 */
export function scopedCachePinsFromKeyedFilters(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	keyingByCollection: Map<CollectionKey, ScopedCacheFilterKeying>,
): Map<CollectionKey, ScopedCacheCollectionPin[]> {
	const pinned = new Map<CollectionKey, ScopedCacheCollectionPin[]>();

	for (const [collection, keying] of keyingByCollection) {
		if (
			collection === rootCollection
			|| !keyedFilterPinnable(schema, collection, keying)
		) {
			continue;
		}

		const type = scopedCacheKeyedFieldType(schema, collection, keying.field)!;
		const pins: ScopedCacheCollectionPin[] = [];

		// Deduped on the canonical token, not the raw value, so `7` and `'7'`
		// collapse to the one slice the write side emits for that row.
		const seen = new Set<string>();

		for (const value of keying.keys) {
			const token = canonicalScopedCacheValue(value, type);

			if (seen.has(token)) {
				continue;
			}

			seen.add(token);
			pins.push({ collection, field: keying.field, value, type });
		}

		pinned.set(collection, pins);
	}

	return pinned;
}

/**
 * The collections the read NESTS — every one that has a node of its own in the
 * AST, whichever direction its relation runs.
 *
 * A nested collection is depended on for the rows it CARRIED, not only for the
 * ones a filter named: `mergeWithParentItems` writes what the nested query
 * returned, so an insert that joins it changes the response. Only
 * `scopedCachePinsFromM2oParents` can name that half, and it declines a
 * to-many or A2O hop. Naming them here lets the caller keep such a collection
 * bare even when its filter named keys — those keys cover the filter's half of
 * the dependency and say nothing about the nested one.
 */
export function scopedCacheNestedCollections(ast: AST): Set<CollectionKey> {
	const nested = new Set<CollectionKey>();

	const addNestedBy = (children: AST['children']): void => {
		for (const child of children) {
			if (child.type === 'field' || child.type === 'functionField') {
				continue;
			}

			if (child.type === 'a2o') {
				for (const name of child.names) {
					nested.add(name);
					addNestedBy(child.children[name] ?? []);
				}

				continue;
			}

			nested.add(child.name);
			addNestedBy(child.children);
		}
	};

	addNestedBy(ast.children);

	return nested;
}

/**
 * What bounds the rows each node of a collection returns — its own filter joined
 * with its cases, the WHERE its query runs under — one entry per node, `null` for
 * a node nothing bounds. Unlike the root's filter, which bounds nothing it
 * nested, a node's bound gates every row that node returns whichever way the
 * read reached it: a to-many under another to-many, a junction whose reverse fk
 * is no scope field, an M2O whose parent a case withholds. So a slice every
 * node's bound binds names every row the read carries of that collection, and a
 * write to any row entering or leaving that slice emits it.
 */
export function scopedCacheNodeBoundsByCollection(
	ast: AST,
): Map<CollectionKey, Array<Filter | null>> {
	const bounds = new Map<CollectionKey, Array<Filter | null>>();

	const addBound = (
		collection: CollectionKey,
		query: Query,
		cases: Filter[],
	): void => {
		const known = bounds.get(collection) ?? [];
		known.push(joinFilterWithCases(query.filter, cases));
		bounds.set(collection, known);
	};

	const addBoundsOf = (children: AST['children']): void => {
		for (const child of children) {
			if (child.type === 'field') {
				continue;
			}

			if (child.type === 'functionField') {
				addBound(child.relatedCollection, child.query, child.cases);
				continue;
			}

			if (child.type === 'a2o') {
				for (const name of child.names) {
					addBound(name, child.query[name] ?? {}, child.cases[name] ?? []);
					addBoundsOf(child.children[name] ?? []);
				}

				continue;
			}

			addBound(child.name, child.query, child.cases);
			addBoundsOf(child.children);
		}
	};

	addBoundsOf(ast.children);

	return bounds;
}

/**
 * The field each nested node's path stands for, keyed by the path the field map
 * and the rows carry — every hop under its alias (`alias[start]=days` files the
 * node under `start`) — so a pin resolves the relation behind an alias where the
 * schema knows only the field.
 */
export function scopedCacheFieldNamesByAliasedPath(ast: AST): Map<string, string> {
	const names = new Map<string, string>();

	const addNamesUnder = (children: AST['children'], prefix: string[]): void => {
		for (const child of children) {
			if (child.type === 'field' || child.type === 'functionField') {
				continue;
			}

			const path = [...prefix, child.fieldKey];

			if (child.type === 'a2o') {
				names.set(path.join('.'), child.relation.field);

				for (const name of child.names) {
					addNamesUnder(child.children[name] ?? [], path);
				}

				continue;
			}

			names.set(path.join('.'), child.type === 'o2m'
				? child.relation.meta?.one_field ?? child.fieldKey
				: child.relation.field);

			addNamesUnder(child.children, path);
		}
	};

	addNamesUnder(ast.children, []);

	return names;
}

/**
 * A field-map path with each alias replaced by the field it stands for: what
 * the schema's relations are looked up by, where the rows are still descended by
 * the aliased one.
 */
export function scopedCacheUnaliasedPath(
	fieldNames: ReadonlyMap<string, string>,
	segments: QueryPath,
): QueryPath {
	return segments.map((segment, at) => {
		return fieldNames.get(segments.slice(0, at + 1).join('.')) ?? segment;
	});
}

/**
 * The field each nested collection's rows are filed under the parent they were
 * read through: the reverse fk of the to-many they hang off.
 *
 * A read of `course` reaching `parts` holds the parts whose `course` names that
 * course, so a part rewritten onto another course leaves the read's result set —
 * a response that changed on a column the read never selected. The field map
 * records what the read SELECTED, filtered and sorted of each collection; this
 * records what decides which of its rows the read holds at all, and the purge's
 * field test has to count both.
 *
 * An M2O adds nothing: the fk lives on the near collection, where the field map
 * already records it, and the row it names is reached by its own immutable key.
 */
export function scopedCacheNestedRowBindings(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	fieldMap: FieldMap,
	fieldNames: ReadonlyMap<string, string>,
): Map<CollectionKey, Set<string>> {
	const boundFieldsByCollection = new Map<CollectionKey, Set<string>>();

	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		if (path === '') {
			continue;
		}

		const pathSegments = path.split('.');
		const unaliasedFields = scopedCacheUnaliasedPath(fieldNames, pathSegments);
		const aliasField = unaliasedFields[unaliasedFields.length - 1];

		if (aliasField === undefined) {
			continue;
		}

		const parentCollection = scopedCacheCollectionAtPathEnd(
			schema,
			rootCollection,
			unaliasedFields.slice(0, -1),
		);

		if (parentCollection === null) {
			continue;
		}

		const { relation, relationType } = getRelationInfo(
			schema.relations,
			parentCollection,
			aliasField,
		);

		if (
			relationType !== 'o2m'
			|| !relation
			|| relation.collection !== entry.collection
		) {
			continue;
		}

		const boundFields = boundFieldsByCollection.get(entry.collection)
			?? new Set<string>();

		boundFields.add(relation.field);
		boundFieldsByCollection.set(entry.collection, boundFields);
	}

	return boundFieldsByCollection;
}

/**
 * The purge side emits `<child>:<fk>=<value>` only when the fk is a declared
 * flat scope field; otherwise a child write emits just its pk slice, which an
 * INSERT of a new child never carries — so a pin on the parent's key would serve
 * stale. Pin only when the matching shallow pin is guaranteed on the write.
 */
function scopedCacheO2mChildPinnedByParentKey(
	schema: SchemaOverview,
	childCollection: CollectionKey,
	reverseFk: string,
): boolean {
	return (schema.collections[childCollection]?.scopedCacheFields ?? [])
		.filter((field) => !field.includes('.'))
		.includes(reverseFk);
}

/**
 * A to-many node's sort reaching a collection the rows must settle: the node's
 * aliased path, to descend the rows to what it nested, and the cut it applies.
 */
export type ScopedCacheSortDeferral = {
	nodePath: string[];
	// The node's own limit; null leaves the query default to decide.
	limit: number | null;
	// A page or offset drops rows ahead of the cut, so the node is never whole.
	paged: boolean;
};

/**
 * The collections a read depends on BEYOND the parent rows it nested, so keying the
 * pin on those rows would leave the entry alive through a write that changes
 * what the read returns.
 *
 * - A query sorts, groups or aggregates on a path into it, so rows the response
 *   never nested decide which rows come back, named by nothing.
 * - A query FILTERS on a path into it that names no key (`keyingByCollection`),
 *   same reason. A filter that does name keys is the one case that survives:
 *   the rows it reaches are exactly those keys, which
 *   `scopedCachePinsFromKeyedFilters` pins alongside whatever the response
 *   nested. Read off EVERY node's query, not only the root's: a nested node's
 *   filter withholds rows, and which ones it withholds is decided by every
 *   collection that filter reads — each of them one the response may have nested
 *   only in part. A to-many node is walked like any other; only what its own
 *   columns decide is covered, and only when its parent's key pins it.
 * - A nested node reads under only SOME of its parent's cases, so a parent it
 *   references can be withheld and arrive as a null slot — which
 *   `mergeWithParentItems` writes for a null foreign key too, leaving the two
 *   indistinguishable once merged. Reading under every case withholds nothing:
 *   a row is returned only when it matched one of them.
 */
export function scopedCacheCollectionsBeyondNestedRows(
	schema: SchemaOverview,
	ast: AST,
	// The same analysis `scopedCachePinsFromKeyedFilters` pins from, so
	// what this one exempts is exactly what that one covers. A caller holding it
	// already passes it rather than paying for a second walk of the AST.
	keyingByCollection = scopedCacheFilterKeyingByCollection(schema, ast),
	// Collections a partial `whenCase` alone must not mark: the read nested them to
	// pin by key. Only that gating is waived — a filter, sort or group reaching one
	// of them still depends on rows it never nested, and marks it all the same.
	exemptFromCaseGating: ReadonlySet<CollectionKey> = new Set(),
	// Populated with the collections a to-many node's sort alone reaches over
	// to-one hops, which only the rows can settle: nested whole, the sort
	// reorders rows the key pins name, and a write to any of them purges; cut by
	// the node's limit, a row beyond the cut decides the order and is named by
	// nothing. `ScopedCacheReadPlan.pinFromRows` marks the cut ones.
	sortDeferredOut?: Map<CollectionKey, ScopedCacheSortDeferral[]>,
): Set<CollectionKey> {
	const beyond = new Set<CollectionKey>();

	const addCollectionsQueriedBy = (
		collection: CollectionKey,
		query: Query,
		cases: Filter[],
		// A to-many node pinned by its parent's key: every write to a row of the
		// slice emits that pin, so what its own columns decide is covered and
		// only a path reaching OUT of it depends on rows the read never nested.
		ownColumnsCovered = false,
		// The aliased path of a to-many node, whose sort may be deferred to the rows.
		nodePath: string[] | null = null,
	): void => {
		const ownColumn = (
			[path, entry]: [string, { collection: CollectionKey }],
		): boolean => {
			return path === '' && entry.collection === collection;
		};

		const queryFieldMap: FieldMap = { read: new Map(), other: new Map() };

		extractFieldsFromQuery(collection, query, queryFieldMap, schema);

		const queriedEntries = [...queryFieldMap.read, ...queryFieldMap.other]
			.filter((entry) => !(ownColumnsCovered && ownColumn(entry)));

		// An exempt node's own cases decide, per nested row, whether that row
		// shows — its key pin already names those rows. Only a case reaching
		// OUT of it depends on rows the read never nested.
		const caseFieldMap: FieldMap = { read: new Map(), other: new Map() };

		extractFieldsFromQuery(
			collection,
			{ filter: joinFilterWithCases(null, cases) },
			caseFieldMap,
			schema,
		);

		const casedEntries = [...caseFieldMap.read, ...caseFieldMap.other]
			.filter((entry) => {
				return !(ownColumnsCovered && ownColumn(entry)) && !(
					entry[1].collection === collection
					&& exemptFromCaseGating.has(collection)
				);
			});

		// `extractPathsFromQuery` files filter and sort under one group, so sort and
		// group/aggregate paths are extracted on their own — apart from each other —
		// to tell, per collection, which of these query shapes reached it.
		const sortedFieldMap: FieldMap = { read: new Map(), other: new Map() };
		const groupedFieldMap: FieldMap = { read: new Map(), other: new Map() };

		// Assigned only when set: `exactOptionalPropertyTypes` separates an absent
		// key from one holding `undefined`, and `Query` declares these optional.
		const sortedQuery: Query = {};

		if (query.sort) {
			sortedQuery.sort = query.sort;
		}

		extractFieldsFromQuery(collection, sortedQuery, sortedFieldMap, schema);

		const groupedQuery: Query = {};

		if (query.group) {
			groupedQuery.group = query.group;
		}

		if (query.aggregate) {
			groupedQuery.aggregate = query.aggregate;
		}

		extractFieldsFromQuery(collection, groupedQuery, groupedFieldMap, schema);

		const sorted = new Set<CollectionKey>();

		for (const [, entry] of [...sortedFieldMap.read, ...sortedFieldMap.other]) {
			sorted.add(entry.collection);
		}

		// What the node's filter alone reaches, to tell a collection its sort
		// alone reaches — reorder only — from one a filter withholds rows by.
		const filteredFieldMap: FieldMap = { read: new Map(), other: new Map() };
		const filteredQuery: Query = {};

		if (query.filter) {
			filteredQuery.filter = query.filter;
		}

		if (query.search) {
			filteredQuery.search = query.search;
		}

		extractFieldsFromQuery(collection, filteredQuery, filteredFieldMap, schema);

		const filtered = new Set<CollectionKey>();

		for (const [, entry] of [...filteredFieldMap.read, ...filteredFieldMap.other]) {
			filtered.add(entry.collection);
		}

		const groupedOrAggregated = new Set<CollectionKey>();

		for (const [, entry] of [
			...groupedFieldMap.read,
			...groupedFieldMap.other,
		]) {
			groupedOrAggregated.add(entry.collection);
		}

		for (const entry of [...queriedEntries, ...casedEntries]) {
			const queried = entry[1].collection;
			const keying = keyingByCollection.get(queried);
			const kind = keying?.kind;

			const namedByFilter = kind === 'independent'
				|| (keying !== undefined && keyedFilterPinnable(schema, queried, keying));

			// A sort only reorders a collection's rows; a per-slice pin catches the
			// reorder because a write to the collection emits its slice. So a sort
			// costs the bare fingerprint only where NO covering slice exists. A group or
			// aggregate collapses rows across slices and always crosses.
			// `independent` is skipped in readPins, so its scope fields pin nothing.
			const hasCoveringSlice =
				(schema.collections[queried]?.scopedCacheFields ?? []).length > 0
				&& kind !== 'independent';

			const crossesMembership =
				groupedOrAggregated.has(queried) ||
				(sorted.has(queried) && !hasCoveringSlice);

			if (namedByFilter && !crossesMembership) {
				continue;
			}

			// Reached by the node's sort and nothing else, over to-one hops from
			// the nested rows: the rows decide whether the node holds them whole.
			const sortAlone =
				nodePath !== null
				&& sortDeferredOut !== undefined
				&& sorted.has(queried)
				&& !filtered.has(queried)
				&& !groupedOrAggregated.has(queried)
				&& !casedEntries.some(([, cased]) => cased.collection === queried)
				&& resolveScopedCacheM2oJoinChainFromPath(
					schema,
					collection,
					entry[0].split('.'),
				) !== null;

			if (sortAlone) {
				const deferrals = sortDeferredOut.get(queried) ?? [];

				deferrals.push({
					nodePath,
					limit: query.limit ?? null,
					paged: (query.page ?? 0) > 1 || (query.offset ?? 0) > 0,
				});

				sortDeferredOut.set(queried, deferrals);
				continue;
			}

			beyond.add(queried);
		}
	};

	addCollectionsQueriedBy(ast.name, ast.query, ast.cases);

	// `whenCase` indexes the cases of the collection the node hangs OFF, which
	// `injectCases` fills from the parent's `caseMap` — not the related
	// collection's cases it stores beside them. Naming every one leaves nothing to
	// withhold: a row comes back only when it matched some case, and the node
	// reads under all of them. An empty list names nothing and cannot cover.
	const readsUnderEveryCase = (whenCase: number[], cases: Filter[]): boolean => {
		return cases.length > 0
			&& cases.every((_, index) => whenCase.includes(index));
	};

	const addWhatNestedNodesDependOn = (
		children: AST['children'],
		cases: Filter[],
		prefix: string[],
	): void => {
		for (const child of children) {
			if (child.type === 'field') {
				continue;
			}

			if (child.type === 'functionField') {
				addCollectionsQueriedBy(child.relatedCollection, child.query, child.cases);
				continue;
			}

			const path = [...prefix, child.fieldKey];

			if (child.type === 'a2o') {
				for (const name of child.names) {
					const namedCases = child.cases[name] ?? [];

					addCollectionsQueriedBy(name, child.query[name] ?? {}, namedCases);
					addWhatNestedNodesDependOn(child.children[name] ?? [], namedCases, path);
				}

				continue;
			}

			if (child.type === 'o2m') {
				addCollectionsQueriedBy(
					child.name,
					child.query,
					child.cases,
					scopedCacheO2mChildPinnedByParentKey(
						schema,
						child.name,
						child.relation.field,
					),
					path,
				);

				addWhatNestedNodesDependOn(child.children, child.cases, path);
				continue;
			}

			addCollectionsQueriedBy(
				child.relation.related_collection!,
				child.query,
				child.cases,
			);

			// Not a filter, so nothing above reads it: the case decides per ROW
			// whether this parent is shown at all.
			if (
				child.whenCase.length > 0
				&& !readsUnderEveryCase(child.whenCase, cases)
				&& !exemptFromCaseGating.has(child.relation.related_collection!)
			) {
				beyond.add(child.relation.related_collection!);
			}

			addWhatNestedNodesDependOn(child.children, child.cases, path);
		}
	};

	addWhatNestedNodesDependOn(ast.children, ast.cases, []);

	return beyond;
}

/**
 * Scope a read's NON-root collections off the parent rows it nested — the other
 * half of `scopedCachePinsFromFilter`, which bounds the root.
 *
 * Per touched collection, the first of these that holds:
 *
 * - `<pk>=<key>` per parent row — M2O hops only. An INSERT lands a key this response
 * cannot have nested, so the pin cannot go stale. - its own declared scope slices —
 * past the ceiling. One pin per distinct value. - the bare collection fingerprint —
 * a to-many hop or A2O anywhere on one of its paths, no parent row nested, or a row
 * missing its key.
 *
 * Returns the pinned collections only; the bare fingerprint is the caller's default,
 * so a collection absent here keeps the fingerprint it has always carried. Each
 * fallback over-purges, none serves stale. The pins name the NESTED rows and
 * nothing more: a read depending on a collection beyond them
 * (`scopedCacheCollectionsBeyondNestedRows`) owes that half to the caller.
 */
export function scopedCachePinsFromM2oParents(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	fieldMap: FieldMap,
	records: Item[],
	// What each aliased path is the field of; the rows keep the alias.
	fieldNames: ReadonlyMap<string, string> = new Map(),
): Map<CollectionKey, ScopedCacheCollectionPin[]> {
	// A set per collection: the field map carries the same path under both its read
	// and its other group, and walking one path twice would double every row.
	const pathsByCollection = new Map<CollectionKey, Set<QueryPath[number]>>();

	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		// The root is bounded by its own filter, not by what it nested, and a
		// self-referential relation reaches it again at a path that bounds nothing.
		if (entry.collection === rootCollection) {
			continue;
		}

		const paths = pathsByCollection.get(entry.collection)
			?? new Set<QueryPath[number]>();

		paths.add(path);
		pathsByCollection.set(entry.collection, paths);
	}

	const pinned = new Map<CollectionKey, ScopedCacheCollectionPin[]>();

	for (const [collection, paths] of pathsByCollection) {
		const primaryKeyField = schema.collections[collection]?.primary;
		const collectionFields = schema.collections[collection]?.fields ?? {};

		if (primaryKeyField === undefined) {
			continue;
		}

		const rows: Item[] = [];
		let pinnableFromNestedRows = true;

		for (const path of paths) {
			const segments = path.split('.');
			const fields = scopedCacheUnaliasedPath(fieldNames, segments);
			const lastField = fields[fields.length - 1];

			// A pure-M2O path resolves directly. A path that crosses a to-many still
			// pins its end collection when the LAST hop is M2O — an M2O parent reached
			// through an o2m child (a junction) — by descending the arrays for the
			// surfaced rows. A last hop that is O2M is the o2m child pinner's, left bare.
			let parentRows: Item[] | null;

			if (resolveScopedCacheM2oJoinChainFromPath(
				schema,
				rootCollection,
				fields,
			) !== null) {
				parentRows = m2oParentRowsAtPathEnd(records, segments);
			}
			else {
				const parentCollection = scopedCacheCollectionAtPathEnd(
					schema,
					rootCollection,
					fields.slice(0, -1),
				);

				if (
					parentCollection === null ||
					lastField === undefined ||
					getRelationInfo(
						schema.relations,
						parentCollection,
						lastField,
					).relationType !== 'm2o'
				) {
					pinnableFromNestedRows = false;
					break;
				}

				parentRows = scopedCacheRowsAtPathEnd(records, segments);
			}

			if (parentRows === null) {
				pinnableFromNestedRows = false;
				break;
			}

			// Pushed one by one: a spread passes an argument per row, and a read
			// with no limit blows the call-stack cap somewhere past 100k of them.
			for (const parentRow of parentRows) {
				rows.push(parentRow);
			}
		}

		if (pinnableFromNestedRows === false) {
			continue;
		}

		// Reached, but carrying nothing to pin — a filter-only relation the response
		// never nested, or rows whose parent link is empty throughout.
		if (rows.length === 0) {
			continue;
		}

		// `coarse`, not `skip`: one row without its key must take the whole
		// collection down to the bare fingerprint. Skipping it would pin the rows
		// that DID carry a key and leave that one covered by nothing — stale, where
		// the bare fingerprint only over-purges.
		const keyPins = scopedCachePinsFromRows(
			collection,
			[primaryKeyField],
			rows,
			'coarse',
			{ [primaryKeyField]: collectionFields[primaryKeyField]?.type },
		);

		if (
			keyPins !== null &&
			keyPins.length <= scopedCacheMaxPinsPerCollection()
		) {
			pinned.set(collection, keyPins);
			continue;
		}

		// Only the direct columns: a dotted scope field names a column on another
		// collection, which the parent row does not carry.
		const sliceFields = (schema.collections[collection]?.scopedCacheFields ?? [])
			.filter((field) => !field.includes('.'));

		if (sliceFields.length === 0) {
			continue;
		}

		const sliceFieldTypes: FieldTypesByField = {};

		for (const field of sliceFields) {
			sliceFieldTypes[field] = collectionFields[field]?.type;
		}

		const slicePins = scopedCachePinsFromRows(
			collection,
			sliceFields,
			rows,
			'coarse',
			sliceFieldTypes,
		);

		if (
			slicePins !== null &&
			slicePins.length <= scopedCacheMaxPinsPerCollection()
		) {
			pinned.set(collection, slicePins);
		}
	}

	return pinned;
}

/**
 * The collection a relational path ends at, walking an M2O into its one related row
 * and an O2M into its children alike. Null on an A2O or unknown field, whose target
 * is not a single collection.
 */
function scopedCacheCollectionAtPathEnd(
	schema: SchemaOverview,
	collection: CollectionKey,
	segments: QueryPath,
): CollectionKey | null {
	let current = collection;

	for (const field of segments) {
		const { relation, relationType } = getRelationInfo(
			schema.relations,
			current,
			field,
		);

		let related: string | null | undefined = null;

		if (relationType === 'm2o') {
			related = relation?.related_collection;
		}
		else if (relationType === 'o2m') {
			related = relation?.collection;
		}

		if (!related) {
			return null;
		}

		current = related;
	}

	return current;
}

/**
 * Every row a relational path reaches, in document order, descending an M2O into its
 * one related row and an O2M into each of its children — so a deep O2M prefix still
 * yields the parent rows the pin keys on. Null when the response cannot answer the
 * path: a segment it never carried, or a scalar where a relation was expected.
 */
export function scopedCacheRowsAtPathEnd(
	records: Item[],
	segments: QueryPath,
): Item[] | null {
	let current = records;

	for (const segment of segments) {
		const next: Item[] = [];

		for (const row of current) {
			const value = row[segment];

			if (value === null || value === undefined) {
				continue;
			}

			if (Array.isArray(value)) {
				for (const element of value) {
					if (element !== null && typeof element === 'object') {
						next.push(element);
					}
				}
			}
			else if (typeof value === 'object') {
				next.push(value);
			}
			else {
				return null;
			}
		}

		current = next;
	}

	return current;
}

/**
 * The to-many twin of `scopedCachePinsFromM2oParents`. A read that EMBEDS a
 * to-many child set depends on every child WHERE `child.<fk> = parent.pk`, so it
 * pins each such collection by that reverse fk = the parent's key — one pin per
 * surfaced parent row. A write to a child of another parent no longer evicts it.
 *
 * The purge side already emits the identical `<child>:<fk>=<value>` shallow pin
 * from the mutated row's own fk column (the flat scope-field branch of
 * `snapshotScopedCachePins`), so read and write agree by construction — no field
 * injection, no response strip, no deep chain. The read never needs the child's fk
 * value: it equals the parent pk by definition of the O2M join.
 *
 * Pins where the parent rows are in reach AND the write will match: the last hop is
 * O2M whose reverse fk is a flat scope field (else the purge emits no match), and
 * the prefix descends to parent rows carrying their key — through a to-many too,
 * so a deep pivot under an all-O2M chain slices. Past the per-collection pin ceiling
 * it falls back to the bare fingerprint; an A2O anywhere on the path keeps it bare.
 *
 * Every path to the child must pin, or none does: the rows another path nested —
 * the same collection reached through an M2O, or through an o2m whose reverse fk
 * is not scoped — lie outside every parent-key slice, and the M2O pinner declines
 * a collection it shares with a to-many hop. Such a collection is reported through
 * `conflictedOut`, since only the bare fingerprint covers it.
 */
export function scopedCachePinsFromO2mChildren(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	fieldMap: FieldMap,
	records: Item[],
	// Populated with the collections some nested path leaves unpinned — two
	// disagreeing reverse fks, or a path that is no scoped o2m at all — the case a
	// single ownership slice can't cover, so the caller must leave bare.
	conflictedOut?: Set<CollectionKey>,
	// What each aliased path is the field of; the rows keep the alias.
	fieldNames: ReadonlyMap<string, string> = new Map(),
): Map<CollectionKey, ScopedCacheCollectionPin[]> {
	// One entry per child collection: it can be nested under several paths, and
	// every parent key it is keyed by must be gathered before the cap so no path
	// masks another. `conflicted` drops a collection reached by two reverse fks —
	// mixing their keys under one field would pin the wrong slice.
	const keyingByChild = new Map<CollectionKey, {
		reverseFk: string;
		fieldType: Type | undefined;
		rows: Item[];
		conflicted: boolean;
		// The prefixes the o2m hangs off, so an m2o path into the child can be
		// checked against them once every path is in.
		prefixes: Set<string>;
	}>();

	const reachedUnpinnably = new Set<CollectionKey>();

	// The child reached through an m2o, kept aside: such a row lies in the
	// parent-key slice when the o2m hangs off that very row's own fk — the path
	// walked on by the reverse fk is where the o2m's parents were nested — and
	// outside every slice when it does not.
	const reachedByM2o = new Map<CollectionKey, Set<string>>();

	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		const childCollection = entry.collection;

		if (childCollection === rootCollection) {
			continue;
		}

		const segments = path.split('.');
		const fields = scopedCacheUnaliasedPath(fieldNames, segments);
		const aliasField = fields[fields.length - 1];

		if (aliasField === undefined) {
			continue;
		}

		const prefix = segments.slice(0, -1);

		// The collection the to-many hangs off: the root at top level, else the tail
		// of the prefix — through a to-many hop too, so a deep pivot resolves.
		let parentCollection = rootCollection;

		if (prefix.length > 0) {
			const resolved = scopedCacheCollectionAtPathEnd(
				schema,
				rootCollection,
				fields.slice(0, -1),
			);

			if (resolved === null) {
				reachedUnpinnably.add(childCollection);
				continue;
			}

			parentCollection = resolved;
		}

		const { relation, relationType } = getRelationInfo(
			schema.relations,
			parentCollection,
			aliasField,
		);

		if (relationType === 'm2o' && relation?.related_collection === childCollection) {
			const paths = reachedByM2o.get(childCollection) ?? new Set<string>();
			paths.add(path);
			reachedByM2o.set(childCollection, paths);
			continue;
		}

		if (
			relationType !== 'o2m' ||
			!relation ||
			relation.collection !== childCollection
		) {
			reachedUnpinnably.add(childCollection);
			continue;
		}

		const reverseFk = relation.field;
		const parentPkField = schema.collections[parentCollection]?.primary;

		if (parentPkField === undefined) {
			reachedUnpinnably.add(childCollection);
			continue;
		}

		if (!scopedCacheO2mChildPinnedByParentKey(schema, childCollection, reverseFk)) {
			reachedUnpinnably.add(childCollection);
			continue;
		}

		const parentRows = prefix.length === 0
			? records
			: scopedCacheRowsAtPathEnd(records, prefix);

		if (parentRows === null) {
			reachedUnpinnably.add(childCollection);
			continue;
		}

		// The child's own fk column type, so the pinned value canonicalizes the way
		// the purge side does the mutated row's fk — or the two pin keys diverge.
		const fieldType = schema.collections[childCollection]?.fields[reverseFk]?.type;

		const keying = keyingByChild.get(childCollection) ?? {
			reverseFk,
			fieldType,
			rows: [],
			conflicted: false,
			prefixes: new Set<string>(),
		};

		if (keying.reverseFk !== reverseFk) {
			keying.conflicted = true;
			keyingByChild.set(childCollection, keying);
			continue;
		}

		keying.prefixes.add(fields.slice(0, -1).join('.'));

		for (const parentRow of parentRows) {
			// Carry the parent key under the child's fk name so `scopedCachePinsFromRows`
			// reads it as that field's value. A surfaced parent without its key leaves
			// part of the set unpinned; one such row takes the whole collection to the
			// bare fingerprint (the `coarse` mode returns null on a missing field).
			keying.rows.push(
				parentPkField in parentRow
					? { [reverseFk]: parentRow[parentPkField] }
					: {},
			);
		}

		keyingByChild.set(childCollection, keying);
	}

	for (const [collection, paths] of reachedByM2o) {
		const keying = keyingByChild.get(collection);

		// A row reached with its fk empty hangs no o2m and lies in no slice.
		const covered = keying !== undefined && [...paths].every((path) => {
			const segments = path.split('.');
			const rows = scopedCacheRowsAtPathEnd(records, segments);
			const fields = scopedCacheUnaliasedPath(fieldNames, segments);

			return keying.prefixes.has(`${fields.join('.')}.${keying.reverseFk}`)
				&& rows !== null
				&& rows.every((row) => row[keying.reverseFk] != null);
		});

		if (!covered) {
			reachedUnpinnably.add(collection);
		}
	}

	const pinned = new Map<CollectionKey, ScopedCacheCollectionPin[]>();

	for (const [collection, keying] of keyingByChild) {
		const conflicted = keying.conflicted || reachedUnpinnably.has(collection);

		if (conflicted && conflictedOut) {
			conflictedOut.add(collection);
		}

		if (conflicted || keying.rows.length === 0) {
			continue;
		}

		const keyPins = scopedCachePinsFromRows(
			collection,
			[keying.reverseFk],
			keying.rows,
			'coarse',
			{ [keying.reverseFk]: keying.fieldType },
		);

		if (
			keyPins !== null &&
			keyPins.length <= scopedCacheMaxPinsPerCollection()
		) {
			pinned.set(collection, keyPins);
		}
	}

	return pinned;
}

// The filter node one segment down — through a `_some` when the hop is a to-many
// written with its quantifier, which joins the same one row the bare key does.
function descendFilterSegment(
	node: Record<string, unknown>,
	segment: string,
): unknown {
	if (segment in node) {
		return node[segment];
	}

	const some = node['_some'];

	return some !== null && typeof some === 'object'
		? (some as Record<string, unknown>)[segment]
		: undefined;
}

/**
 * Scope a read's root pins off a filter — the read side. A read is soundly
 * scoped to a value slice only when the filter *bounds* it to that value: a future
 * insert with a new scope value must be excluded by the same filter, or the read
 * would silently miss it. Pins come from `_eq`/`_in` on a scoped field (flat or
 * relational `{ fk: { <pk>: … } }`). Each node reports its pins plus whether it
 * *covers* every row it matches (i.e. binds a pinnable field on that row), combined
 * by operator: - `_and`/root union a field's values and are covered if ANY conjunct
 * is (a row satisfies every conjunct); the value union over-approximates the
 * intersection — over-purges, never stale. - `_or` is sound only when EVERY branch
 * is covered (else a row matching an uncovered branch carries no pin → stale);
 * then its pins are the union across branches — a matching row satisfies one
 * branch, whose covering pin lies in that union. This holds across *different*
 * fields too: `{ _or: [{ owner }, { dept }] }` pins both, purged if a write touches
 * either. This is what scopes a permission-isolated read: the caller passes
 * `joinFilterWithCases(query.filter, ast.cases)`, whose `{ _or: cases }` is unioned
 * by that rule (one case = its own values; a case that leaves ALL fields unbound →
 * bare). No pinned field → `[]`, and the caller falls back to the bare collection
 * fingerprint. `fieldTypes` canonicalizes a value the way the purge side does and
 * skips date-ish types (not pin-safe, `PIN_UNSAFE_SCOPE_TYPES`).
 *
 * `primaryKeyField` joins the declared fields implicitly and always, no config: -
 * Every row has a primary key, so this axis always resolves. - An inserted row
 * carries a different key, so it can never join a `<pk>._eq` or `<pk>._in` read's
 * result set — the insert-blindness that bars a value slice elsewhere cannot bite
 * here. - The purge side emits the same pin from the keys it already holds, so read
 * and write agree without either paying a query for it.
 */
export function pinnedScopedCacheQueryCasesFromFilter(
	collection: string,
	fields: string[],
	filter: Filter | null | undefined,
	fieldTypes: FieldTypesByField = {},
	relatedPrimaryKeys: Record<string, string> = {},
	scopedCachePaths: ScopedCachePath[] = [],
	primaryKeyField?: string,
): ScopedCacheCollectionPin[][] {
	const fieldSet = new Set(fields);

	if (primaryKeyField !== undefined) {
		fieldSet.add(primaryKeyField);
	}

	if (!filter || (fieldSet.size === 0 && scopedCachePaths.length === 0)) {
		return [];
	}

	// A relational-path scope field (`enrollment.student.user`) is pinned by walking
	// the nested filter down its segments to the terminal `_eq`/`_in` (`evalPathsAt`).
	// Grouped by head segment so a filter key can look up the paths it starts.
	const pathsByHead = new Map<string, ScopedCachePath[]>();

	for (const path of scopedCachePaths) {
		const head = path.segments[0];

		if (head === undefined) {
			continue;
		}

		const group = pathsByHead.get(head) ?? [];
		group.push(path);
		pathsByHead.set(head, group);
	}

	// A node's pinned values plus whether it *covers* every row it matches — a leaf
	// that bound a pinnable field covers its rows; an uncovered node's rows carry no
	// pin (would be stale).
	//
	// `queryCases` is the same pinning read as a disjunction: one entry per way a
	// row can match the node, each holding every field that way binds.
	// `pinnedValues` flattens it, losing which values had to hold together — which
	// is all a flat sweep can use, and not enough for a composite fingerprint.
	type Eval = {
		pinnedValues: Map<string, Set<unknown>>;
		queryCases: Map<string, Set<unknown>>[];
		covered: boolean;
	};

	// Union `source`'s values into `target` in place (shared by AND and OR).
	function unionPins(
		target: Map<string, Set<unknown>>,
		source: Map<string, Set<unknown>>,
	): void {
		for (const [field, values] of source) {
			const seen = target.get(field) ?? new Set<unknown>();

			for (const value of values) {
				seen.add(value);
			}

			target.set(field, seen);
		}
	}

	/** A node's own pinned fields as the one way its rows match it. */
	function queryCasesOf(
		pinnedValues: Map<string, Set<unknown>>,
	): Map<string, Set<unknown>>[] {
		return pinnedValues.size === 0
			? []
			: [pinnedValues];
	}

	// AND of two disjunctions: every pairing of one way to match each side, each
	// holding both sides' fields. A side pinning nothing constrains nothing, so the
	// other side stands alone.
	//
	// Past the cap the product is dropped for the two sides' ways side by side —
	// each still covers the rows it named, and a row matching both is matched twice
	// rather than once. That widens what a purge reaches, never narrows it.
	function andQueryCases(
		left: Map<string, Set<unknown>>[],
		right: Map<string, Set<unknown>>[],
	): Map<string, Set<unknown>>[] {
		if (left.length === 0 || right.length === 0) {
			return left.length === 0
				? right
				: left;
		}

		if (left.length * right.length > scopedCacheMaxQueryCases()) {
			return [...left, ...right];
		}

		const mergedQueryCases: Map<string, Set<unknown>>[] = [];

		for (const one of left) {
			for (const other of right) {
				const bothPairs = new Map<string, Set<unknown>>();
				unionPins(bothPairs, one);
				unionPins(bothPairs, other);
				mergedQueryCases.push(bothPairs);
			}
		}

		return mergedQueryCases;
	}

	// A single `_eq`/`_in` (or relational `{ fk: { <pk>: { _eq | _in } } }`) leaf →
	// its value set. Covered iff it bound a pinnable scope field; a
	// non-scope/date/non-`_eq`/`_in` key covers nothing.
	function evalLeaf(field: string, value: unknown): Eval {
		const pinnedValues = new Map<string, Set<unknown>>();

		if (
			!fieldSet.has(field) ||
			!isPinnableScopeType(fieldTypes[field]) ||
			value === null ||
			typeof value !== 'object'
		) {
			return { pinnedValues, queryCases: [], covered: false };
		}

		const ops = value as Record<string, unknown>;

		if ('_eq' in ops) {
			pinnedValues.set(field, new Set([ops['_eq']]));
		}
		else if ('_in' in ops && Array.isArray(ops['_in'])) {
			pinnedValues.set(field, new Set(ops['_in']));
		}
		else {
			// Relational: a filter on the related PK bounds the fk to the value the write
			// side stores. Only the related PK is sound — a non-PK attribute wouldn't
			// determine it.
			const relatedPrimaryKey = relatedPrimaryKeys[field];

			const inner = relatedPrimaryKey === undefined
				? undefined
				: ops[relatedPrimaryKey];

			if (inner !== null && typeof inner === 'object') {
				const innerOps = inner as Record<string, unknown>;

				if ('_eq' in innerOps) {
					pinnedValues.set(field, new Set([innerOps['_eq']]));
				}
				else if ('_in' in innerOps && Array.isArray(innerOps['_in'])) {
					pinnedValues.set(field, new Set(innerOps['_in']));
				}
			}
		}

		return {
			pinnedValues,
			queryCases: queryCasesOf(pinnedValues),
			covered: pinnedValues.size > 0,
		};
	}

	// Follow a declared path's segments down the nested filter to the terminal ops
	// and read its `_eq`/`_in` — or `{ <terminalRelatedPk>: { _eq | _in } }` when the
	// terminal is an M2O written PK-unwrapped. Returns the value set, or null when the
	// filter doesn't bind the full path to a concrete value.
	function pathTerminalValues(
		segments: string[],
		value: unknown,
		terminalRelatedPk: string | undefined,
	): Set<unknown> | null {
		let node: unknown = value;

		for (let i = 1; i < segments.length; i++) {
			if (node === null || typeof node !== 'object') {
				return null;
			}

			node = descendFilterSegment(node as Record<string, unknown>, segments[i]!);
		}

		if (node === null || typeof node !== 'object') {
			return null;
		}

		const ops = node as Record<string, unknown>;

		if ('_eq' in ops) {
			return new Set([ops['_eq']]);
		}

		if ('_in' in ops && Array.isArray(ops['_in'])) {
			return new Set(ops['_in']);
		}

		const inner = terminalRelatedPk === undefined
			? undefined
			: ops[terminalRelatedPk];

		if (inner !== null && typeof inner === 'object') {
			const innerOps = inner as Record<string, unknown>;

			if ('_eq' in innerOps) {
				return new Set([innerOps['_eq']]);
			}

			if ('_in' in innerOps && Array.isArray(innerOps['_in'])) {
				return new Set(innerOps['_in']);
			}
		}

		return null;
	}

	// Every declared path whose head segment is this filter key → its terminal values.
	// Covered iff a path bound (terminal `_eq`/`_in` present, type pin-safe).
	function evalPathsAt(headField: string, value: unknown): Eval {
		const pinnedValues = new Map<string, Set<unknown>>();
		const paths = pathsByHead.get(headField);

		if (!paths || value === null || typeof value !== 'object') {
			return { pinnedValues, queryCases: [], covered: false };
		}

		for (const { field, segments } of paths) {
			if (!isPinnableScopeType(fieldTypes[field])) {
				continue;
			}

			const values = pathTerminalValues(segments, value, relatedPrimaryKeys[field]);

			if (values !== null && values.size > 0) {
				pinnedValues.set(field, values);
			}
		}

		return {
			pinnedValues,
			queryCases: queryCasesOf(pinnedValues),
			covered: pinnedValues.size > 0,
		};
	}

	// OR: a row matches at least one branch. Sound to pin only when EVERY branch
	// covers its own rows (else a row matching an uncovered branch carries no pin →
	// stale); then the values are the union across branches — a matching row's
	// covering value lies in it, across different fields too.
	function evalOr(branches: Eval[]): Eval {
		if (branches.length === 0 || !branches.every((branch) => branch.covered)) {
			return {
				pinnedValues: new Map<string, Set<unknown>>(),
				queryCases: [],
				covered: false,
			};
		}

		const pinnedValues = new Map<string, Set<unknown>>();
		const queryCases: Map<string, Set<unknown>>[] = [];

		for (const branch of branches) {
			unionPins(pinnedValues, branch.pinnedValues);
			queryCases.push(...branch.queryCases);
		}

		return { pinnedValues, queryCases, covered: true };
	}

	// Every key at an object level is AND-combined (the root and `_and` share this): a
	// row satisfies every conjunct, so the values union and the node is covered if
	// ANY conjunct covers the row.
	function evalNode(node: Filter): Eval {
		const evalResult: Eval = {
			pinnedValues: new Map<string, Set<unknown>>(),
			queryCases: [],
			covered: false,
		};

		function andIn(part: Eval): void {
			unionPins(evalResult.pinnedValues, part.pinnedValues);
			evalResult.queryCases = andQueryCases(evalResult.queryCases, part.queryCases);
			evalResult.covered = evalResult.covered || part.covered;
		}

		for (const [key, value] of Object.entries(node)) {
			if (key === '_and' && Array.isArray(value)) {
				for (const sub of value) {
					andIn(evalNode(sub as Filter));
				}
			}
			else if (key === '_or' && Array.isArray(value)) {
				andIn(evalOr(value.map((sub) => evalNode(sub as Filter))));
			}
			else {
				andIn(evalLeaf(key, value));
				andIn(evalPathsAt(key, value));
			}
		}

		return evalResult;
	}

	const pinned = evalNode(filter);

	return pinned.queryCases.map((queryCase) => {
		const queryCasePins: ScopedCacheCollectionPin[] = [];

		for (const [field, values] of queryCase) {
			for (const value of values) {
				queryCasePins.push({ collection, field, value, type: fieldTypes[field] });
			}
		}

		return queryCasePins;
	});
}

/**
 * Query cases flattened: every pin any of them names, deduplicated — the axes a
 * read touched, with the AND between them dropped. What the label rendering and
 * the anomaly detail speak; the invalidation itself keeps the query cases.
 */
export function scopedCachePinsOfQueryCases(
	queryCases: readonly (readonly ScopedCacheCollectionPin[])[],
): ScopedCacheCollectionPin[] {
	const pins = new Map<string, ScopedCacheCollectionPin>();

	for (const queryCase of queryCases) {
		for (const pin of queryCase) {
			pins.set(scopedCachePinKey(pin), pin);
		}
	}

	return [...pins.values()];
}

/**
 * The same pinning as `pinnedScopedCacheQueryCasesFromFilter`, read as a pin list.
 */
export function scopedCachePinsFromFilter(
	...inputs: Parameters<typeof pinnedScopedCacheQueryCasesFromFilter>
): ScopedCacheCollectionPin[] {
	return scopedCachePinsOfQueryCases(
		pinnedScopedCacheQueryCasesFromFilter(...inputs),
	);
}

/**
 * Whether a read path from the root walks one ownership chain BACKWARDS: from the
 * root, one o2m hop per chain segment, each landing on the collection the segment
 * below it is declared on, through the very fk that segment names. Every row
 * nested that way holds the root row's key at the end of the chain, so the root's
 * own pin bounds them all — the one way a would-be-bare child slices off the root.
 *
 * `chain` is read from `collection` upward (`['student', 'user']` on a course:
 * `course.student` then `student.user`), so it must end on the root.
 */
export function scopedCachePathReversesChain(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	pathSegments: QueryPath,
	collection: CollectionKey,
	chain: string[],
): boolean {
	const joins = resolveScopedCacheM2oJoinChainFromPath(schema, collection, chain);

	if (
		joins === null ||
		joins.length !== pathSegments.length ||
		joins[joins.length - 1]?.relatedCollection !== rootCollection
	) {
		return false;
	}

	// The collections the chain crosses, `collection` first, the root last.
	const crossed = [collection, ...joins.map((join) => join.relatedCollection)];

	return pathSegments.every((alias, hop) => {
		const from = crossed[crossed.length - 1 - hop];
		const to = crossed[crossed.length - 2 - hop];
		const fk = chain[chain.length - 1 - hop];

		const { relation, relationType } = getRelationInfo(
			schema.relations,
			from!,
			alias,
		);

		return (
			relationType === 'o2m' &&
			relation !== null &&
			relation.collection === to &&
			relation.field === fk
		);
	});
}
