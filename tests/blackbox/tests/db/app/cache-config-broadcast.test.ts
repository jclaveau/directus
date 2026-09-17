import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

// The live cache-TTL override is durable in `directus_settings.cache_ttl` and
// mirrored in every node's memory off the `cacheConfigChanged` bus. Two nodes over
// one Redis and one database are the smallest rig that can tell a real broadcast
// from a node merely reading its own write, so the assertions below are made on the
// node that did NOT write.
//
// `writer` and `peer` differ only by cache namespace: same DB, same Redis and,
// named for both, the same bus, so they share the settings row and the
// broadcast while keeping their cache entries apart.
describe('Cache config broadcast', () => {
	const directusInstances = {} as { [vendor: string]: ChildProcess[] };
	const envs = {} as Record<Vendor, { writer: Env; peer: Env; stranger: Env }>;

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			// Redis (localhost:6108) is shared across vendors, so the cache namespace
			// must carry the vendor — same reasoning as cache.test.ts. The bus
			// follows the cache namespace, which would put the two on separate
			// buses; the broadcast under test needs them on one.
			const nsPrefix = `directus-cache-config-${vendor}`;

			const writer = cloneDeep(config.envs);
			writer[vendor]['CACHE_ENABLED'] = 'true';
			writer[vendor]['CACHE_STORE'] = 'redis';
			writer[vendor]['REDIS_HOST'] = 'localhost';
			writer[vendor]['REDIS_PORT'] = '6108';
			writer[vendor]['CACHE_NAMESPACE'] = `${nsPrefix}_writer`;
			writer[vendor]['BUS_NAMESPACE'] = `${nsPrefix}:bus`;
			writer[vendor]['CACHE_TTL'] = '11m';

			const peer = cloneDeep(writer);
			peer[vendor]['CACHE_NAMESPACE'] = `${nsPrefix}_peer`;

			// Another deployment on the same Redis and database: its bus is named
			// after its own cache namespace, so nothing the writer announces
			// reaches it.
			const stranger = cloneDeep(writer);
			stranger[vendor]['CACHE_NAMESPACE'] = `${nsPrefix}_stranger`;
			delete stranger[vendor]['BUS_NAMESPACE'];

			const writerPort = await getPort();
			const peerPort = await getPort();
			const strangerPort = await getPort();
			writer[vendor].PORT = String(writerPort);
			peer[vendor].PORT = String(peerPort);
			stranger[vendor].PORT = String(strangerPort);

			directusInstances[vendor] = [
				spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: writer[vendor] }),
				spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: peer[vendor] }),
				spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: stranger[vendor],
				}),
			];

			envs[vendor] = { writer, peer, stranger };

			promises.push(
				awaitDirectusConnection(writerPort),
				awaitDirectusConnection(peerPort),
				awaitDirectusConnection(strangerPort),
			);
		}

		await Promise.all(promises);
	}, 180_000);

	afterAll(() => {
		for (const vendor of vendors) {
			for (const instance of directusInstances[vendor]!) {
				instance.kill();
			}
		}
	});

	afterEach(async () => {
		// The override lives in one settings row shared by both nodes and outlives the
		// test, so clear it back to "inherit env" between cases.
		for (const vendor of vendors) {
			await request(getUrl(vendor, envs[vendor]!.writer))
				.patch('/settings')
				.send({ cache_ttl: null })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);
		}
	});

	// The TTL in force on a node, as that node reports it. Read from the node under
	// assertion, never from the writer. Polled because the bus is asynchronous: a
	// single immediate read would be a race, and a fixed sleep would either flake or
	// pad every case.
	async function awaitEffectiveTtl(
		vendor: Vendor,
		env: Env,
		expected: string | null,
	): Promise<string | null> {
		let effectiveTtl: string | null = null;

		for (let attempt = 0; attempt < 50; attempt++) {
			const response = await request(getUrl(vendor, env))
				.get('/utils/cache/timeseries')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			effectiveTtl = response.body.data.effectiveTtl;

			if (effectiveTtl === expected) {
				return effectiveTtl;
			}

			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		return effectiveTtl;
	}

	describe.each(vendors)('%s', (vendor) => {
		it('starts both nodes on env CACHE_TTL with no override set', async () => {
			// Non-vacuity: without this the later assertions could pass against a value
			// that was already in force before the write.
			const { writer, peer } = envs[vendor]!;

			expect(await awaitEffectiveTtl(vendor, writer, '11m')).toBe('11m');
			expect(await awaitEffectiveTtl(vendor, peer, '11m')).toBe('11m');
		});

		it('flips the peer when the cache page writes the TTL', async () => {
			// The control: PATCH /settings routes through SettingsService, the path that
			// already announced. If this fails the rig is broken, not the feature.
			const { writer, peer } = envs[vendor]!;

			await request(getUrl(vendor, writer))
				.patch('/settings')
				.send({ cache_ttl: '3h' })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.expect(200);

			expect(await awaitEffectiveTtl(vendor, peer, '3h')).toBe('3h');
		});

		it('leaves a node on another bus where it was', async () => {
			// Redis pub/sub is global to the server, so what keeps one deployment's
			// announcements out of another's is the bus name alone. The stranger
			// shares the row the writer changed and still serves its boot-time
			// value: a poll for the peer's new value runs out its whole window.
			//
			// What this arm cannot tell apart is a stranger that heard nothing
			// from one whose subscription is dead: the writer's own mirror moves
			// before the bus does, so no write on the stranger can witness its
			// bus. The subscribe path is the peer's, exercised above on the same
			// build.
			const { writer, peer, stranger } = envs[vendor]!;

			expect(await awaitEffectiveTtl(vendor, stranger, '11m')).toBe('11m');

			await request(getUrl(vendor, writer))
				.patch('/settings')
				.send({ cache_ttl: '3h' })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.expect(200);

			expect(await awaitEffectiveTtl(vendor, peer, '3h')).toBe('3h');
			expect(await awaitEffectiveTtl(vendor, stranger, '3h')).toBe('11m');
		});

		it('flips both nodes when an import writes past SettingsService', async () => {
			// A config-sync import writes the singleton through a plain ItemsService, so
			// nothing SettingsService does applies. Both nodes must still converge — the
			// writer included, since it never learned of its own write either.
			const { writer, peer } = envs[vendor]!;

			await request(getUrl(vendor, writer))
				.post('/settings-import-write')
				.send({ cache_ttl: '6h' })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.expect(200);

			expect(await awaitEffectiveTtl(vendor, peer, '6h')).toBe('6h');
			expect(await awaitEffectiveTtl(vendor, writer, '6h')).toBe('6h');
		});

		it('returns both nodes to env CACHE_TTL when an import clears it', async () => {
			// The production shape exactly: an import re-asserting `cache_ttl: null`
			// over a value an operator had set. Clearing has to announce as loudly as
			// setting, or the fleet splits between the override and the env fallback.
			const { writer, peer } = envs[vendor]!;

			await request(getUrl(vendor, writer))
				.patch('/settings')
				.send({ cache_ttl: '24h' })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.expect(200);

			expect(await awaitEffectiveTtl(vendor, peer, '24h')).toBe('24h');

			await request(getUrl(vendor, writer))
				.post('/settings-import-write')
				.send({ cache_ttl: null })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.expect(200);

			expect(await awaitEffectiveTtl(vendor, peer, '11m')).toBe('11m');
			expect(await awaitEffectiveTtl(vendor, writer, '11m')).toBe('11m');
		});

		it('marks the timeseries for an import write too', async () => {
			// The chart draws a step wherever the TTL moved; a step with no marker is a
			// change with no visible cause, which is how a production reset went
			// unexplained until `directus_revisions` was read by hand.
			const { writer, peer } = envs[vendor]!;

			await request(getUrl(vendor, writer))
				.post('/settings-import-write')
				.send({ cache_ttl: '7h' })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.expect(200);

			expect(await awaitEffectiveTtl(vendor, peer, '7h')).toBe('7h');

			// The marker is written fire-and-forget so a chart annotation can never fail
			// a settings save, which means it lands after the broadcast the poll above
			// waits on. Poll for it too, or the read races the insert and finds the
			// previous case's cleanup as the latest change.
			let timeseries;
			let ttlChanges = [];

			for (let attempt = 0; attempt < 50; attempt++) {
				timeseries = await request(getUrl(vendor, writer))
					.get('/utils/cache/timeseries')
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				ttlChanges = timeseries.body.data.markers
					.filter((marker: { kind: string }) => marker.kind === 'ttl_change');

				if (ttlChanges.at(-1)?.detail === '7h') {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			expect(ttlChanges.at(-1)).toMatchObject({ kind: 'ttl_change', detail: '7h' });

			// And the replayed series ends on the value the marker announced, rather than
			// on whatever lifetime the surviving entries were stamped with.
			expect(timeseries!.body.data.buckets.at(-1).effectiveTtlMs).toBe(25_200_000);
		});
	});
});
