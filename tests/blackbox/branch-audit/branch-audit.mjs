/* eslint-disable no-console */
// Lists the branches a pull request adds to api/src that no blackbox server ran,
// and checks the lines listed as unit-only are run by the api unit tests.
//
//   node tests/blackbox/branch-audit/branch-audit.mjs
//     --blackbox <dir> --base <ref> --head <ref>
//     [--unit <dir> --unit-head <ref>] [--report <out.md>]
//
// --blackbox holds the coverage-final.json each blackbox shard wrote, at any
// depth: download-artifact puts each artifact in its own folder. The added
// lines come from `git diff <base> <head> -- api/src`, so --head is the commit
// the shards built: on a pull_request run, the merge commit, its first parent
// the base.
//
// --unit holds the api unit tests' coverage-final.json, built from --unit-head.
//
// A line no blackbox server ran is
// - out of scope when out-of-scope.json lists it under its `oos feature` issue;
// - unit-only when unit-only.json lists it: no request can reach it, so the
//   unit tests must run it;
// - otherwise a gap: a blackbox scenario should reach it.
//
// Exits 1 when a list entry names no line, a unit-only line is run by
// blackbox, or a unit-only line is not run by the unit tests. Gaps alone
// never fail it.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
	options: {
		'blackbox': { type: 'string' },
		'base': { type: 'string' },
		'head': { type: 'string' },
		'unit': { type: 'string' },
		'unit-head': { type: 'string' },
		'report': { type: 'string' },
	},
});

if (!options.blackbox || !options.base || !options.head
	|| Boolean(options.unit) !== Boolean(options['unit-head'])) {
	console.error(
		'usage: branch-audit.mjs --blackbox <dir> --base <ref> --head <ref> '
		+ '[--unit <dir> --unit-head <ref>] [--report <out.md>]',
	);

	process.exit(2);
}

const listDir = dirname(fileURLToPath(import.meta.url));

function findCoverageFiles(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);

		if (statSync(path).isDirectory()) {
			return findCoverageFiles(path);
		}

		return name === 'coverage-final.json'
			? [path]
			: [];
	});
}

// istanbul keys a file by the path the build saw: absolute on a runner,
// `src/…` when relative to api/. Both name the same repo file.
function repoPathOf(coveredPath) {
	const apiIndex = coveredPath.lastIndexOf('/api/src/');

	if (apiIndex !== -1) {
		return coveredPath.slice(apiIndex + 1);
	}

	if (coveredPath.startsWith('src/')) {
		return `api/${coveredPath}`;
	}

	throw new Error(
		`Coverage file ${JSON.stringify(coveredPath)} is not under api/src.`,
	);
}

function addCounts(target, source, coveredPath, counter) {
	for (const [id, hits] of Object.entries(source)) {
		const known = target[id];

		if (known === undefined) {
			throw new Error(
				`Shards disagree on ${counter} ${JSON.stringify(id)} `
				+ `of ${JSON.stringify(coveredPath)}: they built different sources.`,
			);
		}

		target[id] = Array.isArray(hits)
			? known.map((count, arm) => count + hits[arm])
			: known + hits;
	}
}

// Sums the hit counts of every report under `dir`, keyed by repo path.
function readCoverage(dir) {
	const coverageFiles = findCoverageFiles(dir);

	if (coverageFiles.length === 0) {
		console.error(`No coverage-final.json under ${JSON.stringify(dir)}.`);
		process.exit(1);
	}

	const coverageByPath = new Map();

	for (const coverageFile of coverageFiles) {
		const reportCoverage = JSON.parse(readFileSync(coverageFile, 'utf8'));

		for (const [coveredPath, fileCoverage] of Object.entries(reportCoverage)) {
			const repoPath = repoPathOf(coveredPath);
			const known = coverageByPath.get(repoPath);

			if (!known) {
				coverageByPath.set(repoPath, structuredClone(fileCoverage));
				continue;
			}

			addCounts(known.s, fileCoverage.s, coveredPath, 'statement');
			addCounts(known.f, fileCoverage.f, coveredPath, 'function');
			addCounts(known.b, fileCoverage.b, coveredPath, 'branch');
		}
	}

	return { coverageByPath, reportCount: coverageFiles.length };
}

