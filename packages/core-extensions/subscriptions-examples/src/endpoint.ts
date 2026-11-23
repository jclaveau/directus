import {
	createError,
	ForbiddenError,
	InvalidPayloadError,
} from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk/scalabus';
import type { Accountability } from '@directus/types';
import express, { type Request } from 'express';
import {
	composePayPage,
	PAY_OUTCOMES,
	PAY_PAGE_POLICY,
	type PayHolding,
} from './pay-page/compose-pay-page.js';
import { rerouteProviderApis } from './pay-page/reroute-provider-apis.js';

type AccountableRequest = Request & { accountability?: Accountability | null };

const FAKE_FLAG = 'SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS';

const PORT_VARIABLE = 'SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT';

const LIVE_KEY_PREFIXES = [
	{
		variable: 'SUBSCRIPTIONS_STRIPE_SECRET_KEY',
		prefixes: ['sk_live_', 'rk_live_'],
	},
	{ variable: 'SUBSCRIPTIONS_MOLLIE_API_KEY', prefixes: ['live_'] },
];

export const UnknownPaymentError = createError<{ payment: string }>(
	'ROUTE_NOT_FOUND',
	({ payment }) => {
		return `The fake providers hold no payment ${JSON.stringify(payment)}.`;
	},
	404,
);

export function refuseLiveKeys(env: Record<string, unknown>): void {
	for (const { variable, prefixes } of LIVE_KEY_PREFIXES) {
		const providerKey = env[variable];

		const isLiveKey = typeof providerKey === 'string'
			&& prefixes.some((livePrefix) => providerKey.startsWith(livePrefix));

		if (isLiveKey) {
			throw new Error(
				`${JSON.stringify(FAKE_FLAG)} fakes Stripe and Mollie, it refuses`
				+ ` to start next to the live key ${JSON.stringify(variable)}`,
			);
		}
	}
}

export function readProvidersPort(env: Record<string, unknown>): number {
	const providersPort = env[PORT_VARIABLE];

	if (typeof providersPort !== 'number' || !Number.isInteger(providersPort)) {
		throw new Error(
			`${JSON.stringify(FAKE_FLAG)} needs the fake providers' port in`
			+ ` ${JSON.stringify(PORT_VARIABLE)}, got`
			+ ` ${JSON.stringify(providersPort ?? null)}`,
		);
	}

	return providersPort;
}

/**
 * The page a checkout's `url` opens in the preview, served only while the fake
 * providers run: without them the route does not exist.
 */
export const subscriptionsExamplesEndpoint = defineEndpoint(
	'subscriptions-examples',
	(router, { env }) => {
		if (env[FAKE_FLAG] !== true) {
			return;
		}

		refuseLiveKeys(env);

		const providersPort = readProvidersPort(env);
		const providersUrl = `http://127.0.0.1:${providersPort}`;

		rerouteProviderApis(providersPort);

		const callFakePay = async (
			paymentId: string,
			payOutcome?: string,
		): Promise<Record<string, unknown>> => {
			const payResponse = await fetch(
				`${providersUrl}/pay/${encodeURIComponent(paymentId)}`,
				payOutcome === undefined
					? {}
					: {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ outcome: payOutcome }),
					},
			);

			if (payResponse.status === 404) {
				throw new UnknownPaymentError({ payment: paymentId });
			}

			const payAnswer = await payResponse.json() as Record<string, unknown>;

			if (!payResponse.ok) {
				throw new InvalidPayloadError({
					reason: `the fake providers refused payment`
						+ ` ${JSON.stringify(paymentId)}:`
						+ ` ${JSON.stringify(payAnswer['error'])}`,
				});
			}

			return payAnswer;
		};

		// Any signed-in user switches the whole preview between the fake
		// providers and the real test-mode ones.
		const callProvidersMode = async (
			requestInit: RequestInit,
		): Promise<Record<string, unknown>> => {
			const modeResponse = await fetch(
				`${providersUrl}/providers-mode`,
				requestInit,
			);

			const modeAnswer = await modeResponse.json() as Record<string, unknown>;

			if (!modeResponse.ok) {
				throw new InvalidPayloadError({
					reason: `the providers mode stays as it was:`
						+ ` ${JSON.stringify(modeAnswer['error'])}`,
				});
			}

			return modeAnswer;
		};

		router.get('/providers-mode', (request, response, next) => {
			if (!(request as AccountableRequest).accountability?.user) {
				next(new ForbiddenError());

				return;
			}

			callProvidersMode({})
				.then((modeAnswer) => response.json({ data: modeAnswer }))
				.catch(next);
		});

		router.put('/providers-mode', (request, response, next) => {
			if (!(request as AccountableRequest).accountability?.user) {
				next(new ForbiddenError());

				return;
			}

			callProvidersMode({
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode: request.body?.mode ?? null }),
			})
				.then((modeAnswer) => response.json({ data: modeAnswer }))
				.catch(next);
		});

		router.get('/pay/:payment', (request, response, next) => {
			callFakePay(request.params.payment)
				.then((payHolding) => {
					response.setHeader('Content-Security-Policy', PAY_PAGE_POLICY);
					response.type('html');
					response.send(composePayPage(payHolding as PayHolding));
				})
				.catch(next);
		});

		router.post(
			'/pay/:payment',
			express.urlencoded({ extended: false }),
			(request, response, next) => {
				const payOutcome: unknown = request.body?.outcome;

				if (typeof payOutcome !== 'string'
					|| !PAY_OUTCOMES.includes(payOutcome)) {
					next(new InvalidPayloadError({
						reason: '"outcome" is "paid", "failed" or "canceled", got'
							+ ` ${JSON.stringify(payOutcome ?? null)}`,
					}));

					return;
				}

				callFakePay(request.params.payment, payOutcome)
					.then((payAnswer) => {
						response.redirect(302, String(payAnswer['redirect_url']));
					})
					.catch(next);
			},
		);
	},
);
