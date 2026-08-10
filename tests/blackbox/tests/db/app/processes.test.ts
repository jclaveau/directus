import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import type {
	ProcessNode,
	ProcessService,
	ProcessesReport,
	ResolvedEnvVariable,
} from '@directus/types';
import { ChildProcess, execFileSync, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `paths.cwd` is tests/blackbox, so two levels up is the repo root. PM2 ships as
// an api dependency; the same binary the published image runs Directus with.
const pm2Bin = join(paths.cwd, '..', '..', 'api', 'node_modules', '.bin', 'pm2');
const pm2Script = `${paths.cli}.js`;
const pm2AppName = 'directus-blackbox';
const pm2Instances = 3;

describe('Processes Report Tests', () => {
	const directusInstances = {} as { [vendor: string]: ChildProcess[] };

	// Every instance of one deployment answers on the same bus, so each of these
	// suites names its own service — the tree is asserted on that name, which
	// keeps any other Directus sharing the Redis out of the assertions.
	const envKeys = [
		'envReplicaA',
		'envReplicaB',
		'envDisabled',
		'envStatsOnly',
		'envNoDetails',
		'envDefaults',
	] as const;

	type EnvTypes = Record<(typeof envKeys)[number], Env> & { envSupervised: Env };

	const envs = {} as Record<Vendor, EnvTypes>;

	const services = {} as Record<Vendor, {
		shared: string;
		stats: string;
		none: string;
		supervised: string;
	}>;

	// Long enough to be truncated by the reporter's 512-column cap.
	const longValue = 'x'.repeat(600);

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			services[vendor] = {
				shared: `processes-shared-${vendor}`,
				stats: `processes-stats-${vendor}`,
				none: `processes-none-${vendor}`,
				supervised: `processes-pm2-${vendor}`,
			};

			// A config file and a `*_FILE` secret, so the report has a variable
			// resolved from each of the loader's four layers to name.
			const configDir = mkdtempSync(join(tmpdir(), `bb-processes-${vendor}-`));
			const configFile = join(configDir, 'config.json');
			const redirectFile = join(configDir, 'root-redirect');

			writeFileSync(configFile, JSON.stringify({ MAX_PAYLOAD_SIZE: '11mb' }));
			writeFileSync(redirectFile, './admin');

			// Redis is what makes the other replicas answerable at all; without it the
			// bus is local and a node can only ever report itself.
			const envReplicaA = cloneDeep(config.envs);
			envReplicaA[vendor]['REDIS_HOST'] = 'localhost';
			envReplicaA[vendor]['REDIS_PORT'] = '6108';
			envReplicaA[vendor]['PROCESSES_SERVICE_NAME'] = services[vendor].shared;
			envReplicaA[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-a`;
			// Generous next to the 750ms default: a loaded CI runner must not turn a
			// slow reply into a "replica missing" assertion failure.
			envReplicaA[vendor]['PROCESSES_COLLECT_TIMEOUT'] = '3s';
			envReplicaA[vendor]['CONFIG_PATH'] = configFile;
			envReplicaA[vendor]['ROOT_REDIRECT_FILE'] = redirectFile;
			// Redaction decoys: a credential in a key that names nothing secret, an
			// over-long value, and a variable that is present but empty.
			envReplicaA[vendor]['PROCESSES_TEST_ENDPOINT'] = 'redis://user:pw@host:6379';
			envReplicaA[vendor]['PROCESSES_TEST_LONG'] = longValue;
			envReplicaA[vendor]['PROCESSES_TEST_EMPTY'] = '';

			const envReplicaB = cloneDeep(envReplicaA);
			envReplicaB[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-b`;

			// Same service, reporting turned off: it must neither serve the endpoint
			// nor answer anyone else's query.
			const envDisabled = cloneDeep(envReplicaA);
			envDisabled[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-off`;
			envDisabled[vendor]['PROCESSES_ENABLED'] = 'false';

			// Stats without env: the page still lists the process, the env half is
			// absent rather than empty.
			const envStatsOnly = cloneDeep(envReplicaA);
			envStatsOnly[vendor]['PROCESSES_SERVICE_NAME'] = services[vendor].stats;
			envStatsOnly[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-stats`;
			envStatsOnly[vendor]['PROCESSES_DETAILS'] = 'stats';

			// Neither half: the process is still located in the tree, with nothing
			// but its identity.
			const envNoDetails = cloneDeep(envReplicaA);
			envNoDetails[vendor]['PROCESSES_SERVICE_NAME'] = services[vendor].none;
			envNoDetails[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-none`;
			envNoDetails[vendor]['PROCESSES_DETAILS'] = '';

			// Nothing configured at all: no Redis, no service name, no replica id and
			// no collection window, so every fallback is the one under test. The
			// harness inherits the runner's environment, so strip rather than assume.
			const envDefaults = cloneDeep(config.envs);

			for (const key of Object.keys(envDefaults[vendor])) {
				if (/^(REDIS|PROCESSES_|RAILWAY_)/.test(key)) {
					delete envDefaults[vendor][key];
				}
			}

			// Under PM2, in cluster mode, the way the published image runs it.
			const envSupervised = cloneDeep(envReplicaA);
			envSupervised[vendor]['PROCESSES_SERVICE_NAME'] = services[vendor].supervised;
			envSupervised[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-pm2`;
			delete envSupervised[vendor]['CONFIG_PATH'];
			delete envSupervised[vendor]['ROOT_REDIRECT_FILE'];

			const ports = await Promise.all(envKeys.map(() => getPort()));
			const supervisedPort = await getPort();

			envs[vendor] = {
				envReplicaA,
				envReplicaB,
				envDisabled,
				envStatsOnly,
				envNoDetails,
				envDefaults,
				envSupervised,
			};

			directusInstances[vendor] = [];

			for (const [index, key] of envKeys.entries()) {
				const env = envs[vendor][key];
				env[vendor].PORT = String(ports[index]);

				directusInstances[vendor].push(
					spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: env[vendor] }),
				);

				promises.push(awaitDirectusConnection(ports[index]!));
			}

			// Its own PM2_HOME so this daemon is this suite's alone, and killable
			// without touching any other.
			envSupervised[vendor].PORT = String(supervisedPort);

			envSupervised[vendor]['PM2_HOME'] = mkdtempSync(
				join(tmpdir(), `bb-pm2-${vendor}-`),
			);

			execFileSync(
				pm2Bin,
				[
					'start',
					pm2Script,
					'--name', pm2AppName,
					'--instances', String(pm2Instances),
					// High enough that nothing is actually recycled mid-suite; the
					// assertion is that the cap is reported, not that it fires.
					'--max-memory-restart', '2000M',
					'--',
					'start',
				],
				{ cwd: paths.cwd, env: envSupervised[vendor], stdio: 'pipe' },
			);

			promises.push(awaitDirectusConnection(supervisedPort));
		}

		await Promise.all(promises);

		// One worker stopped for the rest of the suite: the supervisor still lists
		// it, so it must appear in the tree as not responding rather than vanish.
		for (const vendor of vendors) {
			execFileSync(pm2Bin, ['stop', String(pm2Instances - 1)], {
				env: envs[vendor].envSupervised[vendor],
				stdio: 'pipe',
			});
		}
	}, 300_000);

	afterAll(() => {
		for (const vendor of vendors) {
			for (const instance of directusInstances[vendor]!) {
				instance.kill();
			}

			try {
				execFileSync(pm2Bin, ['kill'], {
					env: envs[vendor].envSupervised[vendor],
					stdio: 'pipe',
				});
			}
			catch {
				// The daemon dies with the job either way; a failed kill must not
				// red an otherwise passing suite.
			}
		}
	});

	function readReport(
		vendor: Vendor,
		key: keyof EnvTypes,
		token: string,
	) {
		return request(getUrl(vendor, envs[vendor][key]))
			.get('/utils/processes')
			.set('Authorization', `Bearer ${token}`);
	}

	function serviceNamed(
		report: ProcessesReport,
		name: string,
	): ProcessService | undefined {
		return report.services.find((service) => service.service === name);
	}

	function soleProcessOf(report: ProcessesReport, name: string): ProcessNode {
		return serviceNamed(report, name)!.replicas[0]!.processes[0]!;
	}

	function variableNamed(
		node: ProcessNode,
		key: string,
	): ResolvedEnvVariable | undefined {
		return node.env?.find((variable) => variable.key === key);
	}

	describe('Refuses the report to anyone but an admin', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(
				vendor,
				'envReplicaA',
				USER.APP_ACCESS.TOKEN,
			);

			expect(response.statusCode).toBe(403);
		});
	});

	describe('Refuses the report without a token', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await request(getUrl(vendor, envs[vendor]['envReplicaA']))
				.get('/utils/processes');

			expect(response.statusCode).toBe(403);
		});
	});

	describe('Reports every replica sharing the bus', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envReplicaA', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(200);

			const report: ProcessesReport = response.body.data;

			expect(report.details).toEqual(['stats', 'env']);
			expect(report.collectedForMs).toBe(3000);
			expect(report.collectedAt).toBeGreaterThan(0);

			const shared = serviceNamed(report, services[vendor].shared);
			const replicaIds = shared?.replicas.map((replica) => replica.replicaId).sort();

			// The disabled instance shares this service name and must not appear.
			expect(replicaIds).toEqual([`${vendor}-a`, `${vendor}-b`]);

			for (const replica of shared!.replicas) {
				expect(replica.processes).toHaveLength(1);
				expect(replica.hostname).toBe(hostname());
				// Started directly, so there is no supervisor to ask on this one.
				expect(replica.supervisor).toBe('none');

				const node = replica.processes[0]!;

				expect(node.responding).toBe(true);
				expect(node.supervisor).toBeNull();
				expect(node.pid).toBeGreaterThan(0);
				expect(node.pmId).toBeNull();
				expect(node.instance).toBeNull();
				expect(node.nodeId).toBeTruthy();
				expect(node.runtime!.rssBytes).toBeGreaterThan(0);
				expect(node.runtime!.nodeVersion).toMatch(/^v\d+\./);
				expect(node.runtime!.uptimeMs).toBeGreaterThan(0);
			}

			// Services are listed in a stable order, whoever answered first.
			const names = report.services.map((service) => service.service);
			expect(names).toEqual([...names].sort());

			// Redis is configured here, so the cross-replica half is not degraded;
			// the supervisor half is, because these processes are unsupervised.
			expect(report.degraded.crossReplica).toBe(false);
			expect(report.degraded.supervisor).toBe(true);
		});
	});

	describe('Reports which layer resolved each variable', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envReplicaA', USER.ADMIN.TOKEN);
			const report: ProcessesReport = response.body.data;

			const replica = serviceNamed(report, services[vendor].shared)!.replicas
				.find((candidate) => candidate.replicaId === `${vendor}-a`)!;

			const node = replica.processes[0]!;

			expect(variableNamed(node, 'DB_CLIENT')).toMatchObject({
				redacted: false,
				isSet: true,
				source: 'process',
			});

			// Nothing sets it here, so it comes off the shipped defaults table.
			expect(variableNamed(node, 'PROCESSES_ENABLED')).toEqual({
				key: 'PROCESSES_ENABLED',
				value: 'true',
				redacted: false,
				isSet: true,
				source: 'default',
			});

			// The config file wins over the same key in the process environment,
			// which sets 10mb — the value reported is the one in force.
			expect(variableNamed(node, 'MAX_PAYLOAD_SIZE')).toEqual({
				key: 'MAX_PAYLOAD_SIZE',
				value: '11mb',
				redacted: false,
				isSet: true,
				source: 'file',
			});

			// `ROOT_REDIRECT_FILE` pointed at a file; the value came out of it.
			expect(variableNamed(node, 'ROOT_REDIRECT')).toEqual({
				key: 'ROOT_REDIRECT',
				value: './admin',
				redacted: false,
				isSet: true,
				source: 'secret-file',
			});

			// A cast list is reported as the list it resolved to, not the raw CSV.
			expect(variableNamed(node, 'METRICS_SERVICES')?.value)
				.toBe('["database","cache","redis","storage"]');

			// Sorted, and every reported key carries a source.
			const keys = node.env!.map((variable) => variable.key);
			expect(keys).toEqual([...keys].sort());
			const sourced = node.env!.every((variable) => variable.source !== undefined);
			expect(sourced).toBe(true);
		});
	});

	describe('Redacts before the value leaves the process', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envReplicaA', USER.ADMIN.TOKEN);
			const report: ProcessesReport = response.body.data;

			const node = serviceNamed(report, services[vendor].shared)!.replicas
				.find((candidate) => candidate.replicaId === `${vendor}-a`)!
				.processes[0]!;

			// A set secret reports that it is set, and nothing more.
			expect(variableNamed(node, 'SECRET')).toEqual({
				key: 'SECRET',
				value: null,
				redacted: true,
				isSet: true,
				source: 'process',
			});

			expect(variableNamed(node, 'STORAGE_MINIO_SECRET')?.value).toBeNull();
			expect(variableNamed(node, 'ADMIN_PASSWORD')?.redacted).toBe(true);

			// The key names nothing secret; the value carries a credential, which is
			// what the shape rule alone would have published.
			expect(variableNamed(node, 'PROCESSES_TEST_ENDPOINT')).toEqual({
				key: 'PROCESSES_TEST_ENDPOINT',
				value: null,
				redacted: true,
				isSet: true,
				source: 'process',
			});

			// `PUBLIC_URL` matches the `_URL$` shape but carries no credential, and a
			// wrong one is a routine thing to diagnose — it stays readable.
			expect(variableNamed(node, 'PUBLIC_URL')?.redacted).toBe(false);
			expect(variableNamed(node, 'PUBLIC_URL')?.value).toMatch(/^http/);

			expect(variableNamed(node, 'ADMIN_EMAIL')).toMatchObject({
				redacted: false,
				value: 'admin@example.com',
			});

			// Present but empty: reported, and reported as unset.
			expect(variableNamed(node, 'PROCESSES_TEST_EMPTY')).toMatchObject({
				value: '',
				redacted: false,
				isSet: false,
			});

			// This is a diagnosis surface, not a config export.
			const long = variableNamed(node, 'PROCESSES_TEST_LONG')!;
			expect(long.value).toHaveLength(513);
			expect(long.value!.endsWith('…')).toBe(true);

			// No value of any redacted variable is anywhere in the payload.
			const payload = JSON.stringify(report);
			expect(payload).not.toContain('directus-test');
			expect(payload).not.toContain('miniosecret');
			expect(payload).not.toContain('user:pw@host');
			expect(payload).not.toContain(longValue);
		});
	});

	describe('Reports a supervised replica from the supervisor', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envSupervised', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(200);

			const report: ProcessesReport = response.body.data;
			const supervised = serviceNamed(report, services[vendor].supervised)!;
			const replica = supervised.replicas[0]!;

			expect(replica.replicaId).toBe(`${vendor}-pm2`);
			expect(replica.supervisor).toBe('pm2');
			expect(replica.processes).toHaveLength(pm2Instances);

			// Ordered by the instance number PM2 assigned, not by who answered first.
			const instances = replica.processes.map((node) => node.instance);
			expect(instances).toEqual([0, 1, 2]);

			for (const node of replica.processes) {
				expect(node.name).toBe(pm2AppName);
				expect(node.pmId).not.toBeNull();
				expect(node.supervisor!.execMode).toBe('cluster_mode');
				expect(node.supervisor!.configuredInstances).toBe(pm2Instances);
				expect(node.supervisor!.maxMemoryRestartBytes).toBe(2000 * 1024 * 1024);
				expect(node.supervisor!.restarts).toBe(0);
			}

			const online = replica.processes.filter((node) => node.responding);
			const silent = replica.processes.filter((node) => !node.responding);

			expect(online).toHaveLength(pm2Instances - 1);
			expect(silent).toHaveLength(1);

			for (const node of online) {
				expect(node.supervisor!.status).toBe('online');
				expect(node.supervisor!.memoryBytes).toBeGreaterThan(0);
				expect(node.runtime!.rssBytes).toBeGreaterThan(0);
				expect(node.env).not.toBeNull();
			}

			// The stopped worker is listed by the supervisor and nothing else: it is
			// in the tree with its supervisor stats, and no self-report at all.
			expect(silent[0]!.supervisor!.status).toBe('stopped');
			expect(silent[0]!.runtime).toBeNull();
			expect(silent[0]!.env).toBeNull();
			expect(silent[0]!.nodeId).toBeNull();

			// A supervised replica answered in full, so nothing is degraded.
			expect(report.degraded.crossReplica).toBe(false);
		});
	});

	describe('Omits the env half where it is turned off', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envStatsOnly', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(200);

			const report: ProcessesReport = response.body.data;

			expect(report.details).toEqual(['stats']);

			const node = soleProcessOf(report, services[vendor].stats);

			// Absent, not empty — the page says so rather than showing no variables.
			expect(node.env).toBeNull();
			expect(node.runtime!.rssBytes).toBeGreaterThan(0);
		});
	});

	describe('Locates a process even with both halves turned off', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envNoDetails', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(200);

			const report: ProcessesReport = response.body.data;

			expect(report.details).toEqual([]);

			const node = soleProcessOf(report, services[vendor].none);

			expect(node.responding).toBe(true);
			expect(node.pid).toBeGreaterThan(0);
			expect(node.runtime).toBeNull();
			expect(node.env).toBeNull();
		});
	});

	describe('Serves no endpoint where the report is turned off', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envDisabled', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(404);
		});
	});

	describe('Falls back to its own identity when nothing is configured', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envDefaults', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(200);

			const report: ProcessesReport = response.body.data;

			// No Redis: the report covers this process, and says as much.
			expect(report.degraded.crossReplica).toBe(true);
			expect(report.collectedForMs).toBe(750);
			expect(report.services).toHaveLength(1);

			const service = report.services[0]!;

			expect(service.service).toBe('directus');
			expect(service.replicas).toHaveLength(1);
			expect(service.replicas[0]!.replicaId).toBe(hostname());
			expect(service.replicas[0]!.processes).toHaveLength(1);
		});
	});

	describe('Never serves the report from the cache', () => {
		it.each(vendors)('%s', async (vendor) => {
			const first = await readReport(vendor, 'envReplicaA', USER.ADMIN.TOKEN);
			const second = await readReport(vendor, 'envReplicaA', USER.ADMIN.TOKEN);

			// Two reads of live state cannot be the same snapshot.
			expect(second.body.data.collectedAt)
				.toBeGreaterThan(first.body.data.collectedAt);
		});
	});
});
