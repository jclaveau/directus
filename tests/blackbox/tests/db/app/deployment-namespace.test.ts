import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A Redis is shared: by the deployments of one server, and here by every
// suite of a shard. What keeps one deployment's traffic out of another's is
// the prefix each key and channel carries, and the cache namespace is what
// names a deployment. Besides its cache, a node keeps two things on that
// Redis: the bus it announces on and the locks it takes. This file watches
// the wire for both and reads the deployment's name off each.
//
// The schema build is where the two meet (`api/src/utils/get-schema.ts`):
// the node that loses the lock waits for the winner's build on the bus. A
// lock shared wider than the bus leaves the loser waiting out the sync
// timeout for a message it cannot hear, so the lock has to carry the name
// the bus carries.
describe('A deployment keeps its bus and its locks under its name', () => {
	const instances = {} as Record<Vendor, ChildProcess>;
	const envs = {} as Record<Vendor, Env>;
	const namespaces = {} as Record<Vendor, string>;

	// Every command the shared Redis serves, from every suite of the shard.
	// Matched on the whole key or channel, so another suite's traffic can
	// only add lines, never satisfy a poll.
	const commands: string[][] = [];
	const redis = new Redis({ host: 'localhost', port: 6108 });
	let monitor: Redis;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		monitor = await redis.monitor();
		monitor.on('monitor', (_time, args: string[]) => commands.push(args));

		const started = [];

		for (const vendor of vendors) {
			const env = cloneDeep(config.envs);
			const namespace = `blackbox-deployment-namespace-${vendor}`;

			env[vendor]['CACHE_ENABLED'] = 'true';
			env[vendor]['CACHE_STORE'] = 'redis';
			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = '6108';
			env[vendor]['CACHE_NAMESPACE'] = namespace;

			const port = await getPort();
			env[vendor].PORT = String(port);
			envs[vendor] = env;
			namespaces[vendor] = namespace;

			instances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			started.push(awaitDirectusConnection(port));
		}

		await Promise.all(started);
	}, 180_000);

	afterAll(() => {
		for (const vendor of vendors) {
			instances[vendor]!.kill();
		}

		monitor.disconnect();
		redis.disconnect();
	});

	// Drops the node's in-memory schema, which is what makes its next read
	// rebuild the schema: take the lock, build, announce the build.
	async function dropSchemaCache(vendor: Vendor) {
		await request(getUrl(vendor, envs[vendor]))
			.post('/utils/cache/clear')
			.query({ targets: 'system' })
			.set('Authorization', auth)
			.expect(200);
	}

	// Whether the node ran `command` against `target` yet, its whole key or
	// channel. Polled with a read of the node between attempts, so a rebuild
	// the clear above did not itself trigger has a request to run under.
	async function ranCommand(
		vendor: Vendor,
		command: string,
		target: string,
	): Promise<boolean> {
		for (let attempt = 0; attempt < 50; attempt++) {
			if (commands.some(([name, key]) => {
				return name?.toLowerCase() === command && key === target;
			})) {
				return true;
			}

			await request(getUrl(vendor, envs[vendor]))
				.get('/collections')
				.set('Authorization', auth);

			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		return false;
	}

	describe.each(vendors)('%s', (vendor) => {
		it('announces a schema change on the bus of the deployment', async () => {
			await dropSchemaCache(vendor);

			const channel = `${namespaces[vendor]}:bus:schemaChanged`;

			expect(await ranCommand(vendor, 'publish', channel)).toBe(true);
		});

		it('takes the schema build lock under the deployment', async () => {
			await dropSchemaCache(vendor);

			const lock = `${namespaces[vendor]}:lock:schemaCache--preparing`;

			expect(await ranCommand(vendor, 'incrby', lock)).toBe(true);
		});

		it('announces the build where the lock losers wait for it', async () => {
			await dropSchemaCache(vendor);

			const channel = `${namespaces[vendor]}:bus:schemaCache--done`;

			expect(await ranCommand(vendor, 'publish', channel)).toBe(true);
		});
	});
});