function armNameOf(branchType, arm, armCount) {
	switch (branchType) {
		case 'if':
			return arm === 0
				? 'then'
				: 'else';
		case 'cond-expr':
			return arm === 0
				? 'true'
				: 'false';
		case 'binary-expr':
			return `operand ${arm + 1} of ${armCount}`;
		case 'switch':
			return `case ${arm + 1} of ${armCount}`;
		case 'default-arg':
			return 'default value';
		default:
			return `${branchType} arm ${arm + 1}`;
	}
}

// Every statement and branch arm starting on `line`, with its hit count.
function countersOnLine(fileCoverage, line) {
	const counters = [];

	for (const [id, statement] of Object.entries(fileCoverage.statementMap)) {
		if (statement.start.line === line) {
			counters.push({ name: 'statement', hits: fileCoverage.s[id] });
		}
	}

	for (const [id, branch] of Object.entries(fileCoverage.branchMap)) {
		branch.locations.forEach((location, arm) => {
			const armLine = location?.start?.line ?? branch.loc.start.line;

			if (armLine === line) {
				const name = armNameOf(branch.type, arm, branch.locations.length);
				counters.push({ name, hits: fileCoverage.b[id][arm] });
			}
		});
	}

	return counters;
}

const sourceByRef = new Map();

function sourceLinesAt(ref, path) {
	const key = `${ref}:${path}`;

	if (!sourceByRef.has(key)) {
		const text = execFileSync('git', ['show', key], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'ignore'],
		});

		sourceByRef.set(key, text.split('\n'));
	}

	return sourceByRef.get(key);
}

const listErrors = [];

function readList(fileName, requiredKeys, optionalKeys) {
	const entries = JSON.parse(readFileSync(join(listDir, fileName), 'utf8'));

	entries.forEach((entry, index) => {
		const name = `${fileName} entry ${index + 1}`;
		const keys = Object.keys(entry);

		for (const key of requiredKeys) {
			if (!keys.includes(key)) {
				listErrors.push(`${name} has no ${JSON.stringify(key)}.`);
			}
		}

		for (const key of keys) {
			if (!requiredKeys.includes(key) && !optionalKeys.includes(key)) {
				listErrors.push(`${name} has an unknown key ${JSON.stringify(key)}.`);
			}
		}

		entry.name = name;
	});

	return entries;
}

// The line an entry names at `ref`: its `source` (trimmed) is found exactly
// once in the file, or at its `occurrence` (1-based) when repeated.
function lineOfEntry(entry, ref) {
	let sourceLines;

	try {
		sourceLines = sourceLinesAt(ref, entry.file);
	}
	catch {
		listErrors.push(`${entry.name}: ${JSON.stringify(entry.file)} does not `
			+ `exist at ${ref}.`);

		return null;
	}

	const matchedLines = [];

	sourceLines.forEach((text, index) => {
		if (text.trim() === entry.source) {
			matchedLines.push(index + 1);
		}
	});

	if (entry.occurrence === undefined && matchedLines.length > 1) {
		listErrors.push(`${entry.name}: ${JSON.stringify(entry.source)} is on `
			+ `lines ${matchedLines.join(', ')} of ${entry.file} at ${ref}; `
			+ 'set "occurrence".');

		return null;
	}

	const line = matchedLines[(entry.occurrence ?? 1) - 1];

	if (line === undefined) {
		listErrors.push(`${entry.name}: no line ${JSON.stringify(entry.source)} `
			+ `in ${entry.file} at ${ref}.`);

		return null;
	}

	return line;
}

const outOfScope = readList('out-of-scope.json', ['issue', 'file', 'reason'], [
	'source',
	'occurrence',
]);

const unitOnly = readList('unit-only.json', ['file', 'source', 'reason'], [
	'occurrence',
]);

const blackbox = readCoverage(options.blackbox);

// Test files and test helpers are never instrumented (api/tsdown.config.ts).
function isInstrumentedSource(path) {
	return /^api\/src\/.*\.ts$/.test(path)
		&& !/\.test(-d)?\.ts$/.test(path)
		&& !/^api\/src\/(__[^/]*|test-utils)\//.test(path);
}

