import { getUrl } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import type { PrimaryKeyType } from '@common/types';
import { PRIMARY_KEY_TYPES, USER } from '@common/variables';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { collectionArtists } from './no-relation.seed';

// Vendors where ItemsService.createMany emits a single multi-row INSERT … RETURNING (the
// "reliable batch" path in api/src/services/items.ts). All other vendors fall through the
// per-row loop and emit one INSERT per item. Both paths must produce the same observable
// result (count, distinct PKs, fields round-trip, explicit PKs preserved) — only the
// expected number of INSERT statements differs.
//
// sqlite3 is included here because it sits on top of SQLite ≥ 3.35, where INSERT … RETURNING
// is supported natively; ItemsService probes the version at runtime and falls back to the
// loop path on older builds. https://www.sqlite.org/lang_returning.html
const RETURNING_VENDORS = [
	'postgres',
	'postgres10',
	'cockroachdb',
	'mssql',
	'oracle',
	'sqlite3',
] as const satisfies readonly Vendor[];

function isReliableBatchVendor(vendor: Vendor): boolean {
	return (RETURNING_VENDORS as readonly Vendor[]).includes(vendor);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NOTE on response ordering: POST /items returns `data` via `service.readMany(savedKeys)` →
// `WHERE id _in (savedKeys)` (api/src/services/items.ts readMany), with no ORDER BY tying
// output rows to the input keys array. The DB returns rows in plan-dependent order — for
// an IN-list lookup on a UUID PK that is alphabetical by id (index-scan order), NOT
// insertion order. So response positions are not aligned with request positions; assert
// via name/id lookup, not by index. (If we ever change `readMany` to preserve key order,
// the lookup helper below still works.)
function indexResponseByName<T extends { name: string }>(items: T[]): Map<string, T> {
	return new Map(items.map((item) => [item.name, item]));
}

type Artist = {
	id?: number | string;
	name: string;
	company: string;
};

function buildArtist(
	pkType: PrimaryKeyType,
	index: number,
	nonce: string,
	opts: { explicitId?: boolean } = {},
): Artist {
	const artist: Artist = {
		name: `batch-${index}-${nonce}`,
		company: `co-${index}-${nonce}`,
	};

	if (pkType === 'string') {
		artist.id = `artist-${nonce}-${index}`;
	} else if (opts.explicitId) {
		if (pkType === 'uuid') {
			artist.id = randomUUID();
		} else if (pkType === 'integer') {
			// 1B+ offset stays above per-table AUTO_INCREMENT in fresh test DBs;
			// nonce hash makes consecutive runs use disjoint ranges.
			const nonceNum = parseInt(nonce.replace(/-/g, '').slice(0, 8), 16);
			artist.id = 1_000_000_000 + (nonceNum % 100_000_000) + index;
		}
	}

	return artist;
}

async function resetQueryCounter(vendor: Vendor) {
	await request(getUrl(vendor)).post('/query-counter/reset').set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);
}

async function fetchInsertQueriesForNonce(vendor: Vendor, nonce: string, collection: string) {
	const response = await request(getUrl(vendor))
		.get(`/query-counter/queries`)
		.query({ containsBinding: nonce, containsSql: `insert into` })
		.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

	const data = (response.body.data ?? []) as Array<{ sql: string; bindings: string }>;
	return data.filter((q) => q.sql.toLowerCase().includes(collection.toLowerCase()));
}

