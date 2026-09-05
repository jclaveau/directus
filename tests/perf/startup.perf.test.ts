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
 *
 * With PERF_CLI_BASELINE set, a second bundle is measured alternately with the first
 * and the two are reported as a ratio. On a shared runner that is the only figure
 * worth reading: the same bundle has measured 4.5 s and 6.5 s on one machine
 * depending on what else was running, so an absolute number belongs to the machine,
 * while a ratio taken minutes apart on it belongs to the diff.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// `pnpm --filter directus deploy --legacy --prod dist` at the repo root, the same
// bundle the blackbox suite runs, so this measures what production actually starts.
const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');
const baselineCli = process.env['PERF_CLI_BASELINE'];

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

type Arm = { name: string; cli: string; samples: number[] };

type Summary = {
	name: string;
	samples: number[];
	min: number;
	median: number;
	p95: number;
	max: number;
};

async function timeOneBoot(arm: Arm, attempt: number): Promise<number> {
	const port = basePort + attempt;

	const server = spawn('node', [arm.cli, 'start'], {
		env: {
			...serverEnv,
			PORT: String(port),
			PUBLIC_URL: `http://127.0.0.1:${port}`,
			CACHE_NAMESPACE: `perf-${process.pid}-${attempt}`,
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
			throw new Error(
				`The ${arm.name} server exited during boot ${attempt}:\n${output}`,
			);
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

function summarise({ name, samples }: Arm): Summary {
	const sorted = [...samples].sort((a, b) => a - b);

	const at = (fraction: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;

	return {
		name,
		samples,
		min: sorted[0]!,
		median: at(0.5),
		p95: at(0.95),
		max: sorted[sorted.length - 1]!,
	};
}

function row(summary: Summary): string {
	return `| ${summary.name} | ${summary.min} ms | **${summary.median} ms**`
		+ ` | ${summary.p95} ms | ${summary.max} ms |`;
}

test('the API answers its first request', async () => {
	const arms: Arm[] = [{ name: 'head', cli, samples: [] }];

	if (baselineCli) {
		arms.push({ name: 'baseline', cli: baselineCli, samples: [] });
	}

	let attempt = 0;

	// Discarded: the first boot of a bundle pays for a cold page cache that no later
	// one does, and it would drag the median of a short series.
	for (const arm of arms) {
		await timeOneBoot(arm, attempt++);
	}

	// Alternating rather than one arm then the other: whatever else the machine is
	// doing drifts over minutes, and alternating spreads that drift across both arms
	// instead of handing all of it to whichever went second.
	for (let rep = 0; rep < reps; rep++) {
		for (const arm of arms) {
			arm.samples.push(await timeOneBoot(arm, attempt++));
		}
	}

	const summaries = arms.map(summarise);
	const [head, baseline] = summaries;

	const comparison = baseline
		? {
				deltaMs: head!.median - baseline.median,
				ratio: Number((head!.median / baseline.median).toFixed(4)),
			}
		: null;

	const result = {
		commit: process.env['GITHUB_SHA'] ?? 'local',
		baselineCommit: process.env['PERF_BASELINE_SHA'] ?? null,
		node: process.version,
		measuredAt: new Date().toISOString(),
		reps,
		arms: summaries,
		comparison,
	};

	await mkdir(outputDir, { recursive: true });

	await writeFile(
		join(outputDir, 'startup.json'),
		`${JSON.stringify(result, null, 2)}\n`,
	);

	const verdict: string[] = [];

	if (comparison) {
		const sign = comparison.deltaMs >= 0
			? '+'
			: '';

		const percent = ((comparison.ratio - 1) * 100).toFixed(1);
		const against = (result.baselineCommit ?? 'baseline').slice(0, 10);

		verdict.push(
			'',
			`**${sign}${comparison.deltaMs} ms** (${percent}%) against \`${against}\`.`,
		);
	}

	await writeFile(
		join(outputDir, 'startup.md'),
		[
			`### Startup — spawn to first answered request`,
			'',
			`Measured commit \`${result.commit.slice(0, 10)}\`.`,
			'',
			'| arm | min | median | p95 | max |',
			'| --- | ---: | ---: | ---: | ---: |',
			...summaries.map(row),
			...verdict,
			'',
			`${reps} measured boots per arm, alternating, one discarded warm-up each.`,
			`Every boot is cold: its own cache namespace. Node ${result.node}.`,
			'',
			...summaries.map((s) => `\`${s.name}\`: ${s.samples.join(', ')} ms.`),
			'',
		].join('\n'),
	);

	// One line for whoever is reading a commit rather than a run: CI copies it into
	// the commit status verbatim, so it has to stand alone.
	let status = `startup ${head!.median} ms`;

	if (comparison) {
		const sign = comparison.deltaMs >= 0
			? '+'
			: '';

		status += ` (${sign}${comparison.deltaMs} ms vs baseline)`;
	}

	await writeFile(join(outputDir, 'startup.status.txt'), `${status}\n`);

	for (const arm of arms) {
		expect(arm.samples).toHaveLength(reps);
		expect(Math.min(...arm.samples)).toBeGreaterThan(0);
	}
});
