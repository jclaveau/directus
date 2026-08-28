import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import type { PrimaryKeyType } from '@common/types';
import { PRIMARY_KEY_TYPES, USER } from '@common/variables';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
	collectionDisciplines,
	collectionSegments,
	collectionUnits,
} from './shared-nested-row.seed';

// Directus resolves a related row once and hands the same object to every
// parent pointing at it, so the projection walks that row once per parent and
// has to answer the same each time. When it did not, the second parent's nested
// rows came back as nulls: the right length, no contents. Only a read reaching
// one row from several parents shows it.

function withKey(
	item: Record<string, unknown>,
	pkType: PrimaryKeyType,
	prefix: string,
) {
	return pkType === 'string'
		? { ...item, id: `${prefix}-${randomUUID()}` }
		: item;
}

describe.each(PRIMARY_KEY_TYPES)('/items', (pkType) => {
	const localCollectionUnits = `${collectionUnits}_${pkType}`;
	const localCollectionDisciplines = `${collectionDisciplines}_${pkType}`;
	const localCollectionSegments = `${collectionSegments}_${pkType}`;

	describe(`pkType: ${pkType}`, () => {
		describe('GET /:collection with a row reached from several parents', () => {
			it.each(vendors)('%s', async (vendor) => {
				// Setup: one discipline, two segments under it, two units pointing at it
				const discipline = await CreateItem(vendor, {
					collection: localCollectionDisciplines,
					item: withKey({ name: `shared-${randomUUID()}` }, pkType, 'discipline'),
				});

				const segments = [];

				for (const index of [0, 1]) {
					segments.push(
						await CreateItem(vendor, {
							collection: localCollectionSegments,
							item: withKey(
								{ discipline: discipline.id },
								pkType,
								`segment-${index}`,
							),
						}),
					);
				}

				const units = [];

				for (const index of [0, 1, 2]) {
					units.push(
						await CreateItem(vendor, {
							collection: localCollectionUnits,
							item: withKey({ discipline: discipline.id }, pkType, `unit-${index}`),
						}),
					);
				}

				// Action: `discipline.segments` names no field of the segments, so they come
				// back as keys — the exit whose second visit used to read a key off a key.
				const response = await request(getUrl(vendor))
					.get(`/items/${localCollectionUnits}`)
					.query({
						fields: 'id,discipline.id,discipline.segments',
						filter: JSON.stringify({ discipline: { _eq: discipline.id } }),
						sort: 'id',
					})
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				// Assert
				expect(response.statusCode).toEqual(200);
				expect(response.body.data).toHaveLength(units.length);

				const expectedSegments = segments.map((segment) => segment.id);

				for (const unit of response.body.data) {
					expect(unit.discipline.id).toEqual(discipline.id);
					expect(unit.discipline.segments).toEqual(expectedSegments);
				}
			});
		});

		describe('GET /:collection giving every parent the same nested rows', () => {
			it.each(vendors)('%s', async (vendor) => {
				// Setup
				const discipline = await CreateItem(vendor, {
					collection: localCollectionDisciplines,
					item: withKey({ name: `shared-${randomUUID()}` }, pkType, 'discipline'),
				});

				await CreateItem(vendor, {
					collection: localCollectionSegments,
					item: withKey({ discipline: discipline.id }, pkType, 'segment'),
				});

				for (const index of [0, 1]) {
					await CreateItem(vendor, {
						collection: localCollectionUnits,
						item: withKey({ discipline: discipline.id }, pkType, `unit-${index}`),
					});
				}

				// Action: the nested rows carry a field of their own this time, so they stay
				// objects rather than collapsing — the same walk, its other exit.
				const response = await request(getUrl(vendor))
					.get(`/items/${localCollectionUnits}`)
					.query({
						fields: 'id,discipline.id,discipline.segments.id',
						filter: JSON.stringify({ discipline: { _eq: discipline.id } }),
						sort: 'id',
					})
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				// Assert
				expect(response.statusCode).toEqual(200);

				const disciplines = response.body.data.map((unit: any) => unit.discipline);

				expect(disciplines).toHaveLength(2);
				expect(disciplines[1]).toEqual(disciplines[0]);
				expect(disciplines[0].segments[0]).toMatchObject({ id: expect.anything() });
			});
		});
	});
});
