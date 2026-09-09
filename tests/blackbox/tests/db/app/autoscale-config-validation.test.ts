import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The autoscaler's loop clamps whatever it is handed, because it runs beside
// the pool with nobody to answer: an environment it cannot argue with, and a
// Redis key anyone with a client can edit. A write has someone to answer, and
// clamping one silently is the worse failure of the two — an operator who
// raised a ceiling during an incident and watched the pool ignore it cannot
// tell a corrected value from a refused one.
//
// Both surfaces that write reach the same service method, and this proves it
// from outside: the same crossed pair is refused over REST and over the MCP,
// and neither leaves anything behind in Redis.
//
// The env chain is pinned here so the cross-field rules have a fixed other
// side — a floor is only too high against the ceiling it will actually sit
// under, and that ceiling is a field these patches never mention.
const ENV_MAX_WORKERS = 4;
const ENV_SCALE_THRESHOLD = 60;

describe('The autoscale configuration is checked before it is stored', () => {
	const instances = {} as Record<Vendor, ChildProcess>;
	const envs = {} as Record<Vendor, Env>;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		const started = [];

		for (const vendor of vendors) {
			const env = cloneDeep(config.envs);

			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = '6108';
			env[vendor]['CACHE_NAMESPACE'] = `blackbox-autoscale-validation-${vendor}`;
			env[vendor]['PM2_AUTOSCALE_MIN_WORKERS'] = '1';
			env[vendor]['PM2_AUTOSCALE_MAX_WORKERS'] = String(ENV_MAX_WORKERS);
			env[vendor]['PM2_AUTOSCALE_SCALE_CPU_THRESHOLD'] = String(ENV_SCALE_THRESHOLD);
			env[vendor]['PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD'] = '40';
			env[vendor]['SYSTEM_MCP_ENABLED'] = 'true';
			env[vendor]['SYSTEM_MCP_TOOLS'] = 'autoscale';

			const port = await getPort();
			env[vendor].PORT = String(port);
			envs[vendor] = env;

			instances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			started.push(awaitDirectusConnection(port));
		}

		await Promise.all(started);
	}, 180_000);

	afterAll(async () => {
		for (const vendor of vendors) {
			await request(getUrl(vendor, envs[vendor]))
				.delete('/utils/autoscale')
				.set('Authorization', auth);

			instances[vendor]!.kill();
		}
	});

	function patch(vendor: Vendor, body: object) {
		return request(getUrl(vendor, envs[vendor]))
			.patch('/utils/autoscale')
			.set('Authorization', auth)
			.send(body);
	}

	function read(vendor: Vendor) {
		return request(getUrl(vendor, envs[vendor]))
			.get('/utils/autoscale')
			.set('Authorization', auth);
	}

	function writeOverMcp(vendor: Vendor, autoscale: object, note: string) {
		return request(getUrl(vendor, envs[vendor]))
			.post('/system-mcp')
			.set('Authorization', auth)
			.send({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'write_autoscale_config',
					arguments: { config: autoscale, note },
				},
			});
	}

	function refusal(response: request.Response): string {
		return response.body.errors[0].message;
	}

	describe('stores a configuration the loop can run on', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await patch(vendor, { maxWorkers: 3, minWorkers: 2 });

			expect(response.statusCode).toBe(200);

			expect(response.body.data.override).toMatchObject({
				maxWorkers: 3,
				minWorkers: 2,
			});
		});
	});

	// The ceiling this floor is judged against is the environment's, not one
	// in the patch: a rule that only compared fields written together would
	// take this and let the loop clamp it back.
	describe('refuses a floor above a ceiling it never mentions', () => {
		it.each(vendors)('%s', async (vendor) => {
			await patch(vendor, { minWorkers: null, maxWorkers: null });

			const response = await patch(vendor, { minWorkers: 8 });

			expect(response.statusCode).toBe(400);

			expect(refusal(response)).toContain(
				`'minWorkers' is 8, above the 'maxWorkers' ceiling of ${ENV_MAX_WORKERS}`,
			);

			// Nothing stored: a refused write leaves the pool on what it had.
			const stored = await read(vendor);

			expect(stored.body.data.override?.minWorkers).toBeUndefined();
		});
	});

	describe('refuses a release threshold that is not under the scale one', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await patch(vendor, { releaseCpuThreshold: 90 });

			expect(response.statusCode).toBe(400);

			expect(refusal(response)).toContain(
				`'releaseCpuThreshold' is 90% and has to stay under the `
					+ `'scaleCpuThreshold' of ${ENV_SCALE_THRESHOLD}%`,
			);
		});
	});

	// A form applies every field at once, so answering the first problem alone
	// would take as many round trips as there are mistakes.
	describe('answers with everything wrong at once', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await patch(vendor, {
				sampleWindow: 90,
				prewarmWorkers: 99,
			});

			expect(response.statusCode).toBe(400);
			expect(refusal(response)).toContain(`'sampleWindow' is 90`);
			expect(refusal(response)).toContain(`'prewarmWorkers' is 99`);
		});
	});

	// The loop rounds what it is given, so half a worker arrives as a value
	// nobody asked for and nobody sees.
	describe('refuses a count that is not whole', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await patch(vendor, { minWorkers: 2.5 });

			expect(response.statusCode).toBe(400);

			expect(refusal(response))
				.toContain(`'minWorkers' has to be a whole number of workers`);
		});
	});

	// The panel is not the only thing that writes this key, so the check
	// cannot live in the route the panel uses.
	describe('refuses the same configuration over the MCP', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await writeOverMcp(
				vendor,
				{ minWorkers: 8 },
				'raising the floor mid-incident',
			);

			// "Invalid params": the write never ran, which the spec lists among
			// the protocol errors rather than as a tool result.
			expect(response.body.error.code).toBe(-32602);

			expect(response.body.error.message).toContain(
				`'minWorkers' is 8, above the 'maxWorkers' ceiling of ${ENV_MAX_WORKERS}`,
			);

			const stored = await read(vendor);

			expect(stored.body.data.override?.minWorkers).toBeUndefined();
		});
	});
});
