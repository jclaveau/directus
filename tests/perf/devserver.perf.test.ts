import { spawn } from 'node:child_process';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { summarise, summaryRow } from './measure.js';

/**
 * What the admin dev server holds while a developer works in it.
 *
 * Vite 8 replaced rollup and esbuild with rolldown, for bundling and for the
 * dependency optimizer both, and rolldown carries an open report that dev mode
 * costs several times the physical memory vite 7 did
 * (https://github.com/rolldown/rolldown/issues/9330). A production `vite build`
 * peak says nothing about it: the optimizer runs once at boot and the module
 * graph is held for the life of the process, so the number that decides whether
 * the fork can take vite 8 is this one.
 *
 * One arm per run, because the two vite majors cannot be installed beside each
 * other — the version under test is whatever the workspace resolved. The
 * workflow installs an arm, runs this, keeps the file, and installs the next;
 * `PERF_ARM` names which one the file belongs to.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const arm = process.env['PERF_ARM'] ?? 'local';
const reps = Number(process.env['PERF_REPS'] ?? '3');

/**
 * How far the crawl walks the graph. Every arm must transform the same modules
 * for their peaks to be comparable, so this is a count rather than a duration —
 * a slower arm would otherwise be measured on a smaller graph.
 */
const moduleBudget = Number(process.env['PERF_MODULE_BUDGET'] ?? '400');

const outputDir = process.env['PERF_OUTPUT_DIR']
	?? join(root, 'tests', 'perf', 'results');

const appDir = join(root, 'app');

/** Where vite keeps the optimized dependencies; removed to force a cold boot. */
const depCache = join(appDir, 'node_modules', '.vite');

const entry = '/admin/src/main.ts';

/**
 * Built from a char code because the escape byte written literally is a control
 * character in a regular expression, which `no-control-regex` rejects.
 */
const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

type Phase = 'boot' | 'optimize' | 'graph';

type Rep = Record<Phase, number> & { modules: number };

/**
 * Resident size of the server and everything it forked. Rolldown's workers are
 * threads rather than processes, so they land in the parent's own VmRSS, but the
 * dependency scanner has been a child process in both majors and the sum has to
 * cover whichever shape the arm under test uses.
 */
async function treeRssMb(rootPid: number): Promise<number> {
	const pids = [rootPid];
	let total = 0;

	for (let index = 0; index < pids.length; index++) {
		const pid = pids[index]!;

		let status: string;

		try {
			status = await readFile(`/proc/${pid}/status`, 'utf8');
		}
		catch {
			// The scanner exits as soon as it has finished; a sample that lands
			// in that window measures the processes that are still there.
			continue;
		}

		const rss = /^VmRSS:\s+(\d+) kB$/m.exec(status);

		if (rss) {
			total += Number(rss[1]) / 1024;
		}

		let children: string;

		try {
			children = await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8');
		}
		catch {
			continue;
		}

		const forked = children.trim()
			.split(/\s+/)
			.filter(Boolean);

		for (const child of forked) {
			pids.push(Number(child));
		}
	}

	return Math.round(total);
}

/**
 * The highest sample taken while `work` runs. A peak rather than a reading at
 * the end: the optimizer hands its memory back when it finishes, so an arm that
 * needed twice as much to get there would otherwise report the same number.
 */
async function peakDuring<T>(
	pid: number,
	work: () => Promise<T>,
): Promise<[T, number]> {
	let peak = 0;
	let sampling = true;

	const sampler = (async () => {
		while (sampling) {
			peak = Math.max(peak, await treeRssMb(pid));
			await new Promise((r) => setTimeout(r, 100));
		}
	})();

	try {
		const value = await work();
		return [value, Math.max(peak, await treeRssMb(pid))];
	}
	finally {
		sampling = false;
		await sampler;
	}
}

type Server = { pid: number; url: string; stop: () => Promise<void> };

async function startServer(): Promise<Server> {
	const child = spawn(
		'pnpm',
		['exec', 'vite', '--port', '0', '--strictPort=false'],
		{
			cwd: appDir,
			env: {
				...process.env,
				NODE_ENV: 'development',
				// The dev server proxies everything outside /admin at an API
				// that is not running here. Nothing this measures leaves
				// /admin, but the proxy logs a refused connection per stray
				// request without it.
				API_URL: 'http://127.0.0.1:1/',
				NO_COLOR: '1',
			},
		},
	);

	let output = '';

	const url = await new Promise<string>((resolveUrl, rejectUrl) => {
		const timer = setTimeout(
			() => rejectUrl(new Error(`The dev server printed no URL:\n${output}`)),
			180_000,
		);

		const read = (chunk: Buffer) => {
			// The banner is coloured even under `NO_COLOR`, and its escapes land
			// inside the URL rather than around it — the port arrives as
			// `localhost:\x1b[1m34629\x1b[22m/admin`, so the line has to be
			// stripped before it can be read as one.
			output += chunk.toString().replace(ansiEscape, '');

			// `Local:   http://localhost:5173/admin`
			const found = /Local:\s+(http:\/\/\S+)/.exec(output);

			if (found) {
				clearTimeout(timer);
				resolveUrl(found[1]!);
			}
		};

		child.stdout.on('data', read);
		child.stderr.on('data', read);

		child.on('exit', (code) => {
			clearTimeout(timer);
			rejectUrl(new Error(`The dev server exited with ${code}:\n${output}`));
		});
	// Every rejection above leaves a listening server behind unless the child is
	// killed with it, and an arm that fails a rep would strand a process holding
	// a gigabyte for the rest of the job.
	}).catch((error: unknown) => {
		child.kill('SIGKILL');
		throw error;
	});

	return {
		pid: child.pid!,
		url: url.replace(/\/admin\/?$/, ''),
		stop: async () => {
			child.kill('SIGTERM');
			await new Promise((r) => child.on('close', r));
		},
	};
}

