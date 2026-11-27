// How a `// bb-unit-only:` or `// bb-out-of-scope:` tag reads, and which
// coverage counters it covers. Shared by branch-audit.mjs, which checks the
// tags against blackbox, and strip-out-of-scope.mjs, which drops the
// out-of-scope counters from the coverage sent to codecov.

export const TAG_SEARCH = '// bb-(unit-only|out-of-scope):';

const TAG_PATTERN = /^(.*?)\/\/ bb-(unit-only|out-of-scope):(.*)$/;

// istanbul keys a file by the path the build saw: absolute on a runner,
// `src/…` when relative to api/. Both name the same repo file. Null when the
// file is not under api/src.
export function repoPathOf(coveredPath) {
	const apiIndex = coveredPath.lastIndexOf('/api/src/');

	if (apiIndex !== -1) {
		return coveredPath.slice(apiIndex + 1);
	}

	if (coveredPath.startsWith('src/')) {
		return `api/${coveredPath}`;
	}

	return null;
}

// Test files and test helpers are never instrumented (api/tsdown.config.ts).
export function isInstrumentedSource(path) {
	return /^api\/src\/.*\.ts$/.test(path)
		&& !/\.test(-d)?\.ts$/.test(path)
		&& !/^api\/src\/(__[^/]*|test-utils)\//.test(path);
}

// The tag ending `sourceLine`, line `line` of `path`: `{ tag }`, `{ error }`
// when it is malformed, or null when the line carries none. `tagPlace` names it
// in the error.
export function parseTag(path, line, sourceLine, tagPlace) {
	const tagMatch = TAG_PATTERN.exec(sourceLine);

	if (!tagMatch) {
		return null;
	}

	const [, codeText, tagKind, rawText] = tagMatch;
	const tag = { path, line, kind: tagKind, text: rawText.trim() };

	if (codeText.trim() === '') {
		return {
			error: `${tagPlace} is alone on its line: end the code line `
				+ 'it covers with it.',
		};
	}

	if (tag.text === '') {
		return { error: `${tagPlace} gives no reason.` };
	}

	if (tagKind === 'out-of-scope' && !/^#\d+\b/.test(tag.text)) {
		return {
			error: `${tagPlace} names no issue: `
				+ `${JSON.stringify(tag.text)} does not start with "#<number>".`,
		};
	}

	return { tag };
}

// The v8 unit coverage ends a range at `column: null`: the end of its line.
function columnOf(position) {
	return position.column ?? Number.POSITIVE_INFINITY;
}

export function comparePositions(left, right) {
	if (left.line !== right.line) {
		return left.line - right.line;
	}

	const leftColumn = columnOf(left);
	const rightColumn = columnOf(right);

	if (leftColumn === rightColumn) {
		return 0;
	}

	return leftColumn < rightColumn
		? -1
		: 1;
}

export function rangeHolds(range, position) {
	return comparePositions(range.start, position) <= 0
		&& comparePositions(position, range.end) <= 0;
}

// What a tag covers in a file's coverage: every statement, function and
// branch starting on its line, each to its end.
export function rangesOfTag(tag, fileCoverage) {
	return [
		...Object.values(fileCoverage.statementMap),
		...Object.values(fileCoverage.fnMap).map(({ loc }) => loc),
		...Object.values(fileCoverage.branchMap).map(({ loc }) => loc),
	].filter((range) => range.start.line === tag.line);
}

// Resolves the tags of a file against its coverage. Returns the tag ranges,
// and the tags covering nothing.
export function resolveTags(tags, fileCoverage) {
	const uncoveringTags = [];

	const tagRanges = tags.flatMap((tag) => {
		const coveredRanges = rangesOfTag(tag, fileCoverage);

		if (coveredRanges.length === 0) {
			uncoveringTags.push(tag);
		}

		return coveredRanges.map((range) => ({ tag, range }));
	});

	return { tagRanges, uncoveringTags };
}

// The innermost tag holding `position`: the covering range starting last.
export function innermostTagAt(tagRanges, position) {
	const holdingRanges = tagRanges
		.filter(({ range }) => rangeHolds(range, position))
		.sort((left, right) => {
			return comparePositions(right.range.start, left.range.start)
				|| comparePositions(left.range.end, right.range.end);
		});

	return holdingRanges[0]?.tag;
}

// Where a branch arm starts: an arm with no location of its own starts where
// its branch does.
export function armStartOf(branch, arm) {
	const armLocation = branch.locations[arm];

	return armLocation?.start?.line === undefined
		? branch.loc.start
		: armLocation.start;
}
