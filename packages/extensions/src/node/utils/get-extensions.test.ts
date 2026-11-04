import { describe, expect, test } from 'vitest';
import { getExtensionDefinition } from './get-extensions.js';

describe('getExtensionDefinition', () => {
	test('marks a bundle without entries as declaring them in code', () => {
		expect(
			getExtensionDefinition(
				{
					name: '@consumer/domain',
					version: '1.0.0',
					'directus:extension': {
						type: 'bundle',
						host: '^11.0.0',
						path: { app: 'dist/app.js', api: 'dist/api.js' },
					},
				},
				{ path: '/extensions/domain', local: true },
			),
		).toEqual({
			path: '/extensions/domain',
			name: '@consumer/domain',
			version: '1.0.0',
			partial: undefined,
			type: 'bundle',
			entrypoint: { app: 'dist/app.js', api: 'dist/api.js' },
			entries: [],
			entriesFrom: 'code',
			host: '^11.0.0',
			local: true,
		});
	});

	test('keeps the entries a manifest declares', () => {
		expect(
			getExtensionDefinition(
				{
					name: '@consumer/domain',
					version: '1.0.0',
					'directus:extension': {
						type: 'bundle',
						host: '^11.0.0',
						path: { app: 'dist/app.js', api: 'dist/api.js' },
						entries: [{ type: 'hook', name: 'audit', source: 'src/audit.ts' }],
					},
				},
				{ path: '/extensions/domain', local: true },
			),
		).toEqual({
			path: '/extensions/domain',
			name: '@consumer/domain',
			version: '1.0.0',
			partial: undefined,
			type: 'bundle',
			entrypoint: { app: 'dist/app.js', api: 'dist/api.js' },
			entries: [{ type: 'hook', name: 'audit' }],
			host: '^11.0.0',
			local: true,
		});
	});
});
