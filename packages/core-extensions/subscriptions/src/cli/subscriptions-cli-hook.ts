import { defineHook } from '@directus/extensions-sdk/scalabus';
import type { Command } from 'commander';
import { readMollieAccessToken } from '../config/read-subscriptions-config.js';
import { INVITE_DAYS_KEPT, sweepInvites } from '../members/sweep-invites.js';

const MOLLIE_WEBHOOKS_URL = 'https://api.mollie.com/v2/webhooks';

// Mollie refuses every `subscription.*` type (422), and the bundle reads only
// `payment.*` events.
const MOLLIE_EVENT_TYPES = [
	'payment.paid',
	'payment.authorized',
	'payment.failed',
	'payment.canceled',
	'payment.expired',
	'payment.pending',
];

/**
 * Its own bundle entry: the webhook secret a Mollie API key requires only
 * exists once this command has run, so it reads the access token alone.
 */
export const subscriptionsCliHook = defineHook(
	'subscriptions-cli',
	({ init }, { env, database }) => {
		init('cli.before', ({ program }: { program: Command }) => {
			const subscriptionsCommand = program
				.command('subscriptions')
				.description('Set up the subscriptions bundle');

			subscriptionsCommand
				.command('sweep-invites')
				.description(
					`Delete the invited users holding no seat ${INVITE_DAYS_KEPT} days`
					+ ' after their invite',
				)
				.action(async () => {
					const sweptCount = await sweepInvites(database);

					process.stdout.write(sweptCount === 1
						? 'Deleted 1 invited user holding no seat since its invite of'
						+ ` ${INVITE_DAYS_KEPT} days\n`
						: `Deleted ${sweptCount} invited users holding no seat since`
						+ ` their invite of ${INVITE_DAYS_KEPT} days\n`);

					process.exit(0);
				});

			subscriptionsCommand
				.command('mollie-setup-webhook')
				.description('Create the Mollie webhook and print its secret')
				.requiredOption('--url <url>', 'Public URL of the Mollie webhook route')
				.option('--name <name>', 'Name shown in Mollie', 'Directus subscriptions')
				.option('--testmode', 'Create the webhook in test mode')
				.action(async (webhookOptions: MollieWebhookOptions) => {
					await createMollieWebhook(
						readMollieAccessToken(env),
						webhookOptions,
					);

					process.exit(0);
				});
		});
	},
);

type MollieWebhookOptions = { url: string; name: string; testmode?: true };

async function createMollieWebhook(
	accessToken: string,
	{ url: webhookUrl, name: webhookName, testmode }: MollieWebhookOptions,
): Promise<void> {
	const mollieAnswer = await fetch(MOLLIE_WEBHOOKS_URL, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			name: webhookName,
			url: webhookUrl,
			eventTypes: MOLLIE_EVENT_TYPES,
			testmode,
		}),
	});

	if (mollieAnswer.ok === false) {
		throw new Error(
			`Mollie answered the webhook creation with ${mollieAnswer.status}:`
			+ ` ${JSON.stringify(await mollieAnswer.text())}`,
		);
	}

	const createdWebhook: { id: string; webhookSecret: string } = await mollieAnswer
		.json();

	process.stdout.write(
		`Created the Mollie webhook ${JSON.stringify(createdWebhook.id)}`
		+ ` for ${JSON.stringify(webhookUrl)}.\n`,
	);

	process.stdout.write(
		'Mollie shows its secret this once: add it to'
		+ ' SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS.\n',
	);

	process.stdout.write(`${createdWebhook.webhookSecret}\n`);
}
