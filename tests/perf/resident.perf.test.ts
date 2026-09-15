import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

/**
 * What a process holds before it does anything: the module graph its argv reaches.
 *
 * The autoscaler is a process of its own, reading the supervisor once a second,
 * and its resident size is a cost the pool carries however small the pool is.
 * Every worker builds the same program before it runs `start`, so what building
 * the program reaches, every process of a deployment pays for. Measured after a
 * full collection, so the number is the graph and not what a boot allocated on
 * its way through it.
 *
 * The budgets are absolute, where the startup bench reports a pair: the point of
 * this number is that it stays small, not that it stays put. Each sits above what
 * the head measured by a margin a dependency bump fits in and a module graph does
 * not — the imports this guards are 100 MB and more, each.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The same deploy bundle the startup bench measures, pointed at by the same
// variables: `pnpm --filter directus deploy --legacy --prod dist` at the repo root.
const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');
const baselineCli = process.env['PERF_CLI_BASELINE'];

const defaultOutput = join(root, 'tests', 'perf', 'results');
const outputDir = process.env['PERF_OUTPUT_DIR'] ?? defaultOutput;

type Subject = {
	name: string;
	/** What the process was started with. */
	argv: string[];
	/** Modules the entry point imports for that argv, relative to the api's dist. */
	modules: string[];
	budgetMb: number;
};

const subjects: Subject[] = [
	// Building the program: commander and the version, with every command's
	// module, the extension loader and the emitter behind the gate `autoscale`
	// passes. Measured 53 MB on a laptop and 55 on a runner, the node runtime
	// itself being 42 of them; the smallest module the gate holds back is
	// ~75 MB on its own.
	{ name: 'program', argv: ['autoscale'], modules: [], budgetMb: 70 },

	// The autoscaler as `cli/run.js` leaves it before the loop connects: the
	// program, the entry guard and the loop's own graph — pm2, ioredis, the
	// logger, the environment, and the metrics registry the rejection guard
	// reports to. Measured 115 MB on a laptop and 123 on a runner.
	{
		name: 'autoscaler',
		argv: ['autoscale'],
		modules: ['entry-guard.js', 'processes/autoscale/index.js'],
		budgetMb: 150,
	},
];

type Arm = { name: string; cli: string };

// The bundle's own `@directus/api`, found the way `cli.js` finds it rather than by
// a path guessed from the layout. `cli/run.js` is the one file the package
// exports under its own name; `./*` maps onto `./dist/*.js` and would double
// the extension of anything else.
function apiDist(arm: Arm): string {
	const require = createRequire(join(dirname(arm.cli), 'package.json'));

	return resolve(dirname(require.resolve('@directus/api/cli/run.js')), '..');
}

// Every subject in a process of its own: a module stays loaded, so a second
// import in the same process would measure nothing.
const script = `
	const dist = process.env['PERF_API_DIST'];
	const { createCli } = await import(dist + '/cli/index.js');

	await createCli(JSON.parse(process.env['PERF_ARGV']));

	for (const module of JSON.parse(process.env['PERF_MODULES'])) {
		await import(dist + '/' + module);
	}

	globalThis.gc();

	// As a string: a number would come out wrapped in colour codes wherever
	// FORCE_COLOR reaches the child, and pnpm sets it. The exit is explicit
	// because a module may have opened a pool or a watcher on its way in.
	console.log(String(process.memoryUsage().rss));
	process.exit(0);
`;

async function measure(arm: Arm, subject: Subject): Promise<number> {
	const child = spawn(
		'node',
		['--expose-gc', '--input-type=module', '--eval', script],
		{
			env: {
				...process.env,
				NODE_ENV: 'production',
				TELEMETRY: 'false',
				PERF_API_DIST: apiDist(arm),
				PERF_ARGV: JSON.stringify(subject.argv),
				PERF_MODULES: JSON.stringify(subject.modules),
			},
		},
	);

	let output = '';
	child.stdout.on('data', (chunk) => (output += chunk));

	let errors = '';
	child.stderr.on('data', (chunk) => (errors += chunk));

	const code = await new Promise<number | null>((r) => child.on('close', r));

	if (code !== 0) {
		throw new Error(
			`Measuring ${subject.name} on ${arm.name} exited with ${code}:\n${errors}`,
		);
	}

	// Whatever a module logged on its way in comes first; the number is last.
	const lines = output.trim().split('\n');
	const bytes = Number(lines.at(-1));

	if (Number.isFinite(bytes) === false) {
		throw new Error(
			`Measuring ${subject.name} on ${arm.name} printed no size:\n${output}`,
		);
	}

	return Math.round(bytes / 1048576);
}

test('a process holds only the modules its command reaches', async () => {
	const arms: Arm[] = [{ name: 'head', cli }];

	if (baselineCli) {
		arms.push({ name: 'baseline', cli: baselineCli });
	}

	type Row = { subject: string; budgetMb: number; [arm: string]: number | string };

	const rows: Row[] = [];

	for (const subject of subjects) {
		const row: Row = { subject: subject.name, budgetMb: subject.budgetMb };

		// The smallest of three: what a run holds above the floor is whatever the
		// allocator had not handed back when the size was read, ~10 MB of it from
		// one run to the next, and the floor is the graph.
		for (const arm of arms) {
			const sizes = [];

			for (let sample = 0; sample < 3; sample++) {
				sizes.push(await measure(arm, subject));
			}

			row[arm.name] = Math.min(...sizes);
		}

		rows.push(row);
	}

	const over = rows.filter((row) => Number(row['head']) > row.budgetMb);

	const result = {
		commit: process.env['PERF_HEAD_SHA'] ?? 'local',
		baselineCommit: process.env['PERF_BASELINE_SHA'] ?? null,
		node: process.version,
		measuredAt: new Date().toISOString(),
		subjects: rows,
		withinBudget: over.length === 0,
	};

	await mkdir(outputDir, { recursive: true });

	await writeFile(
		join(outputDir, 'resident.json'),
		`${JSON.stringify(result, null, 2)}\n`,
	);

	const armColumns = arms.map((arm) => arm.name);

	await writeFile(
		join(outputDir, 'resident.md'),
		[
			`### Resident — what a process holds before it runs its command`,
			'',
			`Measured commit \`${result.commit.slice(0, 10)}\`.`,
			'',
			`| process | ${armColumns.join(' | ')} | budget |`,
			`| --- | ${armColumns.map(() => '---:').join(' | ')} | ---: |`,
			...rows.map((row) => {
				const cells = armColumns.map((arm) => `**${row[arm]} MB**`);

				return `| ${row.subject} | ${cells.join(' | ')} | ${row.budgetMb} MB |`;
			}),
			'',
			`RSS after a full collection, the smallest of three fresh processes per`
			+ ` cell. Node ${result.node}.`,
			'',
		].join('\n'),
	);

	// One line for the commit status, written before the verdict so a breach
	// reports its number rather than a measurement that did not finish.
	await writeFile(
		join(outputDir, 'resident.status.txt'),
		`${rows.map((row) => `${row.subject} ${row['head']} MB`).join(' · ')}\n`,
	);

	expect(
		over.map((row) => `${row.subject} holds ${row['head']} MB of ${row.budgetMb}`),
	).toEqual([]);
});
