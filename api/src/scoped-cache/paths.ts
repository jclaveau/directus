import {
	joinFilterWithCases,
} from '../database/run-ast/lib/apply-query/join-filter-with-cases.js';
import type {
	CollectionKey,
	QueryPath,
} from '../permissions/modules/process-ast/types.js';
import {
	findRelatedCollection,
} from '../permissions/modules/process-ast/utils/find-related-collection.js';
import type { AST } from '../types/ast.js';
import {
	expandRelatedKeyFilters,
} from '../utils/expand-related-key-filters.js';
import {
	hopsAcrossRelation,
	isFilterNode,
} from '../utils/filter-shape.js';
import {
	getRelationInfo,
} from '../utils/get-relation-info.js';
import {
	parseFilterKey,
} from '../utils/parse-filter-key.js';
import type {
	Filter,
	Item,
	Query,
	SchemaOverview,
	ScopedCachePath,
} from '@directus/types';
import {
	isPinnableScopeType,
} from './tags.js';

export type ScopedCacheM2oJoin = {
	field: string;
	relatedCollection: string;
	relatedPk: string;
};

/**
 * Resolve a dotted path into the chain of M2O joins it crosses, from `collection`
 * down. Null on anything that is not an M2O — a to-many hop, an unknown field, or an
 * A2O, whose relation names no single related collection — and every caller then
 * degrades to the bare collection tag.
 *
 * A row maps to exactly one parent across an M2O, so what such a join reaches is
 * fully determined by the rows already in hand. Shared, so the two sides that ask
 * "is this path pinnable?" cannot drift apart on the answer: a collection's declared
 * scope paths, and the nested collections of a read.
 */
export function resolveScopedCacheM2oJoinChainFromPath(
	schema: SchemaOverview,
	collection: CollectionKey,
	path: QueryPath,
): ScopedCacheM2oJoin[] | null {
	const joins: ScopedCacheM2oJoin[] = [];
	let current = collection;

	for (const field of path) {
		const relation = schema.relations.find((rel) => {
			return rel.collection === current && rel.field === field;
		});

		const relatedCollection = relation?.related_collection;

		const relatedPk = relatedCollection
			? schema.collections[relatedCollection]?.primary
			: undefined;

		if (!relatedCollection || !relatedPk) {
			return null;
		}

		joins.push({ field, relatedCollection, relatedPk });
		current = relatedCollection;
	}

	return joins;
}

/**
 * Field paths to inject so a read's ownership ANCESTORS — the collections its
 * scope chain crosses toward the owner — come back as rows and pin by key, not
 * the bare tag a read that nested none of them (`fields: ['*']`) over-purges on.
 *
 * Walks the same flat-field M2O chain `composeScopedCachePaths` does: each
 * collection names its parent, so ownership composes hop by hop. A path per
 * intermediate ancestor, ending at that ancestor's own pk so it carries its key
 * in the response (run-ast's linking pk is temporary and stripped). The terminal
 * owner — no scope of its own — is the value slice's root, left un-nested.
 */
export function scopedCacheOwnershipNestedPkPaths(
	schema: SchemaOverview,
	collection: CollectionKey,
): string[] {
	const paths = new Set<string>();

	const walk = (current: string, prefix: string, visited: Set<string>): void => {
		if (visited.has(current)) {
			return;
		}

		const seen = new Set(visited).add(current);

		for (const field of schema.collections[current]?.scopedCacheFields ?? []) {
			if (field.includes('.')) {
				continue;
			}

			const target = schema.relations.find((rel) => {
				return rel.collection === current && rel.field === field;
			})?.related_collection;

			const targetPk = target
				? schema.collections[target]?.primary
				: undefined;

			const targetHasScope =
				(schema.collections[target ?? '']?.scopedCacheFields ?? []).length > 0;

			if (!target || !targetPk || !targetHasScope) {
				continue;
			}

			const targetPrefix = prefix === ''
				? field
				: `${prefix}.${field}`;

			paths.add(`${targetPrefix}.${targetPk}`);
			walk(target, targetPrefix, seen);
		}
	};

	walk(collection, '', new Set());

	// A chain of only direct-fk ancestors is already pinned from the read row's own
	// columns; nest only to reach one two-plus hops out, that no column carries.
	const nested = [...paths];

	return nested.some((path) => path.split('.').length > 2)
		? nested
		: [];
}

