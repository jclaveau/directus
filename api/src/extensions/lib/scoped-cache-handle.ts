import type {
	ApiExtensionContext,
	PrimaryKey,
	ScopedCacheExtensionHandle,
	ScopedCacheFingerprint,
} from '@directus/types';
import { getCache } from '../../cache.js';
import getDatabase from '../../database/index.js';
import { useLogger } from '../../logger/index.js';
import {
	composeScopedCachePaths,
	type FieldTypesByField,
	ItemScopedCacheService,
	purgeScopedCache,
	scopedCacheMutatedFingerprints,
	scopedCacheFingerprintOf,
	scopedCacheIndexPath,
	scopedCachePurgeEnabled,
	scopedCacheCollectionPinsFromRows,
	type ScopedCacheSnapshot,
} from '../../scoped-cache/index.js';

/**
 * Build the `context.scopedCache` handle for a register-type extension's
 * registration context (hook/endpoint/operation), closing over that context's own
 * `getSchema` so a per-request schema override is honored. Lives in its own leaf
 * module so `getCache` (cache.js) and the purge engine (scoped-cache.js) can both be
 * imported without re-entering the `cache.js` ⇄ `scoped-cache.js` cycle.
 *
 * See `ScopedCacheExtensionHandle` for the contract and footgun.
 */
export function createScopedCacheExtensionHandle(
	getSchema: ApiExtensionContext['getSchema'],
): ScopedCacheExtensionHandle {
	return {
		async purgeForMutatedRows(collection, mutatedRows) {
			const { cache } = getCache();

			if (!cache) {
				return;
			}

			// Scoped purging off (memory store / CI): no fingerprint index to target a
			// slice, so a bypassed write can only stay correct by dropping the whole
			// data cache. (The same fallback `purgeScopedCache` runs when scoped is
			// off.)
			if (!scopedCachePurgeEnabled()) {
				await cache.clear();
				return;
			}

			const schema = await getSchema();
			const collectionSchema = schema.collections[collection];
			const scopeFields = collectionSchema?.scopedCacheFields ?? [];

			const hasRelationalScope =
				scopeFields.some((field) => field.includes('.'))
				|| composeScopedCachePaths(schema, collection).length > 0;

			// The primary key pins on every collection, declared or not, so a bypassed
			// write owes its key slices too — a read of that row pinned nothing else.
			// Deduped, since a project may also list its key as a scope field.
			const primaryKeyField = collectionSchema?.primary;

			// A raw row lacks the relational terminals; the snapshot joins them in by key.
			if (hasRelationalScope) {
				// No key to read a row back by: even a terminal the row spells out is
				// not trusted, since the flat path would bind it as given.
				if (primaryKeyField === undefined || mutatedRows.some((mutatedRow) => {
					const mutatedKey = mutatedRow[primaryKeyField];

					return mutatedKey === undefined || mutatedKey === null;
				})) {
					await purgeScopedCache(cache, collection, null);
					return;
				}

				const distinctKeys = [...new Set(mutatedRows.map((mutatedRow) => {
					return mutatedRow[primaryKeyField] as PrimaryKey;
				}))];

				let scopedCacheSnapshot: ScopedCacheSnapshot;

				// The caller's write has committed already, so a failed read must
				// still purge rather than throw past it and leave the slices stale.
				try {
					scopedCacheSnapshot = await new ItemScopedCacheService(
						collection,
						schema,
						getDatabase(),
						cache,
						null,
					).snapshot(distinctKeys);
				}
				catch (error) {
					useLogger().warn(
						error,
						`[scoped-cache] purgeForMutatedRows could not read back `
						+ `${collection}, purging it whole`,
					);

					await purgeScopedCache(cache, collection, null);
					return;
				}

				const snapshotFingerprints =
					scopedCacheMutatedFingerprints(scopedCacheSnapshot);

				// A key the read did not find — a deleted row, or an uncommitted insert
				// — has no terminal left to name its old slice by.
				if (
					snapshotFingerprints === null
					|| scopedCacheSnapshot.rows.length < distinctKeys.length
				) {
					await purgeScopedCache(cache, collection, null);
					return;
				}

				await purgeScopedCache(cache, collection, [], null, {
					rowFingerprints: snapshotFingerprints,
					indexPath: scopedCacheIndexPath(schema, collection),
				});

				return;
			}

			const pinnedFields = primaryKeyField === undefined
				? scopeFields
				: [...new Set([primaryKeyField, ...scopeFields])];

			const fieldTypes: FieldTypesByField = Object.fromEntries(
				pinnedFields.map((field) => [field, collectionSchema?.fields[field]?.type]),
			);

			// One fingerprint per row, not one pin per value: a flat pin list spells a
			// row's pins as separate slices, so a read bound to `owner=alpha AND
			// method=spaced` would go on any write carrying either one. A fingerprint
			// keeps them together, which is the whole query case the index purge tests
			// each row against.
			//
			// 'coarse': a row missing a pinned field yields null → a collection-wide
			// purge (fail-safe), never a silently-stale slice. That covers a row handed
			// over without its primary key.
			const rowFingerprints: ScopedCacheFingerprint[] = [];

			for (const mutatedRow of mutatedRows) {
				const rowPins = scopedCacheCollectionPinsFromRows(
					collection,
					pinnedFields,
					[mutatedRow],
					'coarse',
					fieldTypes,
				);

				if (rowPins === null) {
					await purgeScopedCache(cache, collection, null);
					return;
				}

				rowFingerprints.push(scopedCacheFingerprintOf(collection, rowPins));
			}

			// Nothing for the rows to bind — a collection pinning no axis at all, or a
			// write naming no row — leaves the bare collection fingerprint, which is
			// what the reads it can still reach were filed under.
			if (pinnedFields.length === 0 || rowFingerprints.length === 0) {
				await purgeScopedCache(cache, collection, []);
				return;
			}

			// No `changed`: a raw write says which rows it touched and nothing about
			// which columns it rewrote, so every field reads as rewritten.
			await purgeScopedCache(cache, collection, [], null, {
				rowFingerprints,
				indexPath: scopedCacheIndexPath(schema, collection),
			});
		},
	};
}
