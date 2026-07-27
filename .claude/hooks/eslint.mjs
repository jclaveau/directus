#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';

if (/\.(js|mjs|ts|vue)$/.test(file)) {
	// TODO(diff-scope): `--fix` runs whole-file, so a latent base-config fix on
	// upstream lines could drift the diff vs upstream. Investigate scoping fixes
	// to changed lines later (the style gate stays changed-lines-only already).
	spawnSync('pnpm', ['exec', 'eslint', '--fix', file], {
		cwd: process.env.CLAUDE_PROJECT_DIR,
		stdio: 'inherit',
		shell: true,
	});
}
