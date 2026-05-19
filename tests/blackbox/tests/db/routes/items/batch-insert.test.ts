import { getUrl } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import type { PrimaryKeyType } from '@common/types';
import { PRIMARY_KEY_TYPES, USER } from '@common/variables';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { collectionArtists } from './no-relation.seed';

const RETURNING_VENDORS = ['postgres', 'postgres10', 'cockroachdb', 'mssql', 'oracle'] as const satisfies readonly Vendor[];
const returningVendors = vendors.filter((v) => (RETURNING_VENDORS as readonly Vendor[]).includes(v));

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Artist = {
	id?: number | string;
	name: string;
	company: string;
};

function buildArtist(pkType: PrimaryKeyType, index: number, nonce: string, opts: { explicitId?: boolean } = {}): Artist {
	const artist: Artist = {
		name: `batch-${index}-${nonce}`,
		company: `co-${index}-${nonce}`,
	};

	if (pkType === 'string') {
		artist.id = `artist-${nonce}-${index}`;
	} else if (opts.explicitId && pkType === 'uuid') {
		artist.id = randomUUID();
	}

	return artist;
}

async function resetQueryCounter(vendor: Vendor) {
	await request(getUrl(vendor))
		.post('/query-counter/reset')
		.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);
}

async function fetchInsertQueriesForNonce(vendor: Vendor, nonce: string, collection: string) {
	const response = await request(getUrl(vendor))
		.get(`/query-counter/queries`)
		.query({ containsBinding: nonce, containsSql: `insert into` })
		.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

	const data = (response.body.data ?? []) as Array<{ sql: string; bindings: string }>;
	return data.filter((q) => q.sql.toLowerCase().includes(collection.toLowerCase()));
}

describe.each(PRIMARY_KEY_TYPES)('/items batch-insert (RETURNING vendors)', (pkType) => {
	const localCollectionArtists = `${collectionArtists}_${pkType}`;

	describe(`pkType: ${pkType}`, () => {
		describe('createMany returns N items with distinct PKs, input order preserved, fields round-trip', () => {
			it.each(returningVendors)('%s', async (vendor) => {
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

				for (let i = 0; i < N; i++) {
					expect(data[i]!.name).toBe(artists[i]!.name);
					expect(data[i]!.company).toBe(artists[i]!.company);
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

				const inserts = await fetchInsertQueriesForNonce(vendor, nonce, localCollectionArtists);
				expect(inserts).toHaveLength(1);
			});
		});

		if (pkType !== 'uuid') {
			return;
		}

		describe('createMany preserves explicit PKs and auto-generates the rest', () => {
			it.each(returningVendors)('%s', async (vendor) => {
				const nonce = randomUUID();
				const explicitIndices = new Set([0, 2, 4]);

				const artists: Artist[] = Array.from({ length: 5 }, (_, i) =>
					buildArtist(pkType, i, nonce, { explicitId: explicitIndices.has(i) }),
				);

				const explicitIds = [...explicitIndices].map((i) => artists[i]!.id!);

				await resetQueryCounter(vendor);

				const response = await request(getUrl(vendor))
					.post(`/items/${localCollectionArtists}`)
					.send(artists)
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				expect(response.statusCode).toBe(200);

				const data = response.body.data as Array<{ id: string; name: string; company: string }>;
				expect(data).toHaveLength(5);

				for (const i of explicitIndices) {
					expect(data[i]!.id).toBe(artists[i]!.id);
				}

				for (const i of [1, 3]) {
					const id = data[i]!.id;
					expect(typeof id).toBe('string');
					expect(id.length).toBeGreaterThan(0);
					expect(explicitIds).not.toContain(id);
				}

				expect(new Set(data.map((d) => d.id)).size).toBe(5);

				for (let i = 0; i < 5; i++) {
					expect(data[i]!.name).toBe(artists[i]!.name);
				}

				const inserts = await fetchInsertQueriesForNonce(vendor, nonce, localCollectionArtists);
				expect(inserts).toHaveLength(1);
			});
		});
	});
});