/**
 * The parent rows sitting at the END of one M2O path, in document order — the set is
 * replaced at every hop, so the rows passed through on the way out are not returned.
 *
 * Null when the response cannot answer the path — a segment it never carried, or an
 * array where an M2O promised one row — so the caller falls back to the bare tag
 * rather than pin a set it only half read.
 */
export function m2oParentRowsAtPathEnd(
	records: Item[],
	segments: QueryPath,
): Item[] | null {
	let current = records;

	for (const segment of segments) {
		const next: Item[] = [];

		for (const row of current) {
			const value = row[segment];

			// A row whose parent link is empty carries no parent to pin, and says
			// nothing about the rows its siblings reached.
			if (value === null) {
				continue;
			}

			if (typeof value !== 'object' || Array.isArray(value)) {
				return null;
			}

			next.push(value);
		}

		current = next;
	}

	return current;
}

/**
 * What a read's filters say about the rows of ONE collection they join to.
 *
 * - `keyed` — every condition that reaches the collection names its rows by
 *   primary key, so no other row of it can change what the read returns and
 *   `<collection>:<pk>=<key>` is the whole dependency.
 * - `unkeyed` — something reaches it by anything else: another column, an
 *   operator other than `_eq`/`_in`, or a hop THROUGH it to a further
 *   collection, which reads the foreign key of every row that could be joined.
 *   A write to any of its rows can then change the result, so only the bare
 *   collection tag covers it.
 * - `independent` — a condition reaches it, and the read still depends on none of
 *   its rows. Only an M2O path terminating on the related primary key qualifies,
 *   and only behind an enforced foreign key: the condition is answered by the
 *   near row's own column, and every way the far row can disappear writes the
 *   near row too (`CASCADE`/`SET NULL`/`SET DEFAULT`), or is refused
 *   (`RESTRICT`/`NO ACTION`). The near collection's own tag then covers it, so
 *   this collection needs no tag at all — not even a bare one.
 * - `absent` — no condition reaches it, and it owes the filters nothing.
 */
export type ScopedCacheFilterKeying =
	| { kind: 'keyed'; field: string; keys: Set<unknown> }
	| { kind: 'unkeyed' }
	| { kind: 'independent'; field: string; keys: Set<unknown> }
	| { kind: 'absent' };

const KEYING_UNKEYED: ScopedCacheFilterKeying = { kind: 'unkeyed' };

const KEYING_ABSENT: ScopedCacheFilterKeying = { kind: 'absent' };

// The keys of every keyed/independent part with the one field they all key by — or
// 'conflict' when parts key DIFFERENT fields (their keys are not one slice axis, so
// nothing pins the alias), or null when none keyed. `independent` carries its keys
// too: it needs no tag of its own, but a sibling reading the same joined row does.
function keyedAxisAcross(
	parts: ScopedCacheFilterKeying[],
): { field: string; keys: Set<unknown> } | 'conflict' | null {
	let field: string | undefined;
	const keys = new Set<unknown>();

	for (const part of parts) {
		if (part.kind !== 'keyed' && part.kind !== 'independent') {
			continue;
		}

		if (field !== undefined && field !== part.field) {
			return 'conflict';
		}

		field = part.field;

		for (const key of part.keys) {
			keys.add(key);
		}
	}

	if (field === undefined) {
		return null;
	}

	return { field, keys };
}

/**
 * Conjunction. Every condition here describes the SAME joined row, so one of them
 * naming that row's key pins it whatever the others go on to read off it:
 * `{ _and: [{ course: { id: { _eq: 7 } } }, { course: { name: { _eq: 'x' } } }] }`
 * compiles to one join alias, and only course 7 can satisfy it.
 */
function keyingOfEveryCondition(
	parts: ScopedCacheFilterKeying[],
): ScopedCacheFilterKeying {
	const axis = keyedAxisAcross(parts);

	// Parts keying different fields name no single slice — the alias falls bare.
	if (axis === 'conflict') {
		return KEYING_UNKEYED;
	}

	// A sibling that DOES read the joined row pulls the alias back to needing a
	// tag — pinned by the key if one was named, bare otherwise.
	if (parts.some((part) => part.kind === 'unkeyed')) {
		return axis === null
			? KEYING_UNKEYED
			: { kind: 'keyed', field: axis.field, keys: axis.keys };
	}

	if (axis !== null && parts.some((part) => part.kind === 'keyed')) {
		return { kind: 'keyed', field: axis.field, keys: axis.keys };
	}

	if (axis !== null && parts.some((part) => part.kind === 'independent')) {
		return { kind: 'independent', field: axis.field, keys: axis.keys };
	}

	return KEYING_ABSENT;
}

