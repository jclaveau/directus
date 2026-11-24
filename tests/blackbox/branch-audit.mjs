/* eslint-disable no-console */
// Lists the branches a pull request adds to api/src that no blackbox server ran.
//
//   node tests/blackbox/branch-audit.mjs <coverage-dir> <base> <head> [<out.md>]
//
// <coverage-dir> holds the coverage-final.json each shard's merge-coverage.mjs
// wrote, at any depth: download-artifact puts each artifact in its own folder.
// The added lines come from `git diff <base> <head> -- api/src`, so <head> must
// be the commit the shards built: on a pull_request run, the merge commit, with
// its first parent as <base>.
//
// Each branch arm and statement on an added line that no shard ran is listed:
// a scenario should reach it, or, out of reach over HTTP, a unit test covers it.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [coverageDir, baseRef, headRef, reportPath] = process.argv.slice(2);

if (!coverageDir || !baseRef || !headRef) {
	console.error(
		'usage: branch-audit.mjs <coverage-dir> <base> <head> [<out.md>]',
	);

	process.exit(2);
}

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

const coverageFiles = findCoverageFiles(coverageDir);

if (coverageFiles.length === 0) {
	console.error(`No coverage-final.json under ${JSON.stringify(coverageDir)}.`);
	process.exit(1);
}

const coverageByPath = new Map();

for (const coverageFile of coverageFiles) {
	const shardCoverage = JSON.parse(readFileSync(coverageFile, 'utf8'));

	for (const [coveredPath, fileCoverage] of Object.entries(shardCoverage)) {
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

// Test files and test helpers are never instrumented (api/tsdown.config.ts).
function isInstrumentedSource(path) {
	return /^api\/src\/.*\.ts$/.test(path)
		&& !/\.test(-d)?\.ts$/.test(path)
		&& !/^api\/src\/(__[^/]*|test-utils)\//.test(path);
}

const diffText = execFileSync(
	'git',
	['diff', '--unified=0', '--no-color', '--no-renames', baseRef, headRef]
		.concat(['--', 'api/src']),
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

const findings = [];
const totals = { arms: 0, armsRun: 0, statements: 0, statementsRun: 0 };

for (const [path, addedLines] of [...addedLinesByPath].sort()) {
	const fileCoverage = coverageByPath.get(path);

	// A file no server loaded: every added line is out of the run.
	if (!fileCoverage) {
		const line = Math.min(...addedLines);
		findings.push({ path, line, kind: 'file', detail: 'never loaded' });
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
			findings.push({ path, line, kind: 'branch', detail });
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

		findings.push({ path, line, kind: 'statement', detail: 'never run' });
	}
}

const sourceLinesByPath = new Map();

function sourceLineOf(path, line) {
	if (!sourceLinesByPath.has(path)) {
		sourceLinesByPath.set(path, readFileSync(path, 'utf8').split('\n'));
	}

	const text = sourceLinesByPath.get(path)[line - 1]
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

findings.sort((left, right) => {
	return left.path.localeCompare(right.path) || left.line - right.line;
});

// One row per line: two unrun statements on one line say no more than one.
const rows = new Map();

for (const finding of findings) {
	const key = `${finding.path}:${finding.line}`;
	const row = rows.get(key) ?? { ...finding, details: new Set() };

	row.details.add(finding.kind === 'branch'
		? finding.detail
		: `${finding.kind} ${finding.detail}`);

	rows.set(key, row);
}

const armsPercent = percentOf(totals.armsRun, totals.arms);
const statementsPercent = percentOf(totals.statementsRun, totals.statements);

const report = [
	'## Blackbox branch audit',
	'',
	`Added lines of \`api/src\` between \`${baseRef}\` and \`${headRef}\`, `
	+ `${coverageFiles.length} shard report(s).`,
	'',
	'| added | run by blackbox | total | run |',
	'|---|---|---|---|',
	`| branch arms | ${totals.armsRun} | ${totals.arms} | ${armsPercent} |`,
	`| statements | ${totals.statementsRun} | ${totals.statements} `
	+ `| ${statementsPercent} |`,
	'',
];

if (rows.size === 0) {
	report.push('Every added branch arm and statement ran in a blackbox server.');
}
else {
	report.push(
		'Each line below needs a blackbox scenario reaching it, or, when no',
		'request can reach it, a unit test.',
		'',
		'| line | not run | source |',
		'|---|---|---|',
	);

	for (const row of rows.values()) {
		const source = row.kind === 'file'
			? ''
			: `\`${sourceLineOf(row.path, row.line)}\``;

		const details = [...row.details].join(', ');
		report.push(`| \`${row.path}:${row.line}\` | ${details} | ${source} |`);
	}
}

const reportText = `${report.join('\n')}\n`;

if (reportPath) {
	writeFileSync(reportPath, reportText);
}

console.log(reportText);
