import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const manifest = JSON.parse(
	readFileSync(new URL('package.json', import.meta.url), 'utf8'),
) as {
	scripts: Record<string, string>;
};

// tsdown cleans its out dir recursively, so a script given `dist` itself wipes
// the sibling entrypoints already built into dist/shared, dist/node,
// dist/browser and dist/values.
test('the build scripts writing into dist itself keep their siblings', () => {
	expect(manifest.scripts['build:array-helpers']).toBe(
		'tsdown shared/array-helpers.ts '
		+ '--tsconfig shared/tsconfig.json '
		+ '--out-dir dist --dts --no-clean',
	);

	expect(manifest.scripts['build:pluralize']).toBe(
		'tsdown shared/pluralize.ts '
		+ '--tsconfig shared/tsconfig.json '
		+ '--out-dir dist --dts --no-clean',
	);
});