/**
 * Disjunction. A row coming back through an unkeyed branch was reached through
 * rows the filter never named, so one such branch takes the whole disjunction
 * down; otherwise the keys are the union, since a row satisfies some branch. A
 * branch that never mentions the collection contributes `absent`, not a
 * fallback — it reads none of its rows.
 */
function keyingOfAnyCondition(
	parts: ScopedCacheFilterKeying[],
): ScopedCacheFilterKeying {
	if (parts.some((part) => part.kind === 'unkeyed')) {
		return KEYING_UNKEYED;
	}

	const axis = keyedAxisAcross(parts);

	// Branches keying different fields name no single slice — the disjunction bares.
	if (axis === 'conflict') {
		return KEYING_UNKEYED;
	}

	// One branch needing a tag makes the whole disjunction need one; the keys the
	// independent branches named are unioned in, since a row may arrive by either.
	if (axis !== null && parts.some((part) => part.kind === 'keyed')) {
		return { kind: 'keyed', field: axis.field, keys: axis.keys };
	}

	if (axis !== null && parts.some((part) => part.kind === 'independent')) {
		return { kind: 'independent', field: axis.field, keys: axis.keys };
	}

	return KEYING_ABSENT;
}

/**
 * One entry per join alias — the dotted path prefix that reaches it. The alias is
 * the unit the whole analysis works in, because `add-join` caches one join per
 * path: two conditions under the same path read one row, two paths to the same
 * collection read two independent rows.
 */
type ScopedCacheKeyingByAlias = Map<string, ScopedCacheFilterKeying>;

function combineKeyingByAlias(
	parts: ScopedCacheKeyingByAlias[],
	combine: (keyings: ScopedCacheFilterKeying[]) => ScopedCacheFilterKeying,
): ScopedCacheKeyingByAlias {
	const aliases = new Set<string>();

	for (const part of parts) {
		for (const alias of part.keys()) {
			aliases.add(alias);
		}
	}

	const combined: ScopedCacheKeyingByAlias = new Map();

	for (const alias of aliases) {
		const atAlias = parts.map((part) => part.get(alias) ?? KEYING_ABSENT);
		combined.set(alias, combine(atAlias));
	}

	return combined;
}

/**
 * The keys an M2O hop names when its conditions are answered by the near row's own
 * foreign key column, so no row of the related collection is depended on — or null
 * when the far row does have to be read.
 *
 * Three things have to hold. The relation must be an M2O, so the column is on this
 * side. The conditions must name the related primary key and nothing else — a
 * sibling on any other column has to read the far row. And the relation must carry
 * a database constraint (`relation.schema`): without one a far row can be deleted
 * behind the near row's back, leaving a foreign key that no longer joins, and the
 * result changes with nothing written on this side.
 *
 * The constraint is taken to be enforced for the rows already there. A Postgres
 * foreign key added `NOT VALID` reports as a constraint while tolerating the
 * orphans that predate it, and would make this verdict wrong — Directus creates
 * no such constraint, and the schema snapshot does not carry its validity.
 */
function nearRowAnswerKeys(
	schema: SchemaOverview,
	collection: CollectionKey,
	fieldName: string,
	conditions: Record<string, unknown>,
): Set<unknown> | null {
	const { relation, relationType } = getRelationInfo(
		schema.relations,
		collection,
		fieldName,
	);

	if (relationType !== 'm2o' || !relation?.schema || !relation.related_collection) {
		return null;
	}

	const relatedPrimaryKey = schema.collections[relation.related_collection]?.primary;
	const named = Object.keys(conditions);

	if (relatedPrimaryKey === undefined || named.length !== 1) {
		return null;
	}

	if (named[0] !== relatedPrimaryKey) {
		return null;
	}

	// Only operators below it: a further hop reaches past the key.
	const terminal = conditions[relatedPrimaryKey];

	if (terminal === null || typeof terminal !== 'object' || Array.isArray(terminal)) {
		return null;
	}

	const operators = terminal as Record<string, unknown>;

	if (!Object.keys(operators).every((child) => child.startsWith('_'))) {
		return null;
	}

	// The keys it named, so a sibling that DOES have to read the far row can pin
	// it. Empty for an operator that names no row.
	if ('_eq' in operators) {
		return new Set([operators['_eq']]);
	}

	if ('_in' in operators && Array.isArray(operators['_in'])) {
		return new Set(operators['_in']);
	}

	return new Set();
}

