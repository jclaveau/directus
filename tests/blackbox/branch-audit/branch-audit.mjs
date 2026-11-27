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
// from OUT_OF_SCOPE_FEATURE_ISSUES in api/src/utils/out-of-scope-features.ts: a
// feature whose issue no tag names, or a tag naming a feature with another
// issue than the list gives it. Gaps alone never fail it.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
	armStartOf,
	innermostTagAt,
	isInstrumentedSource,
	parseTag,
	repoPathOf,
	resolveTags,
	TAG_SEARCH,
} from './coverage-tags.mjs';

const { values: cliOptions } = parseArgs({
	options: {
		'blackbox': { type: 'string' },
		'base': { type: 'string' },
		'head': { type: 'string' },
		'unit': { type: 'string' },
		'unit-head': { type: 'string' },
		'report': { type: 'string' },
	},
});

if (!cliOptions.blackbox || !cliOptions.base || !cliOptions.head
	|| Boolean(cliOptions.unit) !== Boolean(cliOptions['unit-head'])) {
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

function addCounts(targetHits, sourceHits, coveredPath, counterKind) {
	for (const [id, hits] of Object.entries(sourceHits)) {
		const knownHits = targetHits[id];

		if (knownHits === undefined) {
			throw new Error(
				`Shards disagree on ${counterKind} ${JSON.stringify(id)} `
				+ `of ${JSON.stringify(coveredPath)}: they built different sources.`,
			);
		}

		targetHits[id] = Array.isArray(hits)
			? knownHits.map((count, arm) => count + hits[arm])
			: knownHits + hits;
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

			if (repoPath === null) {
				throw new Error(
					`Coverage file ${JSON.stringify(coveredPath)} is not under api/src.`,
				);
			}

			const knownCoverage = coverageByPath.get(repoPath);

			if (!knownCoverage) {
				coverageByPath.set(repoPath, structuredClone(fileCoverage));
				continue;
			}

			addCounts(knownCoverage.s, fileCoverage.s, coveredPath, 'statement');
			addCounts(knownCoverage.f, fileCoverage.f, coveredPath, 'function');
			addCounts(knownCoverage.b, fileCoverage.b, coveredPath, 'branch');
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
			return branch.locations.map((_location, arm) => {
				return {
					kind: 'arm',
					name: armNameOf(branch.type, arm, branch.locations.length),
					start: armStartOf(branch, arm),
					branchLine: branch.loc.start.line,
					hits: fileCoverage.b[id][arm],
				};
			});
		});

	return [...statementCounters, ...armCounters];
}

const sourceByRef = new Map();

function sourceLinesAt(ref, path) {
	const refPathKey = `${ref}:${path}`;

	if (!sourceByRef.has(refPathKey)) {
		const sourceText = execFileSync('git', ['show', refPathKey], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'ignore'],
		});

		sourceByRef.set(refPathKey, sourceText.split('\n'));
	}

	return sourceByRef.get(refPathKey);
}

const tagErrors = [];

