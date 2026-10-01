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

	test('takes the map itself, not only the bundle beside it', async () => {
		const { bundle, out } = await writeMap({
			sources: ['../src/index.ts'],
			sourcesContent: ['export default 1;'],
		});

		await unbundle(`${bundle}.map`, out);

		expect(await fse.readFile(resolve(out, 'src/index.ts'), 'utf8')).toBe(
			'export default 1;',
		);
	});

	test('follows the map the bundle names when it is not beside it', async () => {
		const { bundle, out } = await writeMap({
			sources: ['../src/index.ts'],
			sourcesContent: ['export default 1;'],
		});

		const root = resolve(bundle, '..');

		await fse.move(resolve(root, 'api.js.map'), resolve(root, 'elsewhere.map'));

		await fse.outputFile(
			bundle,
			'export default () => 1;\n//# sourceMappingURL=elsewhere.map\n',
		);

		await unbundle(bundle, out);

		expect(await fse.readFile(resolve(out, 'src/index.ts'), 'utf8')).toBe(
			'export default 1;',
		);
	});

	test('writes a source whose path goes nowhere, not nothing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const { bundle, out } = await writeMap({
			sources: ['../../..', 'C:\\Users\\dev\\src\\drive.ts'],
			sourcesContent: ['content that has nowhere to go', 'from a windows path'],
		});

		try {
			await unbundle(bundle, out);

			// the content exists; only its path did not survive sanitising, and a
			// silent drop is how a source goes missing without anyone being told
			expect(await fse.readFile(resolve(out, '_unmapped/source-0'), 'utf8')).toBe(
				'content that has nowhere to go',
			);

			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('had no usable path'),
			);

			// a drive letter is not a directory anyone means to create
			const drive = resolve(out, 'Users/dev/src/drive.ts');

			expect(await fse.readFile(drive, 'utf8')).toBe('from a windows path');
		}
		finally {
			warn.mockRestore();
		}
	});

	test('keeps both sources when two paths sanitise to one', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const { bundle, out } = await writeMap({
			sources: ['/tmp/a.ts', 'tmp/a.ts'],
			sourcesContent: ['first', 'second'],
		});

		try {
			await unbundle(bundle, out);

			expect(await fse.readFile(resolve(out, 'tmp/a.ts'), 'utf8')).toBe('first');
			expect(await fse.readFile(resolve(out, 'tmp/a-2.ts'), 'utf8')).toBe('second');

			expect(warn).toHaveBeenCalledWith(expect.stringContaining('carry a suffix'));
		}
		finally {
			warn.mockRestore();
		}
	});

	test('refuses a directory that already holds files', async () => {
		const { bundle, out } = await writeMap({
			sources: ['../src/index.ts'],
			sourcesContent: ['export default 1;'],
		});

		// a leftover from an earlier extraction reads exactly like one of this build's
		await fse.outputFile(resolve(out, 'src/stale.ts'), 'from another build');

		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});

		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			await expect(unbundle(bundle, out)).rejects.toThrow('exited');

			expect(error).toHaveBeenCalledWith(
				expect.stringContaining('already holds files'),
			);
		}
		finally {
			exit.mockRestore();
			error.mockRestore();
		}
	});

	test('refuses a bundle with no map at all', async () => {
		const { bundle, out } = await writeMap({ sources: [], sourcesContent: [] });

		await fse.remove(`${bundle}.map`);

		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});

		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			await expect(unbundle(bundle, out)).rejects.toThrow('exited');

			expect(error).toHaveBeenCalledWith(expect.stringContaining('No source map'));
		}
		finally {
			exit.mockRestore();
			error.mockRestore();
		}
	});

	test('refuses a map that is not readable json', async () => {
		const { bundle, out } = await writeMap({ sources: [], sourcesContent: [] });

		await fse.outputFile(`${bundle}.map`, '{ this is not json');

		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});

		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			await expect(unbundle(bundle, out)).rejects.toThrow('exited');

			expect(error).toHaveBeenCalledWith(
				expect.stringContaining('not a readable source map'),
			);
		}
		finally {
			exit.mockRestore();
			error.mockRestore();
		}
	});

	test('says a map too big to parse needs a bigger heap', async () => {
		const { bundle, out } = await writeMap({ sources: [], sourcesContent: [] });

		// sparse, so this costs no disk: the size is all the check reads
		const handle = await fse.open(`${bundle}.map`, 'w');
		await fse.ftruncate(handle, 201e6);
		await fse.close(handle);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});

		try {
			await expect(unbundle(bundle, out)).rejects.toThrow('exited');

			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('max-old-space-size'),
			);
		}
		finally {
			warn.mockRestore();
			error.mockRestore();
			exit.mockRestore();
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
