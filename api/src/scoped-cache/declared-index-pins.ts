import type {
	SchemaOverview,
	ScopedCacheFingerprint,
} from '@directus/types';
import type { Knex } from 'knex';
import { useLogger } from '../logger/index.js';
import { scopedCacheFingerprintIsBare } from './fingerprint.js';

/**
 * How many keys a declared purge reads back before it reads its collection's index
 * whole instead: one index chunk's worth.
 */
const SCOPED_CACHE_READ_BACK_KEYS = 500;

/** The token `canonicalizeScopedCachePinValue` spells a null as. */
const SCOPED_CACHE_NULL_TOKEN = '\x00null';

function pinnedTokensAt(
	fingerprint: ScopedCacheFingerprint,
	field: string,
): readonly string[] {
	const pinnedScope = fingerprint.pinnedScope ?? {};

	return Object.hasOwn(pinnedScope, field)
		? pinnedScope[field]!
		: [];
}

/**
 * The declared pins, each also pinned to the index path's values its relation
 * reaches — what the store reads instead of every set the collection owns — or
 * `null` when those values cannot be read back, and the store has to.
 *
 * Only for a pin on the index path's first hop: `student_course_id=7` under
 * `student_course_id.teaching_unit.owner` reads `teaching_unit.owner` off
 * `student_courses` row 7. The value at the path's end is reached THROUGH the
 * key, so it is a function of the key alone, never of the rows holding it: a row
 * that moved off 7, or was deleted, cannot hide a value an entry holding it was
 * filed under. A pin on any other field could only be read back through the rows
 * holding it now — which a moved row no longer is.
 *
 * That function is read after the mutation committed, so a mutation of a
 * collection the path walks through — `student_courses` or `teaching_units` — may
 * have just changed it, and the value an entry was filed under is gone: the store
 * reads the index whole for that one. So does a collection the database changed
 * under the mutation, as a delete's `SET NULL` rewrites `teaching_units.owner`.
 *
 * What it returns is what the store scans, never what the purge matches: the
 * match still tests the pins as declared. A bare pin is left out of it, since the
 * entries it reaches pin nothing, and every other pin reaches those too.
 */
export async function scopedCacheDeclaredIndexPins(
	schema: SchemaOverview,
	knex: Knex,
	collection: string,
	declared: readonly ScopedCacheFingerprint[],
	indexPath: string | null,
	mutatedCollections: readonly string[],
): Promise<ScopedCacheFingerprint[] | null> {
	const [hopField, ...terminalSegments] = indexPath?.split('.') ?? [];

	if (indexPath === null || hopField === undefined) {
		return null;
	}

	const walkedCollections: string[] = [];

	for (const segment of [hopField, ...terminalSegments.slice(0, -1)]) {
		const walkedFrom = walkedCollections.at(-1) ?? collection;

		const reachedCollection = schema.relations.find((relation) => {
			return relation.collection === walkedFrom && relation.field === segment;
		})?.related_collection;

		if (!reachedCollection || mutatedCollections.includes(reachedCollection)) {
			return null;
		}

		walkedCollections.push(reachedCollection);
	}

	const [relatedCollection] = walkedCollections;

	const relatedPrimaryKey = relatedCollection
		? schema.collections[relatedCollection]?.primary
		: undefined;

	if (!relatedCollection || relatedPrimaryKey === undefined) {
		return null;
	}

	const readBackKeys = new Set<string>();

	for (const fingerprint of declared) {
		if (
			scopedCacheFingerprintIsBare(fingerprint)
			|| pinnedTokensAt(fingerprint, indexPath).length > 0
		) {
			continue;
		}

		const hopTokens = pinnedTokensAt(fingerprint, hopField);

		// A pin silent on the hop says nothing about which value it reaches.
		if (hopTokens.length === 0) {
			return null;
		}

		for (const hopToken of hopTokens) {
			readBackKeys.add(hopToken);
		}
	}

	if (
		readBackKeys.size === 0
		|| readBackKeys.size > SCOPED_CACHE_READ_BACK_KEYS
		|| readBackKeys.has(SCOPED_CACHE_NULL_TOKEN)
	) {
		return null;
	}

	let snapshot;

	// After the mutation committed: a failed read must not throw past it.
	try {
		// Loaded on use: the service imports the purge that imports this module.
		const { ItemScopedCacheService } =
			await import('./item-scoped-cache-service.js');

		snapshot = await new ItemScopedCacheService(
			relatedCollection,
			schema,
			knex,
			null,
			null,
		).snapshot([...readBackKeys]);
	}
	catch (error) {
		useLogger().warn(
			error,
			`[scoped-cache] a declared pin on ${collection}.${hopField} could not be `
			+ `read back, reading its index whole: ${error}`,
		);

		return null;
	}

	if (snapshot.canResolveSlicesFromRows === false) {
		return null;
	}

	const terminalPath = terminalSegments.join('.');
	const terminalTokensByKey = new Map<string, readonly string[]>();

	for (const { fingerprint } of snapshot.rows) {
		const [keyToken] = pinnedTokensAt(fingerprint, relatedPrimaryKey);
		const terminalTokens = pinnedTokensAt(fingerprint, terminalPath);

		if (keyToken === undefined || terminalTokens.length === 0) {
			return null;
		}

		terminalTokensByKey.set(keyToken, terminalTokens);
	}

	const scannedPins: ScopedCacheFingerprint[] = [];

	for (const fingerprint of declared) {
		if (scopedCacheFingerprintIsBare(fingerprint)) {
			continue;
		}

		if (pinnedTokensAt(fingerprint, indexPath).length > 0) {
			scannedPins.push(fingerprint);
			continue;
		}

		const terminalTokens = new Set<string>();

		for (const hopToken of pinnedTokensAt(fingerprint, hopField)) {
			const reachedTokens = terminalTokensByKey.get(hopToken);

			// A key read back as nothing — deleted, or spelled unlike its row —
			// leaves the values its entries were filed under unknown.
			if (reachedTokens === undefined) {
				return null;
			}

			for (const reachedToken of reachedTokens) {
				terminalTokens.add(reachedToken);
			}
		}

		scannedPins.push({
			...fingerprint,
			pinnedScope: {
				...fingerprint.pinnedScope,
				[indexPath]: [...terminalTokens],
			},
		});
	}

	return scannedPins;
}