// The tags in api/src at `ref`, keyed by path, each `{ path, line, kind, text }`.
function readTags(ref) {
	let grepText;

	try {
		grepText = execFileSync(
			'git',
			['grep', '-n', '-E', TAG_SEARCH, ref, '--', 'api/src'],
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

		const line = Number(lineText);
		const tagPlace = `Tag on ${path}:${line} at ${ref}`;
		const { tag, error } = parseTag(path, line, sourceLine, tagPlace);

		if (error) {
			tagErrors.push(error);
			continue;
		}

		tagsByPath.set(path, [...tagsByPath.get(path) ?? [], tag]);
	}

	return tagsByPath;
}

// Resolves a file's tags against its coverage, then the innermost tag of each
// counter: the covering range starting last.
function tagCounters(tags, fileCoverage, ref) {
	const { tagRanges, uncoveringTags } = resolveTags(tags, fileCoverage);

	for (const tag of uncoveringTags) {
		tagErrors.push(`Tag on ${tag.path}:${tag.line} at ${ref} covers no `
			+ 'statement, function or branch: end the line one starts on.');
	}

	const fileCounters = countersOf(fileCoverage);

	for (const counter of fileCounters) {
		counter.tag = innermostTagAt(tagRanges, counter.start);
	}

	return fileCounters;
}

const blackboxCoverage = readCoverage(cliOptions.blackbox);
const headTags = readTags(cliOptions.head);

const diffText = execFileSync(
	'git',
	['diff', '--unified=0', '--no-color', '--no-renames']
		.concat([cliOptions.base, cliOptions.head, '--', 'api/src']),
	{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
);

const addedLinesByPath = new Map();
let currentPath = null;

for (const diffLine of diffText.split('\n')) {
	if (diffLine.startsWith('+++ ')) {
		const targetPath = diffLine.slice(4);

		currentPath = targetPath === '/dev/null'
			? null
			: targetPath.replace(/^b\//, '');

		continue;
	}

	const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(diffLine);

	if (!hunkMatch || !currentPath || !isInstrumentedSource(currentPath)) {
		continue;
	}

	const firstLine = Number(hunkMatch[1]);

	const lineCount = hunkMatch[2] === undefined
		? 1
		: Number(hunkMatch[2]);

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
	const fileCoverage = blackboxCoverage.coverageByPath.get(path);

	// A file no server loaded: its unit-only tags are checked on the unit side.
	if (!fileCoverage) {
		continue;
	}

	const fileCounters = tagCounters(tags, fileCoverage, cliOptions.head);
	countersByPath.set(path, fileCounters);

	for (const tag of tags) {
		const taggedCounters = fileCounters
			.filter((counter) => counter.tag === tag);

		if (
			taggedCounters.length > 0
			&& taggedCounters.every(({ hits }) => hits > 0)
		) {
			tagErrors.push(`Blackbox runs all the tag on ${path}:${tag.line} `
				+ `covers: drop the tag.`);
		}
	}
}

const unrunFindings = [];

const counterTotals = {
	arm: { added: 0, run: 0 },
	statement: { added: 0, run: 0 },
};

for (const [path, addedLines] of [...addedLinesByPath].sort()) {
	const fileCoverage = blackboxCoverage.coverageByPath.get(path);

	// A file no server loaded: every added line is out of the run.
	if (!fileCoverage) {
		const line = Math.min(...addedLines);
		unrunFindings.push({ path, line, detail: 'file never loaded' });
		continue;
	}

	const fileCounters = countersByPath.get(path) ?? countersOf(fileCoverage);

	for (const counter of fileCounters) {
		const line = counter.start.line;

		const isAdded = addedLines.has(line)
			|| addedLines.has(counter.branchLine);

		if (!isAdded) {
			continue;
		}

		counterTotals[counter.kind].added++;

		if (counter.hits > 0) {
			counterTotals[counter.kind].run++;
			continue;
		}

		unrunFindings.push({ path, line, detail: counter.name, tag: counter.tag });
	}
}

unrunFindings.sort((left, right) => {
	return left.path.localeCompare(right.path) || left.line - right.line;
});

// One row per line: two unrun statements on one line say no more than one.
const gapRows = new Map();
const outOfScopeRows = new Map();

for (const unrunFinding of unrunFindings) {
	// A unit-only counter is reported by the unit check below, not here.
	if (unrunFinding.tag?.kind === 'unit-only') {
		continue;
	}

	const findingRows = unrunFinding.tag?.kind === 'out-of-scope'
		? outOfScopeRows
		: gapRows;

	const rowKey = `${unrunFinding.path}:${unrunFinding.line}`;

	const findingRow = findingRows.get(rowKey)
		?? { ...unrunFinding, details: new Set() };

	findingRow.details.add(unrunFinding.detail);
	findingRows.set(rowKey, findingRow);
}

function sourceLineOf(path, line) {
	const shownSource = sourceLinesAt(cliOptions.head, path)[line - 1]
		.trim()
		.replaceAll('`', '\'')
		.replaceAll('|', '\\|');

	return shownSource.length > 90
		? `${shownSource.slice(0, 87)}...`
		: shownSource;
}

function percentOf(part, whole) {
	return whole === 0
		? '—'
		: `${((100 * part) / whole).toFixed(1)}%`;
}

function rowLine(findingRow, lastCell) {
	const detailText = [...findingRow.details].join(', ');
	const rowPlace = `${findingRow.path}:${findingRow.line}`;
	return `| \`${rowPlace}\` | ${detailText} | ${lastCell} |`;
}

function sourceCellOf(findingRow) {
	return findingRow.details.has('file never loaded')
		? ''
		: `\`${sourceLineOf(findingRow.path, findingRow.line)}\``;
}

function totalRow(label, { added, run }) {
	return `| ${label} | ${run} | ${added} | ${percentOf(run, added)} |`;
}

const reportLines = [
	'## Blackbox branch audit',
	'',
	`Added lines of \`api/src\` between \`${cliOptions.base}\` and `
	+ `\`${cliOptions.head}\`, ${blackboxCoverage.reportCount} blackbox `
	+ 'shard report(s).',
	'',
	'| added | run by blackbox | total | run |',
	'|---|---|---|---|',
	totalRow('branch arms', counterTotals.arm),
	totalRow('statements', counterTotals.statement),
	'',
	`### Not run by blackbox: ${gapRows.size} line(s)`,
	'',
];

if (gapRows.size === 0) {
	reportLines.push('Every added line is run by blackbox or tagged.');
}
else {
	reportLines.push(
		'Each needs a blackbox scenario reaching it. When no request can reach',
		'it, end the line its statement starts on with `// bb-unit-only: <why>`.',
		'',
		'| line | not run | source |',
		'|---|---|---|',
		...[...gapRows.values()].map((findingRow) => {
			return rowLine(findingRow, sourceCellOf(findingRow));
		}),
	);
}

const unitFailures = [];

const unitOnlyTags = [...headTags.values()]
	.flat()
	.filter(({ kind }) => kind === 'unit-only');

reportLines.push('', `### Unit-only: ${unitOnlyTags.length} tag(s)`, '');

if (cliOptions.unit) {
	const unitHead = cliOptions['unit-head'];
	const unitCoverage = readCoverage(cliOptions.unit);
	const unitRows = [];

	for (const [path, tags] of readTags(unitHead)) {
		const unitOnlyOfFile = tags.filter(({ kind }) => kind === 'unit-only');

		if (unitOnlyOfFile.length === 0) {
			continue;
		}

		const fileCoverage = unitCoverage.coverageByPath.get(path);

		const fileCounters = fileCoverage
			? tagCounters(tags, fileCoverage, unitHead)
			: [];

		for (const tag of unitOnlyOfFile) {
			const unrunNames = fileCounters
				.filter((counter) => counter.tag === tag && counter.hits === 0)
				.map(({ name, start }) => `${name} on ${start.line}`);

			let unitVerdict = 'run';

			if (!fileCoverage) {
				unitVerdict = 'no unit coverage of the file';
			}
			else if (unrunNames.length > 0) {
				unitVerdict = `not run: ${[...new Set(unrunNames)].join(', ')}`;
			}

			if (unitVerdict !== 'run') {
				unitFailures.push(`Unit-only tag on ${path}:${tag.line}: ${unitVerdict}`);
			}

			unitRows.push(`| \`${path}:${tag.line}\` | ${unitVerdict} | ${tag.text} |`);
		}
	}

	reportLines.push(
		`Checked against the api unit tests at \`${unitHead}\`.`,
		'',
		'| tag | unit tests | why blackbox cannot reach it |',
		'|---|---|---|',
		...unitRows,
	);
}
else {
	reportLines.push('Not checked: no unit coverage given.');
}

reportLines.push('', `### Out of scope: ${outOfScopeRows.size} line(s)`, '');

if (outOfScopeRows.size > 0) {
	reportLines.push(
		'| line | not run | issue |',
		'|---|---|---|',
		...[...outOfScopeRows.values()].map((findingRow) => {
			return rowLine(findingRow, findingRow.tag.text);
		}),
	);
}

const FEATURES_PATH = 'api/src/utils/out-of-scope-features.ts';
const FEATURE_ENTRY = /^\t'([a-z0-9-]+)': '(#\d+)',$/;
const driftFailures = [];

// The `'<feature>': '#<issue>',` lines of OUT_OF_SCOPE_FEATURE_ISSUES at --head.
const featureLines = sourceLinesAt(cliOptions.head, FEATURES_PATH);

const LIST_OPENING = 'export const OUT_OF_SCOPE_FEATURE_ISSUES';
const listStart = featureLines.findIndex((line) => line.startsWith(LIST_OPENING));

const listEnd = featureLines.indexOf('};', listStart);

const issueByFeature = new Map(featureLines
	.slice(listStart + 1, listEnd)
	.map((line) => FEATURE_ENTRY.exec(line))
	.filter((match) => match !== null)
	.map(([, featureName, issue]) => [featureName, issue]));

if (listStart === -1 || issueByFeature.size !== listEnd - listStart - 1) {
	driftFailures.push(`${FEATURES_PATH} at ${cliOptions.head}: no `
		+ 'OUT_OF_SCOPE_FEATURE_ISSUES list of `\'<feature>\': \'#<issue>\',` lines '
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

reportLines.push(
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

const auditFailures = [...tagErrors, ...unitFailures, ...driftFailures];

if (auditFailures.length > 0) {
	reportLines.push(
		'',
		'### Failures',
		'',
		...auditFailures.map((failureText) => `- ${failureText}`),
	);
}

const reportText = `${reportLines.join('\n')}\n`;

if (cliOptions.report) {
	writeFileSync(cliOptions.report, reportText);
}

console.log(reportText);

if (auditFailures.length > 0) {
	process.exit(1);
}
