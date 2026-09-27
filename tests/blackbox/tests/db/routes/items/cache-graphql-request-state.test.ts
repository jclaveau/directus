import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { ROLE, USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import getPort from 'get-port';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const cacheStatusHeader = 'x-cache-status';
const COLLECTION = 'request_state';

const feature = loadFeature(
	'./tests/db/routes/items/cache-graphql-request-state.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-graphql-request-state-${vendor}`;

	let instance: ChildProcess;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	// Every user a scenario created, removed once the file is done with them.
	const createdUserIds: string[] = [];
	let adminRoleId: string;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [{
				collection: COLLECTION,
				meta: { scoped_cache_fields: ['slot'] },
				fields: [
					{ field: 'slot', type: 'string', meta: {} },
					{ field: 'label', type: 'string', meta: {} },
				],
			}],
		});

		await CreateItem(vendor, {
			collection: COLLECTION,
			item: [
				{ slot: 'one', label: 'one' },
				{ slot: 'two', label: 'two' },
			],
		});

		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);

		const roles = await request(getUrl(vendor, env))
			.get('/roles')
			.query({ filter: JSON.stringify({ name: { _eq: ROLE.ADMIN.NAME } }) })
			.set('Authorization', auth);

		expect(roles.statusCode).toBe(200);
		adminRoleId = roles.body.data[0].id;
	}, 60_000);

	afterAll(async () => {
		for (const userId of createdUserIds) {
			await request(getUrl(vendor, env))
				.delete(`/users/${userId}`)
				.set('Authorization', auth);
		}

		instance.kill();

		await DeleteCollection(vendor, { collection: COLLECTION });
	});

	type ReadRow = { query: string; response: string };

	async function expectRead(
		token: string,
		{ query, response: expectedResponse }: ReadRow,
		status: 'HIT' | 'MISS',
	) {
		const response = await request(getUrl(vendor, env))
			.post('/graphql')
			.send({ query })
			.set('Authorization', `Bearer ${token}`);

		expect(response.statusCode).toBe(200);
		expect(response.body.errors).toBeUndefined();
		expect(response.headers[cacheStatusHeader]).toBe(status);

		expect(response.body.data).toEqual(
			loadYaml(expectedResponse) as Record<string, unknown>,
		);
	}

	// Created by the scenario that reads as them, so the schema their first
	// request builds is theirs alone.
	async function createUser() {
		const token = randomUUID();

		const response = await request(getUrl(vendor, env))
			.post('/users')
			.send({
				email: `reader-${token}@request-state.example.com`,
				token,
				role: adminRoleId,
			})
			.set('Authorization', auth);

		expect(response.statusCode).toBe(200);
		createdUserIds.push(response.body.data.id);

		return token;
	}

	function defineGivenSteps(
		{ given, and }: StepFunctions,
		reader: { token: string },
	) {
		// The MISS then HIT proves the first request of a key is cached, so the
		// read after it fails for the schema it reuses, not for its own shape.
		given.optional(
			'a user whose schema is built by this read, which is cached:',
			async (table: Record<string, string>[]) => {
				reader.token = await createUser();

				await expectRead(reader.token, table[0] as ReadRow, 'MISS');
				await expectRead(reader.token, table[0] as ReadRow, 'HIT');
			},
		);

		given.optional(
			/^a user whose schema is built by a read sent as "(.*)"$/,
			async (userAgent: string) => {
				reader.token = await createUser();

				const response = await request(getUrl(vendor, env))
					.post('/graphql')
					.send({ query: `{ ${COLLECTION} { id } }` })
					.set('Authorization', `Bearer ${reader.token}`)
					.set('User-Agent', userAgent);

				expect(response.statusCode).toBe(200);
				expect(response.body.errors).toBeUndefined();
			},
		);

		and.optional(
			'this read is cached:',
			async (table: Record<string, string>[]) => {
				await expectRead(reader.token, table[0] as ReadRow, 'MISS');
				await expectRead(reader.token, table[0] as ReadRow, 'HIT');
			},
		);
	}

	function defineWhenSteps(
		{ when }: StepFunctions,
		reader: { token: string; createdId?: number },
	) {
		when.optional(
			/^the row in slot "(.*)" is relabelled "(.*)"$/,
			async (slot: string, label: string) => {
				const response = await request(getUrl(vendor, env))
					.patch(`/items/${COLLECTION}`)
					.send({
						query: { filter: { slot: { _eq: slot } } },
						data: { label },
					})
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);
			},
		);

		when.optional(
			/^the user creates a row in slot "(.*)" through GraphQL, sent as "(.*)"$/,
			async (slot: string, userAgent: string) => {
				const response = await request(getUrl(vendor, env))
					.post('/graphql')
					.send({
						query: `mutation { create_${COLLECTION}_item(
							data: { slot: "${slot}", label: "${slot}" }
						) { id } }`,
					})
					.set('Authorization', `Bearer ${reader.token}`)
					.set('User-Agent', userAgent);

				expect(response.statusCode).toBe(200);
				expect(response.body.errors).toBeUndefined();
				reader.createdId = response.body.data[`create_${COLLECTION}_item`].id;
			},
		);
	}

	function defineThenSteps(
		{ then, and }: StepFunctions,
		reader: { token: string; createdId?: number },
	) {
		then.optional(
			/^the read is purged, .+:$/,
			async (table: Record<string, string>[]) => {
				await expectRead(reader.token, table[0] as ReadRow, 'MISS');
			},
		);

		and.optional(
			/^the read that built the schema is still cached, .+:$/,
			async (table: Record<string, string>[]) => {
				await expectRead(reader.token, table[0] as ReadRow, 'HIT');
			},
		);

		then.optional(
			/^the activity of that row names "(.*)" as its user agent$/,
			async (userAgent: string) => {
				const response = await request(getUrl(vendor, env))
					.get('/activity')
					.query({
						filter: JSON.stringify({
							collection: { _eq: COLLECTION },
							item: { _eq: String(reader.createdId) },
						}),
						fields: 'action,user_agent',
					})
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);

				expect(response.body.data).toEqual([
					{ action: 'create', user_agent: userAgent },
				]);
			},
		);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a user\'s second read is cached, and purged by a write to its row',
			(steps) => {
				const reader = { token: '' };

				defineGivenSteps(steps, reader);

				defineWhenSteps(steps, reader);

				defineThenSteps(steps, reader);
			},
			60_000,
		);

		scenario(
			'a mutation records the user agent of the request that sent it',
			(steps) => {
				const reader = { token: '' };

				defineGivenSteps(steps, reader);

				defineWhenSteps(steps, reader);

				defineThenSteps(steps, reader);
			},
			60_000,
		);
	});
});
