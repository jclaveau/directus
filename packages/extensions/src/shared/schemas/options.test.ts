import { describe, expect, test } from 'vitest';
import { ExtensionOptions } from './options.js';

describe('ExtensionOptions coverage', () => {
	test('refuses a coverage directory on an app-only extension', () => {
		expect(ExtensionOptions.safeParse({
			type: 'interface',
			path: 'dist/index.js',
			source: 'src/index.ts',
			host: '^11.0.0',
			coverage: 'coverage',
		}).error?.issues).toEqual([
			{
				code: 'custom',
				path: ['coverage'],
				message: 'coverage is only read for an api, hybrid or bundle '
					+ 'extension, not for an extension of type "interface".',
			},
		]);
	});

	test('takes a coverage directory on an api extension', () => {
		expect(ExtensionOptions.safeParse({
			type: 'hook',
			path: 'dist/index.js',
			source: 'src/index.ts',
			host: '^11.0.0',
			coverage: 'coverage',
		}).success).toBe(true);
	});
});
