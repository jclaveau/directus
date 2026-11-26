import https from 'node:https';
import type { CheckoutAmount } from './types.js';

export type MollieSessionStart = {
	amount: CheckoutAmount;
	/** The payment's, as on a hosted checkout. */
	description: string;
	planName: string;
	redirectUrl: string;
	customerId: string;
	metadata: Record<string, string>;
};

/** Resolves to the client access token Mollie.js mounts its form from. */
export type MollieSessionCreator = (
	sessionStart: MollieSessionStart,
) => Promise<string>;

/**
 * `POST /v2/sessions`, the in-page form's session (beta): Mollie's client has
 * no binder for it. Sent through `https.request`, which the examples' fake
 * providers reroute. Mollie refuses a `webhookUrl` there, so the payment it
 * makes sends no webhook: the checkout's return looks it up instead.
 */
export function createMollieSessionCreator(
	apiKey: string,
): MollieSessionCreator {
	return async ({
		amount,
		description,
		planName,
		redirectUrl,
		customerId,
		metadata,
	}) => {
		const requestBody = JSON.stringify({
			amount,
			description,
			lines: [{
				description: planName,
				quantity: 1,
				unitPrice: amount,
				totalAmount: amount,
			}],
			redirectUrl,
			sequenceType: 'first',
			customerId,
			metadata,
		});

		const { statusCode, responseText } = await postMollieSession(
			requestBody,
			apiKey,
		);

		const sessionAnswer = readSessionAnswer(responseText);

		if (statusCode !== 201
			|| typeof sessionAnswer?.clientAccessToken !== 'string') {
			throw new Error(
				`Mollie answered ${JSON.stringify(statusCode)} to a session:`
				+ ` ${JSON.stringify(sessionAnswer?.detail ?? responseText)}`,
			);
		}

		return sessionAnswer.clientAccessToken;
	};
}

/** No JSON, a proxy's 502 page: null, and the refusal quotes the raw text. */
function readSessionAnswer(responseText: string): {
	clientAccessToken?: unknown;
	detail?: unknown;
} | null {
	try {
		return JSON.parse(responseText);
	}
	catch {
		return null;
	}
}

function postMollieSession(
	requestBody: string,
	apiKey: string,
): Promise<{ statusCode: number | undefined; responseText: string }> {
	return new Promise((resolve, reject) => {
		const sessionRequest = https.request(
			{
				method: 'POST',
				hostname: 'api.mollie.com',
				path: '/v2/sessions',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(requestBody),
				},
			},
			(sessionResponse) => {
				const responseChunks: Buffer[] = [];

				sessionResponse.on('data', (responseChunk: Buffer) => {
					responseChunks.push(responseChunk);
				});

				sessionResponse.on('error', reject);

				sessionResponse.on('end', () => {
					resolve({
						statusCode: sessionResponse.statusCode,
						responseText: Buffer.concat(responseChunks)
							.toString('utf8'),
					});
				});
			},
		);

		sessionRequest.on('error', reject);
		sessionRequest.end(requestBody);
	});
}
