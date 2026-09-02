import { randomUUID } from 'node:crypto';
import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

// `ItemsService.updateMany` calls `validateUserCountIntegrity` itself whenever the
// payload raised a flag and the caller offered no `onRequireUserIntegrityCheck` to
// take it over — the branch that tells a top-level update from a nested one. Only
// the system services raise those flags, and `PoliciesService.updateMany` raises
// them for `app_access` and `admin_access` before delegating, so a policy PATCH is
// the shortest route to that branch from HTTP.
//
// These reach the branch and assert the write landed; none of them counts how many
// times the check ran, which is not observable from outside.
//
// The policies below are attached to no role, so granting one app access counts
// nobody in and cannot alter what any other suite is allowed to do.

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

describe('policy updates run the user-count integrity check', () => {
	describe.each(vendors)('%s', (vendor) => {
		async function createDetachedPolicy({ adminAccess = false } = {}) {
			const response = await request(getUrl(vendor))
				.post('/policies')
				.send({
					name: `test_policy_integrity_${randomUUID()}`,
					app_access: false,
					admin_access: adminAccess,
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			return response.body.data as { id: string; admin_access: boolean };
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

		it('updates every policy of an array body', async () => {
			const [first, second] = await Promise.all([
				createDetachedPolicy(),
				createDetachedPolicy(),
			]);

			// An array body reaches `updateBatch`, which drives `updateOne` per row
			// and collects each row's flags through `onRequireUserIntegrityCheck`
			// instead of letting them validate, so the check falls to its own block
			// after the loop rather than to `updateMany`'s.
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
			const policy = await createDetachedPolicy({ adminAccess: true });

			// The policy really did grant admin access, so revoking it is a change
			// rather than a no-op — and `admin_access` raises the remaining-admins
			// flag, a different arm of the same check. Attached to no role, it
			// counted nobody in, so turning it off leaves every admin standing.
			const response = await request(getUrl(vendor))
				.patch(`/policies/${policy.id}`)
				.send({ admin_access: false })
				.set('Authorization', AUTH);

			expect(policy.admin_access).toBe(true);
			expect(response.statusCode).toEqual(200);
			expect(response.body.data.admin_access).toBe(false);
		});
	});
});