describe.each(PRIMARY_KEY_TYPES)('/items batch-insert', (pkType) => {
	const localCollectionArtists = `${collectionArtists}_${pkType}`;

	describe(`pkType: ${pkType}`, () => {
		describe('createMany short-circuits on empty input', () => {
			it.each(vendors)('%s', async (vendor) => {
				const nonce = randomUUID();

				await resetQueryCounter(vendor);

				const response = await request(getUrl(vendor))
					.post(`/items/${localCollectionArtists}`)
					.send([])
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				expect(response.statusCode).toBe(200);
				expect(response.body.data).toEqual([]);

				const inserts = await fetchInsertQueriesForNonce(vendor, nonce, localCollectionArtists);
				expect(inserts).toHaveLength(0);
			});
		});

		describe('createMany returns N items with distinct PKs, fields round-trip', () => {
			it.each(vendors)('%s', async (vendor) => {
				const N = 5;
				const nonce = randomUUID();
				const artists = Array.from({ length: N }, (_, i) => buildArtist(pkType, i, nonce));

				await resetQueryCounter(vendor);

				const response = await request(getUrl(vendor))
					.post(`/items/${localCollectionArtists}`)
					.send(artists)
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				expect(response.statusCode).toBe(200);

				const data = response.body.data as Array<{ id: number | string; name: string; company: string }>;
				expect(data).toHaveLength(N);

				expect(new Set(data.map((d) => d.id)).size).toBe(N);

				// Round-trip via name lookup (response order is NOT guaranteed; see header note)
				const byName = indexResponseByName(data);

				for (const artist of artists) {
					const got = byName.get(artist.name);
					expect(got, `missing inserted artist with name ${artist.name}`).toBeDefined();
					expect(got!.company).toBe(artist.company);
				}

				for (const id of data.map((d) => d.id)) {
					if (pkType === 'integer') {
						expect(typeof id).toBe('number');
						expect(id as number).toBeGreaterThan(0);
					} else if (pkType === 'uuid') {
						expect(typeof id).toBe('string');
						expect(id as string).toMatch(UUID_REGEX);
					} else {
						expect(typeof id).toBe('string');
						expect((id as string).length).toBeGreaterThan(0);
					}
				}

				// Query-count is the only branch: reliable vendors emit one multi-row INSERT,
				// loop-bucket vendors emit one INSERT per row.
				const inserts = await fetchInsertQueriesForNonce(vendor, nonce, localCollectionArtists);
				expect(inserts).toHaveLength(isReliableBatchVendor(vendor) ? 1 : N);
			});
		});

		describe('createOne (single-object POST) returns one item via createMany([one])', () => {
			it.each(vendors)('%s', async (vendor) => {
				const nonce = randomUUID();
				const artist = buildArtist(pkType, 0, nonce);

				await resetQueryCounter(vendor);

				const response = await request(getUrl(vendor))
					.post(`/items/${localCollectionArtists}`)
					.send(artist)
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				expect(response.statusCode).toBe(200);
				expect(response.body.data).toMatchObject({ name: artist.name, company: artist.company });

				const inserts = await fetchInsertQueriesForNonce(vendor, nonce, localCollectionArtists);
				expect(inserts).toHaveLength(1);
			});
		});

		if (pkType === 'string') {
			return;
		}

		describe('createMany preserves explicit PKs (homogeneous-explicit batch)', () => {
			it.each(vendors)('%s', async (vendor) => {
				const N = 3;
				const nonce = randomUUID();

				const artists = Array.from({ length: N }, (_, i) => buildArtist(pkType, i, nonce, { explicitId: true }));

				const sentIds = artists.map((a) => a.id!);

				await resetQueryCounter(vendor);

				const response = await request(getUrl(vendor))
					.post(`/items/${localCollectionArtists}`)
					.send(artists)
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				// MSSQL: inserting explicit values into an IDENTITY-typed integer PK requires
				// SET IDENTITY_INSERT ON. Neither knex's mssql querycompiler nor Directus's
				// createMany emits that toggle, so the INSERT fails with SQL Server error 544
				// ("Cannot insert explicit value for identity column ... when IDENTITY_INSERT
				// is set to OFF"). We pin the failure here so a future fix (e.g. an mssql
				// override in api/src/database/helpers/sequence/dialects/) lights up this test.
				if (pkType === 'integer' && vendor === 'mssql') {
					expect(response.statusCode).toBeGreaterThanOrEqual(400);
					expect(Array.isArray(response.body.errors)).toBe(true);
					expect(response.body.errors.length).toBeGreaterThan(0);
					return;
				}

				expect(response.statusCode).toBe(200);

				const data = response.body.data as Array<{ id: string | number; name: string }>;
				const byName = indexResponseByName(data);

				for (const artist of artists) {
					const got = byName.get(artist.name);
					expect(got).toBeDefined();
					expect(got!.id).toBe(artist.id);
				}

				expect(new Set(data.map((d) => d.id))).toEqual(new Set(sentIds));

				const inserts = await fetchInsertQueriesForNonce(vendor, nonce, localCollectionArtists);
				expect(inserts).toHaveLength(isReliableBatchVendor(vendor) ? 1 : N);
			});
		});

		if (pkType !== 'uuid') {
			// The mixed (some-explicit, some-auto in one batch) variant only runs for
			// UUID because integer PKs in a mixed batch have dialect-specific
			// auto-increment-advance semantics that aren't a regression target —
			// the homogeneous-explicit test above already verifies explicit PKs
			// survive on the integer path.
			return;
		}

		describe('createMany preserves explicit PKs and auto-generates the rest (mixed batch)', () => {
			it.each(vendors)('%s', async (vendor) => {
				const N = 5;
				const nonce = randomUUID();
				const explicitIndices = new Set([0, 2, 4]);

				const artists: Artist[] = Array.from({ length: N }, (_, i) =>
					buildArtist(pkType, i, nonce, { explicitId: explicitIndices.has(i) }),
				);

				const explicitIds = new Set([...explicitIndices].map((i) => artists[i]!.id!));

				await resetQueryCounter(vendor);

				const response = await request(getUrl(vendor))
					.post(`/items/${localCollectionArtists}`)
					.send(artists)
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				expect(response.statusCode).toBe(200);

				const data = response.body.data as Array<{ id: string; name: string; company: string }>;
				expect(data).toHaveLength(N);

				const byName = indexResponseByName(data);

				// Explicit PKs survive on the items that supplied them
				for (const i of explicitIndices) {
					const got = byName.get(artists[i]!.name);
					expect(got).toBeDefined();
					expect(got!.id).toBe(artists[i]!.id);
				}

				// Auto-gen items got non-empty distinct ids not colliding with explicit ones
				for (const i of [1, 3]) {
					const got = byName.get(artists[i]!.name);
					expect(got).toBeDefined();
					expect(typeof got!.id).toBe('string');
					expect(got!.id.length).toBeGreaterThan(0);
					expect(explicitIds.has(got!.id)).toBe(false);
				}

				expect(new Set(data.map((d) => d.id)).size).toBe(N);

				const inserts = await fetchInsertQueriesForNonce(vendor, nonce, localCollectionArtists);
				expect(inserts).toHaveLength(isReliableBatchVendor(vendor) ? 1 : N);
			});
		});
	});
});
