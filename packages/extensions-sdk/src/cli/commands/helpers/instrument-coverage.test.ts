import { runInThisContext } from 'node:vm';
import { afterEach, describe, expect, test } from 'vitest';
import {
	DEFAULT_INSTRUMENTER_CONFIG,
	renderCoverageBanner,
	resolveCoverageTarget,
} from './instrument-coverage.js';

describe('renderCoverageBanner', () => {
	afterEach(() => {
		delete (globalThis as Record<string, unknown>)['__extensionCoverageDirs'];
	});

	test('registers the directory of the build loaded last', () => {
		runInThisContext(renderCoverageBanner({
			sourceRoot: '/repo/ext',
			coverageDir: '/repo/ext/cov-a',
			pluginOptions: {},
		}, ['/repo/ext/src/index.ts']));

		// the same package rebuilt with another dir, reloaded in the same process
		runInThisContext(renderCoverageBanner({
			sourceRoot: '/repo/ext',
			coverageDir: '/repo/ext/cov-b',
			pluginOptions: {},
		}, ['/repo/ext/src/index.ts']));

		expect((globalThis as Record<string, unknown>)['__extensionCoverageDirs'])
			.toEqual([{
				sourceRoot: '/repo/ext',
				coverageDir: '/repo/ext/cov-b',
				sourceFiles: ['/repo/ext/src/index.ts'],
			}]);
	});

	test('adds up the files of every chunk of one build', () => {
		runInThisContext(renderCoverageBanner({
			sourceRoot: '/repo/ext',
			coverageDir: '/repo/ext/cov',
			pluginOptions: {},
		}, ['/repo/shared/date.ts', '/repo/ext/src/index.ts']));

		runInThisContext(renderCoverageBanner({
			sourceRoot: '/repo/ext',
			coverageDir: '/repo/ext/cov',
			pluginOptions: {},
		}, ['/repo/ext/src/index.ts', '/repo/ext/src/routes.ts']));

		expect((globalThis as Record<string, unknown>)['__extensionCoverageDirs'])
			.toEqual([{
				sourceRoot: '/repo/ext',
				coverageDir: '/repo/ext/cov',
				sourceFiles: [
					'/repo/ext/src/index.ts',
					'/repo/shared/date.ts',
					'/repo/ext/src/routes.ts',
				],
			}]);
	});
});

