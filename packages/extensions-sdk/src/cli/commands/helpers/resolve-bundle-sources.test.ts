import fse from 'fs-extra';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveBundleSources } from './resolve-bundle-sources.js';

let bundleRoot: string;

beforeEach(async () => {
	bundleRoot = await mkdtemp(path.join(tmpdir(), 'bundle-sources-'));
});

afterEach(async () => {
	await rm(bundleRoot, { recursive: true, force: true });
});

describe('resolveBundleSources', () => {
	test('defaults to src/app.ts and src/api.ts', async () => {
		await fse.outputFile(path.join(bundleRoot, 'src/app.ts'), '');
		await fse.outputFile(path.join(bundleRoot, 'src/api.ts'), '');

		expect(
			await resolveBundleSources('@consumer/domain', bundleRoot),
		).toEqual({
			app: 'src/app.ts',
			api: 'src/api.ts',
		});
	});

	test('leaves a side without its default file unbuilt', async () => {
		await fse.outputFile(path.join(bundleRoot, 'src/api.ts'), '');

		expect(
			await resolveBundleSources('@consumer/domain', bundleRoot),
		).toEqual({
			app: null,
			api: 'src/api.ts',
		});
	});

	test('refuses a bundle with neither default file', async () => {
		await expect(
			resolveBundleSources('@consumer/domain', bundleRoot),
		).rejects.toThrow(
			new Error(
				'Bundle "@consumer/domain" has no "src/app.ts" or "src/api.ts"',
			),
		);
	});
});
