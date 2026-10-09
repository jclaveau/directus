import axios from 'axios';
import type { Reporter, TestModule } from 'vitest/node';
import { USER } from '../common/variables';

/**
 * Posts each file's completion to `tests_flow_completed`, the count the
 * sequential gate opens the `after` files on.
 *
 * vitest runs no hook of a file whose tests are all skipped or that fails to
 * load, the setup file's included, so a completion posted from an `afterAll`
 * never arrives for one and every `after` file waits out the gate's timeout.
 * The main process reports every module it ran, whatever its state.
 */
export default class CompletionReporter implements Reporter {
	async onTestModuleEnd(testModule: TestModule) {
		const completionsUrl = `${process.env['serverUrl']}/items/tests_flow_completed`;
		const testFilePath = testModule.moduleId.split('blackbox')[1];

		const headers = {
			Authorization: `Bearer ${USER.TESTS_FLOW.TOKEN}`,
			'Content-Type': 'application/json',
		};

		// A completion lost to one failed post holds every `after` file to the
		// gate's timeout. The last failure still throws: vitest reports it, and
		// it names the cause the gate's timeout would not.
		for (let attempt = 1; ; attempt++) {
			try {
				// A failed post may have been saved with only its answer lost, and the
				// gate counts rows: posted again, the file would open it a file early.
				if (attempt > 1) {
					const posted = await axios.get(completionsUrl, {
						params: { 'filter[test_file_path][_eq]': testFilePath, limit: 1 },
						headers,
						timeout: 10_000,
					});

					if (posted.data.data.length > 0) {
						return;
					}
				}

				await axios.post(completionsUrl, {
					test_file_path: testFilePath,
				}, {
					headers,
					timeout: 10_000,
				});

				return;
			}
			catch (error) {
				if (attempt === 3) {
					throw error;
				}
			}
		}
	}
}
