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
		// A completion lost to one failed post holds every `after` file to the
		// gate's timeout. The last failure still throws: vitest reports it, and
		// it names the cause the gate's timeout would not.
		for (let attempt = 1; ; attempt++) {
			try {
				await axios.post(`${process.env['serverUrl']}/items/tests_flow_completed`, {
					test_file_path: testModule.moduleId.split('blackbox')[1],
				}, {
					headers: {
						Authorization: `Bearer ${USER.TESTS_FLOW.TOKEN}`,
						'Content-Type': 'application/json',
					},
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
