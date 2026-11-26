/* eslint-disable no-console */
// Lists the branches a pull request adds to api/src that no blackbox server ran,
// and checks the code tagged unit-only is run by the api unit tests.
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
// A tag ends the code line it covers, and covers every statement, function and
// branch starting on that line, to their end:
//
//   if (retryDelay > 0) { // bb-unit-only: Redis never refuses in bb
//   if (isMysql) { // bb-out-of-scope: #610
//
// A counter under several tags takes the innermost one. A line no blackbox
// server ran is
// - out of scope under a `bb-out-of-scope: #<oos feature issue>` tag;
// - unit-only under a `bb-unit-only: <why>` tag: no request can reach it, so
//   the unit tests must run it;
// - otherwise a gap: a blackbox scenario should reach it.
//
// Exits 1 when a tag is malformed or covers nothing, blackbox runs all a tag
// covers, the unit tests leave a unit-only counter unrun, or the tags drift
// from OUT_OF_SCOPE_FEATURES in api/src/utils/out-of-scope-features.ts: a
// feature whose issue no tag names, or a tag naming a feature with another
// issue than the list gives it. Gaps alone never fail it.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

// Every statement and branch arm of a file: where it starts, its hit count.
// An arm with no location of its own starts where its branch does.
function countersOf(fileCoverage) {
	const statementCounters = Object.entries(fileCoverage.statementMap)
		.map(([id, statement]) => {
			return {
				kind: 'statement',
				name: 'statement',
				start: statement.start,
				hits: fileCoverage.s[id],
			};
		});

	const armCounters = Object.entries(fileCoverage.branchMap)
		.flatMap(([id, branch]) => {
			return branch.locations.map((location, arm) => {
				const start = location?.start?.line === undefined
					? branch.loc.start
					: location.start;

				return {
					kind: 'arm',
					name: armNameOf(branch.type, arm, branch.locations.length),
					start,
					branchLine: branch.loc.start.line,
					hits: fileCoverage.b[id][arm],
				};
			});
		});

	return [...statementCounters, ...armCounters];
}

function comparePositions(left, right) {
	return left.line - right.line || left.column - right.column;
}

