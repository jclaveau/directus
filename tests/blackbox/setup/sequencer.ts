import { findIndex } from 'lodash-es';
import fs from 'node:fs/promises';
import { BaseSequencer, type WorkspaceSpec } from 'vitest/node';
import { filesForShard } from './shard-files';
import { sequentialTestsList } from './sequential-tests';

// The `waitFor` key each file's env setup looks itself up by (mirrors environment.ts).
function shardKey(path: string): string {
	return path.split('blackbox')[1]!;
}

export default class CustomSequencer extends BaseSequencer {
	// Split files across `--shard=i/n` jobs, but keep every `before` file in each shard (the
	// shard-local ordering barrier needs them); the parallel middle and the `after` files are
	// balanced across shards. `sort()` then orders whatever this shard runs [before → middle →
	// after] and writes a per-file `waitFor` threshold so each shard runs its own after-chain last.
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
		// path → completed-count threshold each file's env setup polls for (see environment.ts)
		let waitFor: Record<string, number> = {};

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
					}
					else {
						throw new Error(`Non-existent test file "${sequentialTest}" in "only" list`);
					}
				}

				files = onlyTests;

				// Serial: each `only` file waits for every prior one to complete
				waitFor = Object.fromEntries(files.map(([, path], position) => {
					return [shardKey(path), position];
				}));
			}
			else {
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
						// A sharded run legitimately lacks some sequential files; guard full runs only
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
					}
					else if (!this.ctx.config.shard) {
						// A sharded run legitimately lacks some sequential files; guard full runs only
						throw new Error(`Non-existent test file "${sequentialTest}" in "after" list`);
					}
				}

				// files is now [before…, middle…, after…]. before files run serially (each waits
				// for the prior), middle files all wait for the before-chain then run concurrently,
				// after files wait for before+middle then run serially among themselves.
				const isBefore = (path: string) => {
					return list.before.some((entry) => path.endsWith(entry));
				};

				const isAfter = (path: string) => {
					return list.after.some((entry) => path.endsWith(entry));
				};

				const beforeCount = files.filter(([, path]) => isBefore(path)).length;

				const middleCount = files.filter(([, path]) => {
					return !isBefore(path) && !isAfter(path);
				}).length;

				let beforeSeen = 0;
				let afterSeen = 0;

				for (const [, path] of files) {
					if (isBefore(path)) {
						waitFor[shardKey(path)] = beforeSeen;
						beforeSeen += 1;
					}
					else if (isAfter(path)) {
						waitFor[shardKey(path)] = beforeCount + middleCount + afterSeen;
						afterSeen += 1;
					}
					else {
						waitFor[shardKey(path)] = beforeCount;
					}
				}
			}
		}
		else if (files.length === 1) {
			waitFor[shardKey(files[0]![1])] = 0;
		}

		// Expose sequencer data to setup & tests
		await fs.writeFile(
			'sequencer-data.json',
			JSON.stringify({ totalTestsCount: files.length, waitFor }),
		);

		return files;
	}
}
