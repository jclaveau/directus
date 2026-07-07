import { findIndex } from 'lodash-es';
import fs from 'node:fs/promises';
import { BaseSequencer, type WorkspaceSpec } from 'vitest/node';
import { filesForShard } from './shard-files';
import { sequentialTestsList } from './sequential-tests';

export default class CustomSequencer extends BaseSequencer {
	// Split files across `--shard=i/n` jobs, but keep every `before` file in each shard (the
	// ordering barrier needs them) and the `after` chain in the last shard only. `sort()` then
	// orders whatever this shard runs and writes the per-shard totalTestsCount.
	override async shard(files: WorkspaceSpec[]) {
		const shard = this.ctx.config.shard;

		if (!shard) {
			return files;
		}

		const project = files[0]![0].config.name as 'db' | 'common';
		const paths = files.map(([, path]) => path);
		const mine = new Set(filesForShard(paths, project, shard.index, shard.count));

		return files.filter(([, path]) => mine.has(path));
	}

	override async sort(files: WorkspaceSpec[]) {
		if (files.length > 1) {
			const list = sequentialTestsList[files[0]![0].config.name as 'db' | 'common'];

			// If specified, only run these tests sequentially
			if (list.only.length > 0) {
				const onlyTests = [];

				for (const sequentialTest of list.only) {
					const testIndex = findIndex(files, ([_, testFile]) => {
						return testFile.endsWith(sequentialTest);
					});

					if (testIndex !== -1) {
						const test = files[testIndex];

						if (test) {
							onlyTests.push(test);
						}
					} else {
						throw new Error(`Non-existent test file "${sequentialTest}" in "only" list`);
					}
				}

				files = onlyTests;
			} else {
				for (const sequentialTest of list.before.slice().reverse()) {
					const testIndex = findIndex(files, ([_, testFile]) => {
						return testFile.endsWith(sequentialTest);
					});

					if (testIndex !== -1) {
						const test = files.splice(testIndex, 1)[0];

						if (test) {
							files.unshift(test);
						}
					} else {
						throw new Error(`Non-existent test file "${sequentialTest}" in "before" list`);
					}
				}

				for (const sequentialTest of list.after) {
					const testIndex = findIndex(files, ([_, testFile]) => {
						return testFile.endsWith(sequentialTest);
					});

					if (testIndex !== -1) {
						const test = files.splice(testIndex, 1)[0];

						if (test) {
							files.push(test);
						}
					} else {
						throw new Error(`Non-existent test file "${sequentialTest}" in "after" list`);
					}
				}
			}
		}

		// Expose sequencer data to setup & tests
		await fs.writeFile('sequencer-data.json', JSON.stringify({ totalTestsCount: files.length }));

		return files;
	}
}
