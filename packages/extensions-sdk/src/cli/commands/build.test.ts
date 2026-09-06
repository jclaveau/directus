import fse from 'fs-extra';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { create } from '../index.js';
import build from './build.js';

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

	/** Scaffolds an endpoint extension, builds it, and returns what landed in dist. */
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

		return fse.readFile(resolve(origCwd, extensionPath, 'dist', 'index.js'), 'utf8');
	}

	test(
		'carries the define helper without the schemas that share its package',
		async () => {
			const bundle = await buildEndpoint(null);

			// defineEndpoint is an identity function. It used to arrive with every
			// zod-backed manifest schema attached — 125 KB — because the two were
			// emitted into one module that declared no sideEffects.
			// an unbuilt workspace leaves the import unresolved, and a bundle that never
			// carried the helper trivially passes the two assertions below
			expect(bundle).not.toContain('@directus/extensions-sdk');

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
			const bundle = await buildEndpoint(
				[
					"import { DatabaseClients } from '@directus/types';",
					'',
					'export default () => DatabaseClients.length;',
					'',
				].join('\n'),
			);

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

			const bundled = await buildEndpoint(source);
			const externalized = await buildEndpoint(source, { external: 'fs-extra' });

			expect(bundled).not.toContain('from "fs-extra"');
			expect(externalized).toContain('from "fs-extra"');
		},
		60_000,
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

				// an endpoint that scaffolds to a few hundred bytes reads as 0.00 MB
				expect(info).toHaveBeenCalledWith(expect.stringMatching(/API bundle: .*KB/));
			}
			finally {
				info.mockRestore();
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
