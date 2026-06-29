#!/usr/bin/env node
// Diff-aware line-width gate: checks only lines ADDED vs the PR base, never pre-existing
// ones. Comments are hard-capped (prettier never reflows them, so a wrap always sticks);
// code is soft-warned only (prettier owns it at printWidth 120 and re-collapses shorter
// breaks, so a hard cap there would be unfixable). See feedback_avoid_review_pane_soft_wrap.
//
// Usage: node scripts/check-line-width.mjs <baseRef>
//   baseRef defaults to $LINEWIDTH_BASE. The script diffs <merge-base(baseRef, HEAD)>...HEAD.

import { execFileSync } from 'node:child_process';

const LIMIT = 90;
const base = process.argv[2] || process.env['LINEWIDTH_BASE'];

if (!base) {
	// No base to diff against (e.g. a push build) — nothing to gate, pass.
	console.log('check-line-width: no base ref, skipping');
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

// Diff the merge-base against the WORKING TREE (not `...HEAD`), so a local run catches
// uncommitted edits too; in CI's clean checkout the working tree equals HEAD.
const diff = git(['diff', '--unified=0', mergeBase, '--', '*.ts', '*.tsx', '*.vue', '*.js', '*.mjs']);

const commentViolations = [];
const codeViolations = [];

let file = null;
let newLine = 0;

for (const raw of diff.split('\n')) {
	if (raw.startsWith('+++ ')) {
		file = raw.slice(4).replace(/^b\//, '');
		continue;
	}

	if (raw.startsWith('@@')) {
		const match = raw.match(/\+(\d+)/);
		newLine = match ? Number(match[1]) : 0;
		continue;
	}

	if (raw.startsWith('+') && !raw.startsWith('+++')) {
		const line = raw.slice(1);

		// A URL can't be wrapped — never flag a line carrying one.
		if (line.length > LIMIT && !/https?:\/\//.test(line)) {
			const trimmed = line.trimStart();
			const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
			const entry = `${file}:${newLine} (${line.length}) ${line.trim()}`;
			(isComment ? commentViolations : codeViolations).push(entry);
		}

		newLine++;
	}
}

if (codeViolations.length > 0) {
	console.log(
		`\n⚠ ${codeViolations.length} added code line(s) > ${LIMIT} (prettier owns these at 120 — verticalize/shorten where you can):`,
	);
	for (const entry of codeViolations) console.log('  ' + entry);
}

if (commentViolations.length > 0) {
	console.error(`\n✗ ${commentViolations.length} added comment line(s) > ${LIMIT} — wrap them (prettier won't):`);
	for (const entry of commentViolations) console.error('  ' + entry);
	process.exit(1);
}

console.log(`✓ no added comment lines > ${LIMIT}`);