/**
 * Walk one filter and report, per join alias, what it says about the rows it
 * reaches. `collectionByAlias` is filled as the walk crosses relations, so the
 * caller can fold aliases back onto the collections they name.
 *
 * Every hop is followed, not only the M2O ones
 * `resolveScopedCacheM2oJoinChainFromPath` accepts: what a hop reaches at its FAR
 * end is named by the key the condition
 * gives, whichever direction the relation runs. `filter/index.ts` joins O2M, M2M
 * and A2O the same way it joins M2O, and `_some`/`_none` push the same condition
 * into a subquery over the same one row.
 */
function scopedCacheFilterKeyingByAlias(
	schema: SchemaOverview,
	collection: CollectionKey,
	filter: Filter,
	alias: string,
	collectionByAlias: Map<string, CollectionKey>,
): ScopedCacheKeyingByAlias {
	collectionByAlias.set(alias, collection);

	const parts: ScopedCacheKeyingByAlias[] = [];

	// Anything the analysis cannot read is treated as reading every row of every
	// collection under it. `_not` is the live case: `applyFilter` drops it on the
	// floor rather than compiling it, so over-purging here costs nothing and
	// leaves no shape that silently pins what it should not.
	const unkeyEverythingUnder = (node: Filter): void => {
		const swept = scopedCacheFilterKeyingByAlias(
			schema,
			collection,
			node,
			alias,
			collectionByAlias,
		);

		for (const sweptAlias of swept.keys()) {
			parts.push(new Map([[sweptAlias, KEYING_UNKEYED]]));
		}

		parts.push(new Map([[alias, KEYING_UNKEYED]]));
	};

	for (const [key, value] of Object.entries(filter)) {
		if ((key === '_and' || key === '_or') && Array.isArray(value)) {
			parts.push(combineKeyingByAlias(
				value.map((branch) => {
					return scopedCacheFilterKeyingByAlias(
						schema,
						collection,
						branch as Filter,
						alias,
						collectionByAlias,
					);
				}),
				key === '_and'
					? keyingOfEveryCondition
					: keyingOfAnyCondition,
			));

			continue;
		}

		// Quantifiers over a to-many hop the caller already crossed: the condition
		// inside still names one row of the same collection, at the same alias.
		if ((key === '_some' || key === '_none') && isFilterNode(value)) {
			parts.push(scopedCacheFilterKeyingByAlias(
				schema,
				collection,
				value as Filter,
				alias,
				collectionByAlias,
			));

			continue;
		}

		if (key.startsWith('_')) {
			if (isFilterNode(value)) {
				unkeyEverythingUnder(value as Filter);
			}
			else {
				parts.push(new Map([[alias, KEYING_UNKEYED]]));
			}

			continue;
		}

		// Shorthands are gone by now (`expandRelatedKeyFilters`), so a leaf that is
		// still not a node carries nothing this walk can read.
		if (isFilterNode(value) === false) {
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}

		const conditions = value as Record<string, unknown>;

		// An A2O path carries its collection scope in the key itself
		// (`item:articles`), which is how `add-join` picks the table to join.
		const [pathField, pathScope] = key.split(':') as [string, string?];
		const { fieldName, functionName } = parseFilterKey(pathField);

		// The scope is request text naming the table to join, so one naming no
		// collection of this schema joins nothing — reporting it would put a
		// collection that cannot exist in the response's tag header.
		if (pathScope !== undefined && schema.collections[pathScope] === undefined) {
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}

		const relatedCollection = pathScope
			?? findRelatedCollection(collection, fieldName, schema);

		const childAlias = alias === ''
			? key
			: `${alias}.${key}`;

		// A function key reads the related rows through a transform: `count`
		// totals every one of them, so the value it is compared against is a
		// cardinality rather than a key. The hop is joined all the same, so the
		// collection is reported — wholesale, which is the bare tag.
		if (relatedCollection !== null && functionName !== undefined) {
			collectionByAlias.set(childAlias, relatedCollection);

			parts.push(new Map([[childAlias, KEYING_UNKEYED]]));
			parts.push(new Map([[alias, KEYING_UNKEYED]]));

			continue;
		}

		if (relatedCollection !== null && hopsAcrossRelation(conditions)) {
			// An M2O ending on the related primary key is answered by the near
			// row's own foreign key column — the join only re-reads the value it
			// already holds. Behind an enforced constraint the far row cannot
			// vanish without writing the near row, so the near collection's tag
			// covers it and this one needs none.
			const nearRowKeys = nearRowAnswerKeys(
				schema,
				collection,
				fieldName,
				conditions,
			);

			if (nearRowKeys !== null) {
				collectionByAlias.set(childAlias, relatedCollection);

				// Keyed on the related pk — the only field `nearRowAnswerKeys` answers.
				const relatedPrimaryKey =
					schema.collections[relatedCollection]?.primary ?? '';

				parts.push(new Map([[
					childAlias,
					{
						kind: 'independent',
						field: relatedPrimaryKey,
						keys: nearRowKeys,
					} as ScopedCacheFilterKeying,
				]]));

				// The near row's foreign-key column holds that same value; when it is a
				// flat scope field (or the pk) the read is bounded by it and the write
				// emits the matching slice, so pin the near collection rather than bare.
				parts.push(new Map([[
					alias,
					isScopedCacheKeyableField(schema, collection, fieldName)
						? { kind: 'keyed', field: fieldName, keys: nearRowKeys }
						: KEYING_UNKEYED,
				]]));

				continue;
			}

			parts.push(scopedCacheFilterKeyingByAlias(
				schema,
				relatedCollection,
				conditions as Filter,
				childAlias,
				collectionByAlias,
			));

			// Crossing the relation reads the foreign key of every row of THIS
			// collection that could be joined, so the hop itself names none of
			// them. A sibling condition naming this alias's key still wins, by
			// the conjunction rule: they describe one row.
			parts.push(new Map([[alias, KEYING_UNKEYED]]));

			continue;
		}

		parts.push(new Map([[
			alias,
			keyingOfColumnConditions(
				schema,
				collection,
				fieldName,
				functionName,
				conditions,
			),
		]]));
	}

	return combineKeyingByAlias(parts, keyingOfEveryCondition);
}

