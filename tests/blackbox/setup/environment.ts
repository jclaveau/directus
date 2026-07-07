import axios from 'axios';
import fs from 'node:fs/promises';
import type { Environment } from 'vitest';
import { USER } from '../common/variables';
import { sequentialTestsList } from './sequential-tests';
import { sleep } from '../utils/sleep';

export default <Environment>{
	name: 'custom',
	transformMode: 'ssr',

	async setup(global) {
		const { waitFor } = JSON.parse(await fs.readFile('sequencer-data.json', 'utf8'));
		const testFilePath = global.__vitest_worker__.ctx.files[0].split('blackbox')[1];
		const serverUrl = process.env['serverUrl'];

		if (!serverUrl || !waitFor) {
			throw 'Missing flow env variables';
		}

		const project = global.__vitest_worker__.ctx.config.name as 'db' | 'common';
		// No entry shouldn't happen; fall back to "middle" (after the before-chain) to avoid a hang.
		const threshold = waitFor[testFilePath] ?? sequentialTestsList[project].before.length;

		while (threshold > 0) {
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

				if (completedCount >= threshold) {
					break;
				}
			}
			catch {
				continue;
			}

			await sleep(1000);
		}

		return {
			async teardown() {
				const body = {
					test_file_path: testFilePath,
				};

				await axios.post(`${serverUrl}/items/tests_flow_completed`, body, {
					headers: {
						Authorization: `Bearer ${USER.TESTS_FLOW.TOKEN}`,
						'Content-Type': 'application/json',
					},
				});
			},
		};
	},
};
