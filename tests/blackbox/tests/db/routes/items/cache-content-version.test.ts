import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
	type StepFunctions,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { ROLE, USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import getPort from 'get-port';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';

const NOTE = 'cache_version_note';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-content-version.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-content-version-${vendor}`;

	let instance: ChildProcess;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	// Every user a GraphQL read was sent by, removed once the file is done.
	const createdUserIds: string[] = [];
	let adminRoleId: string;

	beforeAll(async () => {
		// A version can be created only on a collection whose meta enables
		// versioning, which the instance reads off the schema it boots on.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: NOTE,
					meta: { versioning: true },
					fields: [{ field: 'title', type: 'string', meta: {} }],
				},
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

	// The versions go before the notes they are on, so no scenario reads a
	// version a previous one left behind.
	beforeEach(async () => {
		const versions = await request(getUrl(vendor, env))
			.get('/versions')
			.query({
				fields: 'id',
				limit: '-1',
				filter: JSON.stringify({ collection: { _eq: NOTE } }),
			})
			.set('Authorization', auth);

		expect(versions.statusCode).toBe(200);

		for (const { id } of versions.body.data as { id: string }[]) {
			const deleted = await request(getUrl(vendor, env))
				.delete(`/versions/${id}`)
				.set('Authorization', auth);

			expect(deleted.statusCode).toBe(204);
		}

		const notes = await request(getUrl(vendor, env))
			.get(`/items/${NOTE}`)
			.query({ fields: 'id', limit: '-1' })
			.set('Authorization', auth);

		expect(notes.statusCode).toBe(200);

		const noteIds = notes.body.data.map((row: { id: number }) => row.id);

		if (noteIds.length > 0) {
			const deleted = await request(getUrl(vendor, env))
				.delete(`/items/${NOTE}`)
				.send(noteIds)
				.set('Authorization', auth);

			expect(deleted.statusCode).toBe(204);
		}
	});

	afterAll(async () => {
		for (const userId of createdUserIds) {
			await request(getUrl(vendor, env))
				.delete(`/users/${userId}`)
				.set('Authorization', auth);
		}

		instance.kill();

		await DeleteCollection(vendor, { collection: NOTE });
	});

	// A scenario's rows, named by the marker it created them under.
	type ScenarioRows = {
		noteIds: Map<string, number>;
		versionIds: Map<string, string>;
		// The token each GraphQL read is sent with, keyed by its query.
		graphqlTokens: Map<string, string>;
	};

	type ReadCell = {
		note: string;
		query?: Record<string, string>;
		graphql?: string;
	};

	type ReadRow = { read: string; response: string };

	// A response holds only the columns carrying the scenario's point, in YAML.
	async function expectRead(
		rows: ScenarioRows,
		{ read, response: expectedResponse }: ReadRow,
		status: 'HIT' | 'MISS',
	) {
		const { note, query, graphql } = loadYaml(read) as ReadCell;
		const noteId = rows.noteIds.get(note);

		// A GraphQL read is sent by a user created for it alone: the schema a
		// user's first request builds is cached, and its resolvers keep that
		// request's service, so a later request files none of the read meta it
		// resolved.
		if (graphql !== undefined && !rows.graphqlTokens.has(graphql)) {
			const token = randomUUID();

			const created = await request(getUrl(vendor, env))
				.post('/users')
				.send({
					email: `version-reader-${token}@content-version.example.com`,
					token,
					role: adminRoleId,
				})
				.set('Authorization', auth);

			expect(created.statusCode).toBe(200);
			createdUserIds.push(created.body.data.id);
			rows.graphqlTokens.set(graphql, token);
		}

		const response = graphql === undefined
			? await request(getUrl(vendor, env))
				.get(`/items/${NOTE}/${noteId}`)
				.query(query ?? {})
				.set('Authorization', auth)
			: await request(getUrl(vendor, env))
				.post('/graphql')
				.send({ query: graphql.replace('$note', String(noteId)) })
				.set('Authorization', `Bearer ${rows.graphqlTokens.get(graphql)}`);

		expect(response.statusCode).toBe(200);
		expect(response.body.errors).toBeUndefined();
		expect(response.headers[cacheStatusHeader]).toBe(status);

		expect(response.body.data).toMatchObject(
			loadYaml(expectedResponse) as Record<string, unknown>,
		);
	}

	function defineScenarioSteps({ given, and, when, then }: StepFunctions) {
		const rows: ScenarioRows = {
			noteIds: new Map(),
			versionIds: new Map(),
			graphqlTokens: new Map(),
		};

		// Asserted rather than created here: the instance reads the collection's
		// meta off the schema it boots on, so `beforeAll` creates it before the
		// spawn.
		given('the note collection is versioned', async () => {
			const collection = await request(getUrl(vendor, env))
				.get(`/collections/${NOTE}`)
				.set('Authorization', auth);

			expect(collection.body.data.meta.versioning).toBe(true);
		});

		and('the notes:', async (table: Record<string, string>[]) => {
			for (const { marker, title } of table) {
				const response = await request(getUrl(vendor, env))
					.post(`/items/${NOTE}`)
					.send({ title })
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);
				rows.noteIds.set(marker!, response.body.data.id);
			}
		});

		// A version is created bare and its delta saved after, the way the app
		// does: a create carrying a delta is refused. The save purges the note's
		// collection, which is why it lands before any read is cached.
		and('the versions:', async (table: Record<string, string>[]) => {
			const versions = parseGherkinTable<{
				marker: string;
				note: string;
				key: string;
				delta: Record<string, unknown>;
			}>(table);

			for (const { marker, note, key, delta } of versions) {
				const created = await request(getUrl(vendor, env))
					.post('/versions')
					.send({
						key,
						name: key,
						collection: NOTE,
						item: String(rows.noteIds.get(note)),
					})
					.set('Authorization', auth);

				expect(created.statusCode).toBe(200);
				rows.versionIds.set(marker, created.body.data.id);

				const saved = await request(getUrl(vendor, env))
					.post(`/versions/${created.body.data.id}/save`)
					.send(delta)
					.set('Authorization', auth);

				expect(saved.statusCode).toBe(200);
			}
		});

		// The MISS then HIT proves there is an entry to purge at all: a scenario
		// asserting a later HIT would pass just as well against a read that was
		// never cacheable.
		and('this read is cached:', async (table: Record<string, string>[]) => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await expectRead(rows, table[0] as ReadRow, 'MISS');
			await expectRead(rows, table[0] as ReadRow, 'HIT');
		});

		// Filled after the read under test, because that step clears the whole cache
		// before it fills its own entry, and the witnesses have to outlive it.
		and(
			'the witness reads are cached:',
			async (table: Record<string, string>[]) => {
				for (const row of table as ReadRow[]) {
					await expectRead(rows, row, 'MISS');
					await expectRead(rows, row, 'HIT');
				}
			},
		);

		// Both writes touch `directus_versions` and nothing else: neither goes
		// through `save()`, the one version write that purges the note's collection.
		when.optional(
			'the versions are deleted:',
			async (table: Record<string, string>[]) => {
				for (const { marker } of table) {
					const response = await request(getUrl(vendor, env))
						.delete(`/versions/${rows.versionIds.get(marker!)}`)
						.set('Authorization', auth);

					expect(response.statusCode).toBe(204);
				}
			},
		);

		when.optional(
			'the versions are renamed:',
			async (table: Record<string, string>[]) => {
				for (const { marker, key } of table) {
					const response = await request(getUrl(vendor, env))
						.patch(`/versions/${rows.versionIds.get(marker!)}`)
						.send({ key })
						.set('Authorization', auth);

					expect(response.statusCode).toBe(200);
				}
			},
		);

		then(
			/^the read is purged, .+:$/,
			async (table: Record<string, string>[]) => {
				await expectRead(rows, table[0] as ReadRow, 'MISS');
			},
		);

		and(
			/^the witness reads are still cached, .+:$/,
			async (table: Record<string, string>[]) => {
				for (const row of table as ReadRow[]) {
					await expectRead(rows, row, 'HIT');
				}
			},
		);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'deleting the version purges a read merged with it',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			"renaming the version's key purges a read merged with it",
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'renaming another version into the asked key purges the read',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'deleting the version purges a GraphQL read merged with it',
			defineScenarioSteps,
			60_000,
		);
	});
});
