import { findIndex } from 'lodash-es';
import fs from 'node:fs/promises';
import { BaseSequencer, type WorkspaceSpec } from 'vitest/node';
import { filesForShard } from './shard-files';
import { flatAfterList, sequentialTestsList } from './sequential-tests';

export default class CustomSequencer extends BaseSequencer {
	// Split files across `--shard=i/n` jobs, but keep every `before` file in each
	// shard — the ordering barrier needs them. `sort()` then orders whatever this
	// shard runs and writes the per-shard totalTestsCount and after chain.
	override async shard(files: WorkspaceSpec[]) {
		const shard = this.ctx.config.shard;

		if (!shard) {
			return files;
		}

		const project = files[0]![0].config.name as 'db' | 'common';

		const mine = new Set(
			filesForShard(
				files.map(([, path]) => path),
				project,
				shard.index,
				shard.count,
			),
		);

		return files.filter(([, path]) => mine.has(path));
	}

	override async sort(files: WorkspaceSpec[]) {
		const project = files[0]![0].config.name as 'db' | 'common';

		if (files.length > 1) {
			const list = sequentialTestsList[project];

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
					}
					else if (!this.ctx.config.shard) {
						// A sharded run legitimately lacks some sequential files;
						// guard full runs only
						throw new Error(`Non-existent test file "${sequentialTest}" in "before" list`);
					}
				}

				for (const sequentialTest of flatAfterList(project)) {
					const testIndex = findIndex(files, ([_, testFile]) => {
						return testFile.endsWith(sequentialTest);
					});

					if (testIndex !== -1) {
						const test = files.splice(testIndex, 1)[0];

						if (test) {
							files.push(test);
						}
					}
					else if (!this.ctx.config.shard) {
						// A sharded run legitimately lacks some sequential files;
						// guard full runs only
						throw new Error(`Non-existent test file "${sequentialTest}" in "after" list`);
					}
				}
			}
		}

		// The after entries this shard actually runs, in the order sorted above.
		// `setup/environment.ts` counts its barrier slots back from the end of THIS
		// list — the project-wide one would wait on completions that never happen
		// in a shard that only got part of the chain.
		const afterFiles = flatAfterList(project).filter((entry) => {
			return files.some(([, testFile]) => testFile.endsWith(entry));
		});

		// Expose sequencer data to setup & tests
		await fs.writeFile(
			'sequencer-data.json',
			JSON.stringify({ totalTestsCount: files.length, afterFiles }),
		);

		return files;
	}
}
