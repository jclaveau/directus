import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

/**
 * How long a worker takes from spawn to its first answered request.
 *
 * This is the number PM2 autoscaling waits on: it starts the next instance only once
 * the current one reports ready, which the server does the moment it listens. So a
 * scale step of N workers costs N of these, one after another.
 *
 * Every repetition gets its own cache namespace, which makes each one a cold boot —
 * the shape a deploy's first worker sees, and the only shape that is the same every
 * time. A warm cache skips the build-identity flush, and that path alone pulls ~480
 * modules, which swamps anything a code change does.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// `pnpm --filter directus deploy --legacy --prod dist` at the repo root, the same
// bundle the blackbox suite runs, so this measures what production actually starts.
// PERF_CLI points it at a bundle built elsewhere, which is how two commits get
// compared without rebuilding between the arms.
const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');

const reps = Number(process.env['PERF_REPS'] ?? 7);
const defaultOutput = join(root, 'tests', 'perf', 'results');
const outputDir = process.env['PERF_OUTPUT_DIR'] ?? defaultOutput;
const basePort = Number(process.env['PERF_BASE_PORT'] ?? 8200);

const serverEnv = {
	...process.env,
	NODE_ENV: 'production',
	SERVE_APP: 'false',
	LOG_LEVEL: 'info',
	TELEMETRY: 'false',
};

async function timeOneBoot(rep: number): Promise<number> {
	const port = basePort + rep;

	const server = spawn('node', [cli, 'start'], {
		env: {
			...serverEnv,
			PORT: String(port),
			PUBLIC_URL: `http://127.0.0.1:${port}`,
			CACHE_NAMESPACE: `perf-${process.pid}-${rep}`,
		},
	});

	// A server that dies during boot answers nothing, so the poll below would spin
	// until the test times out with no idea why. Keep its output for the failure.
	let output = '';
	server.stdout.on('data', (chunk) => (output += chunk));
	server.stderr.on('data', (chunk) => (output += chunk));

	let exited = false;
	server.on('exit', () => (exited = true));

	const started = performance.now();
	let ready: number | null = null;

	while (ready === null) {
		if (exited) {
			throw new Error(`The server exited during boot ${rep}:\n${output}`);
		}

		try {
			const response = await fetch(`http://127.0.0.1:${port}/server/ping`);

			if (response.ok) {
				ready = performance.now();
			}
		}
		catch {
			// Not listening yet.
		}

		if (ready === null) {
			await new Promise((r) => setTimeout(r, 20));
		}
	}

	server.kill('SIGTERM');
	await new Promise((r) => server.on('exit', r));

	return Math.round(ready - started);
}

function percentile(sorted: number[], fraction: number): number {
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

test('the API answers its first request', async () => {
	// Discarded: the first boot of a run pays for a cold page cache that no later one
	// does, and it would drag the median of a short series.
	await timeOneBoot(0);

	const samples: number[] = [];

	for (let rep = 1; rep <= reps; rep++) {
		samples.push(await timeOneBoot(rep));
	}

	const sorted = [...samples].sort((a, b) => a - b);

	const result = {
		commit: process.env['GITHUB_SHA'] ?? 'local',
		node: process.version,
		measuredAt: new Date().toISOString(),
		reps,
		samples,
		min: sorted[0]!,
		median: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		max: sorted[sorted.length - 1]!,
	};

	await mkdir(outputDir, { recursive: true });

	await writeFile(
		join(outputDir, 'startup.json'),
		`${JSON.stringify(result, null, 2)}\n`,
	);

	await writeFile(
		join(outputDir, 'startup.md'),
		[
			'### Startup — spawn to first answered request',
			'',
			'| commit | reps | min | median | p95 | max |',
			'| --- | ---: | ---: | ---: | ---: | ---: |',
			`| \`${result.commit.slice(0, 10)}\` | ${reps} | ${result.min} ms`
				+ ` | **${result.median} ms** | ${result.p95} ms | ${result.max} ms |`,
			'',
			`Samples: ${samples.join(', ')} ms. Node ${result.node}.`,
			'',
			'Each repetition is a cold boot in its own cache namespace, after one',
			'discarded warm-up. A repetition is one worker, and PM2 starts them one',
			'at a time.',
			'',
		].join('\n'),
	);

	expect(samples).toHaveLength(reps);
	expect(sorted[0]).toBeGreaterThan(0);
});
