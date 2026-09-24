import axios from 'axios';
import fs from 'node:fs/promises';
import { afterAll, beforeAll, expect, inject } from 'vitest';
import { USER } from '../common/variables';
import { getReversedTestIndex } from './sequential-tests';
import { sleep } from '../utils/sleep';

declare module 'vitest' {
	interface ProvidedContext {
		projectName: string;
	}
}

const serverUrl = process.env['serverUrl'];

let testFilePath: string;

beforeAll(async () => {
	const { totalTestsCount, afterFiles } = JSON.parse(
		await fs.readFile('sequencer-data.json', 'utf8'),
	);

	const { testPath } = expect.getState();

	if (!serverUrl || isNaN(totalTestsCount) || !testPath) {
		throw 'Missing flow env variables';
	}

	testFilePath = testPath.split('blackbox')[1]!;

	const testIndex = getReversedTestIndex(
		testFilePath,
		inject('projectName'),
		afterFiles ?? [],
	);

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
				if (completedCount >= testIndex) break;
			} else if (totalTestsCount + testIndex === completedCount) {
				break;
			}
		} catch {
			continue;
		}

		await sleep(1000);
	}
});

afterAll(async () => {
	const body = {
		test_file_path: testFilePath,
	};

	await axios.post(`${serverUrl}/items/tests_flow_completed`, body, {
		headers: {
			Authorization: `Bearer ${USER.TESTS_FLOW.TOKEN}`,
			'Content-Type': 'application/json',
		},
	});
});
