import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import {
	CreateCollections,
	CreateField,
	CreateFieldM2A,
	CreateFieldO2M,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';

const ARTICLE = 'view_binding_article';
const COMMENT = 'view_binding_comment';
const TOPIC = 'view_binding_topic';
const MENTION = 'view_binding_mention';
const PAGE = 'view_binding_page';
const BLOCK = 'view_binding_block';
const HEADING = 'view_binding_heading';
const IMAGE = 'view_binding_image';

// Children before the parents their keys name, which is the order the rows
// are emptied and the collections dropped in.
const COLLECTIONS = [
	COMMENT,
	ARTICLE,
	MENTION,
	TOPIC,
	BLOCK,
	PAGE,
	HEADING,
	IMAGE,
];

const cacheStatusHeader = 'x-cache-status';
const policyName = 'view binding policy';

const feature = loadFeature(
	'./tests/db/routes/items/cache-view-binding.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-view-binding-${vendor}`;

	let instance: ChildProcess;
	let userId: string;

	// The bound view is read back out of the index the spawned instance writes.
	const redis = new Redis({
		host: env[vendor]['REDIS_HOST'],
		port: Number(env[vendor]['REDIS_PORT']),
	});

	const admin = `Bearer ${USER.ADMIN.TOKEN}`;
	const userToken = `view-binding-${vendor}-000000000000000000`;

	beforeAll(async () => {
		// The scoped instance reads `scoped_cache_fields` off the schema it boots on,
		// so every collection and relation precedes the spawn.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: ARTICLE,
					meta: { scoped_cache_fields: ['scope_key'] },
					fields: [
						{ field: 'title', type: 'string', meta: {} },
						{ field: 'scope_key', type: 'string', meta: {} },
					],
				},
				{
					collection: COMMENT,
					fields: [
						{ field: 'status', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
						{ field: 'scope_key', type: 'string', meta: {} },
					],
				},
				{
					collection: TOPIC,
					meta: { scoped_cache_fields: ['scope_key'] },
					fields: [
						{ field: 'title', type: 'string', meta: {} },
						{ field: 'scope_key', type: 'string', meta: {} },
					],
				},
				{
					collection: MENTION,
					meta: { scoped_cache_fields: ['scope_key'] },
					fields: [
						{ field: 'item', type: 'string', meta: {} },
						{ field: 'collection', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
						{ field: 'scope_key', type: 'string', meta: {} },
					],
				},
				{
					collection: PAGE,
					meta: { scoped_cache_fields: ['scope_key'] },
					fields: [
						{ field: 'title', type: 'string', meta: {} },
						{ field: 'scope_key', type: 'string', meta: {} },
					],
				},
				{
					collection: HEADING,
					meta: { scoped_cache_fields: ['scope_key'] },
					fields: [
						{ field: 'title', type: 'string', meta: {} },
						{ field: 'scope_key', type: 'string', meta: {} },
					],
				},
				{
					collection: IMAGE,
					meta: { scoped_cache_fields: ['scope_key'] },
					fields: [
						{ field: 'caption', type: 'string', meta: {} },
						{ field: 'scope_key', type: 'string', meta: {} },
					],
				},
			],
		});

		await CreateFieldO2M(vendor, {
			collection: ARTICLE,
			field: 'comments',
			otherCollection: COMMENT,
			otherField: 'article',
		});

		// The junction is created by the M2A helper, so its scope column and the
		// declaration naming it follow it.
		await CreateFieldM2A(vendor, {
			collection: PAGE,
			field: 'blocks',
			relatedCollections: [HEADING, IMAGE],
			junctionCollection: BLOCK,
		});

		await CreateField(vendor, {
			collection: BLOCK,
			field: 'scope_key',
			type: 'string',
		});

		for (const collection of [COMMENT, BLOCK]) {
			const declared = await request(getUrl(vendor, env))
				.patch(`/collections/${collection}`)
				.send({ meta: { scoped_cache_fields: ['scope_key'] } })
				.set('Authorization', admin);

			expect(declared.statusCode).toBe(200);
		}

		// Reads every article, and only the published comments: the case filter is
		// what puts `status` in the comment view, which is why the count scenario
		// reads as this user.
		const userResponse = await request(getUrl(vendor, env))
			.post('/users')
			.set('Authorization', admin)
			.send({
				first_name: 'view binding user',
				token: userToken,
				policies: {
					create: [{
						policy: {
							name: policyName,
							app_access: true,
							permissions: {
								create: [
									{
										policy: '+',
										permissions: {},
										validation: null,
										fields: ['*'],
										presets: null,
										collection: ARTICLE,
										action: 'read',
									},
									{
										policy: '+',
										permissions: { status: { _eq: 'published' } },
										validation: null,
										fields: ['*'],
										presets: null,
										collection: COMMENT,
										action: 'read',
									},
								],
								update: [],
								delete: [],
							},
						},
					}],
					update: [],
					delete: [],
				},
			});

		expect(userResponse.statusCode).toBe(200);

		userId = userResponse.body.data.id;

		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);
	}, 60_000);

	// Every scenario states the rows it starts from.
	beforeEach(async () => {
		for (const collection of COLLECTIONS) {
			const existing = await request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ fields: 'id', limit: '-1' })
				.set('Authorization', admin);

			expect(existing.statusCode).toBe(200);

			const existingIds = existing.body.data.map(
				(row: { id: number }) => row.id,
			);

			if (existingIds.length > 0) {
				const deleted = await request(getUrl(vendor, env))
					.delete(`/items/${collection}`)
					.send(existingIds)
					.set('Authorization', admin);

				expect(deleted.statusCode).toBe(204);
			}
		}
	});

	afterAll(async () => {
		await request(getUrl(vendor, env))
			.delete(`/users/${userId}`)
			.set('Authorization', admin);

		await request(getUrl(vendor, env))
			.delete('/policies')
			.send({ query: { filter: { name: { _eq: policyName } } } })
			.set('Authorization', admin);

		instance.kill();

		await redis.quit();

		for (const collection of COLLECTIONS) {
			await DeleteCollection(vendor, { collection });
		}
	});

	// What one scenario carries across its steps: the ids its markers stand for,
	// and who its reads are made by.
	type ScenarioState = { ids: Map<string, number>; readAuth: string };

	function cellRows(cell: string): Record<string, unknown>[] {
		return loadYaml(cell) as Record<string, unknown>[];
	}

	// A `data` cell names a row by its marker wherever a column holds a key: the
	// item column of a mention or a block is a string, every other key an integer.
	function rowBody(
		data: string,
		ids: Map<string, number>,
	): Record<string, unknown> {
		const body = loadYaml(data) as Record<string, unknown>;

		for (const [column, value] of Object.entries(body)) {
			if (typeof value !== 'string' || !ids.has(value)) {
				continue;
			}

			body[column] = column === 'item'
				? String(ids.get(value))
				: ids.get(value);
		}

		return body;
	}

	// `fields` is a list over the wire; a nested filter goes as JSON, which
	// Directus parses natively.
	function queryParameters(query: string): Record<string, string | string[]> {
		const parameters: Record<string, string | string[]> = {};
		const sent = loadYaml(query) as Record<string, unknown>;

		for (const [parameter, value] of Object.entries(sent)) {
			if (typeof value === 'string' || Array.isArray(value)) {
				parameters[parameter] = value;
			}
			else {
				parameters[parameter] = JSON.stringify(value);
			}
		}

		return parameters;
	}

	async function expectRead(
		collection: string,
		query: Record<string, string | string[]>,
		status: 'HIT' | 'MISS',
		expectedAnswer: Record<string, unknown>[],
		state: ScenarioState,
	) {
		const response = await request(getUrl(vendor, env))
			.get(`/items/${collection}`)
			.query(query)
			.set('Authorization', state.readAuth);

		expect(response.headers[cacheStatusHeader]).toBe(status);

		expect(response.body.data).toEqual(
			expectedAnswer.map(({ marker, ...columns }) => {
				return expect.objectContaining({
					id: state.ids.get(marker as string),
					...columns,
				});
			}),
		);
	}

	// Every member of one collection's scoped-cache index, as `<rendered
	// fingerprint>|<cache key>` (`redis-store.ts`).
	async function indexedMembers(collection: string): Promise<Set<string>> {
		const members = new Set<string>();

		const indexKeys = await redis.keys(
			`${env[vendor]['CACHE_NAMESPACE']}:scoped-cache-index:fingerprint:`
			+ `${collection}:*`,
		);

		for (const indexKey of indexKeys) {
			for (const member of await redis.smembers(indexKey)) {
				members.add(member);
			}
		}

		return members;
	}

	// Keeps each escape as written, so a part's length is where its separator sat.
	function splitUnescaped(serialized: string, separator: string) {
		const splitParts = [''];

		for (let charAt = 0; charAt < serialized.length; charAt++) {
			if (serialized[charAt] === separator) {
				splitParts.push('');
				continue;
			}

			const escapedLength = serialized[charAt] === '\\'
				? 2
				: 1;

			splitParts[splitParts.length - 1] += serialized
				.slice(charAt, charAt + escapedLength);

			charAt += escapedLength - 1;
		}

		return splitParts;
	}

	// The collection a rendered fingerprint was filed for and its view, which is
	// all a scenario here states of it (`cache-composite-tag.test.ts` decodes the
	// pins too).
	function decodeView(rendered: string) {
		const unescaped = (token: string) => token.replace(/\\(.)/g, '$1');
		const colonAt = rendered.indexOf(':&');

		const fingerprintBody = colonAt === -1
			? ''
			: rendered.slice(colonAt + 1);

		let viewFields: string[] | undefined;

		for (const pin of splitUnescaped(fingerprintBody, '&')) {
			if (pin.startsWith('view=,')) {
				viewFields = splitUnescaped(pin.slice('view='.length), ',')
					.slice(1, -1)
					.map(unescaped);
			}
		}

		return {
			collection: unescaped(colonAt === -1
				? rendered
				: rendered.slice(0, colonAt)),
			viewFields,
		};
	}

	function defineGivenSteps(
		{ given, and }: StepFunctions,
		state: ScenarioState,
	) {
		// Asserted rather than created: `beforeAll` builds the schema before the
		// spawn, and a drift fails the Background, not a purge assertion.
		given('the collections:', async (table: Record<string, string>[]) => {
			const declaredFields: Record<string, string>[] = [];

			for (const collectionName of COLLECTIONS) {
				const fields = await request(getUrl(vendor, env))
					.get(`/fields/${collectionName}`)
					.set('Authorization', admin);

				const collection = await request(getUrl(vendor, env))
					.get(`/collections/${collectionName}`)
					.set('Authorization', admin);

				const scopedCacheFields: string[]
					= collection.body.data.meta.scoped_cache_fields ?? [];

				for (const field of fields.body.data) {
					if (field.field === 'id') {
						continue;
					}

					declaredFields.push({
						collection: collectionName,
						field: field.field,
						type: field.type,
						scoped_cache_field: scopedCacheFields.includes(field.field)
							? 'yes'
							: 'no',
					});
				}
			}

			expect(declaredFields).toEqual(expect.arrayContaining(table));
			expect(declaredFields).toHaveLength(table.length);
		});

		and('the rows:', async (table: Record<string, string>[]) => {
			for (const { collection, marker, data } of table) {
				const response = await request(getUrl(vendor, env))
					.post(`/items/${collection}`)
					.send(rowBody(data!, state.ids))
					.set('Authorization', admin);

				expect(response.statusCode).toBe(200);
				state.ids.set(marker!, response.body.data.id);
			}
		});

		and.optional(
			'the reads are made by a user reading only published comments',
			() => {
				state.readAuth = `Bearer ${userToken}`;
			},
		);

		// The MISS then HIT proves there is an entry to purge at all; the bound view
		// is read off the members the filling request added to the related
		// collection's index.
		and(
			/^this read of (\S+) is cached:$/,
			async (collection: string, table: Record<string, string>[]) => {
				const { query, response, 'bound view': boundViewCell } = table[0]!;
				const readQuery = queryParameters(query!);
				const boundView = loadYaml(boundViewCell!) as { collection: string };

				await request(getUrl(vendor, env))
					.post('/utils/cache/clear')
					.set('Authorization', admin);

				const filedBefore = await indexedMembers(boundView.collection);

				await expectRead(collection, readQuery, 'MISS', cellRows(response!), state);
				await expectRead(collection, readQuery, 'HIT', cellRows(response!), state);

				const added = [...await indexedMembers(boundView.collection)].filter(
					(member) => !filedBefore.has(member),
				);

				expect(
					added.map((member) => decodeView(splitUnescaped(member, '|')[0]!)),
				).toContainEqual(boundView);
			},
		);

		// Filled after the read under test, whose step clears the whole cache.
		and(
			/^the witness reads of (\S+) are cached:$/,
			async (collection: string, table: Record<string, string>[]) => {
				for (const { query, response } of table) {
					const witnessQuery = queryParameters(query!);

					await expectRead(
						collection,
						witnessQuery,
						'MISS',
						cellRows(response!),
						state,
					);

					await expectRead(
						collection,
						witnessQuery,
						'HIT',
						cellRows(response!),
						state,
					);
				}
			},
		);
	}

	function defineWhenSteps({ when }: StepFunctions, state: ScenarioState) {
		when(
			/^the (\S+) rows are updated:$/,
			async (collection: string, table: Record<string, string>[]) => {
				for (const { marker, data } of table) {
					const response = await request(getUrl(vendor, env))
						.patch(`/items/${collection}/${state.ids.get(marker!)}`)
						.send(rowBody(data!, state.ids))
						.set('Authorization', admin);

					expect(response.statusCode).toBe(200);
				}
			},
		);
	}

	// The read under test is of the collection the scenario's cached read named,
	// which the Then steps take from the `Given`'s capture.
	function defineThenSteps(
		{ then, and }: StepFunctions,
		state: ScenarioState,
		collection: string,
	) {
		then(
			/^the read is purged, .+:$/,
			async (table: Record<string, string>[]) => {
				const { query, response } = table[0]!;

				await expectRead(
					collection,
					queryParameters(query!),
					'MISS',
					cellRows(response!),
					state,
				);
			},
		);

		and(
			/^the witness reads are still cached, .+:$/,
			async (table: Record<string, string>[]) => {
				for (const { query, response } of table) {
					await expectRead(
						collection,
						queryParameters(query!),
						'HIT',
						cellRows(response!),
						state,
					);
				}
			},
		);
	}

	function defineScenarioSteps(steps: StepFunctions, collection: string) {
		const state: ScenarioState = { ids: new Map(), readAuth: admin };

		defineGivenSteps(steps, state);
		defineWhenSteps(steps, state);
		defineThenSteps(steps, state, collection);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a comment moved to another article purges the count read of its old one',
			(steps) => defineScenarioSteps(steps, ARTICLE),
			60_000,
		);

		scenario(
			'a mention moved to another item purges a read following it',
			(steps) => defineScenarioSteps(steps, TOPIC),
			60_000,
		);

		scenario(
			'a mention moved to another collection purges a read following it',
			(steps) => defineScenarioSteps(steps, TOPIC),
			60_000,
		);

		scenario(
			'a block moved to another collection purges a read filtered through its'
				+ ' item',
			(steps) => defineScenarioSteps(steps, PAGE),
			60_000,
		);
	});
});