/**
 * What one column's conditions say about the rows they can match. Only the
 * primary key under `_eq`/`_in` names them: any other column matches rows by a
 * value a write can move onto a row this read never saw, and any other operator
 * describes rows by what they are NOT. A function key (`year(created_on)`)
 * reads the column through a transform, so it names nothing either.
 *
 * An empty `_in` matches no row and so depends on none, but it is reported
 * unkeyed rather than as an empty key set: pinning a collection to nothing would
 * drop its tag altogether, and a bare tag is the cheaper way to be right about a
 * query that returns nothing.
 */
// The pk, or a flat scoped_cache_field, of a pin-safe type: a filter naming it by
// value bounds the collection to that value, and the write side emits the same
// slice — the pk slice always, a scoped field's from the flat-scope-field branch —
// so read and write agree. An INSERT can match a scoped-field value (not a pk one),
// and the write emits that field's slice on create, so the pin still catches it.
// Shared by the two analyses that key off it: a plain column condition, and the near
// row of an M2O crossing whose foreign key IS this field.
function isScopedCacheKeyableField(
	schema: SchemaOverview,
	collection: CollectionKey,
	fieldName: string,
): boolean {
	const scopedFlatFields = (schema.collections[collection]?.scopedCacheFields ?? [])
		.filter((field) => !field.includes('.'));

	if (
		fieldName !== schema.collections[collection]?.primary
		&& !scopedFlatFields.includes(fieldName)
	) {
		return false;
	}

	const keyType = schema.collections[collection]?.fields[fieldName]?.type;

	return isPinnableScopeType(keyType);
}

function keyingOfColumnConditions(
	schema: SchemaOverview,
	collection: CollectionKey,
	fieldName: string,
	functionName: string | undefined,
	conditions: Record<string, unknown>,
): ScopedCacheFilterKeying {
	if (
		functionName !== undefined
		|| !isScopedCacheKeyableField(schema, collection, fieldName)
	) {
		return KEYING_UNKEYED;
	}

	if ('_eq' in conditions) {
		return {
			kind: 'keyed',
			field: fieldName,
			keys: new Set([conditions['_eq']]),
		};
	}

	if ('_in' in conditions && Array.isArray(conditions['_in'])) {
		const keys = new Set<unknown>(conditions['_in']);

		if (keys.size > 0) {
			return { kind: 'keyed', field: fieldName, keys };
		}
	}

	return KEYING_UNKEYED;
}

