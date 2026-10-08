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
import { oneLine } from '@directus/utils';
import { awaitDirectusConnection } from '@utils/await-connection';
import { monitorRedisCommands } from '@utils/monitor-redis-commands';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-collection-index-keys.feature',
);

// The purges come from the cache-collection-purge extension: a row handed over
// without its primary key leaves the purge nothing to bind, so it drops every
// read of the collection through the collection's index-key set.
describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-collection-index-keys-${vendor}`;
	const indexPrefix = `${namespace}:scoped-cache-index:`;
	const markerKey = `${namespace}:scoped-cache-collection-index-keys-complete`;
	const generationKey = `${namespace}:scoped-cache-index-generation`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;
	env[vendor]['CACHE_TTL'] = '1h';

	// Once a year: the reap names every set it finds, and would name again the
	// sets these scenarios check the fill names itself.
	env[vendor]['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = '0 0 1 1 *';

	// The home pin scenarios read which way a purge found its sets off
	// directus_scoped_cache_index_reads_total.
	env[vendor]['METRICS_ENABLED'] = 'true';

	const collections = [
		'index_keys_new',
		'index_keys_unnamed',
		'index_keys_gone',
		'index_keys_short',
		'index_keys_long',
		'index_keys_unbounded',
		'index_keys_move',
		'index_keys_marked',
		'index_keys_unmarked',
		'index_keys_flushed',
	];

	// Scoped on a field other than `name`, and never on the primary key, so a
	// read pinning the key or a second scope field is filed under a home pin.
	const homePinScopes: Record<string, string[]> = {
		home_pin_key: ['owner'],
		home_pin_second: ['owner', 'label'],
		home_pin_untouched: ['owner', 'label'],
	};

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: collections.map((collection) => {
				return {
					collection,
					meta: { scoped_cache_fields: ['name'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				};
			}).concat(
				Object.entries(homePinScopes).map(([collection, scopeFields]) => {
					return {
						collection,
						meta: { scoped_cache_fields: scopeFields },
						fields: [
							{ field: 'owner', type: 'string', meta: {} },
							{ field: 'label', type: 'string', meta: {} },
						],
					};
				}),
			),
		});

		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		for (const key of await redisClient.keys(`${namespace}:*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();

		for (const collection of [
			...collections,
			...Object.keys(homePinScopes),
		]) {
			await DeleteCollection(vendor, { collection });
		}
	});

	// Every scenario's steps, in the order the scenarios hold them: a scenario
	// binds only the ones it declares.
	function defineIndexKeySteps({ given, and, when, then }: StepFunctions) {
		let collection = '';
		let keptMarker: string | null = null;
		const purgeWrites: string[][] = [];
		const purgeReads: string[][] = [];

		given(
			/^these rows of (\w+):$/,
			async (rowsOf: string, table: Record<string, string>[]) => {
				collection = rowsOf;

				const created = await request(getUrl(vendor, env))
					.post(`/items/${collection}`)
					.send(table)
					.set('Authorization', auth);

				expect(created.statusCode).toBe(200);
			},
		);

		and('these reads are cached:', async (table: Record<string, string>[]) => {
			for (const row of table) {
				const filled = await request(getUrl(vendor, env))
					.get(`/items/${collection}`)
					.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
					.set('Authorization', auth);

				expect(filled.headers[cacheStatusHeader]).toBe('MISS');

				// The fill lands after the response.
				await expect.poll(async () => {
					const reread = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
						.set('Authorization', auth);

					return reread.headers[cacheStatusHeader];
				}, { timeout: 5_000 }).toBe('HIT');
			}
		});

		// What a reap's full pass writes: the index generation as it read
		// before the pass.
		and.optional('the index-key sets are marked complete', async () => {
			expect(await redisClient.set(
				markerKey,
				(await redisClient.get(generationKey))!,
			)).toBe('OK');
		});

		and.optional('the index-key sets are not marked complete', async () => {
			await redisClient.del(markerKey);
			expect(await redisClient.exists(markerKey)).toBe(0);
		});

		and.optional('the marker is kept as it reads now', async () => {
			keptMarker = await redisClient.get(markerKey);
			expect(keptMarker).not.toBeNull();
		});

		when.optional('the cache is flushed', async () => {
			const flushed = await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			expect(flushed.statusCode).toBe(200);
		});

		// The flush unlinks the sets and keeps their names: only the pass it asks
		// for releases them, the marker or none.
		and.optional(
			/^the reap the flush asked for has released the names in \w+$/,
			async () => {
				await expect.poll(() => {
					return redisClient.scard(
						`${indexPrefix}collection-index-keys:${collection}`,
					);
				}, { timeout: 15_000 }).toBe(0);
			},
		);

		// A name whose set the flush unlinked reads empty, and every fill after it
		// names the set it files into: nothing the flush left goes unnamed.
		then.optional(
			'the marker still reads as it was kept, naming the index generation',
			async () => {
				expect(await redisClient.mget(markerKey, generationKey))
					.toEqual([keptMarker, keptMarker]);
			},
		);

		and.optional(
			'these reads are cached again:',
			async (table: Record<string, string>[]) => {
				for (const row of table) {
					const filled = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
						.set('Authorization', auth);

					expect(filled.headers[cacheStatusHeader]).toBe('MISS');

					await expect.poll(async () => {
						const reread = await request(getUrl(vendor, env))
							.get(`/items/${collection}`)
							.query({
								'filter[name][_eq]': row['name'],
								'fields': row['fields'],
							})
							.set('Authorization', auth);

						return reread.headers[cacheStatusHeader];
					}, { timeout: 5_000 }).toBe('HIT');
				}
			},
		);

		// What a flush dropping the index-key set after the set was filed
		// leaves, for this one name.
		and.optional(
			/^the index-key set of \w+ no longer names the set of ada$/,
			async () => {
				expect(await redisClient.srem(
					`${indexPrefix}collection-index-keys:${collection}`,
					`${indexPrefix}fingerprint:${collection}:name=ada`,
				)).toBe(1);
			},
		);

		and.optional(/^the index-key set of \w+ is gone$/, async () => {
			expect(await redisClient.del(
				`${indexPrefix}collection-index-keys:${collection}`,
			)).toBe(1);
		});

		and.optional(
			/^the index-key set of \w+ is given this expiry:$/,
			async (table: Record<string, string>[]) => {
				expect(await redisClient.pexpire(
					`${indexPrefix}collection-index-keys:${collection}`,
					Number(table[0]!['milliseconds']),
				)).toBe(1);
			},
		);

		// Read before the refill: an index-key set that expired first would be
		// recreated with the fill's expiry rather than kept longer.
		and.optional(/^the index-key set of \w+ still exists$/, async () => {
			expect(await redisClient.exists(
				`${indexPrefix}collection-index-keys:${collection}`,
			)).toBe(1);
		});

		// Under half a second past the whole one: `TTL` reads it rounded down, so
		// an index-key set kept that many seconds would fall short of the set.
		and.optional(
			'the set of ada is given this expiry:',
			async (table: Record<string, string>[]) => {
				expect(await redisClient.pexpire(
					`${indexPrefix}fingerprint:${collection}:name=ada`,
					Number(table[0]!['milliseconds']),
				)).toBe(1);
			},
		);

		and.optional('the set of ada is given no expiry', async () => {
			expect(await redisClient.persist(
				`${indexPrefix}fingerprint:${collection}:name=ada`,
			)).toBe(1);
		});

		// The index-key set was never dropped, so only the fill's own SADD can
		// name the set of ada again.
		then.optional(
			/^the index-key set of \w+ still names the set of bob, not the set of ada$/,
			async () => {
				expect([
					await redisClient.sismember(
						`${indexPrefix}collection-index-keys:${collection}`,
						`${indexPrefix}fingerprint:${collection}:name=bob`,
					),
					await redisClient.sismember(
						`${indexPrefix}collection-index-keys:${collection}`,
						`${indexPrefix}fingerprint:${collection}:name=ada`,
					),
				]).toEqual([1, 0]);
			},
		);

		and.optional(
			'these reads fill the same set:',
			async (table: Record<string, string>[]) => {
				for (const row of table) {
					const filled = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
						.set('Authorization', auth);

					expect(filled.headers[cacheStatusHeader]).toBe('MISS');

					await expect.poll(async () => {
						const reread = await request(getUrl(vendor, env))
							.get(`/items/${collection}`)
							.query({
								'filter[name][_eq]': row['name'],
								'fields': row['fields'],
							})
							.set('Authorization', auth);

						return reread.headers[cacheStatusHeader];
					}, { timeout: 5_000 }).toBe('HIT');
				}
			},
		);

		then.optional(
			/^the index-key set of \w+ names the set of ada again$/,
			async () => {
				expect(await redisClient.sismember(
					`${indexPrefix}collection-index-keys:${collection}`,
					`${indexPrefix}fingerprint:${collection}:name=ada`,
				)).toBe(1);
			},
		);

		// The index-key set read first: both only count down from here.
		then.optional(
			/^the index-key set of \w+ expires no sooner than the set of ada$/,
			async () => {
				const indexKeysExpiry = await redisClient.pttl(
					`${indexPrefix}collection-index-keys:${collection}`,
				);

				const setExpiry = await redisClient.pttl(
					`${indexPrefix}fingerprint:${collection}:name=ada`,
				);

				expect(setExpiry).toBeGreaterThan(0);
				expect(indexKeysExpiry).toBeGreaterThanOrEqual(setExpiry);
			},
		);

		then.optional(
			/^neither the index-key set of \w+ nor the set of ada expires$/,
			async () => {
				expect([
					await redisClient.pttl(
						`${indexPrefix}collection-index-keys:${collection}`,
					),
					await redisClient.pttl(
						`${indexPrefix}fingerprint:${collection}:name=ada`,
					),
				]).toEqual([-1, -1]);
			},
		);

		// The commands the purge sends to this collection's index sets, as MONITOR
		// sees them, the ones its scripts run included, each kept as sent.
		when.optional(/^every read of \w+ is purged$/, async () => {
			const monitoredCommands = await monitorRedisCommands(
				redisClient,
				async () => {
					const purged = await request(getUrl(vendor, env))
						.post(`/cache-collection-purge/${collection}`)
						.set('Authorization', auth);

					expect(purged.statusCode).toBe(200);
				},
			);

			for (const { commandArgs } of monitoredCommands) {
				const command = commandArgs[0]!.toLowerCase();

				const namesCollection = commandArgs.some((commandArg) => {
					return commandArg.includes(collection);
				});

				// Its first page only: a scan of the keyspace takes several.
				if (
					namesCollection
					&& ((command === 'scan' && commandArgs[1] === '0')
						|| (command === 'sscan' && commandArgs[2] === '0'))
				) {
					purgeReads.push(commandArgs);
				}
				else if (
					namesCollection
					&& ['rename', 'sadd', 'srem', 'unlink'].includes(command)
					&& commandArgs.slice(1).every((commandArg) => {
						return commandArg.startsWith(indexPrefix);
					})
				) {
					purgeWrites.push(commandArgs);
				}
			}
		});

		// A cell spells the index prefix `<index>` and a moved set's fresh uuid
		// `<sweep>`.
		then.optional(
			/^the purge (wrote|read) these index sets, in order:$/,
			(wroteOrRead: string, table: Record<string, string>[]) => {
				expect(
					wroteOrRead === 'wrote'
						? purgeWrites
						: purgeReads,
				).toEqual(
					table.map((row) => {
						return [
							row['command'],
							...row['arguments']!.split(' ').map((cellArgument) => {
								const sentArgument = cellArgument
									.replaceAll('<index>', indexPrefix);

								return sentArgument.includes('<sweep>')
									? expect.stringMatching(new RegExp(
										`^${sentArgument.replace('<sweep>', '[0-9a-f-]{36}')}$`,
									))
									: sentArgument;
							}),
						];
					}),
				);
			},
		);

		then.optional(
			'these reads answer:',
			async (table: Record<string, string>[]) => {
				for (const row of table) {
					const answered = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
						.set('Authorization', auth);

					expect(answered.headers[cacheStatusHeader]).toBe(row['cache']);
				}
			},
		);
	}

	// A counter no read incremented yet is absent from the exposition: 0.
	async function countedIndexReads(): Promise<Record<string, number>> {
		const exposed = await request(getUrl(vendor, env))
			.get('/metrics')
			.set('Authorization', auth);

		expect(exposed.statusCode).toBe(200);

		const counted: Record<string, number> = { scan: 0, registry: 0 };

		for (const [, mode, count] of exposed.text.matchAll(
			/^directus_scoped_cache_index_reads_total\{mode="(\w+)"\} (\d+)$/gm,
		)) {
			counted[mode!] = Number(count);
		}

		return counted;
	}

	// A `query` cell holds the `Query` the read is made of: `fields` goes as a
	// list, `filter` as the JSON Directus parses (`sanitize-query.ts`).
	function readHomePinned(collection: string, query: string) {
		const { fields, filter } = loadYaml(query) as {
			fields: string[];
			filter: Record<string, unknown>;
		};

		return request(getUrl(vendor, env))
			.get(`/items/${collection}`)
			.query({ fields, filter: JSON.stringify(filter) })
			.set('Authorization', auth);
	}

	// A `set` cell spells what follows `fingerprint:<collection>:` in the key.
	function homePinSetKey(collection: string, indexSet: string) {
		return `${indexPrefix}fingerprint:${collection}:${indexSet}`;
	}

	function defineHomePinSteps({ given, and, when, then }: StepFunctions) {
		let purgedCollection = '';
		let countedBefore: Record<string, number> = {};
		let countedAfter: Record<string, number> = {};

		given(
			'these rows, each written to its own collection:',
			async (table: Record<string, string>[]) => {
				for (const { collection, id, owner, label } of parseGherkinTable<{
					collection: string;
					id: number;
					owner: string;
					label: string;
				}>(table)) {
					const created = await request(getUrl(vendor, env))
						.post(`/items/${collection}`)
						.send({ id, owner, label })
						.set('Authorization', auth);

					expect(created.statusCode).toBe(200);
				}
			},
		);

		// The fill lands after the response, and files the entry under the set
		// the cell names: the set exists only once something is filed in it.
		and(
			/^these reads are cached, each in the set of .+:$/,
			async (table: Record<string, string>[]) => {
				for (const { collection, query, set: indexSet } of table) {
					expect(
						(await readHomePinned(collection!, query!))
							.headers[cacheStatusHeader],
					).toBe('MISS');

					await expect.poll(async () => {
						return (await readHomePinned(collection!, query!))
							.headers[cacheStatusHeader];
					}, { timeout: 5_000 }).toBe('HIT');

					expect(await redisClient.exists(
						homePinSetKey(collection!, indexSet!),
					)).toBe(1);
				}
			},
		);

		and(
			/^the index-key set of (\w+) names these sets, so the purge finds them there:$/,
			async (namedBy: string, table: Record<string, string>[]) => {
				purgedCollection = namedBy;

				for (const { set: indexSet } of table) {
					expect(await redisClient.sismember(
						`${indexPrefix}collection-index-keys:${purgedCollection}`,
						homePinSetKey(purgedCollection, indexSet!),
					)).toBe(1);
				}
			},
		);

		// What a reap's full pass writes: the index generation as it read
		// before the pass.
		and(
			'the index-key sets are marked complete, so a purge trusts them over a scan',
			async () => {
				expect(await redisClient.set(
					markerKey,
					(await redisClient.get(generationKey))!,
				)).toBe('OK');
			},
		);

		// Read on each side of the purge alone: the fills before it read no
		// collection-wide index.
		when(/^every read of \w+ is purged$/, async () => {
			countedBefore = await countedIndexReads();

			const purged = await request(getUrl(vendor, env))
				.post(`/cache-collection-purge/${purgedCollection}`)
				.set('Authorization', auth);

			expect(purged.statusCode).toBe(200);
			countedAfter = await countedIndexReads();
		});

		then(
			oneLine`
				the purge found its sets through the index-key set, not a scan of
				the keyspace:
			`,
			(table: Record<string, string>[]) => {
				for (const { mode, grew } of table) {
					if (grew === 'yes') {
						expect(countedAfter[mode!])
							.toBeGreaterThan(countedBefore[mode!]!);
					}
					else {
						expect(countedAfter[mode!]).toBe(countedBefore[mode!]);
					}
				}
			},
		);

		and(
			oneLine`
				these reads answer, the purged collection's gone and the other's
				still cached:
			`,
			async (table: Record<string, string>[]) => {
				for (const { collection, query, cache } of table) {
					expect(
						(await readHomePinned(collection!, query!))
							.headers[cacheStatusHeader],
					).toBe(cache);
				}
			},
		);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			oneLine`
				a set created after the index-key set exists is purged with the
				collection
			`,
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			'a set whose name was lost is named again by the next fill into it',
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			oneLine`
				an index-key set that is gone is rebuilt by the next fill, with an
				expiry
			`,
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			oneLine`
				an index-key set expiring before its sets is kept longer by the next
				fill
			`,
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			'a set kept past this fill\'s expiry keeps the index-key set as long',
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			'a set with no expiry leaves the index-key set with none',
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			oneLine`
				a purge moves each set aside, names it, and releases both once its
				reads are gone
			`,
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			oneLine`
				a purge reads the index-key set once the index-key sets are marked
				complete
			`,
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			oneLine`
				a set nothing names is purged while the index-key sets are not marked
				complete
			`,
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			'a marker written before a flush still vouches after it',
			defineIndexKeySteps,
			60_000,
		);

		scenario(
			oneLine`
				a read filed under its primary key's home pin is purged with the
				collection
			`,
			defineHomePinSteps,
			60_000,
		);

		scenario(
			oneLine`
				a read filed under a second scope field's home pin is purged with the
				collection
			`,
			defineHomePinSteps,
			60_000,
		);
	});
});
