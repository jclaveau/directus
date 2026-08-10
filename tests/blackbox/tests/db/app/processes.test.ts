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
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
		'envLocalBus',
	] as const;

	type EnvTypes = Record<(typeof envKeys)[number], Env>;

	const envs = {} as Record<Vendor, EnvTypes>;
	const services = {} as Record<Vendor, {
		shared: string;
		stats: string;
		local: string;
	}>;

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			services[vendor] = {
				shared: `processes-shared-${vendor}`,
				stats: `processes-stats-${vendor}`,
				local: `processes-local-${vendor}`,
			};

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

			// No Redis at all — the local bus reaches this process and nothing else.
			const envLocalBus = cloneDeep(config.envs);
			envLocalBus[vendor]['PROCESSES_SERVICE_NAME'] = services[vendor].local;
			envLocalBus[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-local`;
			envLocalBus[vendor]['PROCESSES_COLLECT_TIMEOUT'] = '3s';

			const ports = await Promise.all(envKeys.map(() => getPort()));

			envs[vendor] = {
				envReplicaA,
				envReplicaB,
				envDisabled,
				envStatsOnly,
				envLocalBus,
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

	function readReport(vendor: Vendor, key: (typeof envKeys)[number], token: string) {
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
				expect(replica.hostname).toBeTruthy();
				// Started directly by the harness, so there is no PM2 to ask.
				expect(replica.supervisor).toBe('none');

				const node = replica.processes[0]!;

				expect(node.responding).toBe(true);
				expect(node.supervisor).toBeNull();
				expect(node.pid).toBeGreaterThan(0);
				expect(node.nodeId).toBeTruthy();
				expect(node.runtime!.rssBytes).toBeGreaterThan(0);
				expect(node.runtime!.nodeVersion).toMatch(/^v\d+\./);
				expect(node.runtime!.uptimeMs).toBeGreaterThan(0);
			}

			// Redis is configured here, so the cross-replica half is not degraded;
			// the supervisor half is, because nothing supervises these processes.
			expect(report.degraded.crossReplica).toBe(false);
			expect(report.degraded.supervisor).toBe(true);
		});
	});

	describe('Reports where each variable was resolved from', () => {
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

			// Sorted, and every reported key carries a source.
			const keys = node.env!.map((variable) => variable.key);
			expect(keys).toEqual([...keys].sort());
			const sourced = node.env!.every((variable) => variable.source !== undefined);
			expect(sourced).toBe(true);
		});
	});

	describe('Redacts by key shape before the value leaves the process', () => {
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

			// `PUBLIC_URL` matches the `_URL$` shape but carries no credential, and a
			// wrong one is a routine thing to diagnose — it stays readable.
			expect(variableNamed(node, 'PUBLIC_URL')?.redacted).toBe(false);
			expect(variableNamed(node, 'PUBLIC_URL')?.value).toMatch(/^http/);

			expect(variableNamed(node, 'ADMIN_EMAIL')).toMatchObject({
				redacted: false,
				value: 'admin@example.com',
			});

			// No value of any redacted variable is anywhere in the payload.
			const payload = JSON.stringify(report);
			expect(payload).not.toContain('directus-test');
			expect(payload).not.toContain('miniosecret');
		});
	});

	describe('Omits the env half where it is turned off', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envStatsOnly', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(200);

			const report: ProcessesReport = response.body.data;

			expect(report.details).toEqual(['stats']);

			const node = serviceNamed(report, services[vendor].stats)!
				.replicas[0]!.processes[0]!;

			// Absent, not empty — the page says so rather than showing no variables.
			expect(node.env).toBeNull();
			expect(node.runtime!.rssBytes).toBeGreaterThan(0);
		});
	});

	describe('Serves no endpoint where the report is turned off', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envDisabled', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(404);
		});
	});

	describe('Reports only itself when the bus is local', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await readReport(vendor, 'envLocalBus', USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(200);

			const report: ProcessesReport = response.body.data;

			// No Redis: the report covers this process, and says as much.
			expect(report.degraded.crossReplica).toBe(true);
			expect(report.services).toHaveLength(1);
			expect(report.services[0]!.service).toBe(services[vendor].local);
			expect(report.services[0]!.replicas).toHaveLength(1);
			expect(report.services[0]!.replicas[0]!.processes).toHaveLength(1);
		});
	});
});