/**
 * What every filter a read carries says about each collection it joins to — the
 * root query's, and every nested node's, each with the permission cases folded in
 * the way the SQL WHERE folds them.
 *
 * Aliases are folded back onto collections by the disjunction rule: two paths to
 * one collection join two independent rows, so one unkeyed path leaves every row
 * of that collection able to change the result, and otherwise the keys are the
 * union of what each path named. Each node folds its own aliases, since alias
 * `''` means a different collection in every one of them.
 *
 * Shared by the two sides that must agree on it — the tags a keyed collection
 * pins, and the collections that consequently need NOT fall back to the bare tag
 * — so neither can drift from the other's answer.
 */
export function scopedCacheFilterKeyingByCollection(
	schema: SchemaOverview,
	ast: AST,
): Map<CollectionKey, ScopedCacheFilterKeying> {
	const keyingByCollection = new Map<CollectionKey, ScopedCacheFilterKeying>();

	const readKeyingOf = (
		collection: CollectionKey,
		query: Query,
		cases: Filter[],
	): void => {
		const filter = joinFilterWithCases(query.filter, cases);

		if (!filter) {
			return;
		}

		const collectionByAlias = new Map<string, CollectionKey>();

		// One shape for the walk to read: a bare leaf becomes `_eq`, and an
		// operator on a to-many alias becomes one on the related key, the way
		// `getColumnPath` resolves it when it builds the join.
		const keyingByAlias = scopedCacheFilterKeyingByAlias(
			schema,
			collection,
			expandRelatedKeyFilters(schema, collection, filter),
			'',
			collectionByAlias,
		);

		for (const [alias, keying] of keyingByAlias) {
			const aliasCollection = collectionByAlias.get(alias);

			if (aliasCollection === undefined) {
				continue;
			}

			const known = keyingByCollection.get(aliasCollection) ?? KEYING_ABSENT;

			keyingByCollection.set(
				aliasCollection,
				keyingOfAnyCondition([known, keying]),
			);
		}
	};

	readKeyingOf(ast.name, ast.query, ast.cases);

	const readKeyingOfChildren = (children: AST['children']): void => {
		for (const child of children) {
			if (child.type === 'field') {
				continue;
			}

			if (child.type === 'functionField') {
				readKeyingOf(child.relatedCollection, child.query, child.cases);
				continue;
			}

			// An A2O node holds one query, one case set and one child list PER
			// related collection, since each is a different table to join.
			if (child.type === 'a2o') {
				for (const name of child.names) {
					readKeyingOf(name, child.query[name] ?? {}, child.cases[name] ?? []);
					readKeyingOfChildren(child.children[name] ?? []);
				}

				continue;
			}

			readKeyingOf(child.name, child.query, child.cases);
			readKeyingOfChildren(child.children);
		}
	};

	readKeyingOfChildren(ast.children);

	return keyingByCollection;
}

/**
 * Auto-derive multi-hop scope paths from LOCAL scope fields, so each collection
 * declares only its own column and the grand-owner path composes itself. A scope
 * field on `collection` that is an M2O to a collection which itself declares scope
 * fields contributes `<field>.<targetScope>` for each of the target's scopes — its
 * own and, transitively, its derived. So `team` scoped by `owner_ref` + `member`
 * scoped by `team` yields `team.owner_ref`, no config naming another collection's
 * relation. Cycle-guarded (`visited`); the caller re-resolves each path (a to-many
 * hop drops to the bare tag).
 */
export function composeScopedCachePaths(
	schema: Pick<SchemaOverview, 'collections' | 'relations'>,
	collection: string,
	visited: Set<string> = new Set(),
): ScopedCachePath[] {
	if (visited.has(collection)) {
		return [];
	}

	const seen = new Set(visited).add(collection);
	const localFields = schema.collections[collection]?.scopedCacheFields ?? [];
	const composed: ScopedCachePath[] = [];

	for (const field of localFields) {
		if (field.includes('.')) {
			continue;
		}

		const relation = schema.relations.find((rel) => {
			return rel.collection === collection && rel.field === field;
		});

		const target = relation?.related_collection;

		if (!target) {
			continue;
		}

		for (const targetField of schema.collections[target]?.scopedCacheFields ?? []) {
			composed.push({
				field: `${field}.${targetField}`,
				segments: [field, ...targetField.split('.')],
			});
		}

		for (const deeper of composeScopedCachePaths(schema, target, seen)) {
			composed.push({
				field: `${field}.${deeper.field}`,
				segments: [field, ...deeper.segments],
			});
		}
	}

	return composed;
}