/**
 * Walks the module graph the way a browser does, breadth first from the entry,
 * so the server transforms real files rather than serving one page. Stops at
 * `moduleBudget` so every arm is measured over the same amount of work.
 */
async function crawl(server: Server): Promise<number> {
	const queue = [entry];
	const seen = new Set(queue);

	for (let index = 0; index < queue.length && seen.size < moduleBudget; index++) {
		const response = await fetch(`${server.url}${queue[index]!}`);

		if (response.ok === false) {
			continue;
		}

		const body = await response.text();

		// What the transform left behind: vite rewrites every specifier it
		// resolved into a path the next request can ask for as it stands.
		for (const match of body.matchAll(/from\s*["'](\/[^"']+)["']/g)) {
			const next = match[1]!;

			if (seen.has(next) === false && seen.size < moduleBudget) {
				seen.add(next);
				queue.push(next);
			}
		}
	}

	return seen.size;
}

/**
 * Resolves once the optimizer has written the metadata it writes last. Vite
 * reports the same state over the websocket the browser holds, which this has
 * no client for, so the file is the signal available here.
 */
async function waitForOptimizedDeps(): Promise<void> {
	const metadata = join(depCache, 'deps', '_metadata.json');
	const deadline = Date.now() + 180_000;

	while (Date.now() < deadline) {
		try {
			const written = JSON.parse(await readFile(metadata, 'utf8'));

			if (Object.keys(written.optimized ?? {}).length > 0) {
				return;
			}
		}
		catch {
			// Not written yet, or written half way through.
		}

		await new Promise((settle) => setTimeout(settle, 200));
	}

	throw new Error('The dependency optimizer did not finish within 180s');
}

async function measureRep(): Promise<Rep> {
	await rm(depCache, { recursive: true, force: true });

	const server = await startServer();
	const boot = await treeRssMb(server.pid);

	try {
		// The optimizer runs on the first module request, not at listen and not
		// on the index, and it finishes after the response that started it. A
		// fetch alone measured 312 MB against the 1597 MB the same boot reached
		// once the crawl forced the work — the wait is what puts the cold cost in
		// this phase instead of the next one.
		const [, optimize] = await peakDuring(server.pid, async () => {
			await fetch(`${server.url}${entry}`);
			await waitForOptimizedDeps();
		});

		const [modules, graph] = await peakDuring(
			server.pid,
			async () => await crawl(server),
		);

		return { boot, optimize, graph, modules };
	}
	finally {
		await server.stop();
	}
}

test('the admin dev server holds a bounded amount while it serves', async () => {
	const reps_: Rep[] = [];

	for (let rep = 0; rep < reps; rep++) {
		reps_.push(await measureRep());
	}

	const summaries = (['boot', 'optimize', 'graph'] as Phase[]).map((phase) =>
		summarise(phase, reps_.map((rep) => rep[phase])));

	const result = {
		arm,
		commit: process.env['PERF_HEAD_SHA'] ?? 'local',
		node: process.version,
		vite: JSON.parse(
			await readFile(
				join(appDir, 'node_modules', 'vite', 'package.json'),
				'utf8',
			),
		).version,
		rolldownWorkerThreads: process.env['ROLLDOWN_WORKER_THREADS'] ?? null,
		measuredAt: new Date().toISOString(),
		moduleBudget,
		modules: reps_.map((rep) => rep.modules),
		phases: summaries,
		reps: reps_,
	};

	await mkdir(outputDir, { recursive: true });

	await writeFile(
		join(outputDir, `devserver.${arm}.json`),
		`${JSON.stringify(result, null, 2)}\n`,
	);

	await writeFile(
		join(outputDir, `devserver.${arm}.md`),
		[
			`### Dev server — ${arm} (vite ${result.vite})`,
			'',
			`| phase | min | median | p95 | max |`,
			`| --- | ---: | ---: | ---: | ---: |`,
			...summaries.map((summary) => summaryRow(summary, 'MB')),
			'',
			`Peak resident of the server and its children, ${reps} cold boots,`
			+ ` ${result.modules[0]} modules crawled. Node ${result.node}.`,
			'',
		].join('\n'),
	);

	// Every arm must have walked the same graph, or the peaks below are not
	// answering the same question.
	expect(new Set(result.modules).size).toBe(1);

	for (const summary of summaries) {
		expect(summary.median).toBeGreaterThan(0);
	}
}, 1_800_000);
