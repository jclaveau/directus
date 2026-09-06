import fse from 'fs-extra';
import { resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import unbundle from './unbundle.js';

// A built extension ships without its sources, so this reads them back out of the
// map. The paths in a map are the author's, which is why the traversal case matters.

const TEST_PREFIX = 'temp-unbundle';
const origCwd = process.cwd();

afterEach(async () => {
	const artifacts = (await fse.readdir(origCwd)).filter((file) => {
		return file.startsWith(TEST_PREFIX);
	});

	for (const artifact of artifacts) {
		await fse.remove(resolve(origCwd, artifact));
	}
});

/** Writes a map beside a stub bundle and returns the paths to hand unbundle. */
async function writeMap(map: Record<string, unknown>) {
	const random = Math.random()
		.toString(36)
		.slice(2);

	const root = resolve(origCwd, `${TEST_PREFIX}-${Date.now()}-${random}`);

	await fse.outputFile(resolve(root, 'api.js'), 'export default () => 1;\n');
	await fse.outputJson(resolve(root, 'api.js.map'), map);

	return { bundle: resolve(root, 'api.js'), out: resolve(root, 'sources') };
}

describe('unbundle', () => {
	test('writes the sources a map carries out as a tree', async () => {
		const { bundle, out } = await writeMap({
			sources: ['../src/index.ts', '../src/lib/helper.ts'],
			sourcesContent: ['export default 1;', 'export const help = 2;'],
		});

		await unbundle(bundle, out);

		expect(await fse.readFile(resolve(out, 'src/index.ts'), 'utf8')).toBe(
			'export default 1;',
		);

		expect(await fse.readFile(resolve(out, 'src/lib/helper.ts'), 'utf8')).toBe(
			'export const help = 2;',
		);
	});

	test('keeps a source that climbs out of the tree inside it', async () => {
		const { bundle, out } = await writeMap({
			sources: ['../../../../etc/passwd', '/tmp/absolute.ts'],
			sourcesContent: ['climbed', 'absolute'],
		});

		await unbundle(bundle, out);

		expect(await fse.readFile(resolve(out, 'etc/passwd'), 'utf8')).toBe('climbed');

		expect(await fse.readFile(resolve(out, 'tmp/absolute.ts'), 'utf8')).toBe(
			'absolute',
		);
	});

	test('reports the sources the map names but does not carry', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		// rolldown names json modules in the map and leaves their content empty
		const { bundle, out } = await writeMap({
			sources: ['../src/index.ts', '../package.json'],
			sourcesContent: ['export default 1;', ''],
		});

		try {
			await unbundle(bundle, out);

			expect(fse.pathExistsSync(resolve(out, 'package.json'))).toBe(false);

			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('1 source(s) the map names carry no content'),
			);
		}
		finally {
			warn.mockRestore();
		}
	});

	test('refuses a bundle whose map maps positions only', async () => {
		const { bundle, out } = await writeMap({
			sources: ['../src/index.ts'],
			mappings: 'AAAA',
		});

		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});

		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			await expect(unbundle(bundle, out)).rejects.toThrow('exited');
		}
		finally {
			exit.mockRestore();
			error.mockRestore();
		}
	});
});
