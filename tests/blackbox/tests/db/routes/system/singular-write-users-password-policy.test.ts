import { getUrl } from '@common/config';
import type { Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect } from 'vitest';
import { defineSingularWriteFeature } from './singular-write-steps';

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const policiesByVendor: Partial<Record<Vendor, string | null>> = {};

defineSingularWriteFeature(
	'./tests/db/routes/system/singular-write-users-password-policy.feature',
	{
		async beforeFeature(vendor) {
			const response = await request(getUrl(vendor))
				.get('/settings')
				.query({ fields: 'auth_password_policy' })
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			policiesByVendor[vendor] = response.body.data.auth_password_policy;
		},
		async afterFeature(vendor) {
			const response = await request(getUrl(vendor))
				.patch('/settings')
				.send({ auth_password_policy: policiesByVendor[vendor] ?? null })
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
		},
	},
);
