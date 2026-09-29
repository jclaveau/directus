import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { oneLine } from '@directus/utils';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import getPort from 'get-port';
import Redis from 'ioredis';
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
	const markerKey = `${indexPrefix}collection-index-keys-complete`;
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
			}),
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

		for (const collection of collections) {
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

		// Before the kept marker goes back: a pass finishing after that would
		// write its own over it.
		and.optional(
			'the reap the flush asked for has marked the index-key sets complete',
			async () => {
				await expect.poll(async () => {
					const [marker, generation] = await redisClient.mget(
						markerKey,
						generationKey,
					);

					return marker === generation && marker !== keptMarker;
				}, { timeout: 15_000 }).toBe(true);
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

		// What a reap that read the generation before the flush writes after it.
		and.optional('the marker is written back as it was kept', async () => {
			expect(await redisClient.set(markerKey, keptMarker!)).toBe('OK');
		});

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
			const monitor = redisClient.duplicate({
				monitor: true,
				lazyConnect: false,
			});

			await new Promise<void>((resolveMonitoring, rejectMonitoring) => {
				monitor.once('monitoring', resolveMonitoring);

				// ioredis flips to monitoring only after the OK resolves, so a
				// line landing in the same chunk finds an empty command queue.
				monitor.on('error', (monitorError: Error) => {
					if (!monitorError.message.startsWith('Command queue state error')) {
						rejectMonitoring(monitorError);
					}
				});
			});

			const endSentinel = `${namespace}:monitor-sentinel:${randomUUID()}`;

			const endSeen = new Promise<void>((resolveEnd) => {
				monitor.on('monitor', (_time: string, commandArgs: string[]) => {
					const command = commandArgs[0]!.toLowerCase();

					const namesCollection = commandArgs.some((commandArg) => {
						return commandArg.includes(collection);
					});

					if (commandArgs[1] === endSentinel) {
						resolveEnd();
					}
					// Its first page only: a scan of the keyspace takes several.
					else if (
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
				});
			});

			const purged = await request(getUrl(vendor, env))
				.post(`/cache-collection-purge/${collection}`)
				.set('Authorization', auth);

			expect(purged.statusCode).toBe(200);

			await Promise.all([endSeen, redisClient.get(endSentinel)]);
			monitor.disconnect();
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
			'a marker written before a flush vouches for nothing after it',
			defineIndexKeySteps,
			60_000,
		);
	});
});
