import { globby } from 'globby';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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

		// A test can read collections another test's seed created — batch-insert
		// imports no-relation.seed, m2o-max-batch-mutation imports m2o.seed. The
		// filename mapping below can't see that, so walk the imports and keep those
		// seeds too, transitively (a seed may pull in another).
		const borrowed = new Set<string>();
		const pending = [...inShard];

		while (pending.length > 0) {
			const importer = pending.pop()!;
			const source = await readFile(importer, 'utf8');

			for (const [, specifier] of source.matchAll(/from '(\.[^']*\.seed)'/g)) {
				const seedFile = `${resolve(dirname(importer), specifier!)}.ts`;

				if (!borrowed.has(seedFile)) {
					borrowed.add(seedFile);
					pending.push(seedFile);
				}
			}
		}

		seeds = seeds.filter((seed) => {
			const seedFile = join(paths.cwd, seed);
			const testFile = join(paths.cwd, seed.replace('.seed.ts', '.test.ts'));

			if (borrowed.has(seedFile)) {
				return true;
			}

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
