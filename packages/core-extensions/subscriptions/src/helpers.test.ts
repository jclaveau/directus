import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

describe('helpers entry', () => {
	test('is what "@scalabus/subscriptions/helpers" resolves to', async () => {
		const packageJson = JSON.parse(await readFile(
			new URL('../package.json', import.meta.url),
			'utf8',
		));

		expect(packageJson.exports).toEqual({
			'./helpers': {
				types: './dist/helpers.d.ts',
				default: './dist/helpers.js',
			},
			'./package.json': './package.json',
		});
	});

	test('exports the member and pending subscription writes', async () => {
		expect(Object.keys(await import('./helpers.js'))).toEqual([
			'addBeneficiary',
			'addManager',
			'createPendingSubscription',
		]);
	});
});
