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
	ScopedCacheTag,
} from '@directus/types';
import {
	ScopedCacheFilterKeying,
	composeScopedCachePaths,
	m2oParentRowsAtPathEnd,
	resolveScopedCacheM2oJoinChainFromPath,
	scopedCacheFilterKeyingByCollection,
} from './paths.js';
import {
	FieldTypesByField,
	canonicalScopedCacheValue,
	isPinnableScopeType,
	scopedCacheMaxPinsPerCollection,
	scopedCacheTagsFromRows,
} from './tags.js';

/**
 * Scope a read's joined collections off the keys its filters named — the third
 * pinner beside `pinnedScopedCacheTagsFromFilter`, which bounds the root off the
 * same filter, and `pinnedScopedCacheTagsFromM2oParents`, which pins the nested
 * ones off the rows they carried.
 *
 * A collection reached ONLY through a filter is nested nowhere, so neither of
 * those two can say anything about it and it has always fallen through to the
 * bare tag — one write anywhere in it dropping every read that merely joined it.
 * When the filter named its rows by key, the read depends on those rows and no
 * others, so `<collection>:<pk>=<key>` is exactly right and the write side
 * already emits it: `snapshotScopedCacheTags` writes the key slice of every
 * mutated row of every collection, declared scope fields or not.
 *
 * The root is left out: its own filter bounds it through
 * `pinnedScopedCacheTagsFromFilter`, under a self-reference guard this analysis
 * does not reproduce.
 *
 * Past the per-collection ceiling the pin is dropped rather than trimmed — a
 * partial key set would leave the rows it omits covered by nothing.
 */
