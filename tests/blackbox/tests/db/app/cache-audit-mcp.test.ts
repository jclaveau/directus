import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The cache audit over the system MCP (jclaveau/directus#498): an agent runs
// one, reads the history it landed in, and moves the schedule every node runs
// it on. The group is its own, `cache_audit`, so a deployment can hand an agent
// the cache reads without handing it a run that replays every live entry.
//
// Its own instance, because `system-mcp.test.ts` pins the exact tool list of a
// deployment that never named this group, and every tool there is read-only.

const ROWS = 'test_cache_audit_mcp_rows';

const cacheStatusHeader = 'x-cache-status';
const SETTLE_ATTEMPTS = 30;
const SETTLE_DELAY_MS = 500;

const auditToolNames = [
	'run_cache_audit',
	'list_cache_audits',
	'read_cache_audit',
	'read_cache_audit_schedule',
	'write_cache_audit_schedule',
];

describe('Cache audit over the system MCP', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);

		env[vendor]['REDIS'] = 'redis://localhost:6108';
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['CACHE_NAMESPACE'] = `directus-cache-audit-mcp-${vendor}`;
		env[vendor]['CACHE_STATS_ENABLED'] = 'true';
		env[vendor]['CACHE_STATS_DRAIN_SCHEDULE'] = '* * * * * *';
		env[vendor]['SYSTEM_MCP_ENABLED'] = 'true';
		env[vendor]['SYSTEM_MCP_TOOLS'] = 'cache,cache_audit';

		let instance: ChildProcess;
		let db: Knex;
		let url: string;

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROWS,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'owner', type: 'string', meta: {} },
							{ field: 'amount', type: 'string', meta: {} },
						],
					},
				],
			});

			await CreateItem(vendor, {
				collection: ROWS,
				item: [
					{ owner: 'acme', amount: '1' },
					{ owner: 'globex', amount: '2' },
				],
			});

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			db = knex(config.knexConfig[vendor]!);
			url = getUrl(vendor, env);

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance.kill();
			await db.destroy();
			await DeleteCollection(vendor, { collection: ROWS });
		});

		function call(body: unknown) {
			return request(url)
				.post('/system-mcp')
				.send(body as object)
				.set('Authorization', auth);
		}

		function callTool(name: string, args: object = {}) {
			return call({
				jsonrpc: '2.0',
				id: 7,
				method: 'tools/call',
				params: { name, arguments: args },
			});
		}

		function readOwner(owner: string) {
			return request(url)
				.get(`/items/${ROWS}`)
				.query(`filter[owner][_eq]=${owner}`)
				.set('Authorization', auth);
		}

		async function warm(read: () => request.Test) {
			await read();
			const warmed = await read();
			expect(warmed.headers[cacheStatusHeader]).toBe('HIT');
		}

		async function clearCache() {
			await request(url).post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		// The descriptors the audit joins land on the one-second drain: wait for
		// the node to describe every entry before the tool reads them.
		async function settled() {
			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				const response = await request(url)
					.post('/utils/cache/audit')
					.set('Authorization', auth);

				const report = response.body.data;

				const undescribed = report.findings.some((finding: any) => {
					return finding.reason === 'no_descriptor';
				});

				if (report.scanned > 0 && !undescribed) {
					return;
				}

				await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
			}
		}

		it(oneLine`
			lists the audit tools beside the cache reads, and marks the two that act
		`, async () => {
			const response = await call({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
			});

			expect(response.statusCode).toBe(200);

			const tools = response.body.result.tools as {
				name: string;
				annotations: { readOnlyHint: boolean };
			}[];

			const names = tools.map((tool) => tool.name);

			expect(names).toEqual(expect.arrayContaining(auditToolNames));
			expect(names).toContain('list_cache_entries');

			// The group named, not every group: the processes tool stays out.
			expect(names).not.toContain('list_processes');

			// A run replays every live entry and a schedule change reaches every
			// node: neither is a read a client may call on its own initiative.
			for (const tool of tools) {
				const acts = ['run_cache_audit', 'write_cache_audit_schedule']
					.includes(tool.name);

				expect(tool.annotations.readOnlyHint, tool.name).toBe(!acts);
			}
		});

		it(oneLine`
			runs an audit, lands it in the history, and reads it back with its
			findings
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));
			await settled();

			// A write past the cache, which no purge covered.
			await db(ROWS).where({ owner: 'acme' })
				.update({ amount: '5' });

			const ran = await callTool('run_cache_audit', { collection: ROWS });

			expect(ran.statusCode).toBe(200);
			expect(ran.body.result.isError).toBeUndefined();

			const report = ran.body.result.structuredContent;

			expect(JSON.parse(ran.body.result.content[0].text)).toEqual(report);
			expect(typeof report.id).toBe('number');
			expect(report.scanned).toBe(2);
			expect(report.counts).toMatchObject({ fresh: 1, stale: 1 });
			expect(report.evicted).toBe(0);
			expect(report.findings).toHaveLength(1);

			expect(report.findings[0]).toMatchObject({
				verdict: 'stale',
				url: `/items/${ROWS}?filter[owner][_eq]=acme`,
				collection: ROWS,
				diff: ['/data/0/amount'],
			});

			// The listing leads with it, under the surface that ran it, and
			// carries the counts without the findings.
			const listed = await callTool('list_cache_audits');

			expect(listed.body.result.isError).toBeUndefined();

			const [newest] = listed.body.result.structuredContent.items;

			expect(newest).toMatchObject({
				id: report.id,
				trigger: 'mcp',
				options: { collection: ROWS, limit: null, user: null, purge: false },
				scanned: 2,
				counts: report.counts,
				evicted: 0,
				error: null,
			});

			expect(newest.finishedAt).toBeGreaterThanOrEqual(newest.startedAt);
			expect(newest).not.toHaveProperty('findings');

			const read = await callTool('read_cache_audit', { id: report.id });

			expect(read.body.result.isError).toBeUndefined();

			expect(read.body.result.structuredContent).toMatchObject({
				id: report.id,
				trigger: 'mcp',
				findings: report.findings,
			});

			// A run that was never recorded reads as forbidden, like an item that
			// is not there: the tool's answer, not a protocol error.
			const missing = await callTool('read_cache_audit', { id: 999_999_999 });

			expect(missing.body.result.isError).toBe(true);
			expect(missing.body.error).toBeUndefined();

			// An argument the tool would not take never became a run at all.
			const noRun = await callTool('run_cache_audit', { limit: 0 });

			expect(noRun.body.error.code).toBe(-32602);
			expect(noRun.body.error.message).toContain('limit');
			expect(noRun.body.result).toBeUndefined();

			const noId = await callTool('read_cache_audit', {});

			expect(noId.body.error.code).toBe(-32602);

			const noWindow = await callTool('list_cache_audits', {
				window: 'yesterday',
			});

			expect(noWindow.body.error.code).toBe(-32602);
			expect(noWindow.body.error.message).toContain('yesterday');
		}, 60_000);

		it(oneLine`
			moves the schedule every node runs on, and hands it back to the
			environment when cleared
		`, async () => {
			const unscheduled = await callTool('read_cache_audit_schedule');

			expect(unscheduled.body.result.isError).toBeUndefined();

			expect(unscheduled.body.result.structuredContent).toEqual({
				rule: null,
				source: null,
				envRule: null,
				nextRunAt: null,
			});

			// A rule that is not a cron is refused before anything is stored, and
			// so is a call that names no rule at all.
			const notACron = await callTool('write_cache_audit_schedule', {
				rule: 'hourly',
			});

			expect(notACron.body.error.code).toBe(-32602);
			expect(notACron.body.error.message).toContain('hourly');

			const noRule = await callTool('write_cache_audit_schedule', {});

			expect(noRule.body.error.code).toBe(-32602);

			const before = Date.now();

			const written = await callTool('write_cache_audit_schedule', {
				rule: '0 3 * * *',
			});

			expect(written.body.result.isError).toBeUndefined();

			expect(written.body.result.structuredContent).toMatchObject({
				rule: '0 3 * * *',
				source: 'settings',
				envRule: null,
			});

			expect(written.body.result.structuredContent.nextRunAt)
				.toBeGreaterThan(before);

			// Stored where the settings page reads it, so it survives a restart
			// and every node reads the same rule.
			const stored = await request(url)
				.get('/settings')
				.query('fields=cache_audit_schedule')
				.set('Authorization', auth);

			expect(stored.body.data.cache_audit_schedule).toBe('0 3 * * *');

			expect((await callTool('read_cache_audit_schedule'))
				.body.result.structuredContent)
				.toEqual(written.body.result.structuredContent);

			const cleared = await callTool('write_cache_audit_schedule', {
				rule: null,
			});

			expect(cleared.body.result.isError).toBeUndefined();

			expect(cleared.body.result.structuredContent).toEqual({
				rule: null,
				source: null,
				envRule: null,
				nextRunAt: null,
			});
		});
	});
});
