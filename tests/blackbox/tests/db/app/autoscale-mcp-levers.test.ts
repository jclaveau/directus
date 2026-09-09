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
import {
	countWorkers,
	declaredEverywhere,
	poolSize,
	reportOf,
	startAutoscaler,
	startPool,
	stopRig,
	type Rig,
} from './autoscale/rig';

// An agent reaching this deployment has no browser to open the panel in, and
// the two levers that need each other are the ones a panel makes obvious and a
// tool list does not: options pm2 reads at boot are stored, and the rolling
// restart is what carries them to the workers. Proven together, end to end,
// because either alone is a value nothing acts on.
//
// The rig is the smallest one that can tell: a real pool under a pm2 daemon of
// its own, a real autoscaler beside it, and a Directus serving the MCP over the
// same Redis — which is the only way the write and the pool meet.
const REDIS_PORT = 6108;

function supervisorKey(namespace: string): string {
	return `${namespace}:config:pm2:supervisor`;
}

describe('The pm2 options and the restart that carries them, over the MCP', () => {
	const redis = new Redis({ host: 'localhost', port: REDIS_PORT });
	const instances = {} as Record<Vendor, ChildProcess>;
	const envs = {} as Record<Vendor, Env>;
	const rigs = {} as Record<Vendor, Rig>;
	const namespaces: string[] = [];

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		const started = [];

		for (const vendor of vendors) {
			const env = cloneDeep(config.envs);
			const namespace = `bb-autoscale-mcp-levers-${vendor}`;
			const service = `autoscale-mcp-levers-${vendor}`;
			namespaces.push(namespace);
			await redis.del(supervisorKey(namespace));

			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = String(REDIS_PORT);
			env[vendor]['CACHE_NAMESPACE'] = namespace;
			env[vendor]['PROCESSES_SERVICE_NAME'] = service;
			env[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-mcp`;
			// Generous next to the 750ms default: a loaded runner must not turn a
			// slow reply into a restart refused for having nobody to reach.
			env[vendor]['PROCESSES_COLLECT_TIMEOUT'] = '3s';
			env[vendor]['SYSTEM_MCP_ENABLED'] = 'true';
			env[vendor]['SYSTEM_MCP_TOOLS'] = 'autoscale';

			const port = await getPort();
			env[vendor].PORT = String(port);
			envs[vendor] = env;

			instances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			// The ecosystem declares 10s, so the two values an arm can see are
			// distinct: 21s is what the MCP stored, and 10s is a pool nothing
			// reached.
			const rig = startPool({
				appName: service,
				instances: 2,
				busyMs: 5,
				idleMs: 95,
			});

			rigs[vendor] = rig;

			startAutoscaler(rig, {
				REDIS_ENABLED: 'true',
				REDIS_HOST: 'localhost',
				REDIS_PORT: String(REDIS_PORT),
				CACHE_NAMESPACE: namespace,
				PROCESSES_SERVICE_NAME: service,
				RAILWAY_REPLICA_ID: `${vendor}-autoscaler`,
				// Bounds that meet at the size the pool booted with, so nothing but
				// the restart each arm asks for replaces a worker here.
				PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
				PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
				PM2_AUTOSCALE_MIN_WORKERS: '2',
				PM2_AUTOSCALE_MAX_WORKERS: '2',
				PM2_AUTOSCALE_WARMUP_SECONDS: '8',
			});

			started.push(awaitDirectusConnection(port));
		}

		await Promise.all(started);
	}, 300_000);

	afterAll(async () => {
		for (const vendor of vendors) {
			stopRig(rigs[vendor]!);
			instances[vendor]!.kill();
		}

		for (const namespace of namespaces) {
			await redis.del(supervisorKey(namespace));
		}

		redis.disconnect();
	});

	function callMcp(vendor: Vendor, name: string, args: object) {
		return request(getUrl(vendor, envs[vendor]))
			.post('/system-mcp')
			.set('Authorization', auth)
			.send({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name, arguments: args },
			});
	}

	// A restart is asked for over the bus, and pub/sub keeps nothing for a
	// subscriber that is not there yet. The pool is answered for by a loop that
	// has already reported itself, which is a loop that has already subscribed.
	it('waits for a loop that has reported itself', async () => {
		for (const vendor of vendors) {
			const rig = rigs[vendor]!;

			expect(await poolSize(rig, 2, 60_000), reportOf(rig)).toBe(2);

			expect(await declaredEverywhere(rig, 'listen_timeout', 10_000, 60_000))
				.toEqual([10_000, 10_000]);

			// The restart tool refuses where nothing answers for a pool, so the
			// arm below cannot start until this one has.
			const read = await callMcp(vendor, 'read_autoscale_config', {});

			expect(read.body.result.structuredContent.running, reportOf(rig))
				.toHaveLength(1);
		}
	}, 200_000);

	it('stores an option an agent wrote and rolls it onto the pool', async () => {
		for (const vendor of vendors) {
			const rig = rigs[vendor]!;

			const written = await callMcp(vendor, 'write_supervisor_config', {
				supervisor: { listenTimeout: 21_000 },
				note: 'the boot got slower after the extension bundle grew',
			});

			expect(written.body.result.isError).toBeUndefined();

			const stored = written.body.result.structuredContent.override;

			// Stamped as an agent's doing, which is what tells this override from
			// one a person typed into the panel during the same incident.
			expect(stored).toMatchObject({ listenTimeout: 21_000, setFrom: 'mcp' });
			expect(stored.note).toContain('the extension bundle grew');

			// Stored is not applied: the workers are still on what they booted
			// with until something restarts them.
			expect(await declaredEverywhere(rig, 'listen_timeout', 10_000, 10_000))
				.toEqual([10_000, 10_000]);

			const asked = Date.now();
			const rolled = await callMcp(vendor, 'restart_autoscale_pool', {});

			expect(rolled.body.result.isError).toBeUndefined();

			// The answer is what the worker taking the call can honestly say: the
			// request is out. The process that restarts the pool is another one,
			// so where the restart got to comes back on its report, not here.
			const state = rolled.body.result.structuredContent;

			expect(state.running).toBe(false);
			expect(state.finishedAt).toBeNull();
			expect(state.error).toBeNull();
			expect(state.askedAt).toBeGreaterThanOrEqual(asked);

			expect(
				await declaredEverywhere(rig, 'listen_timeout', 21_000, 150_000),
				reportOf(rig),
			).toEqual([21_000, 21_000]);

			// A roll, not a scale: the pool holds two workers on the other side of
			// it, and an arm reading only the declaration could not tell a restart
			// that replaced them from one that grew the pool instead.
			expect(countWorkers(rig), reportOf(rig)).toBe(2);
		}
	}, 300_000);
});
