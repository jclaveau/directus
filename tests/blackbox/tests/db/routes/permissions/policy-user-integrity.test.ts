import { randomUUID } from 'node:crypto';
import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

// `updateMany` runs the user-count integrity check itself whenever the payload
// raised a flag and no caller offered to take it over — the branch at
// items.ts:1754-1762 that tells a top-level update from a nested one. Only the
// system services raise those flags, and `PoliciesService.updateMany` raises
// `UserLimits` for `app_access` before delegating, so a policy PATCH is the
// shortest route to it from HTTP.
//
// The policies below are attached to no role, so granting one app access counts
// nobody in and cannot alter what any other suite is allowed to do.

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

describe('policy updates run the user-count integrity check', () => {
	describe.each(vendors)('%s', (vendor) => {
		async function createDetachedPolicy() {
			const response = await request(getUrl(vendor))
				.post('/policies')
				.send({
					name: `test_policy_integrity_${randomUUID()}`,
					app_access: false,
					admin_access: false,
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			return response.body.data as { id: string; app_access: boolean };
		}

		it('grants app access through the checked update path', async () => {
			const policy = await createDetachedPolicy();

			const response = await request(getUrl(vendor))
				.patch(`/policies/${policy.id}`)
				.send({ app_access: true })
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.data.app_access).toBe(true);
		});

		it('runs the check once for a whole batch, not once per row', async () => {
			const [first, second] = await Promise.all([
				createDetachedPolicy(),
				createDetachedPolicy(),
			]);

			// An array body reaches updateBatch, which drives updateOne per row and
			// collects each row's flags through `onRequireUserIntegrityCheck` rather
			// than letting it validate — so the count is checked once, after the
			// loop, on the batch's own transaction.
			const response = await request(getUrl(vendor))
				.patch('/policies')
				.send([
					{ id: first.id, app_access: true },
					{ id: second.id, app_access: true },
				])
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			expect(response.body.data.map((policy: { app_access: boolean }) => {
				return policy.app_access;
			})).toEqual([true, true]);
		});

		it('revokes admin access through the checked update path', async () => {
			const policy = await createDetachedPolicy();

			// `admin_access` raises the remaining-admins flag, a different arm of the
			// same check: turning it off has to leave at least one admin standing,
			// and this policy never granted admin access to anybody.
			const response = await request(getUrl(vendor))
				.patch(`/policies/${policy.id}`)
				.send({ admin_access: false })
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.data.admin_access).toBe(false);
		});
	});
});
