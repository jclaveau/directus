import axios from 'axios';
import fs from 'node:fs/promises';
import { beforeAll, expect, inject } from 'vitest';
import { USER } from '../common/variables';
import { getReversedTestIndex } from './sequential-tests';
import { recordTiming } from '../utils/record-timing';
import { sleep } from '../utils/sleep';

declare module 'vitest' {
	interface ProvidedContext {
		projectName: string;
	}
}

const serverUrl = process.env['serverUrl'];

// The gate blocks until the files it depends on report completion, which can
// outlast every other file still queued behind it, so it gets its own timeout.
beforeAll(async () => {
	const { totalTestsCount, beforeFiles, afterFiles } = JSON.parse(
		await fs.readFile('sequencer-data.json', 'utf8'),
	);

	const { testPath } = expect.getState();

	if (!serverUrl || isNaN(totalTestsCount) || !testPath) {
		throw 'Missing flow env variables';
	}

	const testFilePath = testPath.split('blackbox')[1]!;

	const testIndex = getReversedTestIndex(
		testFilePath,
		inject('projectName'),
		beforeFiles ?? [],
		afterFiles ?? [],
	);

	const gateOpenedAt = Date.now();

	while (testIndex !== 0) {
		try {
			const response = await axios.get(`${serverUrl}/items/tests_flow_completed`, {
				params: {
					'aggregate[count]': 'id',
				},
				headers: {
					Authorization: `Bearer ${USER.TESTS_FLOW.TOKEN}`,
				},
			});

			const completedCount = Number(response.data.data[0].count.id);

			if (testIndex >= 0) {
				if (completedCount >= testIndex) {
					break;
				}
			}
			else if (totalTestsCount + testIndex === completedCount) {
				break;
			}
		}
		catch {
			// A server still booting answers with a connection error, so the poll
			// has to keep its pace rather than spin.
		}

		// Every `before` and `after` file waits here for the one ahead of it, so
		// the interval is paid once per link of each chain.
		await sleep(250);
	}

	// How long the file sat behind the barrier, which its vitest duration counts
	// as its own: the timings subtract it to get what the file costs.
	recordTiming('gate', {
		file: testFilePath,
		testIndex,
		waitedMs: Date.now() - gateOpenedAt,
	});
}, 600_000);
