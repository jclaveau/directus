import { getUrl } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
	type StepFunctions,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { describe, expect } from 'vitest';

type Update = {
	userId: string;
	response?: request.Response;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature(
	'./tests/db/routes/users/update-batch-guards.feature',
);

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		scenario(
			'a batch setting a tfa_secret is refused and writes nothing',
			({ given, when, then, and }: StepFunctions) => {
				const update: Update = { userId: '' };

				given(/^the user "(.*)"$/, async (firstName: string) => {
					const response = await request(getUrl(vendor))
						.post('/users')
						.send({
							first_name: firstName,
							email: `${firstName}-${randomUUID()}@example.com`,
						})
						.query({ fields: 'id' })
						.set('Authorization', AUTH);

					expect(response.statusCode).toEqual(200);

					update.userId = response.body.data.id;
				});

				when('the batch sends:', async (table: Record<string, string>[]) => {
					update.response = await request(getUrl(vendor))
						.patch('/users')
						.send(parseGherkinTable(table).map((change) => {
							return { id: update.userId, ...change };
						}))
						.set('Authorization', AUTH);
				});

				then(
					/^the update is refused with a reason naming "(.*)"$/,
					(reason: string) => {
						expect(update.response!.statusCode).toEqual(400);
						expect(update.response!.body.errors[0].message).toContain(reason);
					},
				);

				and('the user holds:', async (table: Record<string, string>[]) => {
					const response = await request(getUrl(vendor))
						.get(`/users/${update.userId}`)
						.query({ fields: 'first_name,tfa_secret' })
						.set('Authorization', AUTH);

					expect(response.statusCode).toEqual(200);
					expect([response.body.data]).toEqual(parseGherkinTable(table));
				});
			},
			60_000,
		);
	});
});
