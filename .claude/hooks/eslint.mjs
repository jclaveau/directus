#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';
const root = process.env.CLAUDE_PROJECT_DIR;

if (!/\.(js|mjs|ts|vue)$/.test(file)) process.exit(0);

// TODO(diff-scope): `--fix` runs whole-file, so a latent base-config fix on
// upstream lines could drift the diff vs upstream. Investigate scoping fixes
// to changed lines later (the style gate stays changed-lines-only already).
spawnSync('pnpm', ['exec', 'eslint', '--fix', file], {
	cwd: root,
	stdio: 'inherit',
	shell: true,
});

// The base config above does not know the repo's own rules: they live in
// `eslint.style.config.js` and are registered as warnings, so nothing about the
// shape of what was just written ever reached the author. Second pass, report only,
// no `--fix` — neither custom rule has a fixer, and a whole-file fix under the style
// config would reformat untouched upstream lines.
const rel = relative(root, resolve(root, file));

// Lint tooling lints itself into noise; same exemption the changed-line gate takes.
if (rel.startsWith('eslint-rules/') || rel.startsWith('scripts/')
	|| /\.config\.[cm]?[jt]s$/.test(rel)) {
	process.exit(0);
}

function git(args) {
	try {
		// stderr silenced: asking git about an untracked path is a normal answer here,
		// not a failure, and its complaint would land in the report.
		return execFileSync('git', args, {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	} catch {
		return '';
	}
}

// Only the lines this edit added, so an old file's existing hits stay quiet. A file
// git does not know yet has no diff, so every line of it counts as added.
const diff = git(['diff', '--unified=0', 'HEAD', '--', rel]);
const added = new Set();
let newLine = 0;

for (const raw of diff.split('\n')) {
	if (raw.startsWith('@@')) {
		const match = raw.match(/\+(\d+)/);
		newLine = match ? Number(match[1]) : 0;
	} else if (raw.startsWith('+') && !raw.startsWith('+++')) {
		added.add(newLine);
		newLine++;
	}
}

const tracked = git(['ls-files', '--error-unmatch', '--', rel]).trim() !== '';

let report;

try {
	report = execFileSync(
		'pnpm',
		[
			'exec', 'eslint', '--no-config-lookup',
			'--config', 'eslint.style.config.js', '--format', 'json', rel,
		],
		{ cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
	);
} catch (error) {
	report = error.stdout;
}

let parsed;

try {
	parsed = JSON.parse(report);
} catch {
	process.exit(0);
}

const notes = parsed
	.flatMap((result) => result.messages)
	.filter((message) => message.ruleId?.startsWith('local/'))
	.filter((message) => !tracked || added.has(message.line))
	.map((message) => `  ${rel}:${message.line}  ${message.ruleId}: ${message.message}`);

if (notes.length > 0) {
	console.log(`\n${notes.length} line(s) worth a second look (advice, not a gate):`);
	for (const note of notes) console.log(note);
}
