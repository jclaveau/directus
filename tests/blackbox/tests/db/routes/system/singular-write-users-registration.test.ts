import { getUrl } from '@common/config';
import type { Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect } from 'vitest';
import { defineSingularWriteFeature } from './singular-write-steps';

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const REGISTRATION_FIELDS = [
	'public_registration',
	'public_registration_verify_email',
	'public_registration_role',
	'public_registration_email_filter',
];

const settingsByVendor: Partial<Record<Vendor, Record<string, unknown>>> = {};

defineSingularWriteFeature(
	'./tests/db/routes/system/singular-write-users-registration.feature',
	{
		async beforeFeature(vendor) {
			const response = await request(getUrl(vendor))
				.get('/settings')
				.query({ fields: REGISTRATION_FIELDS.join(',') })
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			settingsByVendor[vendor] = response.body.data;
		},
		async afterFeature(vendor) {
			const response = await request(getUrl(vendor))
				.patch('/settings')
				.send(settingsByVendor[vendor] ?? {})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
		},
	},
);
