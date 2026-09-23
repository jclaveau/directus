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

	/**
	 * The schema the scenarios read against, asserted rather than created here: the
	 * instance reads `scoped_cache_fields` off the schema it boots on, so `beforeAll`
	 * creates the collection before the spawn. The feature still states it, and a
	 * drift between the two fails the Background instead of a purge assertion.
	 */
	async function expectSlotSchema(table: Record<string, string>[]) {
		const fields = await request(getUrl(vendor, env))
			.get(`/fields/${SLOT}`)
			.set('Authorization', auth);

		const collection = await request(getUrl(vendor, env))
			.get(`/collections/${SLOT}`)
			.set('Authorization', auth);

		const scopedCacheFields: string[]
			= collection.body.data.meta.scoped_cache_fields;

		const declaredFields = fields.body.data
			.filter((field: { field: string }) => field.field !== 'id')
			.map((field: { field: string; type: string }) => {
				return {
					field: field.field,
					type: field.type,
					scoped_cache_field: scopedCacheFields.includes(field.field)
						? 'yes'
						: 'no',
				};
			});

		expect(declaredFields).toEqual(expect.arrayContaining(table));
		expect(declaredFields).toHaveLength(table.length);
	}

	function defineGivenSteps(
		{ given, and }: StepFunctions,
		ids: Map<string, number>,
		readQuery: Record<string, string>,
	) {
		given('the slot collection:', async (table: Record<string, string>[]) => {
			await expectSlotSchema(table);
		});

		and('the slots:', async (table: Record<string, string>[]) => {
			await createSlots(table, ids);
		});

		// The query is the scenario's own table, so a reader sees what is cached
		// where the scenario says it is cached, and the `Then` reads it back.
		and('this read is cached:', async (table: Record<string, string>[]) => {
			for (const row of table) {
				readQuery[row['param']!] = row['value']!;
			}

			await fillCache(readQuery);
		});
	}

	function whenSlotsCreated({ when }: StepFunctions, ids: Map<string, number>) {
		when('the slots are created:', async (table: Record<string, string>[]) => {
			await createSlots(table, ids);
		});
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a write matching one pair but not the other leaves the read cached',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				whenSlotsCreated(steps, ids);

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(readQuery, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			'a write matching every pair purges the read',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				whenSlotsCreated(steps, ids);

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a write changing a field the read never named leaves it cached',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "d1" is updated with note "rewritten"', async () => {
					await updateSlot(ids.get('d1')!, { note: 'rewritten' });
				});

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(readQuery, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			'a write changing a field the read sorted on purges it',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "e1" is updated with note "rewritten"', async () => {
					await updateSlot(ids.get('e1')!, { note: 'rewritten' });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read selecting every field is purged by any column change',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "z1" is updated with note "rewritten"', async () => {
					await updateSlot(ids.get('z1')!, { note: 'rewritten' });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read filtered on a range binds the field without pinning a value',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "t1" is updated with note "rewritten"', async () => {
					await updateSlot(ids.get('t1')!, { note: 'rewritten' });
				});

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(readQuery, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			'a write to the field a range was read on purges it',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "i1" is updated with amount 30', async () => {
					await updateSlot(ids.get('i1')!, { amount: 30 });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read filtered on a list of owners is purged by a write to any of them',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				whenSlotsCreated(steps, ids);

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read filtered on a list of owners survives a write outside it',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				whenSlotsCreated(steps, ids);

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(readQuery, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			"a row moving into the read's slice purges it",
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "p1" is updated with owner "omicron"', async () => {
					await updateSlot(ids.get('p1')!, { owner: 'omicron' });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			"a row moving out of the read's slice purges it",
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "r1" is updated with owner "sigma"', async () => {
					await updateSlot(ids.get('r1')!, { owner: 'sigma' });
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read matching two ways is purged by a write matching either',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				whenSlotsCreated(steps, ids);

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			'a read matching two ways survives a write matching neither',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				whenSlotsCreated(steps, ids);

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(readQuery, 'HIT'),
				);
			},
			60_000,
		);

		scenario(
			'a delete of a matching row purges the read',
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "u1" is deleted', async () => {
					await deleteSlot(ids.get('u1')!);
				});

				steps.then(
					'the read is purged',
					async () => await expectCacheStatus(readQuery, 'MISS'),
				);
			},
			60_000,
		);

		scenario(
			"a delete outside the read's slice leaves it cached",
			(steps) => {
				const ids = new Map<string, number>();
				const readQuery: Record<string, string> = {};

				defineGivenSteps(steps, ids, readQuery);

				steps.when('slot "c2" is deleted', async () => {
					await deleteSlot(ids.get('c2')!);
				});

				steps.then(
					'the read is still cached',
					async () => await expectCacheStatus(readQuery, 'HIT'),
				);
			},
			60_000,
		);
	});
});
