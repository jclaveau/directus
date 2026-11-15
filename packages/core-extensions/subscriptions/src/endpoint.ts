import { InvalidPayloadError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk/scalabus';
import type { Accountability } from '@directus/types';
import type { Request } from 'express';
import { cancelOwnSubscription } from './cancel/cancel-own-subscription.js';
import { readChosenSubscription } from './cancel/read-chosen-subscription.js';
import { resumeOwnSubscription } from './cancel/resume-own-subscription.js';
import { readSubscriptionsConfig } from './config/read-subscriptions-config.js';
import { addOwnBeneficiary } from './members/add-own-beneficiary.js';
import { archivePlan } from './plans/archive-plan.js';
import { createProviders } from './providers/create-providers.js';
import { receiveWebhook } from './webhook/receive-webhook.js';

type AccountableRequest = Request & { accountability?: Accountability | null };

export const subscriptionsEndpoint = defineEndpoint(
	'subscriptions',
	(router, { env, database, logger }) => {
		const enabledProviders = createProviders(readSubscriptionsConfig(env));

		router.post('/webhooks/:provider', (request, response, next) => {
			if (!Buffer.isBuffer(request.body)) {
				next(new InvalidPayloadError({
					reason: 'the webhook body was not read raw',
				}));

				return;
			}

			receiveWebhook({
				database,
				enabledProviders,
				providerName: String(request.params['provider']),
				rawBody: request.body,
				requestHeaders: request.headers,
				logger,
			})
				.then(() => {
					response.status(200)
						.end();
				}, next);
		});

		router.post('/cancel', (request: AccountableRequest, response, next) => {
			Promise.resolve()
				.then(() => {
					return cancelOwnSubscription({
						database,
						enabledProviders,
						userId: request.accountability?.user ?? null,
						subscriptionId: readChosenSubscription(request.body),
					});
				})
				.then(() => {
					response.status(204)
						.end();
				}, next);
		});

		router.post('/resume', (request: AccountableRequest, response, next) => {
			Promise.resolve()
				.then(() => {
					return resumeOwnSubscription({
						database,
						enabledProviders,
						userId: request.accountability?.user ?? null,
						subscriptionId: readChosenSubscription(request.body),
					});
				})
				.then(() => {
					response.status(204)
						.end();
				}, next);
		});

		router.post(
			'/beneficiaries',
			(request: AccountableRequest, response, next) => {
				addOwnBeneficiary({
					database,
					enabledProviders,
					userId: request.accountability?.user ?? null,
					requestBody: request.body,
				})
					.then((beneficiaryId) => {
						response.json({ data: { id: beneficiaryId } });
					}, next);
			},
		);

		router.post(
			'/plans/:id/archive',
			(request: AccountableRequest, response, next) => {
				archivePlan({
					database,
					enabledProviders,
					planId: String(request.params['id']),
					confirmation: request.body?.confirmation,
					accountability: request.accountability ?? null,
				})
					.then((archivedPlan) => {
						response.json({ data: archivedPlan });
					}, next);
			},
		);
	},
);
