#!/usr/bin/env node
// Lists every path scanners probe on a Railway service, from its HTTP logs.
//
// A scanner is any client that never got a real answer: the script pulls the
// service's 4xx HTTP log lines, drops the source IPs that also got a 2xx/3xx on
// an app-driven path in the window (a real user hitting a stale link), and
// groups what is left by path. A 2xx on `/`, `/admin`, `/admin/<anything>` (the
// SPA fallback serves index.html), `/server/*`, `/metrics` or `/graphql` proves
// nothing — every scanner collects those too.
// The result feeds an Edge rule (Block on `Path matches ...`) so the probes stop
// waking the service.
//
// Usage:
//   node scripts/railway-scanner-paths.mjs --service <name> [--since 7d]
//     [--environment dev] [--lines 5000] [--json]
//
// HTTP logs live per deployment, so the script walks every deployment created
// inside the window (dev redeploys several times a day) and merges their lines.
//
// Needs the railway CLI, and a linked project (`railway link -w <workspace>
// -p <project> -e <environment>`, from any directory — link state is per-cwd).
// --service names the service to read and has no default.

/* eslint-disable no-console -- a CLI, stdout is its output */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
	options: {
		since: { type: 'string', default: '7d' },
		service: { type: 'string' },
		environment: { type: 'string', default: 'dev' },
		lines: { type: 'string', default: '5000' },
		json: { type: 'boolean', default: false },
	},
});

if (!args.service) {
	console.error('--service <name> is required: the Railway service whose HTTP logs to read');
	process.exit(1);
}

const railway = (cliArgs) => execFileSync(
	'railway',
	[...cliArgs, '--service', args.service, '--environment', args.environment],
	{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
);

const SINCE_UNITS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

function sinceToDate(since) {
	const relative = /^(\d+)([smhdw])$/.exec(since);

	if (relative) {
		return new Date(Date.now() - Number(relative[1]) * SINCE_UNITS[relative[2]] * 1000);
	}

	return new Date(since);
}

function listDeployments() {
	const all = JSON.parse(railway(['deployment', 'list', '--json', '--limit', '1000']));
	const floor = sinceToDate(args.since);

	// The deployment live at the start of the window predates it; keep the
	// first one older than the floor so its lines are not lost.
	const inWindow = all.filter((d) => new Date(d.createdAt) >= floor);
	const before = all.find((d) => new Date(d.createdAt) < floor);

	return before ? [...inWindow, before] : inWindow;
}

function fetchHttpLogs(deploymentId, filter) {
	const out = railway([
		'logs',
		'--http',
		'--json',
		'--since', args.since,
		'--lines', args.lines,
		'--filter', filter,
		deploymentId,
	]);

	return out
		.split('\n')
		.filter((line) => line.startsWith('{'))
		.map((line) => JSON.parse(line));
}

const deployments = listDeployments();
const errors = [];
const successes = [];

for (const deployment of deployments) {
	errors.push(...fetchHttpLogs(deployment.id, '@httpStatus:400..499'));
	successes.push(...fetchHttpLogs(deployment.id, '@httpStatus:200..399'));
}

// A success that only a browser running the admin app, or an SDK holding a
// token, can produce.
const APP_DRIVEN = /^\/(admin\/assets\/|auth\/|items\/|users\/|extensions\/|files\/|assets\/|utils\/|translations|settings|collections|fields|relations)/;

const legitIps = new Set(
	successes.filter((entry) => APP_DRIVEN.test(entry.path)).map((entry) => entry.srcIp),
);

const probes = errors.filter((entry) => !legitIps.has(entry.srcIp));

const byPath = new Map();

for (const entry of probes) {
	const stats = byPath.get(entry.path) ?? {
		path: entry.path,
		hits: 0,
		statuses: new Set(),
		ips: new Set(),
		agents: new Set(),
		first: entry.timestamp,
		last: entry.timestamp,
	};

	stats.hits += 1;
	stats.statuses.add(entry.httpStatus);
	stats.ips.add(entry.srcIp);
	stats.agents.add(entry.clientUa);
	if (entry.timestamp < stats.first) stats.first = entry.timestamp;
	if (entry.timestamp > stats.last) stats.last = entry.timestamp;
	byPath.set(entry.path, stats);
}

const rows = [...byPath.values()]
	.sort((a, b) => b.hits - a.hits || a.path.localeCompare(b.path))
	.map((stats) => ({
		...stats,
		statuses: [...stats.statuses].sort(),
		ips: [...stats.ips],
		agents: [...stats.agents],
	}));

const prefixOf = (path) => {
	const [, first = ''] = path.split('/');
	return `/${first}`;
};

const byPrefix = new Map();

for (const row of rows) {
	const prefix = prefixOf(row.path);
	byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + row.hits);
}

const prefixes = [...byPrefix.entries()].sort((a, b) => b[1] - a[1]);

if (args.json) {
	console.log(JSON.stringify({ since: args.since, rows, prefixes }, null, 2));
	process.exit(0);
}

const scannerIps = new Set(probes.map((entry) => entry.srcIp));

console.log(
	`${args.service}/${args.environment}, last ${args.since}, `
	+ `${deployments.length} deployments: ${errors.length} 4xx lines, ${probes.length} from ${scannerIps.size} `
	+ `scanner IPs (${legitIps.size} IPs excluded as legit), `
	+ `${rows.length} distinct paths\n`,
);

const width = Math.max(4, ...rows.map((row) => row.path.length));
console.log(`${'path'.padEnd(width)}  hits  ips  status  last seen`);

for (const row of rows) {
	console.log(
		`${row.path.padEnd(width)}  ${String(row.hits).padStart(4)}  `
		+ `${String(row.ips.length).padStart(3)}  ${row.statuses.join('/').padEnd(6)}  `
		+ row.last.slice(0, 19),
	);
}

console.log('\nfirst path segment (edge-rule candidates, `Path matches <prefix>*`):');

for (const [prefix, hits] of prefixes) {
	console.log(`  ${String(hits).padStart(5)}  ${prefix}`);
}
