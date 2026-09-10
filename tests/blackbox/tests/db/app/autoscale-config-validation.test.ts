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

	// The same deployment with nothing to reach the pool over, kept beside the
	// one above so the arm asking it for the routes costs no extra boot.
	const buslessInstances = {} as Record<Vendor, ChildProcess>;
	const buslessEnvs = {} as Record<Vendor, Env>;

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

			const busless = cloneDeep(config.envs);

			busless[vendor]['REDIS_ENABLED'] = 'false';

			const buslessPort = await getPort();
			busless[vendor].PORT = String(buslessPort);
			buslessEnvs[vendor] = busless;

			buslessInstances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: busless[vendor],
			});

			started.push(awaitDirectusConnection(buslessPort));
		}

		await Promise.all(started);
	}, 180_000);

	afterAll(async () => {
		for (const vendor of vendors) {
			await request(getUrl(vendor, envs[vendor]))
				.delete('/utils/autoscale')
				.set('Authorization', auth);

			instances[vendor]!.kill();
			buslessInstances[vendor]!.kill();
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

	function patchSupervisor(vendor: Vendor, body: object) {
		return request(getUrl(vendor, envs[vendor]))
			.patch('/utils/autoscale/supervisor')
			.set('Authorization', auth)
			.send(body);
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

	function refusal(response: request.Response): string {
		return response.body.errors[0].message;
	}

	describe('stores a configuration the loop can run on', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await patch(vendor, { maxWorkers: 3, minWorkers: 2 });

			expect(response.statusCode).toBe(200);

			expect(response.body.data.sharedSettings).toMatchObject({
				maxWorkers: 3,
				minWorkers: 2,
			});
		});
	});

	// A change to the pool is a change to a setting, so it is audited like every
	// other one: the revision names the writer, the moment, and the whole
	// document they left behind. That trail is what the write goes through
	// `SettingsService` for, rather than touching the column itself.
	describe('leaves the change in the audit trail', () => {
		it.each(vendors)('%s', async (vendor) => {
			await patch(vendor, { minWorkers: 2, maxWorkers: 4 });

			const written = await patch(vendor, {
				maxWorkers: 3,
				note: 'the sale starts at nine',
			});

			expect(written.statusCode).toBe(200);

			const revisions = await request(getUrl(vendor, envs[vendor]))
				.get('/revisions')
				.query({
					'filter[collection][_eq]': 'directus_settings',
					fields: 'delta,activity.action,activity.user.email',
					sort: '-id',
					limit: 1,
				})
				.set('Authorization', auth);

			expect(revisions.statusCode).toBe(200);

			const latest = revisions.body.data[0];

			expect(latest.activity.action).toBe('update');
			expect(latest.activity.user.email).toBe(USER.ADMIN.EMAIL);

			// The whole document, not the field that moved: what the next reader
			// gets handed is this, and a delta holding only `maxWorkers` would
			// read as a pool with no floor.
			expect(latest.delta.autoscale_settings).toMatchObject({
				maxWorkers: 3,
				minWorkers: 2,
				note: 'the sale starts at nine',
				setFrom: 'admin',
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

			expect(stored.body.data.sharedSettings?.minWorkers).toBeUndefined();
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

			expect(stored.body.data.sharedSettings?.minWorkers).toBeUndefined();
		});
	});

	// The supervisor options reach pm2 unclamped — a supervisor takes what it
	// is handed — so the bounds are the whole of what stands between a number
	// typed during an incident and a pool that cannot come back. A listen
	// timeout of five milliseconds retires every replacement before it can
	// report ready, which empties the pool one worker at a time.
	describe('refuses a supervisor option outside its bounds', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await callMcp(vendor, 'write_supervisor_config', {
				supervisor: { listenTimeout: 5 },
				note: 'the boot got slower',
			});

			expect(response.body.error.code).toBe(-32602);

			expect(response.body.error.message).toContain(
				`'listenTimeout' has to be a whole number between 1000 and 600000`,
			);

			// And the note did not land on its own: a refused write stores
			// nothing at all.
			expect((await read(vendor)).body.data.supervisor.sharedSettings).toBeNull();
		});
	});

	// The panel writes the supervisor options over this route while an agent
	// writes them over the MCP, and the two meet at the same service method —
	// the route, the payload check and the answer a page redraws itself from
	// are the part only this one carries.
	describe('stores a supervisor option and releases it again', () => {
		it.each(vendors)('%s', async (vendor) => {
			const written = await patchSupervisor(vendor, {
				listenTimeout: 21_000,
				note: 'the boot got slower',
			});

			expect(written.statusCode).toBe(200);

			expect(written.body.data).toMatchObject({
				key: 'directus_settings.supervisor_settings',
				setByEmail: USER.ADMIN.EMAIL,
				sharedSettings: {
					listenTimeout: 21_000,
					note: 'the boot got slower',
					setFrom: 'admin',
				},
			});

			// Read back over the route the panel loads with, which reaches the
			// column through a different method than the one that wrote it.
			const stored = await read(vendor);

			expect(stored.body.data.supervisor.sharedSettings)
				.toMatchObject({ listenTimeout: 21_000 });

			// Releasing the last value they hold drops the shared settings
			// whole, so the page stops naming a supervisor as carrying some
			// while every option it runs on comes from the environment.
			const released = await patchSupervisor(vendor, { listenTimeout: null });

			expect(released.statusCode).toBe(200);
			expect(released.body.data.sharedSettings).toBeNull();

			expect((await read(vendor)).body.data.supervisor.sharedSettings)
				.toBeNull();
		});
	});

	// Clearing is the whole layer at once, and the answer says what is left
	// behind: the panel redraws every field as the environment's from it
	// rather than asking again.
	describe('hands the whole layer back to the environment', () => {
		it.each(vendors)('%s', async (vendor) => {
			await patch(vendor, { minWorkers: 2, maxWorkers: 3 });

			expect((await read(vendor)).body.data.sharedSettings)
				.toMatchObject({ minWorkers: 2 });

			const cleared = await request(getUrl(vendor, envs[vendor]))
				.delete('/utils/autoscale')
				.set('Authorization', auth);

			expect(cleared.statusCode).toBe(200);
			expect(cleared.body.data).toEqual({ sharedSettings: null });

			expect((await read(vendor)).body.data.sharedSettings).toBeNull();
		});
	});

	// `/server/specs/oas` needs no credential and gates per tag, so a path
	// published under a tag that names no audience is published to anonymous
	// callers. The runtime refusal is `assertAdmin`'s; this is disclosure.
	describe('publishes the autoscale surface to administrators alone', () => {
		it.each(vendors)('%s', async (vendor) => {
			const spec = async (token: string | null) => {
				const call = request(getUrl(vendor, envs[vendor]))
					.get('/server/specs/oas');

				const response = token === null
					? await call
					: await call.set('Authorization', `Bearer ${token}`);

				expect(response.statusCode).toBe(200);

				return {
					paths: Object.keys(response.body.paths),
					tags: response.body.tags.map((tag: { name: string }) => tag.name),
				};
			};

			const admin = await spec(USER.ADMIN.TOKEN);

			expect(admin.tags).toContain('Autoscaling');
			expect(admin.paths).toContain('/utils/autoscale');
			expect(admin.paths).toContain('/utils/autoscale/supervisor');
			expect(admin.paths).toContain('/utils/autoscale/reload');

			// This deployment did not ask for the drill, so the path is a 404 on
			// it and publishing one would document the 404.
			expect(admin.paths).not.toContain('/utils/autoscale/drill');

			for (const token of [USER.APP_ACCESS.TOKEN, null]) {
				const other = await spec(token);

				expect(other.tags).not.toContain('Autoscaling');
				expect(other.paths).not.toContain('/utils/autoscale');
				expect(other.paths).not.toContain('/utils/autoscale/supervisor');
				expect(other.paths).not.toContain('/utils/autoscale/reload');

				// Non-vacuous: a spec that came back empty would pass every line
				// above it.
				expect(other.paths).toContain('/auth/login');
			}
		});
	});

	// Nothing here is scaling a pool, and a restart is asked for over the bus:
	// answered with a success it would leave an agent believing a pool it
	// cannot see had been rolled, and reading the options it wrote as applied.
	describe('refuses a restart nothing would hear', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await callMcp(vendor, 'restart_autoscale_pool', {});

			expect(response.body.error.code).toBe(-32602);

			expect(response.body.error.message)
				.toContain('no process reported that it is scaling a pool');
		});
	});

	// The button in the panel asks over this route, and it has to be refused
	// on the same terms: a page that took a 200 for an answer would show the
	// options it had just written as the ones the pool is running.
	describe('refuses that restart over REST as well', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await request(getUrl(vendor, envs[vendor]))
				.post('/utils/autoscale/reload')
				.set('Authorization', auth);

			expect(response.statusCode).toBe(400);

			expect(refusal(response))
				.toContain('no process reported that it is scaling a pool');
		});
	});

	// Without Redis the bus is an emitter this worker shares with nobody, so a
	// stored change would wait for a pool that never hears of it and a restart
	// would be answered with a success nothing acted on. Such a deployment says
	// so by not carrying the routes at all, which is a claim about the router
	// this instance built and only an instance built that way can answer.
	describe('carries no autoscale route without a bus to reach the pool', () => {
		it.each(vendors)('%s', async (vendor) => {
			const url = getUrl(vendor, buslessEnvs[vendor]);

			const routes = [
				['get', '/utils/autoscale'],
				['patch', '/utils/autoscale'],
				['patch', '/utils/autoscale/supervisor'],
				['delete', '/utils/autoscale'],
				['post', '/utils/autoscale/reload'],
			] as const;

			for (const [method, path] of routes) {
				const response = await request(url)[method](path)
					.set('Authorization', auth);

				expect(response.statusCode, `${method} ${path}`).toBe(404);
			}

			// Non-vacuous: an instance that never came up would answer every
			// line above with the same 404 and prove nothing.
			expect((await request(url).get('/server/ping')).statusCode).toBe(200);
		});
	});
});
