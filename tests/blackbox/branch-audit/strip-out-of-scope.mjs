/* eslint-disable no-console */
// Drops from a coverage report every counter a `// bb-out-of-scope:` tag
// covers, so codecov counts none of the lines of a feature this build refuses.
//
//   node tests/blackbox/branch-audit/strip-out-of-scope.mjs
//     --coverage <coverage-final.json> --root <repo root> --out <dir>
//
// Writes <dir>/coverage-final.json and <dir>/lcov.info. The input report is
// left as it is: branch-audit.mjs reads the raw one, to check blackbox never
// runs what a tag covers.
//
// A counter goes when its innermost tag is out-of-scope, as branch-audit.mjs
// resolves it: a function or statement by where it starts, a branch arm by
// where the arm starts, a branch with it once no arm is left. A
// `// bb-unit-only:` tag keeps its counters: the unit report codecov merges
// runs them.
//
// Exits 1 when a source file of the report is missing under --root, a tag is
// malformed, or a tag covers nothing.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

import {
	armStartOf,
	innermostTagAt,
	isInstrumentedSource,
	parseTag,
	repoPathOf,
	resolveTags,
} from './coverage-tags.mjs';

// istanbul-lib-* are CommonJS; named ESM imports fail under Node, so
// destructure the default.
const { createCoverageMap } = libCoverage;
const { createContext } = libReport;

const { values: options } = parseArgs({
	options: {
		coverage: { type: 'string' },
		root: { type: 'string' },
		out: { type: 'string' },
	},
});

if (!options.coverage || !options.root || !options.out) {
	console.error('usage: strip-out-of-scope.mjs --coverage '
		+ '<coverage-final.json> --root <repo root> --out <dir>');

	process.exit(2);
}

const failures = [];

function readSourceLines(repoPath) {
	try {
		return readFileSync(join(options.root, repoPath), 'utf8').split('\n');
	}
	catch (error) {
		failures.push(`Source ${JSON.stringify(repoPath)} of the coverage `
			+ `report is unreadable under ${JSON.stringify(options.root)}: `
			+ `${error.message}`);

		return null;
	}
}

function readTagsOf(repoPath, sourceLines) {
	const tags = [];

	for (const [index, sourceLine] of sourceLines.entries()) {
		const line = index + 1;
		const place = `Tag on ${repoPath}:${line}`;
		const parsed = parseTag(repoPath, line, sourceLine, place);

		if (parsed === null) {
			continue;
		}

		if (parsed.error) {
			failures.push(parsed.error);
			continue;
		}

		tags.push(parsed.tag);
	}

	return tags;
}

function keepEntries(map, isKept) {
	return Object.fromEntries(Object.entries(map).filter(([id]) => isKept(id)));
}

// The counts of a file, less the counters an out-of-scope tag covers.
function stripFile(fileCoverage, tags) {
	const { tagRanges, uncovering } = resolveTags(tags, fileCoverage);

	for (const tag of uncovering) {
		failures.push(`Tag on ${tag.path}:${tag.line} covers no statement, `
			+ 'function or branch: end the line one starts on.');
	}

	const isOutOfScope = (position) => {
		return innermostTagAt(tagRanges, position)?.kind === 'out-of-scope';
	};

	const keptStatement = (id) => {
		return !isOutOfScope(fileCoverage.statementMap[id].start);
	};

	const keptFunction = (id) => {
		return !isOutOfScope(fileCoverage.fnMap[id].loc.start);
	};

	const branchMap = {};
	const branchHits = {};

	for (const [id, branch] of Object.entries(fileCoverage.branchMap)) {
		const keptArms = branch.locations
			.map((_location, arm) => arm)
			.filter((arm) => !isOutOfScope(armStartOf(branch, arm)));

		if (keptArms.length === 0) {
			continue;
		}

		branchMap[id] = {
			...branch,
			locations: keptArms.map((arm) => branch.locations[arm]),
		};

		branchHits[id] = keptArms.map((arm) => fileCoverage.b[id][arm]);
	}

	return {
		...fileCoverage,
		statementMap: keepEntries(fileCoverage.statementMap, keptStatement),
		s: keepEntries(fileCoverage.s, keptStatement),
		fnMap: keepEntries(fileCoverage.fnMap, keptFunction),
		f: keepEntries(fileCoverage.f, keptFunction),
		branchMap,
		b: branchHits,
	};
}

const reportCoverage = JSON.parse(readFileSync(options.coverage, 'utf8'));
const strippedCoverage = {};
let strippedFiles = 0;

for (const [coveredPath, fileCoverage] of Object.entries(reportCoverage)) {
	const repoPath = repoPathOf(coveredPath);

	// Tags live in the instrumented api sources only.
	if (repoPath === null || !isInstrumentedSource(repoPath)) {
		strippedCoverage[coveredPath] = fileCoverage;
		continue;
	}

	const sourceLines = readSourceLines(repoPath);

	if (sourceLines === null) {
		continue;
	}

	const fileTags = readTagsOf(repoPath, sourceLines);

	if (!fileTags.some(({ kind }) => kind === 'out-of-scope')) {
		strippedCoverage[coveredPath] = fileCoverage;
		continue;
	}

	strippedCoverage[coveredPath] = stripFile(fileCoverage, fileTags);
	strippedFiles++;
}

if (failures.length > 0) {
	console.error(failures.join('\n'));
	process.exit(1);
}

mkdirSync(options.out, { recursive: true });

const context = createContext({
	dir: options.out,
	coverageMap: createCoverageMap(strippedCoverage),
});

reports.create('json', { file: 'coverage-final.json' }).execute(context);
reports.create('lcovonly', { file: 'lcov.info' }).execute(context);

console.log(`stripped the out-of-scope counters of ${strippedFiles} file(s) `
	+ `→ ${join(options.out, 'coverage-final.json')}, lcov.info`);