describe('resolveCoverageTarget', () => {
	test.each([
		{ coverageConfig: undefined },
		{ coverageConfig: false },
		{ coverageConfig: { enabled: false, dir: 'coverage/.tmp/backend' } },
	])('builds plain for $coverageConfig', ({ coverageConfig }) => {
		expect(resolveCoverageTarget({
			coverageConfig,
			extensionType: 'endpoint',
			sourceRoot: '/repo/ext',
			nodeEnv: 'test',
		})).toBeUndefined();
	});

	test('instruments the package own sources into coverage/backend for true', () => {
		expect(resolveCoverageTarget({
			coverageConfig: true,
			extensionType: 'endpoint',
			sourceRoot: '/repo/ext',
			nodeEnv: 'test',
		})).toEqual({
			sourceRoot: '/repo/ext',
			coverageDir: '/repo/ext/coverage/backend',
			pluginOptions: {
				include: ['/repo/ext/**/*.{js,mjs,cjs,ts,mts,cts}'],
				exclude: ['/repo/ext/node_modules/**', '**/*.d.ts'],
				instrumenterConfig: DEFAULT_INSTRUMENTER_CONFIG,
			},
		});
	});

	test('escapes the glob characters of the package path', () => {
		expect(resolveCoverageTarget({
			coverageConfig: { include: 'src/**' },
			extensionType: 'endpoint',
			sourceRoot: '/repo/ext (2){a,b}',
			nodeEnv: 'test',
		})).toEqual({
			sourceRoot: '/repo/ext (2){a,b}',
			coverageDir: '/repo/ext (2){a,b}/coverage/backend',
			pluginOptions: {
				include: ['/repo/ext [(]2[)][{]a,b[}]/src/**'],
				exclude: [
					'/repo/ext [(]2[)][{]a,b[}]/node_modules/**',
					'**/*.d.ts',
				],
				instrumenterConfig: DEFAULT_INSTRUMENTER_CONFIG,
			},
		});
	});

	test('escapes the extglob characters of the package path', () => {
		expect(resolveCoverageTarget({
			coverageConfig: { include: 'src/**' },
			extensionType: 'endpoint',
			sourceRoot: '/repo/e*x?t!+@|',
			nodeEnv: 'test',
		})).toEqual({
			sourceRoot: '/repo/e*x?t!+@|',
			coverageDir: '/repo/e*x?t!+@|/coverage/backend',
			pluginOptions: {
				include: ['/repo/e[*]x[?]t[!][+][@][|]/src/**'],
				exclude: [
					'/repo/e[*]x[?]t[!][+][@][|]/node_modules/**',
					'**/*.d.ts',
				],
				instrumenterConfig: DEFAULT_INSTRUMENTER_CONFIG,
			},
		});
	});

	test('passes the plugin options through, anchoring relative globs', () => {
		const customInstrumenter = { createInstrumenter: () => ({}) };

		expect(resolveCoverageTarget({
			coverageConfig: {
				dir: 'coverage/.tmp/backend',
				include: ['src/**', /\.ts$/, '/abs/**'],
				exclude: '**/*.spec.ts',
				instrumenterConfig: { compact: false, parserPlugins: ['jsx'] },
				instrumenter: customInstrumenter,
			},
			extensionType: 'hybrid',
			sourceRoot: '/repo/ext',
			nodeEnv: undefined,
		})).toEqual({
			sourceRoot: '/repo/ext',
			coverageDir: '/repo/ext/coverage/.tmp/backend',
			pluginOptions: {
				include: ['/repo/ext/src/**', /\.ts$/, '/abs/**'],
				exclude: ['**/*.spec.ts'],
				instrumenterConfig: {
					esModules: true,
					compact: false,
					produceSourceMap: true,
					autoWrap: true,
					preserveComments: true,
					parserPlugins: ['jsx'],
				},
				instrumenter: customInstrumenter,
			},
		});
	});

	test('takes the object form without a dir', () => {
		expect(resolveCoverageTarget({
			coverageConfig: { enabled: true },
			extensionType: 'bundle',
			sourceRoot: '/repo/ext',
			nodeEnv: 'test',
		})).toEqual({
			sourceRoot: '/repo/ext',
			coverageDir: '/repo/ext/coverage/backend',
			pluginOptions: {
				include: ['/repo/ext/**/*.{js,mjs,cjs,ts,mts,cts}'],
				exclude: ['/repo/ext/node_modules/**', '**/*.d.ts'],
				instrumenterConfig: DEFAULT_INSTRUMENTER_CONFIG,
			},
		});
	});

	test('refuses coverage on an app-only extension', () => {
		expect(() => {
			return resolveCoverageTarget({
				coverageConfig: true,
				extensionType: 'interface',
				sourceRoot: '/repo/ext',
				nodeEnv: 'test',
			});
		}).toThrow(new Error(
			'coverage is only read for an api, hybrid or bundle extension, not for '
				+ 'an extension of type "interface".',
		));
	});

	test('refuses coverage when NODE_ENV is production', () => {
		expect(() => {
			return resolveCoverageTarget({
				coverageConfig: { dir: 'cov' },
				extensionType: 'endpoint',
				sourceRoot: '/repo/ext',
				nodeEnv: 'production',
			});
		}).toThrow(new Error(
			'Coverage instrumentation is forbidden when NODE_ENV is production.',
		));
	});

	test('refuses a coverage variable the server does not read', () => {
		expect(() => {
			return resolveCoverageTarget({
				coverageConfig: { instrumenterConfig: { coverageVariable: '__cov' } },
				extensionType: 'endpoint',
				sourceRoot: '/repo/ext',
				nodeEnv: 'test',
			});
		}).toThrow(new Error(
			'coverage.instrumenterConfig.coverageVariable must be "__coverage__", '
				+ 'the global the server dumps, not "__cov".',
		));
	});

	test('refuses a coverage global scope the server does not read', () => {
		expect(() => {
			return resolveCoverageTarget({
				coverageConfig: { instrumenterConfig: { coverageGlobalScope: 'process' } },
				extensionType: 'endpoint',
				sourceRoot: '/repo/ext',
				nodeEnv: 'test',
			});
		}).toThrow(new Error(
			'coverage.instrumenterConfig.coverageGlobalScope must be "this", the '
				+ 'global object the server dumps from, not "process".',
		));
	});

	test('refuses a coverage global scope read as a bare this', () => {
		expect(() => {
			return resolveCoverageTarget({
				coverageConfig: {
					instrumenterConfig: { coverageGlobalScopeFunc: false },
				},
				extensionType: 'endpoint',
				sourceRoot: '/repo/ext',
				nodeEnv: 'test',
			});
		}).toThrow(new Error(
			'coverage.instrumenterConfig.coverageGlobalScopeFunc must be true: an '
				+ 'ES module has no top-level this to hold the coverage.',
		));
	});

	test('refuses an empty coverage dir', () => {
		expect(() => {
			return resolveCoverageTarget({
				coverageConfig: { dir: '' },
				extensionType: 'endpoint',
				sourceRoot: '/repo/ext',
				nodeEnv: 'test',
			});
		}).toThrow(new Error(
			'coverage.dir must name a directory, not "".',
		));
	});

	test.each([
		{
			coverageConfig: { include: 5 },
			refusal: 'coverage.include must be a glob, a regular expression, an '
				+ 'array of them or null, not 5.',
		},
		{
			coverageConfig: { exclude: ['src/**', {}] },
			refusal: 'coverage.exclude must be a glob, a regular expression, an '
				+ 'array of them or null, not ["src/**",{}].',
		},
	])('refuses the filter of $coverageConfig', ({ coverageConfig, refusal }) => {
		expect(() => {
			return resolveCoverageTarget({
				coverageConfig: coverageConfig as never,
				extensionType: 'endpoint',
				sourceRoot: '/repo/ext',
				nodeEnv: 'test',
			});
		}).toThrow(new Error(refusal));
	});

	test.each([
		{ coverageConfig: 'coverage/backend', shown: '"coverage/backend"' },
		{ coverageConfig: ['coverage/backend'], shown: '["coverage/backend"]' },
		{ coverageConfig: { enabled: 'false' }, shown: '{"enabled":"false"}' },
		{ coverageConfig: { dir: 5 }, shown: '{"dir":5}' },
	])('refuses the coverage $shown', ({ coverageConfig, shown }) => {
		expect(() => {
			return resolveCoverageTarget({
				coverageConfig: coverageConfig as never,
				extensionType: 'endpoint',
				sourceRoot: '/repo/ext',
				nodeEnv: 'test',
			});
		}).toThrow(new Error(
			'coverage in extension.config.js must be true, false or an object of '
				+ 'rolldown-plugin-istanbul options with an optional enabled and dir, '
				+ `not ${shown}.`,
		));
	});
});