export function pinnedScopedCacheTagsFromKeyedFilters(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	keyingByCollection: Map<CollectionKey, ScopedCacheFilterKeying>,
): Map<CollectionKey, ScopedCacheTag[]> {
	const pinned = new Map<CollectionKey, ScopedCacheTag[]>();

	for (const [collection, keying] of keyingByCollection) {
		if (collection === rootCollection || keying.kind !== 'keyed') {
			continue;
		}

		const type = schema.collections[collection]?.fields[keying.field]?.type;

		// The collection is absent from the schema, or its keyed field is — no field to
		// canonicalize a value against, so it pins nothing (a bare tag never named it).
		if (type === undefined) {
			continue;
		}

		if (keying.keys.size > scopedCacheMaxPinsPerCollection()) {
			continue;
		}

		const tags: ScopedCacheTag[] = [];

		// Deduped on the canonical token, not the raw value, so `7` and `'7'`
		// collapse to the one slice the write side emits for that row.
		const seen = new Set<string>();

		for (const value of keying.keys) {
			const token = canonicalScopedCacheValue(value, type);

			if (seen.has(token)) {
				continue;
			}

			seen.add(token);
			tags.push({ collection, field: keying.field, value, type });
		}

		pinned.set(collection, tags);
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
 * `pinnedScopedCacheTagsFromM2oParents` can name that half, and it declines a
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
 * The collections a read depends on BEYOND the parent rows it nested, so keying the
 * pin on those rows would leave the entry alive through a write that changes
 * what the read returns.
 *
 * - A query sorts, groups or aggregates on a path into it, so rows the response
 *   never nested decide which rows come back, named by nothing.
 * - A query FILTERS on a path into it that names no key (`keyingByCollection`),
 *   same reason. A filter that does name keys is the one case that survives:
 *   the rows it reaches are exactly those keys, which
 *   `pinnedScopedCacheTagsFromKeyedFilters` pins alongside whatever the response
 *   nested. Read off EVERY node's query, not only the root's: a nested node's
 *   filter withholds parents, and which ones it withholds is decided by every
 *   collection that filter reads — each of them one the response may have nested
 *   only in part.
 * - A nested node carries a field-level case, so a parent it references can be
 *   withheld and arrive as a null slot — which `mergeWithParentItems` writes for
 *   a null foreign key too, leaving the two indistinguishable once merged.
 */
export function scopedCacheCollectionsBeyondNestedRows(
	schema: SchemaOverview,
	ast: AST,
	// The same analysis `pinnedScopedCacheTagsFromKeyedFilters` pins from, so
	// what this one exempts is exactly what that one covers. A caller holding it
	// already passes it rather than paying for a second walk of the AST.
	keyingByCollection = scopedCacheFilterKeyingByCollection(schema, ast),
): Set<CollectionKey> {
	const beyond = new Set<CollectionKey>();

	const addCollectionsQueriedBy = (
		collection: CollectionKey,
		query: Query,
		cases: Filter[],
	): void => {
		const queryFieldMap: FieldMap = { read: new Map(), other: new Map() };

		extractFieldsFromQuery(
			collection,
			{ ...query, filter: joinFilterWithCases(query.filter, cases) },
			queryFieldMap,
			schema,
		);

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

		const groupedOrAggregated = new Set<CollectionKey>();

		for (const [, entry] of [
			...groupedFieldMap.read,
			...groupedFieldMap.other,
		]) {
			groupedOrAggregated.add(entry.collection);
		}

		for (const [, entry] of [...queryFieldMap.read, ...queryFieldMap.other]) {
			const collection = entry.collection;
			const kind = keyingByCollection.get(collection)?.kind;
			const namedByFilter = kind === 'keyed' || kind === 'independent';

			// A sort only reorders a collection's rows; a per-slice pin catches the
			// reorder because a write to the collection emits its slice. So a sort
			// costs the bare tag only where NO covering slice exists. A group or
			// aggregate collapses rows across slices and always crosses.
			const hasCoveringSlice =
				(schema.collections[collection]?.scopedCacheFields ?? []).length > 0;

			const crossesMembership =
				groupedOrAggregated.has(collection) ||
				(sorted.has(collection) && !hasCoveringSlice);

			if (namedByFilter && !crossesMembership) {
				continue;
			}

			beyond.add(collection);
		}
	};

	addCollectionsQueriedBy(ast.name, ast.query, ast.cases);

	const addWhatNestedM2oNodesDependOn = (children: AST['children']): void => {
		for (const child of children) {
			if (child.type !== 'm2o') {
				continue;
			}

			addCollectionsQueriedBy(
				child.relation.related_collection!,
				child.query,
				child.cases,
			);

			// Not a filter, so nothing above reads it: the case decides per ROW
			// whether this parent is shown at all.
			if (child.whenCase.length > 0) {
				beyond.add(child.relation.related_collection!);
			}

			addWhatNestedM2oNodesDependOn(child.children);
		}
	};

	addWhatNestedM2oNodesDependOn(ast.children);

	return beyond;
}

/**
 * Scope a read's NON-root collections off the parent rows it nested — the other
 * half of `pinnedScopedCacheTagsFromFilter`, which bounds the root.
 *
 * Per touched collection, the first of these that holds:
 *
 * - `<pk>=<key>` per parent row — M2O hops only. An INSERT lands a key this
 *   response cannot have nested, so the pin cannot go stale.
 * - its own declared scope slices — past the ceiling. One tag per distinct value.
 * - the bare collection tag — a to-many hop or A2O anywhere on one of its paths, no
 *   parent row nested, a row missing its key, or the read depending on it
 *   beyond what it nested (`scopedCacheCollectionsBeyondNestedRows`).
 *
 * Returns the pinned collections only; the bare tag is the caller's default, so a
 * collection absent here keeps the tag it has always carried. Each fallback
 * over-purges, none serves stale.
 */
export function pinnedScopedCacheTagsFromM2oParents(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	fieldMap: FieldMap,
	records: Item[],
	collectionsBeyondNestedRows: Set<CollectionKey>,
): Map<CollectionKey, ScopedCacheTag[]> {
	// A set per collection: the field map carries the same path under both its read
	// and its other group, and walking one path twice would double every row.
	const pathsByCollection = new Map<CollectionKey, Set<QueryPath[number]>>();

	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		// The root is bounded by its own filter, not by what it nested, and a
		// self-referential relation reaches it again at a path that bounds nothing.
		if (entry.collection === rootCollection) {
			continue;
		}

		// Its parent rows do not bound the read, so only the bare tag covers it.
		if (collectionsBeyondNestedRows.has(entry.collection)) {
			continue;
		}

		const paths = pathsByCollection.get(entry.collection)
			?? new Set<QueryPath[number]>();

		paths.add(path);
		pathsByCollection.set(entry.collection, paths);
	}

	const pinned = new Map<CollectionKey, ScopedCacheTag[]>();

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
			const lastField = segments[segments.length - 1];

			// A pure-M2O path resolves directly. A path that crosses a to-many still
			// pins its end collection when the LAST hop is M2O — an M2O parent reached
			// through an o2m child (a junction) — by descending the arrays for the
			// surfaced rows. A last hop that is O2M is the o2m child pinner's, left bare.
			let parentRows: Item[] | null;

			if (resolveScopedCacheM2oJoinChainFromPath(
				schema,
				rootCollection,
				segments,
			) !== null) {
				parentRows = m2oParentRowsAtPathEnd(records, segments);
			}
			else {
				const parentCollection = scopedCacheCollectionAtPathEnd(
					schema,
					rootCollection,
					segments.slice(0, -1),
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
		// collection down to the bare tag. Skipping it would pin the rows that DID
		// carry a key and leave that one covered by nothing — stale, where the bare
		// tag only over-purges.
		const keyTags = scopedCacheTagsFromRows(
			collection,
			[primaryKeyField],
			rows,
			'coarse',
			{ [primaryKeyField]: collectionFields[primaryKeyField]?.type },
		);

		if (
			keyTags !== null &&
			keyTags.length <= scopedCacheMaxPinsPerCollection()
		) {
			pinned.set(collection, keyTags);
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

		const sliceTags = scopedCacheTagsFromRows(
			collection,
			sliceFields,
			rows,
			'coarse',
			sliceFieldTypes,
		);

		if (
			sliceTags !== null &&
			sliceTags.length <= scopedCacheMaxPinsPerCollection()
		) {
			pinned.set(collection, sliceTags);
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
function scopedCacheRowsAtPathEnd(
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
 * The to-many twin of `pinnedScopedCacheTagsFromM2oParents`. A read that EMBEDS a
 * to-many child set depends on every child WHERE `child.<fk> = parent.pk`, so it
 * pins each such collection by that reverse fk = the parent's key — one tag per
 * surfaced parent row. A write to a child of another parent no longer evicts it.
 *
 * The purge side already emits the identical `<child>:<fk>=<value>` shallow tag
 * from the mutated row's own fk column (the flat scope-field branch of
 * `snapshotScopedCacheTags`), so read and write agree by construction — no field
 * injection, no response strip, no deep chain. The read never needs the child's fk
 * value: it equals the parent pk by definition of the O2M join.
 *
 * Pins where the parent rows are in reach AND the write will match: the last hop is
 * O2M whose reverse fk is a flat scope field (else the purge emits no match), and
 * the prefix descends to parent rows carrying their key — through a to-many too,
 * so a deep pivot under an all-O2M chain slices. Past the per-collection pin ceiling
 * it falls back to the bare tag; an A2O anywhere on the path keeps it bare.
 */
export function pinnedScopedCacheTagsFromO2mChildren(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	fieldMap: FieldMap,
	records: Item[],
	collectionsBeyondNestedRows: Set<CollectionKey>,
	// Populated with the collections reached by two disagreeing reverse fks — the
	// case a single ownership slice can't cover, so the caller must leave bare.
	conflictedOut?: Set<CollectionKey>,
): Map<CollectionKey, ScopedCacheTag[]> {
	// One bucket per child collection: it can be nested under several paths, and
	// every parent key it is keyed by must be gathered before the cap so no path
	// masks another. `conflicted` drops a collection reached by two reverse fks —
	// mixing their keys under one field would pin the wrong slice.
	const keyingByChild = new Map<CollectionKey, {
		reverseFk: string;
		fieldType: string | undefined;
		rows: Item[];
		conflicted: boolean;
	}>();

	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		const childCollection = entry.collection;

		if (childCollection === rootCollection) {
			continue;
		}

		if (collectionsBeyondNestedRows.has(childCollection)) {
			continue;
		}

		const segments = path.split('.');
		const aliasField = segments[segments.length - 1];

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
				prefix,
			);

			if (resolved === null) {
				continue;
			}

			parentCollection = resolved;
		}

		const { relation, relationType } = getRelationInfo(
			schema.relations,
			parentCollection,
			aliasField,
		);

		if (
			relationType !== 'o2m' ||
			!relation ||
			relation.collection !== childCollection
		) {
			continue;
		}

		const reverseFk = relation.field;
		const parentPkField = schema.collections[parentCollection]?.primary;

		if (parentPkField === undefined) {
			continue;
		}

		// The purge side emits `<child>:<fk>=<value>` only when the fk is a declared
		// flat scope field; otherwise a child write emits just its pk slice, which an
		// INSERT of a new child never carries — so this pin would serve stale. Pin
		// only when the matching shallow tag is guaranteed on the write.
		if (
			!(schema.collections[childCollection]?.scopedCacheFields ?? [])
				.filter((field) => !field.includes('.'))
				.includes(reverseFk)
		) {
			continue;
		}

		const parentRows = prefix.length === 0
			? records
			: scopedCacheRowsAtPathEnd(records, prefix);

		if (parentRows === null) {
			continue;
		}

		// The child's own fk column type, so the pinned value canonicalizes the way
		// the purge side does the mutated row's fk — or the two tag strings diverge.
		const fieldType = schema.collections[childCollection]?.fields[reverseFk]?.type;

		const keying = keyingByChild.get(childCollection) ?? {
			reverseFk,
			fieldType,
			rows: [],
			conflicted: false,
		};

		if (keying.reverseFk !== reverseFk) {
			keying.conflicted = true;
			keyingByChild.set(childCollection, keying);
			continue;
		}

		for (const parentRow of parentRows) {
			// Carry the parent key under the child's fk name so `scopedCacheTagsFromRows`
			// reads it as that field's value. A surfaced parent without its key leaves
			// part of the set unpinned; one such row takes the whole collection to the
			// bare tag (the `coarse` mode returns null on a missing field).
			keying.rows.push(
				parentPkField in parentRow
					? { [reverseFk]: parentRow[parentPkField] }
					: {},
			);
		}

		keyingByChild.set(childCollection, keying);
	}

	const pinned = new Map<CollectionKey, ScopedCacheTag[]>();

	for (const [collection, keying] of keyingByChild) {
		if (keying.conflicted && conflictedOut) {
			conflictedOut.add(collection);
		}

		if (keying.conflicted || keying.rows.length === 0) {
			continue;
		}

		const keyTags = scopedCacheTagsFromRows(
			collection,
			[keying.reverseFk],
			keying.rows,
			'coarse',
			{ [keying.reverseFk]: keying.fieldType },
		);

		if (
			keyTags !== null &&
			keyTags.length <= scopedCacheMaxPinsPerCollection()
		) {
			pinned.set(collection, keyTags);
		}
	}

	return pinned;
}

/**
 * Scope a read's root cache tags off a filter — the read side. A read is soundly
 * scoped to a value slice only when the filter *bounds* it to that value: a future
 * insert with a new scope value must be excluded by the same filter, or the read
 * would silently miss it. Tags come from `_eq`/`_in` on a scoped field (flat or
 * relational `{ fk: { <pk>: … } }`). Each node reports its tags plus whether it
 * *covers* every row it matches (i.e. binds a pinnable field on that row), combined
 * by operator: - `_and`/root union a field's values and are covered if ANY conjunct
 * is (a row satisfies every conjunct); the value union over-approximates the
 * intersection — over-purges, never stale. - `_or` is sound only when EVERY branch
 * is covered (else a row matching an uncovered branch carries no pinned tag →
 * stale); then its tags are the union across branches — a matching row satisfies one
 * branch, whose covering tag lies in that union. This holds across *different*
 * fields too: `{ _or: [{ owner }, { dept }] }` pins both, purged if a write touches
 * either. This is what scopes a permission-isolated read: the caller passes
 * `joinFilterWithCases(query.filter, ast.cases)`, whose `{ _or: cases }` is unioned
 * by that rule (one case = its own values; a case that leaves ALL fields unbound →
 * bare). No pinned field → `[]`, and the caller falls back to the bare collection
 * tag. `fieldTypes` canonicalizes a value the way the purge side does and skips
 * date-ish types (not pin-safe, `PIN_UNSAFE_SCOPE_TYPES`).
 *
 * `primaryKeyField` joins the declared fields implicitly and always, no config: -
 * Every row has a primary key, so this axis always resolves. - An inserted row
 * carries a different key, so it can never join a `<pk>._eq` or `<pk>._in` read's
 * result set — the insert-blindness that bars a value slice elsewhere cannot bite
 * here. - The purge side emits the same tag from the keys it already holds, so read
 * and write agree without either paying a query for it.
 */
export function pinnedScopedCacheTagsFromFilter(
	collection: string,
	fields: string[],
	filter: Filter | null | undefined,
	fieldTypes: FieldTypesByField = {},
	relatedPrimaryKeys: Record<string, string> = {},
	scopedCachePaths: ScopedCachePath[] = [],
	primaryKeyField?: string,
): ScopedCacheTag[] {
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

	// A node's pinned tags plus whether it *covers* every row it matches — a leaf that
	// bound a pinnable field covers its rows; an uncovered node's rows carry no pinned
	// tag (would be stale).
	type Eval = { tags: Map<string, Set<unknown>>; covered: boolean };

	// Union `source`'s values into `target` in place (shared by AND and OR).
	function unionTags(
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

	// A single `_eq`/`_in` (or relational `{ fk: { <pk>: { _eq | _in } } }`) leaf →
	// its value set. Covered iff it bound a pinnable scope field; a
	// non-scope/date/non-`_eq`/`_in` key covers nothing.
	function evalLeaf(field: string, value: unknown): Eval {
		const tags = new Map<string, Set<unknown>>();

		if (
			!fieldSet.has(field) ||
			!isPinnableScopeType(fieldTypes[field]) ||
			value === null ||
			typeof value !== 'object'
		) {
			return { tags, covered: false };
		}

		const ops = value as Record<string, unknown>;

		if ('_eq' in ops) {
			tags.set(field, new Set([ops['_eq']]));
		}
		else if ('_in' in ops && Array.isArray(ops['_in'])) {
			tags.set(field, new Set(ops['_in']));
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
					tags.set(field, new Set([innerOps['_eq']]));
				}
				else if ('_in' in innerOps && Array.isArray(innerOps['_in'])) {
					tags.set(field, new Set(innerOps['_in']));
				}
			}
		}

		return { tags, covered: tags.size > 0 };
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

			node = (node as Record<string, unknown>)[segments[i]!];
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
		const tags = new Map<string, Set<unknown>>();
		const paths = pathsByHead.get(headField);

		if (!paths || value === null || typeof value !== 'object') {
			return { tags, covered: false };
		}

		for (const { field, segments } of paths) {
			if (!isPinnableScopeType(fieldTypes[field])) {
				continue;
			}

			const values = pathTerminalValues(segments, value, relatedPrimaryKeys[field]);

			if (values !== null && values.size > 0) {
				tags.set(field, values);
			}
		}

		return { tags, covered: tags.size > 0 };
	}

	// OR: a row matches at least one branch. Sound to pin only when EVERY branch
	// covers its own rows (else a row matching an uncovered branch carries no pinned
	// tag → stale); then the tags are the union across branches — a matching row's
	// covering tag lies in it, across different fields too.
	function evalOr(branches: Eval[]): Eval {
		if (branches.length === 0 || !branches.every((branch) => branch.covered)) {
			return { tags: new Map<string, Set<unknown>>(), covered: false };
		}

		const tags = new Map<string, Set<unknown>>();

		for (const branch of branches) {
			unionTags(tags, branch.tags);
		}

		return { tags, covered: true };
	}

	// Every key at an object level is AND-combined (the root and `_and` share this): a
	// row satisfies every conjunct, so tags union and the node is covered if ANY
	// conjunct covers the row.
	function evalNode(node: Filter): Eval {
		const result: Eval = { tags: new Map<string, Set<unknown>>(), covered: false };

		function andIn(part: Eval): void {
			unionTags(result.tags, part.tags);
			result.covered = result.covered || part.covered;
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

		return result;
	}

	const pinned = evalNode(filter);
	const tags: ScopedCacheTag[] = [];

	for (const [field, values] of pinned.tags) {
		for (const value of values) {
			tags.push({ collection, field, value, type: fieldTypes[field] });
		}
	}

	return tags;
}

/**
 * The paths a read can pin a would-be-bare nested collection BY, instead of the bare
 * tag, when an ancestor its ownership chain crosses is itself pinned in the read —
 * nearest first. Every row the collection surfaced belongs to that ancestor's slice,
 * so a per-slice pin stands in for the whole-collection tag.
 *
 * Every hop is a scoped-cache ownership edge (`scopedCacheFields`), so a write to
 * the near collection purges every key a candidate names — the invariant keeping the
 * slice sound. `field` is the dotted key the matching pin's value slices on — the
 * same key `composeScopedCachePaths` hands the purge, so read pin and purge agree;
 * `ancestor` is the collection that key reaches; `terminalField` is the field on it
 * a pin must name for the candidate to apply.
 *
 * Two shapes, both ownership-covered:
 * - a flat parent fk (`discipline`) reaching the 1-hop ancestor by its own key, and
 * - a composed relational path (`discipline.enrollment.student.user`) reaching a
 *   deeper ancestor's scope field.
 */
export function scopedCacheAncestorSliceCandidates(
	schema: SchemaOverview,
	collection: CollectionKey,
): Array<{ field: string; ancestor: CollectionKey; terminalField: string }> {
	const candidates: Array<{
		field: string;
		ancestor: CollectionKey;
		terminalField: string;
	}> = [];

	for (const field of schema.collections[collection]?.scopedCacheFields ?? []) {
		if (field.includes('.')) {
			continue;
		}

		const target = schema.relations.find((rel) => {
			return rel.collection === collection && rel.field === field;
		})?.related_collection;

		const targetPk = target
			? schema.collections[target]?.primary
			: undefined;

		if (!target || !targetPk) {
			continue;
		}

		candidates.push({ field, ancestor: target, terminalField: targetPk });
	}

	for (const path of composeScopedCachePaths(schema, collection)) {
		const terminalField = path.segments[path.segments.length - 1];

		const joins = resolveScopedCacheM2oJoinChainFromPath(
			schema,
			collection,
			path.segments.slice(0, -1),
		);

		const ancestor = joins?.[joins.length - 1]?.relatedCollection;

		if (!ancestor || terminalField === undefined) {
			continue;
		}

		candidates.push({ field: path.field, ancestor, terminalField });
	}

	return candidates.sort((a, b) => {
		return a.field.split('.').length - b.field.split('.').length;
	});
}
