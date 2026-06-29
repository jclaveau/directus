#!/usr/bin/env node
// Diff-aware style gate (`pnpm lint:style:changes`). Runs eslint's `max-len` — tuned the
// way jean's planner config tunes it (strings/templates/urls/regex/trailing-comments
// ignored, comments allowed to 110) — but reports ONLY violations on lines ADDED vs the PR
// base. eslint is the engine (correct string/comment handling); the diff filter keeps it
// new-code-only, so a touched file's pre-existing long lines (e.g. items.ts has 63) never
// pollute the PR. See feedback_avoid_review_pane_soft_wrap.
//
// Usage: node scripts/lint-style-changes.mjs <baseRef>
//   baseRef defaults to $LINEWIDTH_BASE; diffs merge-base(baseRef, HEAD) vs the working tree.

import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

const base = process.argv[2] || process.env['LINEWIDTH_BASE'];

if (!base) {
	console.log('lint:style:changes: no base ref, skipping');
	process.exit(0);
}

// `code: 120` defers code lines to prettier (which already caps at printWidth 120) — so this
// gate enforces only what prettier WON'T: comment width. Flip `code` to 90 once the repo
// switches to eslint-driven formatting (layout rules can then auto-wrap code to fit).
const MAX_LEN = {
	code: 120,
	tabWidth: 2,
	comments: 110,
	ignoreUrls: true,
	ignoreTrailingComments: true,
	ignoreRegExpLiterals: true,
	ignoreStrings: true,
	ignoreTemplateLiterals: true,
};

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

let mergeBase;
try {
	mergeBase = git(['merge-base', base, 'HEAD']).trim();
} catch {
	mergeBase = base;
}

// Map each changed lintable file to the set of line numbers it ADDS (the `+` side, vs the
// working tree so a local run sees uncommitted edits; in CI the tree equals HEAD).
const diff = git(['diff', '--unified=0', mergeBase, '--', '*.ts', '*.tsx', '*.vue', '*.js', '*.mjs']);
const addedByFile = new Map();

let file = null;
let newLine = 0;

for (const raw of diff.split('\n')) {
	if (raw.startsWith('+++ ')) {
		file = raw.slice(4).replace(/^b\//, '');
		if (file !== '/dev/null' && !addedByFile.has(file)) addedByFile.set(file, new Set());
		continue;
	}

	if (raw.startsWith('@@')) {
		const match = raw.match(/\+(\d+)/);
		newLine = match ? Number(match[1]) : 0;
		continue;
	}

	if (raw.startsWith('+') && !raw.startsWith('+++')) {
		addedByFile.get(file)?.add(newLine);
		newLine++;
	}
}

const files = [...addedByFile.keys()].filter((f) => addedByFile.get(f).size > 0);

if (files.length === 0) {
	console.log('✓ no added lines to check');
	process.exit(0);
}

// eslint exits non-zero when it reports anything, so capture stdout from the throw too.
let raw;
try {
	raw = execFileSync(
		'pnpm',
		['exec', 'eslint', '--rule', `{"max-len": ["error", ${JSON.stringify(MAX_LEN)}]}`, '--format', 'json', ...files],
		{ encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
	);
} catch (error) {
	raw = error.stdout;
}

const violations = [];

for (const result of JSON.parse(raw)) {
	const rel = relative(process.cwd(), result.filePath);
	const added = addedByFile.get(rel);
	if (!added) continue;

	for (const message of result.messages) {
		if (message.ruleId === 'max-len' && added.has(message.line)) {
			violations.push(`${rel}:${message.line}  ${message.message}`);
		}
	}
}

if (violations.length > 0) {
	console.error(`\n✗ ${violations.length} added line(s) over max-len — extract a const / verticalize:`);
	for (const entry of violations) console.error('  ' + entry);
	process.exit(1);
}

console.log('✓ no added lines over max-len');
