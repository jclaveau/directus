import config, { paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { spawn } from 'child_process';
import { describe, expect } from 'vitest';

const feature = loadFeature(
	'./tests/db/routes/server/out-of-scope-features.feature',
);

describe.each(vendors)('%s', (vendor) => {
	// An instance that starts anyway is stopped after 30 seconds, and exits with
	// no code.
	function refusedStartOf(refusedEnv: Record<string, string>) {
		return new Promise<{ code: number | null; output: string }>((resolve) => {
			const refusedInstance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: { ...config.envs[vendor], ...refusedEnv },
			});

			const stopTimer = setTimeout(() => refusedInstance.kill(), 30_000);
			let output = '';

			refusedInstance.stdout.on('data', (chunk) => (output += String(chunk)));
			refusedInstance.stderr.on('data', (chunk) => (output += String(chunk)));

			refusedInstance.on('exit', (code) => {
				clearTimeout(stopTimer);
				resolve({ code, output });
			});
		});
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'an instance with an ldap auth driver it did not allow refuses to start',
			({ when, then }) => {
				let exit: { code: number | null; output: string };

				when(
					'an instance starts with AUTH_PROVIDERS "corp" and AUTH_CORP_DRIVER ldap',
					async () => {
						exit = await refusedStartOf({
							PORT: String(await freePortOfWorker()),
							AUTH_PROVIDERS: 'corp',
							AUTH_CORP_DRIVER: 'ldap',
						});
					},
				);

				then('it exits naming AUTH_CORP_DRIVER and issue #619', () => {
					expect(exit.code, exit.output).toBe(1);

					expect(exit.output).toContain(
						'"AUTH_CORP_DRIVER" Environment Variable is "ldap", a feature out'
						+ ' of the tested scope (#619): add "ldap" to'
						+ ' OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.',
					);
				});
			},
			60_000,
		);

		scenario(
			'an instance allowing a feature that does not exist refuses to start',
			({ when, then }) => {
				let exit: { code: number | null; output: string };

				when(
					'an instance starts with OUT_OF_SCOPE_FEATURES_ALLOWED "ldapp"',
					async () => {
						exit = await refusedStartOf({
							PORT: String(await freePortOfWorker()),
							OUT_OF_SCOPE_FEATURES_ALLOWED: 'ldapp',
						});
					},
				);

				then(
					'it exits naming OUT_OF_SCOPE_FEATURES_ALLOWED and the features',
					() => {
						expect(exit.code, exit.output).toBe(1);

						expect(exit.output).toContain(
							'"OUT_OF_SCOPE_FEATURES_ALLOWED" Environment Variable names'
							+ ' "ldapp", which is not one of ldap, oauth2, openid, saml,'
							+ ' websockets-graphql, extensions-auto-reload, shares,'
							+ ' comments.',
						);
					},
				);
			},
			60_000,
		);
	});
});
