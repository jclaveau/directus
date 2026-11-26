import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('keeps serving after a request aborted mid-body', async () => {
	const fakeProviders = spawn(
		process.execPath,
		[fileURLToPath(new URL('serve-fake-providers.mjs', import.meta.url))],
		{
			env: {
				...process.env,
				SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT: '18657',
				PUBLIC_URL: 'http://127.0.0.1:8055',
				SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: 'whsec_test_1',
				SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_1',
			},
		},
	);

	try {
		await once(fakeProviders.stdout, 'data');

		const abortedRequest = connect(18657, '127.0.0.1');
		await once(abortedRequest, 'connect');

		abortedRequest.write(
			'POST /v2/payments HTTP/1.1\r\nHost: 127.0.0.1\r\n'
			+ 'Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{"amo',
		);

		abortedRequest.destroy();

		const paymentsResponse = await fetch(
			'http://127.0.0.1:18657/v2/payments/tr_examples_404',
		);

		expect(paymentsResponse.status).toBe(404);
		expect(fakeProviders.exitCode).toBe(null);
	}
	finally {
		fakeProviders.kill();
	}
});
