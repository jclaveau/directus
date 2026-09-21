import config, { getUrl, paths } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { spawn } from 'child_process';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

// `directus edge allow-list` prints the root paths an edge in front of the
// deployment lets through. What has to hold is that it names every way the
// running node answers a path: the core mounts, the websocket controllers, an
// extension's named endpoint and a route a hook mounts on the app itself — and
// that each of those really answers, so the list is not a guess.

describe('`directus edge allow-list`', () => {
	describe.each(vendors)('%s', (vendor) => {
		// Its own process, with the running node's env: the shell the command is
		// for, not an in-process call.
		function runAllowList(
			args: string[],
		): Promise<{ code: number | null; output: string }> {
			return new Promise((resolve) => {
				const cli = spawn('node', [paths.cli, 'edge', 'allow-list', ...args], {
					cwd: paths.cwd,
					env: { ...config.envs[vendor], LOG_LEVEL: 'error' },
				});

				let output = '';

				cli.stdout.on('data', (chunk) => (output += String(chunk)));
				cli.stderr.on('data', (chunk) => (output += String(chunk)));

				cli.on('exit', (code) => resolve({ code, output }));
			});
		}

		it('lists every root the running node answers on', async () => {
			const { code, output } = await runAllowList(['--format', 'plain']);

			expect(code).toBe(0);

			const roots = output.split('\n').filter((line) => line.startsWith('/'));

			expect(roots).toEqual([...roots].sort());

			expect(roots).toEqual(
				expect.arrayContaining([
					'/',
					'/auth',
					'/edge-allow-list-endpoint',
					'/edge-hooked',
					'/graphql',
					'/items',
					'/server',
					'/websocket',
				]),
			);

			// SERVE_APP is off for the suite
			expect(roots).not.toContain('/admin');

			const api = request(getUrl(vendor));
			const endpoint = await api.get('/edge-allow-list-endpoint/ping');
			const hooked = await api.get('/edge-hooked/ping');

			expect(endpoint.statusCode).toBe(200);
			expect(hooked.statusCode).toBe(200);
		});

		it('prints those roots as a Railway ruleset ending on a block', async () => {
			const { code, output } = await runAllowList(['--block-status', '410']);

			expect(code).toBe(0);

			const ruleset = JSON.parse(output.slice(output.indexOf('{')));
			const allows = ruleset.rules.slice(0, -1);
			const clauses = allows.flatMap((rule: any) => rule.if.or ?? [rule.if]);

			expect(ruleset.version).toBe(1);

			expect(ruleset.rules.at(-1).then).toEqual({
				action: 'block',
				params: { status: 410 },
			});

			expect(allows.every((rule: any) => rule.then.action === 'allow')).toBe(true);

			expect(clauses).toContainEqual({
				attr: 'http.path',
				op: 'eq',
				value: '/edge-hooked',
			});

			expect(clauses).toContainEqual({
				attr: 'http.path',
				op: 'matches',
				value: '/edge-hooked/*',
			});
		});
	});
});
