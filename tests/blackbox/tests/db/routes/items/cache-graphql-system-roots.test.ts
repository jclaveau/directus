import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
	type StepFunctions,
} from '@common/cucumber';
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

const feature = loadFeature(
	'./tests/db/routes/items/cache-graphql-system-roots.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-graphql-system-roots-${vendor}`;

	let instance: ChildProcess;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	// Every user a scenario created, removed once the file is done with them.
	const createdUserIds: string[] = [];

	// The descriptor the database held before the file wrote its own, put back
	// once the file is done.
	let originalDescriptor: string | null = null;
	let adminRoleId: string;

	beforeAll(async () => {
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

		const settings = await request(getUrl(vendor, env))
			.get('/settings')
			.query({ fields: 'project_descriptor' })
			.set('Authorization', auth);

		expect(settings.statusCode).toBe(200);
		originalDescriptor = settings.body.data.project_descriptor;
	}, 60_000);

	afterAll(async () => {
		await request(getUrl(vendor, env))
			.patch('/settings')
			.send({ project_descriptor: originalDescriptor })
			.set('Authorization', auth);

		for (const userId of createdUserIds) {
			await request(getUrl(vendor, env))
				.delete(`/users/${userId}`)
				.set('Authorization', auth);
		}

		instance.kill();
	});

	type ReadRow = { user: string; query: string; response: string };

	// A response holds only the roots carrying the scenario's point, in YAML, so
	// `roles { id }` answering every role the database holds is not restated.
	async function expectRead(
		tokens: Map<string, string>,
		{ user, query, response: expectedResponse }: ReadRow,
		status: 'HIT' | 'MISS',
	) {
		const response = await request(getUrl(vendor, env))
			.post('/graphql/system')
			.send({ query: loadYaml(query) as string })
			.set('Authorization', `Bearer ${tokens.get(user)}`);

		expect(response.statusCode).toBe(200);
		expect(response.body.errors).toBeUndefined();
		expect(response.headers[cacheStatusHeader]).toBe(status);

		expect(response.body.data).toMatchObject(
			loadYaml(expectedResponse) as Record<string, unknown>,
		);
	}

	async function writeDescriptor(descriptor: string) {
		const response = await request(getUrl(vendor, env))
			.patch('/settings')
			.send({ project_descriptor: descriptor })
			.set('Authorization', auth);

		expect(response.statusCode).toBe(200);
	}

	function defineGivenSteps(
		{ given, and }: StepFunctions,
		tokens: Map<string, string>,
	) {
		// Created by the scenario that reads as them: the schema a user's first
		// request builds is cached, and its resolvers keep that request's service,
		// so a later request files none of the read meta it resolved.
		given('the users:', async (table: Record<string, string>[]) => {
			const users = parseGherkinTable<{ marker: string; first_name: string }>(
				table,
			);

			for (const { marker, first_name } of users) {
				const token = randomUUID();

				const response = await request(getUrl(vendor, env))
					.post('/users')
					.send({
						email: `${marker}-${token}@system-roots.example.com`,
						token,
						first_name,
						role: adminRoleId,
					})
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);
				createdUserIds.push(response.body.data.id);
				tokens.set(marker, token);
			}
		});

		and.optional(
			/^the project descriptor is "(.*)"$/,
			async (descriptor: string) => {
				await writeDescriptor(descriptor);
			},
		);

		// The MISS then HIT proves there is an entry to purge at all: a scenario
		// asserting a later HIT would pass just as well against a read that was
		// never cacheable.
		and.optional(
			'this read is cached:',
			async (table: Record<string, string>[]) => {
				await request(getUrl(vendor, env))
					.post('/utils/cache/clear')
					.set('Authorization', auth);

				await expectRead(tokens, table[0] as ReadRow, 'MISS');
				await expectRead(tokens, table[0] as ReadRow, 'HIT');
			},
		);

		// Two MISSes in a row: the first one was answered and not stored.
		and.optional(
			'this read is refused:',
			async (table: Record<string, string>[]) => {
				await request(getUrl(vendor, env))
					.post('/utils/cache/clear')
					.set('Authorization', auth);

				await expectRead(tokens, table[0] as ReadRow, 'MISS');
				await expectRead(tokens, table[0] as ReadRow, 'MISS');
			},
		);

		// Filled after the read under test, because that step clears the whole cache
		// before it fills its own entry, and the witnesses have to outlive it.
		and(
			'the witness reads are cached:',
			async (table: Record<string, string>[]) => {
				for (const row of table as ReadRow[]) {
					await expectRead(tokens, row, 'MISS');
					await expectRead(tokens, row, 'HIT');
				}
			},
		);
	}

	function defineWhenSteps(
		{ when }: StepFunctions,
		tokens: Map<string, string>,
	) {
		when.optional(
			'the users rename themselves:',
			async (table: Record<string, string>[]) => {
				const renames = parseGherkinTable<{
					marker: string;
					first_name: string;
				}>(table);

				for (const { marker, first_name } of renames) {
					const response = await request(getUrl(vendor, env))
						.patch('/users/me')
						.send({ first_name })
						.set('Authorization', `Bearer ${tokens.get(marker)}`);

					expect(response.statusCode).toBe(200);
				}
			},
		);

		when.optional(
			/^the project descriptor is changed to "(.*)"$/,
			async (descriptor: string) => {
				await writeDescriptor(descriptor);
			},
		);
	}

	function defineThenSteps(
		{ then, and }: StepFunctions,
		tokens: Map<string, string>,
	) {
		then.optional(
			/^the read is purged, .+:$/,
			async (table: Record<string, string>[]) => {
				await expectRead(tokens, table[0] as ReadRow, 'MISS');
			},
		);

		// A refused read answers the value the write left, and stays unstored.
		then.optional(
			/^the read is refused, .+:$/,
			async (table: Record<string, string>[]) => {
				await expectRead(tokens, table[0] as ReadRow, 'MISS');
				await expectRead(tokens, table[0] as ReadRow, 'MISS');
			},
		);

		and(
			/^the witness reads are still cached, .+:$/,
			async (table: Record<string, string>[]) => {
				for (const row of table as ReadRow[]) {
					await expectRead(tokens, row, 'HIT');
				}
			},
		);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'renaming yourself purges a read mixing users_me with an item root',
			(steps) => {
				const tokens = new Map<string, string>();

				defineGivenSteps(steps, tokens);

				defineWhenSteps(steps, tokens);

				defineThenSteps(steps, tokens);
			},
			60_000,
		);

		scenario(
			'a read resolving server_info is never cached',
			(steps) => {
				const tokens = new Map<string, string>();

				defineGivenSteps(steps, tokens);

				defineWhenSteps(steps, tokens);

				defineThenSteps(steps, tokens);
			},
			60_000,
		);
	});
});