const diffText = execFileSync(
	'git',
	['diff', '--unified=0', '--no-color', '--no-renames']
		.concat([options.base, options.head, '--', 'api/src']),
	{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
);

const addedLinesByPath = new Map();
let currentPath = null;

for (const diffLine of diffText.split('\n')) {
	if (diffLine.startsWith('+++ ')) {
		const target = diffLine.slice(4);

		currentPath = target === '/dev/null'
			? null
			: target.replace(/^b\//, '');

		continue;
	}

	const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(diffLine);

	if (!hunk || !currentPath || !isInstrumentedSource(currentPath)) {
		continue;
	}

	const firstLine = Number(hunk[1]);

	const lineCount = hunk[2] === undefined
		? 1
		: Number(hunk[2]);

	// A hunk that only deletes adds no line.
	if (lineCount === 0) {
		continue;
	}

	const addedLines = addedLinesByPath.get(currentPath) ?? new Set();

	for (let line = firstLine; line < firstLine + lineCount; line++) {
		addedLines.add(line);
	}

	addedLinesByPath.set(currentPath, addedLines);
}

const findings = [];
const totals = { arms: 0, armsRun: 0, statements: 0, statementsRun: 0 };

for (const [path, addedLines] of [...addedLinesByPath].sort()) {
	const fileCoverage = blackbox.coverageByPath.get(path);

	// A file no server loaded: every added line is out of the run.
	if (!fileCoverage) {
		const line = Math.min(...addedLines);
		findings.push({ path, line, detail: 'file never loaded' });
		continue;
	}

	for (const [id, branch] of Object.entries(fileCoverage.branchMap)) {
		const hits = fileCoverage.b[id];
		const branchLine = branch.loc.start.line;

		branch.locations.forEach((location, arm) => {
			const line = location?.start?.line ?? branchLine;

			if (!addedLines.has(line) && !addedLines.has(branchLine)) {
				return;
			}

			totals.arms++;

			if (hits[arm] > 0) {
				totals.armsRun++;
				return;
			}

			const detail = armNameOf(branch.type, arm, branch.locations.length);
			findings.push({ path, line, detail });
		});
	}

	for (const [id, statement] of Object.entries(fileCoverage.statementMap)) {
		const line = statement.start.line;

		if (!addedLines.has(line)) {
			continue;
		}

		totals.statements++;

		if (fileCoverage.s[id] > 0) {
			totals.statementsRun++;
			continue;
		}

		findings.push({ path, line, detail: 'statement never run' });
	}
}

// Resolve every entry, so a stale one fails whichever PR runs next.
const outOfScopeByLine = new Map();
const outOfScopeFiles = new Map();

for (const entry of outOfScope) {
	if (entry.source === undefined) {
		outOfScopeFiles.set(entry.file, entry);
		continue;
	}

	const line = lineOfEntry(entry, options.head);

	if (line !== null) {
		outOfScopeByLine.set(`${entry.file}:${line}`, entry);
	}
}

const unitOnlyByLine = new Map();

for (const entry of unitOnly) {
	const line = lineOfEntry(entry, options.head);

	if (line === null) {
		continue;
	}

	unitOnlyByLine.set(`${entry.file}:${line}`, entry);

	// Listed as out of reach, yet a blackbox server ran all of it.
	const fileCoverage = blackbox.coverageByPath.get(entry.file);

	const counters = fileCoverage
		? countersOnLine(fileCoverage, line)
		: [];

	if (counters.length > 0 && counters.every(({ hits }) => hits > 0)) {
		listErrors.push(`${entry.name}: blackbox runs ${entry.file}:${line} `
			+ `${JSON.stringify(entry.source)}; drop the entry.`);
	}
}

findings.sort((left, right) => {
	return left.path.localeCompare(right.path) || left.line - right.line;
});

// One row per line: two unrun statements on one line say no more than one.
const gapRows = new Map();
const outOfScopeRows = new Map();

for (const finding of findings) {
	const key = `${finding.path}:${finding.line}`;

	// A unit-only line is reported by the unit check below, not here.
	if (unitOnlyByLine.has(key)) {
		continue;
	}

	const scopeEntry = outOfScopeByLine.get(key)
		?? outOfScopeFiles.get(finding.path);

	const rows = scopeEntry
		? outOfScopeRows
		: gapRows;

	const row = rows.get(key) ?? { ...finding, details: new Set(), scopeEntry };
	row.details.add(finding.detail);
	rows.set(key, row);
}

function sourceLineOf(path, line) {
	const text = sourceLinesAt(options.head, path)[line - 1]
		.trim()
		.replaceAll('`', '\'')
		.replaceAll('|', '\\|');

	return text.length > 90
		? `${text.slice(0, 87)}...`
		: text;
}

function percentOf(part, whole) {
	return whole === 0
		? '—'
		: `${((100 * part) / whole).toFixed(1)}%`;
}

function rowLine(row, lastCell) {
	const details = [...row.details].join(', ');
	return `| \`${row.path}:${row.line}\` | ${details} | ${lastCell} |`;
}

function sourceCellOf(row) {
	return row.details.has('file never loaded')
		? ''
		: `\`${sourceLineOf(row.path, row.line)}\``;
}

const armsPercent = percentOf(totals.armsRun, totals.arms);
const statementsPercent = percentOf(totals.statementsRun, totals.statements);

const report = [
	'## Blackbox branch audit',
	'',
	`Added lines of \`api/src\` between \`${options.base}\` and `
	+ `\`${options.head}\`, ${blackbox.reportCount} blackbox shard report(s).`,
	'',
	'| added | run by blackbox | total | run |',
	'|---|---|---|---|',
	`| branch arms | ${totals.armsRun} | ${totals.arms} | ${armsPercent} |`,
	`| statements | ${totals.statementsRun} | ${totals.statements} `
	+ `| ${statementsPercent} |`,
	'',
	`### Not run by blackbox: ${gapRows.size} line(s)`,
	'',
];

if (gapRows.size === 0) {
	report.push('Every added line is run by blackbox or listed.');
}
else {
	report.push(
		'Each needs a blackbox scenario reaching it. When no request can reach',
		'it, list it in `tests/blackbox/branch-audit/unit-only.json`.',
		'',
		'| line | not run | source |',
		'|---|---|---|',
		...[...gapRows.values()].map((row) => rowLine(row, sourceCellOf(row))),
	);
}

const unitFailures = [];

report.push('', `### Unit-only: ${unitOnly.length} listed line(s)`, '');

if (options.unit) {
	const unit = readCoverage(options.unit);
	const unitRows = [];

	for (const entry of unitOnly) {
		const line = lineOfEntry(entry, options['unit-head']);

		if (line === null) {
			continue;
		}

		const fileCoverage = unit.coverageByPath.get(entry.file);

		const counters = fileCoverage
			? countersOnLine(fileCoverage, line)
			: [];

		const unrunNames = counters
			.filter(({ hits }) => hits === 0)
			.map(({ name }) => name);

		let verdict = 'run';

		if (counters.length === 0) {
			verdict = 'no unit coverage on this line';
		}
		else if (unrunNames.length > 0) {
			verdict = `not run: ${[...new Set(unrunNames)].join(', ')}`;
		}

		if (verdict !== 'run') {
			unitFailures.push(`${entry.name}: ${entry.file}:${line} ${verdict}`);
		}

		unitRows.push(`| \`${entry.file}:${line}\` | ${verdict} `
			+ `| ${entry.reason} |`);
	}

	report.push(
		`Checked against the api unit tests at \`${options['unit-head']}\`.`,
		'',
		'| line | unit tests | why blackbox cannot reach it |',
		'|---|---|---|',
		...unitRows,
	);
}
else {
	report.push('Not checked: no unit coverage given.');
}

report.push('', `### Out of scope: ${outOfScopeRows.size} line(s)`, '');

if (outOfScopeRows.size > 0) {
	report.push(
		'| line | not run | issue |',
		'|---|---|---|',
		...[...outOfScopeRows.values()]
			.map((row) => rowLine(row, `#${row.scopeEntry.issue}`)),
	);
}

const failures = [...listErrors, ...unitFailures];

if (failures.length > 0) {
	report.push('', '### Failures', '', ...failures.map((text) => `- ${text}`));
}

const reportText = `${report.join('\n')}\n`;

if (options.report) {
	writeFileSync(options.report, reportText);
}

console.log(reportText);

if (failures.length > 0) {
	process.exit(1);
}
