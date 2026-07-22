import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
	collectionContainsNull,
	collectionFkChild,
	collectionFkParent,
	collectionUnique,
} from './db-error-translation.seed';

describe('translateDatabaseError', () => {
	describe('duplicate on a unique field -> RECORD_NOT_UNIQUE', () => {
		it.each(vendors)('%s', async (vendor) => {
			// Setup
			const code = `dup-${randomUUID()}`;

			const first = await request(getUrl(vendor))
				.post(`/items/${collectionUnique}`)
				.send({ code })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Action
			const second = await request(getUrl(vendor))
				.post(`/items/${collectionUnique}`)
				.send({ code })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Assert
			expect(first.statusCode).toBe(200);
			expect(second.statusCode).toBe(400);
			expect(second.body.errors[0].extensions.code).toBe('RECORD_NOT_UNIQUE');
		});
	});

	describe('alter to NOT NULL over a null row -> CONTAINS_NULL_VALUES', () => {
		it.each(vendors)('%s', async (vendor) => {
			// Setup: a row whose `label` is null
			const created = await request(getUrl(vendor))
				.post(`/items/${collectionContainsNull}`)
				.send({ label: null })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Action: tighten the column to NOT NULL while the null row exists
			const altered = await request(getUrl(vendor))
				.patch(`/fields/${collectionContainsNull}/label`)
				.send({
					field: 'label',
					type: 'string',
					meta: {},
					schema: { is_nullable: false },
				})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Restore the column so re-runs of this suite stay idempotent
			await request(getUrl(vendor))
				.patch(`/fields/${collectionContainsNull}/label`)
				.send({
					field: 'label',
					type: 'string',
					meta: {},
					schema: { is_nullable: true },
				})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Assert
			expect(created.statusCode).toBe(200);
			expect(altered.statusCode).toBe(400);
			expect(altered.body.errors[0].extensions.code).toBe('CONTAINS_NULL_VALUES');
		});
	});

	describe('missing M2O target -> INVALID_FOREIGN_KEY', () => {
		it.each(vendors)('%s', async (vendor) => {
			// Action: point the M2O at a parent id that does not exist
			const response = await request(getUrl(vendor))
				.post(`/items/${collectionFkChild}`)
				.send({ parent: 999999 })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Assert
			expect(response.statusCode).toBe(400);
			expect(response.body.errors[0].extensions.code).toBe('INVALID_FOREIGN_KEY');
		});
	});

	describe('delete a still-referenced parent -> INVALID_FOREIGN_KEY', () => {
		it.each(vendors)('%s', async (vendor) => {
			// Setup: a parent and a child pointing at it
			const parent = await request(getUrl(vendor))
				.post(`/items/${collectionFkParent}`)
				.send({})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			const parentId = parent.body.data.id;

			await request(getUrl(vendor))
				.post(`/items/${collectionFkChild}`)
				.send({ parent: parentId })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Action: delete the still-referenced parent
			const response = await request(getUrl(vendor))
				.delete(`/items/${collectionFkParent}/${parentId}`)
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// The translated message is vendor-specific: sqlite can't extract the
			// column so it yields the bare prefix, pg names the field/collection.
			// Pin the full string where we know it; other vendors (Full matrix)
			// still assert the translated prefix.
			const exactMessage: Record<string, string> = {
				postgres: `Invalid foreign key for field "id" in collection "${collectionFkChild}".`,
				sqlite3: 'Invalid foreign key.',
			};

			// Assert
			expect(response.statusCode).toBe(400);
			expect(response.body.errors[0].extensions.code).toBe('INVALID_FOREIGN_KEY');

			if (exactMessage[vendor]) {
				expect(response.body.errors[0].message).toBe(exactMessage[vendor]);
			}
			else {
				expect(response.body.errors[0].message).toContain('Invalid foreign key');
			}
		});
	});
});
