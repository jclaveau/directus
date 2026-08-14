import { execSync } from 'node:child_process';
import istanbul from 'rolldown-plugin-istanbul';
import { defineConfig } from 'tsdown';

// COVERAGE_DIR builds instrument the server with istanbul so the blackbox suite produces
// integration coverage (dumped on shutdown in server.ts). Off by default → prod ships clean.
const coverage = Boolean(process.env['COVERAGE_DIR']);

// Bake the git commit into the build so CACHE_AUTO_FLUSH_ON_DEPLOY can tell one
// code-only deploy from the next even when directus/version is pinned on the
// fork's version line. Prefer a CI/platform commit, else read it from git; empty
// when neither is available (a tarball build with no .git), where the runtime
// fallback chain in cache-build-identity.ts takes over.
function resolveBuildCommit(): string {
	const provided =
		process.env['SOURCE_COMMIT'] ??
		process.env['RAILWAY_GIT_COMMIT_SHA'] ??
		process.env['GITHUB_SHA'];

	if (provided) {
		return provided;
	}

	try {
		const out = execSync('git rev-parse HEAD', {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});

		return out.trim();
	}
	catch {
		return '';
	}
}

export default defineConfig({
	define: {
		__DIRECTUS_BUILD_COMMIT__: JSON.stringify(resolveBuildCommit()),
	},
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
	// Keep workspace @directus/* deps (and their transitive externals) out of the bundle.
	// rolldown 1.1.3 otherwise follows the workspace:* @directus/types into api/dist and
	// rewrites its `@sinclair/typebox` import to a physical .pnpm store path that isn't
	// shipped, breaking boot. They're separately installed packages — resolve them at runtime.
	//
	// `pg` is resolved at runtime too, the way knex already resolves its drivers
	// by name. Bundling it drags in pg's native client, whose top-level
	// `require('pg-native')` runs on load and kills boot — pg-native is optional
	// and not installed. knex's own require is dynamic, so nothing hit this until
	// the pgbouncer admin console imported pg directly.
	external: [/^@directus\//, /^@sinclair\/typebox/, /^pg(-native)?$/],
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
