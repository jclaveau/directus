import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
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
 * The worker boots with extensions, because a worker in production does: they are
 * imported one after another before the server listens, and how they are imported is
 * itself a lever. They are generated rather than committed so both arms load exactly
 * the same bytes — PERF_EXTENSIONS of them, PERF_EXTENSION_KB each.
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

const extensionsDir = process.env['PERF_EXTENSIONS_PATH']
	?? join(root, 'tests', 'perf', 'extensions');

const extensionCount = Number(process.env['PERF_EXTENSIONS'] ?? 8);
const extensionKb = Number(process.env['PERF_EXTENSION_KB'] ?? 500);

// `length < NaN` is false, so a mistyped knob would quietly generate one-line
// extensions and report a boot that measured nothing in particular
const knobs = [
	['PERF_EXTENSIONS', extensionCount],
	['PERF_EXTENSION_KB', extensionKb],
] as const;

for (const [name, value] of knobs) {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`${name} has to be a number, not ${String(value)}`);
	}
}

/**
 * A hook whose body is the size of a real one. What a boot pays for an extension is
 * mostly parsing it, so filler that has to be parsed is the honest shape — and it is
 * generated fresh so a leftover directory from another run cannot skew an arm.
 */
async function writeExtensions(): Promise<string[]> {
	const existing = await readdir(extensionsDir).catch(() => []);

	// PERF_EXTENSIONS_PATH invites being pointed at a real extensions directory, and
	// this deletes what it finds, so it only ever deletes what it wrote
	const foreign = existing.filter((entry) => !/^perf-hook-\d+$/.test(entry));

	if (foreign.length > 0) {
		throw new Error(
			`${extensionsDir} holds extensions this bench did not write`
			+ ` (${foreign.join(', ')}); point PERF_EXTENSIONS_PATH somewhere else.`,
		);
	}

	await rm(extensionsDir, { recursive: true, force: true });
	await mkdir(extensionsDir, { recursive: true });

	const names: string[] = [];

	for (let index = 0; index < extensionCount; index++) {
		const name = `perf-hook-${index}`;
		const dir = join(extensionsDir, name);
		const lines = ['export default () => undefined;'];

		// joining the whole array to measure it is quadratic: 4.5 s for one 500 KB
		// extension, and this runs once per extension before a single boot is timed
		let length = lines[0]!.length;

		while (length < extensionKb * 1024) {
			const fn = lines.length;

			const line =
				`export function fn${fn}_${index}(value) { return value + ${fn}; }`;

			lines.push(line);
			length += line.length + 1;
		}

		await mkdir(dir, { recursive: true });

		await writeFile(
			join(dir, 'package.json'),
			JSON.stringify({
				name,
				version: '0.0.0',
				type: 'module',
				'directus:extension': {
					type: 'hook',
					path: 'index.js',
					source: 'src/index.js',
					host: '^11.0.0',
				},
			}),
		);

		await writeFile(join(dir, 'index.js'), `${lines.join('\n')}\n`);
		names.push(name);
	}

	return names;
}

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

async function timeOneBoot(
	arm: Arm,
	attempt: number,
): Promise<{ ms: number; output: string }> {
	const port = basePort + attempt;

	const server = spawn('node', [arm.cli, 'start'], {
		env: {
			...serverEnv,
			EXTENSIONS_PATH: extensionsDir,
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

	// 'close' rather than 'exit': the output is read below, and only 'close' waits for
	// the child's stdio to drain
	await new Promise((r) => server.on('close', r));

	return { ms: Math.round(ready - started), output };
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

	const extensionNames = await writeExtensions();

	// Discarded: the first boot of a bundle pays for a cold page cache that no later
	// one does, and it would drag the median of a short series.
	for (const arm of arms) {
		const { output } = await timeOneBoot(arm, attempt++);

		// A server that finds no extension boots fine and answers just as fast, so
		// without this the whole extension dimension could quietly measure nothing.
		for (const name of extensionNames) {
			expect(output, `${arm.name} did not load ${name}`).toContain(name);
		}
	}

	// Alternating rather than one arm then the other: whatever else the machine is
	// doing drifts over minutes, and alternating spreads that drift across both arms
	// instead of handing all of it to whichever went second.
	for (let rep = 0; rep < reps; rep++) {
		for (const arm of arms) {
			const { ms } = await timeOneBoot(arm, attempt++);

			arm.samples.push(ms);
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
		// Not GITHUB_SHA: it is reserved, and the runner overwrites a step-level
		// override with its own value — on a workflow_run that is the default
		// branch's head, not the commit being measured.
		commit: process.env['PERF_HEAD_SHA'] ?? 'local',
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
			`Each boot loads ${extensionCount} generated hooks of ${extensionKb} KB.`,
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