function rangeHolds(range, position) {
	return comparePositions(range.start, position) <= 0
		&& comparePositions(position, range.end) <= 0;
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

// Test files and test helpers are never instrumented (api/tsdown.config.ts).
function isInstrumentedSource(path) {
	return /^api\/src\/.*\.ts$/.test(path)
		&& !/\.test(-d)?\.ts$/.test(path)
		&& !/^api\/src\/(__[^/]*|test-utils)\//.test(path);
}

const tagErrors = [];
const TAG_PATTERN = /^(.*?)\/\/ bb-(unit-only|out-of-scope):(.*)$/;

// The tags in api/src at `ref`, keyed by path, each `{ path, line, kind, text }`.
function readTags(ref) {
	let grepText;

	try {
		grepText = execFileSync(
			'git',
			['grep', '-n', '-E', '// bb-(unit-only|out-of-scope):', ref, '--', 'api/src'],
			{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
		);
	}
	catch (error) {
		// git grep exits 1 when nothing matches.
		if (error.status === 1) {
			return new Map();
		}

		throw error;
	}

	const tagsByPath = new Map();

	for (const grepLine of grepText.split('\n')) {
		if (grepLine === '') {
			continue;
		}

		// `<ref>:<path>:<line>:<source line>`
		const [, path, lineText, sourceLine] = /^([^:]+):(\d+):(.*)$/
			.exec(grepLine.slice(ref.length + 1));

		if (!isInstrumentedSource(path)) {
			continue;
		}

		const [, code, kind, rawText] = TAG_PATTERN.exec(sourceLine);
		const tag = { path, line: Number(lineText), kind, text: rawText.trim() };
		const place = `Tag on ${path}:${tag.line} at ${ref}`;

		if (code.trim() === '') {
			tagErrors.push(`${place} is alone on its line: end the code line `
				+ 'it covers with it.');

			continue;
		}

		if (tag.text === '') {
			tagErrors.push(`${place} gives no reason.`);
			continue;
		}

		if (kind === 'out-of-scope' && !/^#\d+\b/.test(tag.text)) {
			tagErrors.push(`${place} names no issue: `
				+ `${JSON.stringify(tag.text)} does not start with "#<number>".`);

			continue;
		}

		tagsByPath.set(path, [...tagsByPath.get(path) ?? [], tag]);
	}

	return tagsByPath;
}

// What a tag covers in a file's coverage: every statement, function and
// branch starting on its line, each to its end.
function rangesOfTag(tag, fileCoverage) {
	return [
		...Object.values(fileCoverage.statementMap),
		...Object.values(fileCoverage.fnMap).map(({ loc }) => loc),
		...Object.values(fileCoverage.branchMap).map(({ loc }) => loc),
	].filter((range) => range.start.line === tag.line);
}

// Resolves a file's tags against its coverage, then the innermost tag of each
// counter: the covering range starting last.
function tagCounters(tags, fileCoverage, ref) {
	const tagRanges = tags.flatMap((tag) => {
		const ranges = rangesOfTag(tag, fileCoverage);

		if (ranges.length === 0) {
			tagErrors.push(`Tag on ${tag.path}:${tag.line} at ${ref} covers no `
				+ 'statement, function or branch: end the line one starts on.');
		}

		return ranges.map((range) => ({ tag, range }));
	});

	const counters = countersOf(fileCoverage);

	for (const counter of counters) {
		const holding = tagRanges
			.filter(({ range }) => rangeHolds(range, counter.start))
			.sort((left, right) => {
				return comparePositions(right.range.start, left.range.start)
					|| comparePositions(left.range.end, right.range.end);
			});

		counter.tag = holding[0]?.tag;
	}

	return counters;
}

const blackbox = readCoverage(options.blackbox);
const headTags = readTags(options.head);

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

// Every tag is checked, added by this PR or not, so a stale one fails
// whichever PR runs next.
const countersByPath = new Map();

for (const [path, tags] of headTags) {
	const fileCoverage = blackbox.coverageByPath.get(path);

	// A file no server loaded: its unit-only tags are checked on the unit side.
	if (!fileCoverage) {
		continue;
	}

	const counters = tagCounters(tags, fileCoverage, options.head);
	countersByPath.set(path, counters);

	for (const tag of tags) {
		const tagged = counters.filter((counter) => counter.tag === tag);

		if (tagged.length > 0 && tagged.every(({ hits }) => hits > 0)) {
			tagErrors.push(`Blackbox runs all the tag on ${path}:${tag.line} `
				+ `covers: drop the tag.`);
		}
	}
}

const findings = [];

const totals = {
	arm: { added: 0, run: 0 },
	statement: { added: 0, run: 0 },
};

for (const [path, addedLines] of [...addedLinesByPath].sort()) {
	const fileCoverage = blackbox.coverageByPath.get(path);

	// A file no server loaded: every added line is out of the run.
	if (!fileCoverage) {
		const line = Math.min(...addedLines);
		findings.push({ path, line, detail: 'file never loaded' });
		continue;
	}

	const counters = countersByPath.get(path) ?? countersOf(fileCoverage);

	for (const counter of counters) {
		const line = counter.start.line;

		const isAdded = addedLines.has(line)
			|| addedLines.has(counter.branchLine);

		if (!isAdded) {
			continue;
		}

		totals[counter.kind].added++;

		if (counter.hits > 0) {
			totals[counter.kind].run++;
			continue;
		}

		findings.push({ path, line, detail: counter.name, tag: counter.tag });
	}
}

findings.sort((left, right) => {
	return left.path.localeCompare(right.path) || left.line - right.line;
});

// One row per line: two unrun statements on one line say no more than one.
const gapRows = new Map();
const outOfScopeRows = new Map();

for (const finding of findings) {
	// A unit-only counter is reported by the unit check below, not here.
	if (finding.tag?.kind === 'unit-only') {
		continue;
	}

	const rows = finding.tag?.kind === 'out-of-scope'
		? outOfScopeRows
		: gapRows;

	const key = `${finding.path}:${finding.line}`;
	const row = rows.get(key) ?? { ...finding, details: new Set() };
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

function totalRow(label, { added, run }) {
	return `| ${label} | ${run} | ${added} | ${percentOf(run, added)} |`;
}

const report = [
	'## Blackbox branch audit',
	'',
	`Added lines of \`api/src\` between \`${options.base}\` and `
	+ `\`${options.head}\`, ${blackbox.reportCount} blackbox shard report(s).`,
	'',
	'| added | run by blackbox | total | run |',
	'|---|---|---|---|',
	totalRow('branch arms', totals.arm),
	totalRow('statements', totals.statement),
	'',
	`### Not run by blackbox: ${gapRows.size} line(s)`,
	'',
];

if (gapRows.size === 0) {
	report.push('Every added line is run by blackbox or tagged.');
}
else {
	report.push(
		'Each needs a blackbox scenario reaching it. When no request can reach',
		'it, end the line its statement starts on with `// bb-unit-only: <why>`.',
		'',
		'| line | not run | source |',
		'|---|---|---|',
		...[...gapRows.values()].map((row) => rowLine(row, sourceCellOf(row))),
	);
}

const unitFailures = [];

const unitOnlyTags = [...headTags.values()]
	.flat()
	.filter(({ kind }) => kind === 'unit-only');

report.push('', `### Unit-only: ${unitOnlyTags.length} tag(s)`, '');

if (options.unit) {
	const unitHead = options['unit-head'];
	const unit = readCoverage(options.unit);
	const unitRows = [];

	for (const [path, tags] of readTags(unitHead)) {
		const unitOnlyOfFile = tags.filter(({ kind }) => kind === 'unit-only');

		if (unitOnlyOfFile.length === 0) {
			continue;
		}

		const fileCoverage = unit.coverageByPath.get(path);

		const counters = fileCoverage
			? tagCounters(tags, fileCoverage, unitHead)
			: [];

		for (const tag of unitOnlyOfFile) {
			const unrunNames = counters
				.filter((counter) => counter.tag === tag && counter.hits === 0)
				.map(({ name, start }) => `${name} on ${start.line}`);

			let verdict = 'run';

			if (!fileCoverage) {
				verdict = 'no unit coverage of the file';
			}
			else if (unrunNames.length > 0) {
				verdict = `not run: ${[...new Set(unrunNames)].join(', ')}`;
			}

			if (verdict !== 'run') {
				unitFailures.push(`Unit-only tag on ${path}:${tag.line}: ${verdict}`);
			}

			unitRows.push(`| \`${path}:${tag.line}\` | ${verdict} | ${tag.text} |`);
		}
	}

	report.push(
		`Checked against the api unit tests at \`${unitHead}\`.`,
		'',
		'| tag | unit tests | why blackbox cannot reach it |',
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
		...[...outOfScopeRows.values()].map((row) => rowLine(row, row.tag.text)),
	);
}

const FEATURES_PATH = 'api/src/utils/out-of-scope-features.ts';
const FEATURE_ENTRY = /^\t'([a-z0-9-]+)': '(#\d+)',$/;
const driftFailures = [];

// The `'<feature>': '#<issue>',` lines of OUT_OF_SCOPE_FEATURES at --head.
const featureLines = sourceLinesAt(options.head, FEATURES_PATH);

const LIST_OPENING = 'export const OUT_OF_SCOPE_FEATURES';
const listStart = featureLines.findIndex((line) => line.startsWith(LIST_OPENING));

const listEnd = featureLines.indexOf('};', listStart);

const issueByFeature = new Map(featureLines
	.slice(listStart + 1, listEnd)
	.map((line) => FEATURE_ENTRY.exec(line))
	.filter((match) => match !== null)
	.map(([, featureName, issue]) => [featureName, issue]));

if (listStart === -1 || issueByFeature.size !== listEnd - listStart - 1) {
	driftFailures.push(`${FEATURES_PATH} at ${options.head}: no `
		+ 'OUT_OF_SCOPE_FEATURES list of `\'<feature>\': \'#<issue>\',` lines '
		+ 'to check the tags against.');
}

const outOfScopeTags = [...headTags.values()]
	.flat()
	.filter(({ kind }) => kind === 'out-of-scope');

const taggedIssues = new Set(outOfScopeTags
	.map(({ text }) => /^#\d+/.exec(text)[0]));

for (const [featureName, issue] of issueByFeature) {
	if (!taggedIssues.has(issue)) {
		driftFailures.push(`Out-of-scope feature ${JSON.stringify(featureName)} `
			+ `(${issue}): no \`bb-out-of-scope: ${issue}\` tag in api/src.`);
	}
}

for (const tag of outOfScopeTags) {
	const [tagIssue] = /^#\d+/.exec(tag.text);
	const tagWords = tag.text.toLowerCase().split(/[^a-z0-9-]+/);

	for (const [featureName, issue] of issueByFeature) {
		if (tagWords.includes(featureName) && tagIssue !== issue) {
			driftFailures.push(`Tag on ${tag.path}:${tag.line} names `
				+ `${JSON.stringify(featureName)} with ${tagIssue}, `
				+ `but ${FEATURES_PATH} gives it ${issue}.`);
		}
	}
}

report.push(
	'',
	`### Out-of-scope features: ${issueByFeature.size} refused`,
	'',
	'| feature | issue | tagged |',
	'|---|---|---|',
	...[...issueByFeature].map(([featureName, issue]) => {
		const taggedCell = taggedIssues.has(issue)
			? 'yes'
			: 'no';

		return `| ${featureName} | ${issue} | ${taggedCell} |`;
	}),
);

const failures = [...tagErrors, ...unitFailures, ...driftFailures];

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
