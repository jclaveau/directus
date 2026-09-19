import type { Item, Query, SchemaOverview } from '@directus/types';
import { cloneDeep } from '../utils/lodash-es-used.js';
import {
	requestedFieldNestsPast,
	scopedCacheOwnershipNestedPkPaths,
} from './paths.js';

/** Marks the hop an injection nests, so a response key is told from a field. */
export const SCOPED_CACHE_INJECTED_PREFIX = '__scoped_cache_';

/**
 * An ownership ancestor's key path, nested into a read for its tags alone.
 *
 * The first hop the caller does not nest past is aliased: run-ast merges a
 * nested row under the node's key, overwriting whatever column bore that name.
 * Under the field's own name a hop whose case withheld its row — or that no row
 * bore — merged as `null` over the foreign key the caller asked for (`*`
 * included), answering `null` where an un-injected read answers the key. Under
 * an alias the caller's column is never touched, and the strip deletes the
 * alias whole.
 */
export type ScopedCacheOwnershipInjection = {
	/** By the fields it crosses: what the schema is looked up by. */
	path: string;
	/** As requested: the field-map path its rows come back under. */
	aliasedPath: string;
};

export function scopedCacheOwnershipInjections(
	schema: SchemaOverview,
	collection: string,
	fields: string[],
): ScopedCacheOwnershipInjection[] {
	const nestedByCaller = (prefix: string[]): boolean => {
		return fields.some((field) => requestedFieldNestsPast(field, prefix));
	};

	return scopedCacheOwnershipNestedPkPaths(schema, collection).flatMap((path) => {
		const segments = path.split('.');

		// The caller already nests past this ancestor — its rows come back on
		// their own, so neither inject nor strip it.
		if (nestedByCaller(segments.slice(0, -1))) {
			return [];
		}

		let hop = 0;

		while (nestedByCaller(segments.slice(0, hop + 1))) {
			hop++;
		}

		const aliased = [...segments];
		aliased[hop] = `${SCOPED_CACHE_INJECTED_PREFIX}${segments[hop]}`;

		return [{ path, aliasedPath: aliased.join('.') }];
	});
}

/** The query with the injections' paths requested and their aliases declared. */
export function withScopedCacheOwnershipInjections(
	query: Query,
	injections: ScopedCacheOwnershipInjection[],
): Query {
	if (injections.length === 0) {
		return query;
	}

	const alias: Record<string, string> = { ...query.alias };
	const deep: Record<string, any> = cloneDeep(query.deep ?? {});

	for (const { path, aliasedPath } of injections) {
		const fields = path.split('.');
		const hop = injectedHop(aliasedPath);
		let aliases = alias;

		// A nested alias is declared on the parent hop's deep query.
		if (hop > 0) {
			let level = deep;

			for (const field of fields.slice(0, hop)) {
				level[field] ??= {};
				level = level[field];
			}

			level['_alias'] ??= {};
			aliases = level['_alias'];
		}

		aliases[`${SCOPED_CACHE_INJECTED_PREFIX}${fields[hop]}`] = fields[hop]!;
	}

	return {
		...query,
		fields: [
			...(query.fields ?? ['*']),
			...injections.map((injection) => injection.aliasedPath),
		],
		alias,
		deep,
	};
}

/** Takes the injected hops back out of the rows, whatever they came back as. */
export function stripScopedCacheOwnershipInjections(
	records: Item[],
	injections: ScopedCacheOwnershipInjection[],
): void {
	for (const { aliasedPath } of injections) {
		const segments = aliasedPath.split('.');
		const hop = injectedHop(aliasedPath);

		for (const record of records) {
			let node: unknown = record;

			for (const field of segments.slice(0, hop)) {
				node = node !== null && typeof node === 'object'
					? (node as Record<string, unknown>)[field]
					: undefined;
			}

			if (node !== null && typeof node === 'object') {
				delete (node as Record<string, unknown>)[segments[hop]!];
			}
		}
	}
}

function injectedHop(aliasedPath: string): number {
	return aliasedPath
		.split('.')
		.findIndex((segment) => segment.startsWith(SCOPED_CACHE_INJECTED_PREFIX));
}
