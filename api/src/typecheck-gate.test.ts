import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
* Every workspace package, from the layout `pnpm-workspace.yaml` declares — read
* rather than listed, so a package added later is covered without being named.
*/
function workspacePackages(): string[] {
	const roots = ['api', 'app', 'sdk', 'directus'];

	for (const group of ['packages', 'tests']) {
		const entries = readdirSync(join(repoRoot, group), { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isDirectory()) {
				roots.push(join(group, entry.name));
			}
		}
	}

	return roots;
}

function typeTestsUnder(pkg: string): string[] {
	const found: string[] = [];

	for (const dir of ['src', 'tests']) {
		let entries: string[];

		try {
			entries = readdirSync(join(repoRoot, pkg, dir), {
				recursive: true,
			}) as string[];
		}
		catch {
			// The package keeps its sources somewhere else, or has none.
			continue;
		}

		for (const entry of entries) {
			if (entry.endsWith('.test-d.ts')) {
				found.push(join(dir, entry));
			}
		}
	}

	return found;
}

/**
* `typecheck.enabled` runs tsc over whatever the type tests reach — and over
* nothing at all in a package that has none. vitest does not call that a failure:
* it prints `Type Errors no errors` and exits 0. So deleting the last
* `*.test-d.ts` in a package silently takes that package's type gate with it,
* while CI stays green.
*
* Measured on `packages/errors`, same deliberate error in `src/index.ts` both
* ways: the suite exits 1 with a type test present, 0 with none collected.
* Nothing in a `*.test-d.ts` file says it is load-bearing, so this says it.
*/
describe('the vitest typecheck gate', () => {
	const gated = workspacePackages().filter((pkg) => {
		try {
			const path = join(repoRoot, pkg, 'vitest.config.ts');
			return /typecheck/.test(readFileSync(path, 'utf8'));
		}
		catch {
			return false;
		}
	});

	it('is enabled somewhere, so the cases below are not vacuous', () => {
		expect(gated).not.toEqual([]);
	});

	it.each(gated)('has a type test for tsc to run in %s', (pkg) => {
		expect(typeTestsUnder(pkg)).not.toEqual([]);
	});
});
