#!/usr/bin/env node
// Diff-aware style gate (`pnpm lint:style:changes`). Runs eslint with `eslint.style.config.js`
// (the single source of truth for what's enforced) and reports every ERROR it emits — but ONLY on
// lines ADDED vs the PR base. eslint is the engine; the diff filter keeps it new-code-only, so a
// touched file's pre-existing hits never pollute the PR. To change what gates, edit the CONFIG —
// turn a rule on/off there, not here. Quality/non-style rules are turned off in the config so they
// don't fire. See feedback_avoid_review_pane_soft_wrap + feedback_adopt_jeans_proven_configs.
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

// Lint/style tooling (eslint config, custom rules, this script's own dir) is exempt from the
// style gate — same policy as the codecov ignore. It's exercised by eslint / the gate, not product
// code, and shouldn't drag a vendored rule file under directus's style conventions.
function isToolingPath(file) {
	return file.startsWith('eslint-rules/') || file.startsWith('scripts/') || /\.config\.[cm]?[jt]s$/.test(file);
}

const files = [...addedByFile.keys()].filter((f) => addedByFile.get(f).size > 0 && !isToolingPath(f));

if (files.length === 0) {
	console.log('✓ no added lines to check');
	process.exit(0);
}

// eslint exits non-zero when it reports anything, so capture stdout from the throw too.
let raw;
try {
	raw = execFileSync(
		'pnpm',
		['exec', 'eslint', '--no-config-lookup', '--config', 'eslint.style.config.js', '--format', 'json', ...files],
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
		if (message.severity === 2 && message.ruleId && added.has(message.line)) {
			violations.push(`${rel}:${message.line}  ${message.ruleId}: ${message.message}`);
		}
	}
}

if (violations.length > 0) {
	console.error(`\n✗ ${violations.length} added line(s) breaking style — verticalize / extract a const / wrap:`);
	for (const entry of violations) console.error(`  ${entry}`);
	process.exit(1);
}

console.log('✓ no added lines breaking style');
