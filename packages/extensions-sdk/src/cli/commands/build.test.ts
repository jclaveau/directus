import fse from 'fs-extra';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { create } from '../index.js';
import build, { APP_ONLY_PACKAGES } from './build.js';

// directus-extension.test.ts already builds extensions end-to-end, but it shells out
// (`execa node ../cli.js build`), so build.ts runs in a child process and is invisible
// to coverage. These call build() in-process — same rolldown paths, but instrumented —
// to pin the rollup→rolldown migration (app/api/hybrid each exercise getRollupOptions'
// platform branch + the buildExtension/buildHybridExtension dispatch).

const TEST_PREFIX = 'temp-build-inproc';
const origCwd = process.cwd();

afterEach(() => {
	process.chdir(origCwd);
});

afterAll(async () => {
	const artifacts = (await fse.readdir(origCwd)).filter((file) => file.startsWith(TEST_PREFIX));

	for (const artifact of artifacts) {
		await fse.remove(resolve(origCwd, artifact));
	}
});

describe('build', () => {
	test.each([
		{ type: 'interface', dist: ['index.js'] }, // app extension → browser platform
		{ type: 'endpoint', dist: ['index.js'] }, // api extension → node platform
		{ type: 'operation', dist: ['app.js', 'api.js'] }, // hybrid extension → both
	])(
		'builds a $type extension to dist',
		async ({ type, dist }) => {
			const extensionPath = `${TEST_PREFIX}-${type}-${Date.now()}`;

			await create(type, extensionPath, { language: 'typescript' });

			process.chdir(resolve(origCwd, extensionPath));

			try {
				await build({});
			} finally {
				process.chdir(origCwd);
			}

			for (const file of dist) {
				expect(fse.pathExistsSync(resolve(origCwd, extensionPath, 'dist', file))).toBe(true);
			}
		},
		30_000,
	);

	/** Scaffolds an endpoint extension, builds it, and returns its dist directory. */
	async function buildEndpoint(
		source: string | null,
		options: Parameters<typeof build>[0] = {},
	) {
		const random = Math.random().toString(36);
		const extensionPath = `${TEST_PREFIX}-endpoint-${Date.now()}-${random.slice(2)}`;

		// Installing would fetch the published sdk from the registry and bundle that
		// instead of this working copy, so the scaffold is pointed at the workspace.
		await create('endpoint', extensionPath, {
			language: 'typescript',
			install: false,
		});

		await fse.ensureSymlink(
			origCwd,
			resolve(origCwd, extensionPath, 'node_modules', '@directus', 'extensions-sdk'),
			'dir',
		);

		if (source !== null) {
			const entrypoint = resolve(origCwd, extensionPath, 'src', 'index.ts');

			await fse.writeFile(entrypoint, source);
		}

		process.chdir(resolve(origCwd, extensionPath));

		try {
			await build(options);
		}
		finally {
			process.chdir(origCwd);
		}

		return resolve(origCwd, extensionPath, 'dist');
	}

	test(
		'carries the define helper without the schemas that share its package',
		async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const dist = await buildEndpoint(null);
			const bundle = await fse.readFile(resolve(dist, 'index.js'), 'utf8');

			// nothing about a plain endpoint is worth a warning
			expect(warn).not.toHaveBeenCalled();

			warn.mockRestore();

			// an unbuilt workspace leaves the import unresolved, and a bundle that never
			// carried the helper trivially passes the two assertions below
			expect(bundle).not.toContain('@directus/extensions-sdk');

			// defineEndpoint is an identity function. It used to arrive with every
			// zod-backed manifest schema attached — 125 KB — because the two were
			// emitted into one module that declared no sideEffects.
			expect(bundle).not.toContain('ZodError');
			expect(bundle.length).toBeLessThan(5_000);
		},
		30_000,
	);

	test(
		'carries a type package value without the schemas that share it',
		async () => {
			// DatabaseClients is a string array. websockets.js sits in the same package
			// and pulls zod, which used to arrive alongside it — 264 KB.
			const dist = await buildEndpoint(
				[
					"import { DatabaseClients } from '@directus/types';",
					'',
					'export default () => DatabaseClients.length;',
					'',
				].join('\n'),
			);

			const bundle = await fse.readFile(resolve(dist, 'index.js'), 'utf8');

			expect(bundle).not.toContain('@directus/types');

			expect(bundle).not.toContain('ZodError');
			expect(bundle.length).toBeLessThan(5_000);
		},
		30_000,
	);

	test(
		'leaves an external dependency to be resolved at runtime',
		async () => {
			const source = [
				"import fse from 'fs-extra';",
				'',
				"export default () => fse.pathExistsSync('.');",
				'',
			].join('\n');

			const bundledDist = await buildEndpoint(source);
			const externalizedDist = await buildEndpoint(source, { external: 'fs-extra' });

			const bundled = await fse.readFile(resolve(bundledDist, 'index.js'), 'utf8');

			const externalized = await fse.readFile(
				resolve(externalizedDist, 'index.js'),
				'utf8',
			);

			expect(bundled).not.toContain('from "fs-extra"');
			expect(externalized).toContain('from "fs-extra"');
		},
		60_000,
	);

	test(
		'builds a bundle extension from its manifest',
		async () => {
			const extensionPath = `${TEST_PREFIX}-bundle-${Date.now()}`;
			const root = resolve(origCwd, extensionPath);

			await fse.outputFile(
				resolve(root, 'src', 'hook.js'),
				'export default () => undefined;\n',
			);

			await fse.outputJson(resolve(root, 'package.json'), {
				name: 'a-bundle',
				version: '0.0.0',
				type: 'module',
				'directus:extension': {
					type: 'bundle',
					host: '^11.0.0',
					path: { app: 'dist/app.js', api: 'dist/api.js' },
					entries: [{ type: 'hook', name: 'a-hook', source: 'src/hook.js' }],
				},
			});

			process.chdir(root);

			try {
				await build({});
			}
			finally {
				process.chdir(origCwd);
			}

			expect(fse.pathExistsSync(resolve(root, 'dist', 'api.js'))).toBe(true);
			expect(fse.pathExistsSync(resolve(root, 'dist', 'app.js'))).toBe(true);
		},
		30_000,
	);

	test(
		'builds a bundle extension from explicit entries',
		async () => {
			const extensionPath = `${TEST_PREFIX}-bundle-flags-${Date.now()}`;
			const root = resolve(origCwd, extensionPath);

			await fse.outputFile(
				resolve(root, 'src', 'hook.js'),
				'export default () => undefined;\n',
			);

			await build({
				type: 'bundle',
				input: JSON.stringify([
					{ type: 'hook', name: 'a-hook', source: `./${extensionPath}/src/hook.js` },
				]),
				output: JSON.stringify({
					app: `${extensionPath}/dist/app.js`,
					api: `${extensionPath}/dist/api.js`,
				}),
			});

			expect(fse.pathExistsSync(resolve(root, 'dist', 'api.js'))).toBe(true);
		},
		30_000,
	);

	test('leaves the sdk out of the app-only packages', () => {
		// the list is the app shared deps minus the sdk, derived by name. Lose that
		// filter and every api extension importing defineHook gets warned about the
		// one package it is supposed to import.
		expect(APP_ONLY_PACKAGES).toContain('vue');
		expect(APP_ONLY_PACKAGES).not.toContain('@directus/extensions-sdk');
	});

	test(
		'says an app-only extension has nowhere to put an external',
		async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const extensionPath = `${TEST_PREFIX}-interface-${Date.now()}`;
			const entrypoint = resolve(origCwd, extensionPath, 'index.js');

			await fse.outputFile(entrypoint, 'export default {};\n');

			try {
				await build({
					type: 'interface',
					input: entrypoint,
					output: resolve(origCwd, extensionPath, 'dist', 'index.js'),
					external: '@directus/types',
				});

				expect(warn).toHaveBeenCalledWith(
					expect.stringContaining('only has an app entrypoint'),
				);
			}
			finally {
				warn.mockRestore();
			}
		},
		30_000,
	);

	test(
		'leaves the app entrypoint bundled when a dependency is externalized',
		async () => {
			const extensionPath = `${TEST_PREFIX}-operation-${Date.now()}`;

			await create('operation', extensionPath, {
				language: 'typescript',
				install: false,
			});

			await fse.ensureSymlink(
				origCwd,
				resolve(
					origCwd,
					extensionPath,
					'node_modules',
					'@directus',
					'extensions-sdk',
				),
				'dir',
			);

			const source = [
				"import { DatabaseClients } from '@directus/types';",
				'',
				'export default { id: 1, handler: () => DatabaseClients.length };',
				'',
			].join('\n');

			await fse.writeFile(resolve(origCwd, extensionPath, 'src', 'api.ts'), source);
			await fse.writeFile(resolve(origCwd, extensionPath, 'src', 'app.ts'), source);

			process.chdir(resolve(origCwd, extensionPath));

			try {
				await build({ external: '@directus/types' });
			}
			finally {
				process.chdir(origCwd);
			}

			const dist = resolve(origCwd, extensionPath, 'dist');
			const api = await fse.readFile(resolve(dist, 'api.js'), 'utf8');
			const app = await fse.readFile(resolve(dist, 'app.js'), 'utf8');

			// the host resolves nothing for the app beyond its own shared deps, so a bare
			// specifier left in app.js is a request the browser answers with a 404
			expect(api).toContain('@directus/types');
			expect(app).not.toContain('@directus/types');
		},
		60_000,
	);

	test(
		'reports a small bundle in the unit it fits',
		async () => {
			const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);

			try {
				await buildEndpoint(null);

				// an endpoint that scaffolds to a few hundred bytes read as 0.00 MB
				expect(info).toHaveBeenCalledWith(
					expect.stringMatching(/API bundle: .*\d+ B,/),
				);
			}
			finally {
				info.mockRestore();
			}
		},
		30_000,
	);

	test(
		'spreads the api entrypoint over one file per module',
		async () => {
			const dist = await buildEndpoint(
				[
					"import { DatabaseClients } from '@directus/types';",
					'',
					'export default () => DatabaseClients.length;',
					'',
				].join('\n'),
				{ preserveModules: true },
			);

			const entry = await fse.readFile(resolve(dist, 'index.js'), 'utf8');

			// the manifest names one entrypoint, so that file keeps its name and reaches
			// the rest of the tree by relative import instead of swallowing it
			expect(fse.pathExistsSync(resolve(dist, 'index.js'))).toBe(true);
			expect(entry).toMatch(/^import .* from "\.\.?\//m);

			const emitted = (await fse.readdir(dist, { recursive: true })) as string[];
			const modules = emitted.filter((file) => file.endsWith('.js'));

			expect(modules.length).toBeGreaterThan(1);
		},
		30_000,
	);

	test(
		'warns that a spread-out build is for reading',
		async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

			try {
				await buildEndpoint(null, { preserveModules: true });

				expect(warn).toHaveBeenCalledWith(
					expect.stringContaining('0.4 ms per module'),
				);
			}
			finally {
				warn.mockRestore();
			}
		},
		30_000,
	);

	test(
		'refuses to spread a sandboxed extension out',
		async () => {
			const extensionPath = `${TEST_PREFIX}-sandboxed-${Date.now()}`;

			await create('endpoint', extensionPath, {
				language: 'typescript',
				install: false,
			});

			const manifestPath = resolve(origCwd, extensionPath, 'package.json');
			const manifest = await fse.readJson(manifestPath);

			manifest['directus:extension'].sandbox = {
				enabled: true,
				requestedScopes: {},
			};

			await fse.writeJson(manifestPath, manifest);

			const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
				throw new Error('exited');
			});

			process.chdir(resolve(origCwd, extensionPath));

			// the sandbox reads the entrypoint as a string and takes no import but
			// "directus:api", so the rest of the tree could never be reached
			try {
				await expect(build({ preserveModules: true })).rejects.toThrow('exited');
			}
			finally {
				process.chdir(origCwd);
				exit.mockRestore();
			}
		},
		30_000,
	);

	test(
		'warns when an api entrypoint reaches an app-only package',
		async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

			const source = [
				"import { ref } from 'vue';",
				'',
				'export default () => ref(1);',
				'',
			].join('\n');

			try {
				await buildEndpoint(source);

				expect(warn).toHaveBeenCalledWith(expect.stringContaining('vue'));

				expect(warn).toHaveBeenCalledWith(
					expect.stringContaining('Every worker parses that at boot'),
				);
			}
			finally {
				warn.mockRestore();
			}
		},
		30_000,
	);
});
