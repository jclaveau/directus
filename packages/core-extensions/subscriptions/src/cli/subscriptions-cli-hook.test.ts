import { Command } from 'commander';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { subscriptionsCliHook } from './subscriptions-cli-hook.js';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('subscriptionsCliHook', () => {
	test('creates the Mollie webhook and prints its secret once', async () => {
		const init = vi.fn();
		const program = new Command();

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
			JSON.stringify({ id: 'hook_1', webhookSecret: 'mollie_secret_new' }),
			{ status: 201 },
		)));

		vi.spyOn(process.stdout, 'write').mockReturnValue(true);

		const exitProcess = vi.spyOn(process, 'exit')
			.mockReturnValue(undefined as never);

		(subscriptionsCliHook.config as (...args: unknown[]) => void)(
			{ init },
			{ env: { SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1' } },
		);

		expect(init).toHaveBeenCalledWith('cli.before', expect.any(Function));
		init.mock.calls[0]?.[1]({ program });

		await program.parseAsync([
			'node',
			'directus',
			'subscriptions',
			'mollie-setup-webhook',
			'--url',
			'https://example.com/subscriptions/webhooks/mollie',
		]);

		expect(fetch).toHaveBeenCalledWith('https://api.mollie.com/v2/webhooks', {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer test_1',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: 'Directus subscriptions',
				url: 'https://example.com/subscriptions/webhooks/mollie',
				eventTypes: [
					'payment.paid',
					'payment.authorized',
					'payment.failed',
					'payment.canceled',
					'payment.expired',
					'payment.pending',
				],
			}),
		});

		expect(vi.mocked(process.stdout.write).mock.calls).toEqual([
			[
				'Created the Mollie webhook "hook_1" for'
				+ ' "https://example.com/subscriptions/webhooks/mollie".\n',
			],
			[
				'Mollie shows its secret this once: add it to'
				+ ' SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS.\n',
			],
			['mollie_secret_new\n'],
		]);

		expect(exitProcess).toHaveBeenCalledWith(0);
	});

	test('refuses to run without the Mollie API key', async () => {
		const init = vi.fn();
		const program = new Command();

		vi.stubGlobal('fetch', vi.fn());

		(subscriptionsCliHook.config as (...args: unknown[]) => void)(
			{ init },
			{ env: {} },
		);

		init.mock.calls[0]?.[1]({ program });

		await expect(program.parseAsync([
			'node',
			'directus',
			'subscriptions',
			'mollie-setup-webhook',
			'--url',
			'https://example.com/subscriptions/webhooks/mollie',
		]))
			.rejects.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_API_KEY" is required to create a Mollie webhook',
			));

		expect(fetch).not.toHaveBeenCalled();
	});

	test('passes on what Mollie answers a refused webhook', async () => {
		const init = vi.fn();
		const program = new Command();

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
			'{"status":422,"detail":"The webhook URL is invalid"}',
			{ status: 422 },
		)));

		(subscriptionsCliHook.config as (...args: unknown[]) => void)(
			{ init },
			{ env: { SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1' } },
		);

		init.mock.calls[0]?.[1]({ program });

		await expect(program.parseAsync([
			'node',
			'directus',
			'subscriptions',
			'mollie-setup-webhook',
			'--url',
			'http://localhost/subscriptions/webhooks/mollie',
		]))
			.rejects.toThrow(new Error(
				'Mollie answered the webhook creation with 422:'
				+ ' "{\\"status\\":422,\\"detail\\":\\"The webhook URL is invalid\\"}"',
			));
	});
});
