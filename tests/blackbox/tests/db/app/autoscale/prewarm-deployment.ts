import config, { getUrl, paths } from '@common/config';
import type { Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { type Rig, startPool } from './rig';

const auth = `Bearer ${USER.ADMIN.TOKEN}`;

export interface Deployment {
	instance: ChildProcess;
	url: string;
	rig: Rig;
	/** What its processes share a bus under; the autoscaler runs under it too. */
	namespace: string;
}

/**
 * A Directus that has been told it serves with a prewarmed pool, and a pm2
 * daemon holding a pool it can be told about.
 *
 * The instance is not a worker of that pool — a blackbox runner has no
 * supervisor over the suite itself — but it reads the same environment and
 * hears the same bus, which is everything the check under test depends on.
 */
export async function deploy(
	vendor: Vendor,
	prewarm: string,
	pool: {
		instances: number;
		crashAfterMs?: number;
		crashOnlyInstance?: string;
		readyDelayMs?: number;
	},
): Promise<Deployment> {
	const env = cloneDeep(config.envs)[vendor]!;
	const port = await getPort();
	const namespace = `blackbox-prewarm-health-${vendor}-${prewarm}`;

	env['PORT'] = String(port);
	env['REDIS_HOST'] = 'localhost';
	env['REDIS_PORT'] = '6108';
	env['CACHE_NAMESPACE'] = namespace;
	env['PM2_AUTOSCALE_PREWARM'] = prewarm;

	const instance = spawn('node', [paths.cli, 'start'], {
		cwd: paths.cwd,
		env,
	});

	// `/server/ping`, not `/server/health`: the point of this file is that the
	// second one is refusing while the first one answers.
	await awaitDirectusConnection(port);

	return {
		instance,
		rig: startPool({
			appName: `prewarm-health-${vendor}-${prewarm}`,
			giveUpAfterRestarts: 1,
			...pool,
		}),
		url: getUrl(vendor, { [vendor]: env } as never),
		namespace,
	};
}

export async function healthOf(url: string): Promise<{ status: number; body: any }> {
	const response = await request(url)
		.get('/server/health')
		.set('Authorization', auth);

	return { status: response.status, body: response.body };
}

export async function healthTurns(
	url: string,
	status: number,
	timeoutMs: number,
): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	let last = 0;

	while (Date.now() < deadline) {
		last = (await healthOf(url)).status;

		if (last === status) {
			return last;
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	return last;
}
