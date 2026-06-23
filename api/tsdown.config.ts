import istanbul from 'rolldown-plugin-istanbul';
import { defineConfig } from 'tsdown';

// COVERAGE_DIR builds instrument the server with istanbul so the blackbox suite produces
// integration coverage (dumped on shutdown in server.ts). Off by default → prod ships clean.
const coverage = Boolean(process.env['COVERAGE_DIR']);

export default defineConfig({
	entry: [
		'src/**/*.ts',
		'!src/**/*.d.ts',
		'!src/**/*.test.ts',
		'!src/__utils__',
		'!src/__setup__',
		'!src/test-utils',
		'!src/database/run-ast/lib/apply-query/mock.ts',
	],
	unbundle: true,
	tsconfig: 'tsconfig.prod.json',
	plugins: coverage
		? [
				istanbul({
					include: ['src/**/*.ts'],
					exclude: ['**/*.test.ts', '**/*.test-d.ts', 'src/__*/**', 'src/test-utils/**'],
					// istanbul-lib-instrument runs @babel/parser, whose default plugins are JS-only; the api
					// is TypeScript, so without the `typescript` plugin it dies on the first type annotation.
					instrumenterConfig: {
						parserPlugins: [
							'asyncGenerators',
							'bigInt',
							'classProperties',
							'classPrivateProperties',
							'classPrivateMethods',
							'dynamicImport',
							'importMeta',
							'numericSeparator',
							'objectRestSpread',
							'optionalCatchBinding',
							'topLevelAwait',
							'typescript',
						],
					},
				}),
			]
		: [],
});
