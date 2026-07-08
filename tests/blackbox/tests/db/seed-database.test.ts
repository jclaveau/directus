import { globby } from 'globby';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { filesForShard } from '../../setup/shard-files';
import { sequentialTestsList } from '../../setup/sequential-tests';
import { paths } from '../../common/config';
import { ClearCaches, DisableTestCachingSetup } from '../../common/functions';

describe('Seed Database Structure', async () => {
	DisableTestCachingSetup();

	let seeds = await globby('**.seed.ts', {
		cwd: paths.cwd,
	});

	if (seeds.length === 0) {
		test('No seed files found', () => {
			expect(true).toBe(true);
		});
	} else if (sequentialTestsList['db'].only.length > 0) {
		const requiredPaths = sequentialTestsList['db'].only.map((testEntry) => {
			return testEntry.slice(1).replace('.test.ts', '.seed.ts');
		});

		seeds = seeds.filter((path) => {
			return requiredPaths.includes(path);
		});
	}

	const shardIndex = Number(process.env['SHARD_INDEX']);
	const shardCount = Number(process.env['SHARD_COUNT']);

	if (Number.isInteger(shardIndex) && shardCount > 1) {
		// Seed only the collections this shard's test files need (before/after
		// seeds always kept).
		const testFiles = await globby(
			['tests/db/**/*.test.ts', 'common/common.test.ts'],
			{
				cwd: paths.cwd,
				absolute: true,
			},
		);

		const known = new Set(testFiles);
		const inShard = new Set(filesForShard(testFiles, 'db', shardIndex, shardCount));

		seeds = seeds.filter((seed) => {
			const testFile = join(paths.cwd, seed.replace('.seed.ts', '.test.ts'));
			// keep a seed we can't map to a known test file (safe), else only this shard's
			return !known.has(testFile) || inShard.has(testFile);
		});
	}

	for (const path of seeds) {
		const importedTest = await import(`../../${path}`);

		if (typeof importedTest.seedDBStructure === 'function') {
			describe(`Seeding "${path}"`, async () => {
				await importedTest.seedDBStructure();
			});
		}
	}

	ClearCaches();
});
