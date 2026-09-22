import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
	type StepFunctions,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const SLOT = 'composite_tag_slot';
const cacheStatusHeader = 'x-cache-status';

type SlotRow = {
	marker: string;
	owner: string;
	method: string;
	note: string;
	amount: number;
};

const feature = loadFeature(
	'./tests/db/routes/items/cache-composite-tag.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-composite-tag-${vendor}`;

	let instance: ChildProcess;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		// The scoped instance reads `scoped_cache_fields` off the schema it boots on,
		// so the collection precedes the spawn.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: SLOT,
					meta: { scoped_cache_fields: ['owner', 'method'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'method', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
						{ field: 'amount', type: 'integer', meta: {} },
					],
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
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		await DeleteCollection(vendor, { collection: SLOT });
	});

	async function createSlots(
		table: Record<string, string>[],
		ids: Map<string, number>,
	) {
		for (const row of parseGherkinTable<SlotRow>(table)) {
			const response = await request(getUrl(vendor, env))
				.post(`/items/${SLOT}`)
				.send({
					owner: row.owner,
					method: row.method,
					note: row.note,
					amount: row.amount,
				})
				.set('Authorization', auth);

			expect(response.statusCode).toBe(200);
			ids.set(row.marker, response.body.data.id);
		}
	}

	function updateSlot(id: number, item: Record<string, unknown>) {
		return request(getUrl(vendor, env))
			.patch(`/items/${SLOT}/${id}`)
			.send(item)
			.set('Authorization', auth);
	}

	function deleteSlot(id: number) {
		return request(getUrl(vendor, env))
			.delete(`/items/${SLOT}/${id}`)
			.set('Authorization', auth);
	}

	function readSlots(query: Record<string, string>) {
		return request(getUrl(vendor, env))
			.get(`/items/${SLOT}`)
			.query(query)
			.set('Authorization', auth);
	}

	/**
	 * Fill the entry this scenario is about, over an otherwise empty cache.
	 *
	 * The MISS then HIT is the witness that there is an entry to purge at all: a
	 * scenario asserting a later HIT would pass just as well against a read that was
	 * never cacheable.
	 */
	async function fillCache(query: Record<string, string>) {
		await request(getUrl(vendor, env))
			.post('/utils/cache/clear')
			.set('Authorization', auth);

		expect((await readSlots(query)).headers[cacheStatusHeader]).toBe('MISS');
		expect((await readSlots(query)).headers[cacheStatusHeader]).toBe('HIT');
	}

	async function expectCacheStatus(
		query: Record<string, string>,
		status: 'HIT' | 'MISS',
	) {
		expect((await readSlots(query)).headers[cacheStatusHeader]).toBe(status);
	}

	function givenSlots({ given, and }: StepFunctions, ids: Map<string, number>) {
		given('a slot collection scoped by owner and method', () => undefined);

		and('the slots:', async (table: Record<string, string>[]) => {
			await createSlots(table, ids);
		});
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a write matching one pair but not the other leaves the read cached',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_eq]': 'alpha',
					'filter[method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of "alpha"\'s spaced slots are cached',
					async () => await fillCache(query),
				);

				steps.when(
					'the slots are created:',
					async (table: Record<string, string>[]) => {
						await createSlots(table, ids);
					},
				);

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(query, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			'a write matching every pair purges the read',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_eq]': 'gamma',
					'filter[method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of "gamma"\'s spaced slots are cached',
					async () => await fillCache(query),
				);

				steps.when(
					'the slots are created:',
					async (table: Record<string, string>[]) => {
						await createSlots(table, ids);
					},
				);

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a write changing a field the read never named leaves it cached',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_eq]': 'delta',
					'filter[method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of "delta"\'s spaced slots are cached',
					async () => await fillCache(query),
				);

				steps.when('slot "d1" is updated with note "rewritten"', async () => {
					await updateSlot(ids.get('d1')!, { note: 'rewritten' });
				});

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(query, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			'a write changing a field the read sorted on purges it',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_eq]': 'epsilon',
					sort: 'note',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of "epsilon"\'s slots sorted by note are cached',
					async () => await fillCache(query),
				);

				steps.when('slot "e1" is updated with note "rewritten"', async () => {
					await updateSlot(ids.get('e1')!, { note: 'rewritten' });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read selecting every field is purged by any column change',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: '*',
					'filter[owner][_eq]': 'zeta',
				};

				givenSlots(steps, ids);

				steps.and(
					'every field of "zeta"\'s slots is cached',
					async () => await fillCache(query),
				);

				steps.when('slot "z1" is updated with note "rewritten"', async () => {
					await updateSlot(ids.get('z1')!, { note: 'rewritten' });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read filtered on a range binds the field without pinning a value',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner,amount',
					'filter[owner][_eq]': 'theta',
					'filter[amount][_gt]': '5',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id, owner and amount of "theta"\'s slots above amount 5 are cached',
					async () => await fillCache(query),
				);

				steps.when('slot "t1" is updated with note "rewritten"', async () => {
					await updateSlot(ids.get('t1')!, { note: 'rewritten' });
				});

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(query, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			'a write to the field a range was read on purges it',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner,amount',
					'filter[owner][_eq]': 'iota',
					'filter[amount][_gt]': '5',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id, owner and amount of "iota"\'s slots above amount 5 are cached',
					async () => await fillCache(query),
				);

				steps.when('slot "i1" is updated with amount 30', async () => {
					await updateSlot(ids.get('i1')!, { amount: 30 });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read filtered on a list of owners is purged by a write to any of them',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_in]': 'kappa,lambda',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of the slots owned by "kappa" or "lambda" are cached',
					async () => await fillCache(query),
				);

				steps.when(
					'the slots are created:',
					async (table: Record<string, string>[]) => {
						await createSlots(table, ids);
					},
				);

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read filtered on a list of owners survives a write outside it',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_in]': 'mu,nu',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of the slots owned by "mu" or "nu" are cached',
					async () => await fillCache(query),
				);

				steps.when(
					'the slots are created:',
					async (table: Record<string, string>[]) => {
						await createSlots(table, ids);
					},
				);

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(query, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			"a row moving into the read's slice purges it",
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_eq]': 'omicron',
					'filter[method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of "omicron"\'s spaced slots are cached',
					async () => await fillCache(query),
				);

				steps.when('slot "p1" is updated with owner "omicron"', async () => {
					await updateSlot(ids.get('p1')!, { owner: 'omicron' });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			"a row moving out of the read's slice purges it",
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_eq]': 'rho',
					'filter[method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of "rho"\'s spaced slots are cached',
					async () => await fillCache(query),
				);

				steps.when('slot "r1" is updated with owner "sigma"', async () => {
					await updateSlot(ids.get('r1')!, { owner: 'sigma' });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read matching two ways is purged by a write matching either',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner,method',
					'filter[_or][0][owner][_eq]': 'tau',
					'filter[_or][1][method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the slots owned by "tau" or read with the "spaced" method are cached',
					async () => await fillCache(query),
				);

				steps.when(
					'the slots are created:',
					async (table: Record<string, string>[]) => {
						await createSlots(table, ids);
					},
				);

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read matching two ways survives a write matching neither',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner,method',
					'filter[_or][0][owner][_eq]': 'omega',
					'filter[_or][1][method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the slots owned by "omega" or read with the "spaced" method are cached',
					async () => await fillCache(query),
				);

				steps.when(
					'the slots are created:',
					async (table: Record<string, string>[]) => {
						await createSlots(table, ids);
					},
				);

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(query, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			'a delete of a matching row purges the read',
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_eq]': 'upsilon',
					'filter[method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of "upsilon"\'s spaced slots are cached',
					async () => await fillCache(query),
				);

				steps.when('slot "u1" is deleted', async () => {
					await deleteSlot(ids.get('u1')!);
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(query, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			"a delete outside the read's slice leaves it cached",
			(steps) => {
				const ids = new Map<string, number>();

				const query = {
					fields: 'id,owner',
					'filter[owner][_eq]': 'chi',
					'filter[method][_eq]': 'spaced',
				};

				givenSlots(steps, ids);

				steps.and(
					'the id and owner of "chi"\'s spaced slots are cached',
					async () => await fillCache(query),
				);

				steps.when('slot "c2" is deleted', async () => {
					await deleteSlot(ids.get('c2')!);
				});

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(query, 'HIT'),
				);
			},
			60_000,
		);
	});
});
