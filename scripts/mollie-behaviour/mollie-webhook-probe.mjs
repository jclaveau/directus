#!/usr/bin/env node
// Measures how Mollie (test mode) calls webhooks, and fails when that differs
// from the committed baseline: Mollie's docs lag behind its API, so this is the
// only source the subscriptions bundle can trust.
//
// One run:
// 1. starts a local receiver behind a cloudflared quick tunnel
// 2. tries every candidate next-gen event type alone (create, then delete a
//    webhook): Mollie answers 422 for a type it does not know
// 3. creates a next-gen webhook with the accepted types on <tunnel>/next-gen,
//    pings it
// 4. triggers Bancontact one-off payments (paid / failed / canceled / expired /
//    open, each picked on Mollie's test checkout by headless Playwright), a
//    recurring payment on a valid mandate, a refund of it, and a subscription
//    created then canceled; each carries a classic webhookUrl <tunnel>/classic
// 5. listens, then compares what reached which webhook with the baseline
//
// Usage:
//   node scripts/mollie-behaviour/mollie-webhook-probe.mjs \
//     [--listen-seconds 180] [--output-directory <dir>] [--update-baseline]
//
// Env:
//   SUBSCRIPTIONS_MOLLIE_API_KEY  a test_ API key (payments, subscriptions)
//   MOLLIE_PROBE_ACCESS_TOKEN     a test-mode access_ token with webhooks.write
//                                 and every <resource>.read an event type needs
//   CLOUDFLARED_BIN               cloudflared binary (default: on PATH)
//   PLAYWRIGHT_CORE_PATH          playwright-core's index.mjs (default: resolved)
//   GITHUB_STEP_SUMMARY           when set, the result is written there too
//
// Never prints the API key, the access token nor the webhook secret, and
// writes none of them to the output directory.

/* eslint-disable no-console -- a CLI, stdout is its output */
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Resolver } from 'node:dns';
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { get as httpsGet } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: cliOptions } = parseArgs({
	options: {
		'listen-seconds': { type: 'string', default: '180' },
		'output-directory': { type: 'string', default: 'mollie-behaviour-output' },
		'update-baseline': { type: 'boolean', default: false },
	},
});

const listenSeconds = Number(cliOptions['listen-seconds']);

if (!Number.isInteger(listenSeconds) || listenSeconds < 0) {
	const givenSeconds = JSON.stringify(cliOptions['listen-seconds']);
	throw new Error(`--listen-seconds must be a whole number, got ${givenSeconds}`);
}

const outputDirectory = cliOptions['output-directory'];

const baselinePath = join(
	dirname(fileURLToPath(import.meta.url)),
	'mollie-behaviour.baseline.json',
);

// A live subscription on the test account that other tests rely on.
const protectedSubscriptionId = 'sub_Szb8WQnef9';
const probeWebhookPrefix = 'scalabus-probe';

const apiKey = process.env.SUBSCRIPTIONS_MOLLIE_API_KEY ?? '';

if (!/^test_[A-Za-z0-9]+$/.test(apiKey)) {
	throw new Error(
		'SUBSCRIPTIONS_MOLLIE_API_KEY is missing or is not a test_ key',
	);
}

const accessToken = process.env.MOLLIE_PROBE_ACCESS_TOKEN ?? '';

if (!/^access_[A-Za-z0-9]+$/.test(accessToken)) {
	throw new Error(
		'MOLLIE_PROBE_ACCESS_TOKEN is missing or is not an access_ token',
	);
}

// '*' needs business-account permissions a test-mode token cannot get, so each
// type is tried alone. The guesses stay in the list: their 422 is the finding.
const candidateEventTypes = [
	'payment.paid',
	'payment.authorized',
	'payment.failed',
	'payment.canceled',
	'payment.expired',
	'payment.pending',
	'payment-link.paid',
	'sales-invoice.created',
	'sales-invoice.issued',
	'sales-invoice.canceled',
	'sales-invoice.paid',
	'balance-transaction.created',
	'payout.created',
	'payout.paid',
	'payout.failed',
	'unmatched-credit-transfer.received',
	'unmatched-credit-transfer.matched',
	'unmatched-credit-transfer.returned',
	'unmatched-credit-transfer.expired',
	'refund.created',
	'refund.pending',
	'refund.processing',
	'refund.refunded',
	'refund.failed',
	'refund.canceled',
	'chargeback.received',
	'chargeback.reversed',
	'subscription.created',
	'subscription.updated',
	'subscription.canceled',
	'subscription.suspended',
	'subscription.completed',
	'mandate.created',
	'mandate.revoked',
	'mandate.invalid',
	'customer.created',
	'customer.updated',
	'customer.deleted',
];

const checkoutStatuses = ['paid', 'failed', 'canceled', 'expired', 'open'];

// Keys and tokens, plus the organization and profile ids the dashboard links
// in an event carry: the output directory is uploaded on a public repo.
function redactSecrets(rawText) {
	return String(rawText)
		.replace(/(test|live|access|org|pfl)_[A-Za-z0-9]+/g, '$1_REDACTED');
}

mkdirSync(outputDirectory, { recursive: true });
const capturesPath = join(outputDirectory, 'captures.jsonl');
const cloudflaredLogPath = join(outputDirectory, 'cloudflared.log');
const capturedRequests = [];
let webhookSecret = null;

async function callMollie(method, path, { body, bearerToken = apiKey } = {}) {
	const mollieResponse = await fetch(`https://api.mollie.com/v2${path}`, {
		method,
		headers: {
			'Authorization': `Bearer ${bearerToken}`,
			'Content-Type': 'application/json',
		},
		body: body === undefined
			? undefined
			: JSON.stringify(body),
	});

	const responseText = await mollieResponse.text();

	if (!mollieResponse.ok) {
		const mollieError = new Error(
			`Mollie ${method} ${path} answered ${mollieResponse.status}:`
			+ ` ${redactSecrets(responseText)}`,
		);

		mollieError.httpStatus = mollieResponse.status;
		mollieError.responseText = responseText;
		throw mollieError;
	}

	return responseText === ''
		? null
		: JSON.parse(responseText);
}

function checkSignature(rawBody, signatureHeader) {
	if (signatureHeader === undefined) {
		return 'missing';
	}

	if (webhookSecret === null) {
		return 'unchecked (no secret yet)';
	}

	const expectedBuffer = Buffer.from(
		createHmac('sha256', webhookSecret)
			.update(rawBody)
			.digest('hex'),
	);

	const givenBuffer = Buffer.from(
		String(signatureHeader).replace(/^sha256=/, ''),
	);

	return expectedBuffer.length === givenBuffer.length
		&& timingSafeEqual(expectedBuffer, givenBuffer)
		? 'valid'
		: 'invalid';
}

function parseCapturedBody(requestPath, rawBody) {
	if (requestPath.startsWith('/classic')) {
		return { kind: 'classic', formFields: new URLSearchParams(rawBody) };
	}

	if (rawBody === '') {
		return { kind: 'empty' };
	}

	try {
		return { kind: 'event', eventBody: JSON.parse(rawBody) };
	}
	catch {
		return { kind: 'unparsed' };
	}
}

const receiverServer = createServer((incomingRequest, serverResponse) => {
	const bodyChunks = [];
	incomingRequest.on('data', (bodyChunk) => bodyChunks.push(bodyChunk));

	incomingRequest.on('end', () => {
		const rawBody = Buffer.concat(bodyChunks).toString('utf8');

		if (incomingRequest.method === 'GET') {
			serverResponse.writeHead(200).end('ok');
			return;
		}

		const capturedRequest = {
			receivedAt: new Date().toISOString(),
			path: incomingRequest.url,
			contentType: incomingRequest.headers['content-type'] ?? null,
			userAgent: incomingRequest.headers['user-agent'] ?? null,
			signatureStatus: checkSignature(
				rawBody,
				incomingRequest.headers['x-mollie-signature'],
			),
			rawBody,
		};

		capturedRequests.push(capturedRequest);

		appendFileSync(
			capturesPath,
			`${redactSecrets(JSON.stringify(capturedRequest))}\n`,
		);

		console.log(
			`  <- ${capturedRequest.path} ${rawBody.length} bytes`
			+ ` signature=${capturedRequest.signatureStatus}`,
		);

		serverResponse.writeHead(200).end();
	});
});

await new Promise((resolveListen) => {
	receiverServer.listen(0, '127.0.0.1', resolveListen);
});

const receiverPort = receiverServer.address().port;

const tunnelProcess = spawn(
	process.env.CLOUDFLARED_BIN ?? 'cloudflared',
	['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${receiverPort}`],
	{ stdio: ['ignore', 'pipe', 'pipe'] },
);

const cleanupSteps = [];
let cleanupStarted = false;

async function runCleanup() {
	if (cleanupStarted) {
		return;
	}

	cleanupStarted = true;
	console.log('\n== cleanup');

	for (const cleanupStep of cleanupSteps.reverse()) {
		try {
			await cleanupStep();
		}
		catch (cleanupError) {
			const errorText = redactSecrets(JSON.stringify(String(cleanupError)));
			console.log(`  cleanup step failed: ${errorText}`);
			process.exitCode = 1;
		}
	}

	tunnelProcess.kill('SIGTERM');
	receiverServer.close();
	console.log('  tunnel stopped, receiver closed');
}

process.on('SIGINT', async () => {
	await runCleanup();
	process.exit(130);
});

function printCloudflaredTail() {
	const logLines = readFileSync(cloudflaredLogPath, 'utf8')
		.trim()
		.split('\n');

	console.log(`  last cloudflared lines (${cloudflaredLogPath}):`);

	for (const logLine of logLines.slice(-15)) {
		console.log(`    ${logLine}`);
	}
}

// The URL is printed before the edge registers the tunnel: wait for both.
const tunnelUrl = await new Promise((resolveUrl, rejectUrl) => {
	let announcedUrl = null;
	let connectionRegistered = false;

	const urlTimeout = setTimeout(() => {
		printCloudflaredTail();

		rejectUrl(new Error(
			`cloudflared not ready in 45 s (url ${JSON.stringify(announcedUrl)},`
			+ ` registered ${connectionRegistered})`,
		));
	}, 45_000);

	const watchOutput = (outputChunk) => {
		const outputText = String(outputChunk);
		appendFileSync(cloudflaredLogPath, outputText);

		announcedUrl ??= outputText
			.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null;

		connectionRegistered ||= outputText
			.includes('Registered tunnel connection');

		if (announcedUrl !== null && connectionRegistered) {
			clearTimeout(urlTimeout);
			resolveUrl(announcedUrl);
		}
	};

	tunnelProcess.stdout.on('data', watchOutput);
	tunnelProcess.stderr.on('data', watchOutput);

	tunnelProcess.on('exit', (exitCode) => {
		rejectUrl(new Error(`cloudflared exited with ${JSON.stringify(exitCode)}`));
	});
});

// A local resolver may cache the NXDOMAIN of a hostname asked before Cloudflare
// published it; resolving through 1.1.1.1 keeps that cache out of the check.
const publicResolver = new Resolver();
publicResolver.setServers(['1.1.1.1', '1.0.0.1']);

function lookupThroughPublicResolver(hostName, lookupOptions, lookupCallback) {
	publicResolver.resolve4(hostName, (resolveError, resolvedAddresses) => {
		if (resolveError) {
			lookupCallback(resolveError);
			return;
		}

		if (lookupOptions.all) {
			lookupCallback(null, resolvedAddresses.map((resolvedAddress) => {
				return { address: resolvedAddress, family: 4 };
			}));

			return;
		}

		lookupCallback(null, resolvedAddresses[0], 4);
	});
}

function requestTunnelHealth() {
	return new Promise((resolveStatus, rejectStatus) => {
		const healthRequest = httpsGet(
			`${tunnelUrl}/health`,
			{ lookup: lookupThroughPublicResolver, timeout: 5_000 },
			(healthResponse) => {
				healthResponse.resume();
				resolveStatus(healthResponse.statusCode);
			},
		);

		healthRequest.on('timeout', () => {
			healthRequest.destroy(new Error('health request timed out'));
		});

		healthRequest.on('error', rejectStatus);
	});
}

function waitSeconds(secondCount) {
	return new Promise((resolveDelay) => {
		setTimeout(resolveDelay, secondCount * 1_000);
	});
}

async function waitForTunnel() {
	let lastFailure = null;

	for (let attemptNumber = 0; attemptNumber < 30; attemptNumber++) {
		try {
			const healthStatus = await requestTunnelHealth();

			if (healthStatus === 200) {
				return;
			}

			lastFailure = `HTTP ${healthStatus}`;
		}
		catch (healthError) {
			lastFailure = String(healthError);
		}

		await waitSeconds(2);
	}

	printCloudflaredTail();

	throw new Error(
		`tunnel ${JSON.stringify(tunnelUrl)} not reachable after 60 s,`
		+ ` last ${JSON.stringify(lastFailure)}`,
	);
}

async function deleteLeftoverWebhooks() {
	const webhookList = await callMollie('GET', '/webhooks?testmode=true', {
		bearerToken: accessToken,
	});

	for (const listedWebhook of webhookList._embedded.webhooks) {
		if (!listedWebhook.name.startsWith(probeWebhookPrefix)) {
			continue;
		}

		await callMollie('DELETE', `/webhooks/${listedWebhook.id}`, {
			bearerToken: accessToken,
			body: { testmode: true },
		});

		console.log(`  deleted leftover ${listedWebhook.id}`);
	}
}

async function tryEventTypes(nextGenUrl) {
	const eventTypeVerdicts = {};
	const refusalDetails = {};

	for (const candidateType of candidateEventTypes) {
		let trialWebhook = null;

		try {
			trialWebhook = await callMollie('POST', '/webhooks', {
				bearerToken: accessToken,
				body: {
					name: `${probeWebhookPrefix}-trial`,
					url: nextGenUrl,
					eventTypes: [candidateType],
					testmode: true,
				},
			});

			eventTypeVerdicts[candidateType] = 'accepted';
		}
		catch (trialError) {
			if (trialError.httpStatus === undefined) {
				throw trialError;
			}

			// Only the status is compared: Mollie rewords its error details.
			eventTypeVerdicts[candidateType] = String(trialError.httpStatus);

			refusalDetails[candidateType] =
				JSON.parse(trialError.responseText).detail;
		}

		// Outside the catch: a failed delete stops the run, never reads as a
		// refusal.
		if (trialWebhook !== null) {
			await callMollie('DELETE', `/webhooks/${trialWebhook.id}`, {
				bearerToken: accessToken,
				body: { testmode: true },
			});
		}

		console.log(`  ${candidateType}: ${eventTypeVerdicts[candidateType]}`);
	}

	writeFileSync(
		join(outputDirectory, 'event-type-refusals.json'),
		`${JSON.stringify(refusalDetails, null, '\t')}\n`,
	);

	return eventTypeVerdicts;
}

// A run killed before its cleanup leaves a probe subscription billing the
// test customer every month.
async function cancelLeftoverSubscriptions() {
	const customerList = await callMollie('GET', '/customers?limit=50');

	for (const listedCustomer of customerList._embedded.customers) {
		const customerPath = `/customers/${listedCustomer.id}/subscriptions`;
		const subscriptionList = await callMollie('GET', customerPath);

		for (const listedSubscription of subscriptionList._embedded.subscriptions) {
			const isProbeSubscription = listedSubscription.status === 'active'
				&& listedSubscription.description.startsWith('scalabus probe ');

			if (!isProbeSubscription) {
				continue;
			}

			if (listedSubscription.id === protectedSubscriptionId) {
				throw new Error(
					`refusing to touch ${JSON.stringify(protectedSubscriptionId)}`,
				);
			}

			await callMollie('DELETE', `${customerPath}/${listedSubscription.id}`);
			console.log(`  canceled leftover ${listedSubscription.id}`);
		}
	}
}

async function findMandateCustomer() {
	const customerList = await callMollie('GET', '/customers?limit=50');

	for (const listedCustomer of customerList._embedded.customers) {
		const mandateList = await callMollie(
			'GET',
			`/customers/${listedCustomer.id}/mandates`,
		);

		const listedMandates = mandateList._embedded.mandates;

		if (listedMandates.some((listedMandate) => listedMandate.status === 'valid')) {
			return listedCustomer.id;
		}
	}

	return null;
}

// Every capture whose body names one of the entity ids, described without ids
// or timestamps so two runs compare equal.
function describeCapturesFor(entityIds) {
	const classicCalls = new Set();
	const nextGenCalls = new Set();

	for (const capturedRequest of capturedRequests) {
		const namesEntity = entityIds.some((entityId) => {
			return capturedRequest.rawBody.includes(entityId);
		});

		if (!namesEntity) {
			continue;
		}

		const parsedBody = parseCapturedBody(
			capturedRequest.path,
			capturedRequest.rawBody,
		);

		if (parsedBody.kind === 'classic') {
			const fieldNames = [...parsedBody.formFields.keys()].sort().join(',');

			classicCalls.add(
				`${capturedRequest.contentType}; fields ${fieldNames};`
				+ ` signature ${capturedRequest.signatureStatus}`,
			);

			continue;
		}

		const eventType = parsedBody.kind === 'event'
			? parsedBody.eventBody.type
			: parsedBody.kind;

		nextGenCalls.add(
			`${eventType}; signature ${capturedRequest.signatureStatus}`,
		);
	}

	return {
		classic: [...classicCalls].sort(),
		nextGen: [...nextGenCalls].sort(),
	};
}

function describeEventEnvelopes() {
	const envelopeShapes = new Set();

	for (const capturedRequest of capturedRequests) {
		const parsedBody = parseCapturedBody(
			capturedRequest.path,
			capturedRequest.rawBody,
		);

		if (parsedBody.kind !== 'event') {
			continue;
		}

		const topKeys = Object.keys(parsedBody.eventBody)
			.sort()
			.join(',');

		const entityResource = parsedBody.eventBody._embedded?.entity?.resource;

		envelopeShapes.add(
			`${capturedRequest.contentType}; ${topKeys}; entity ${entityResource};`
			+ ` ${capturedRequest.userAgent}`,
		);
	}

	return [...envelopeShapes].sort();
}

function isPlainObject(candidateValue) {
	return typeof candidateValue === 'object'
		&& candidateValue !== null
		&& !Array.isArray(candidateValue);
}

// Lists every leaf where the two values differ, as `path: baseline → observed`.
function listDifferences(baselineValue, observedValue, valuePath = '') {
	if (!isPlainObject(baselineValue) || !isPlainObject(observedValue)) {
		const baselineText = JSON.stringify(baselineValue);
		const observedText = JSON.stringify(observedValue);

		return baselineText === observedText
			? []
			: [`${valuePath}: ${baselineText} → ${observedText}`];
	}

	const allKeys = new Set([
		...Object.keys(baselineValue),
		...Object.keys(observedValue),
	]);

	return [...allKeys].sort().flatMap((childKey) => {
		return listDifferences(
			baselineValue[childKey],
			observedValue[childKey],
			valuePath === ''
				? childKey
				: `${valuePath}.${childKey}`,
		);
	});
}

function writeStepSummary(observedBehaviour, behaviourDifferences) {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;

	if (summaryPath === undefined) {
		return;
	}

	const summaryLines = ['## Mollie webhook behaviour', ''];

	if (behaviourDifferences.length === 0) {
		summaryLines.push('Matches the baseline.', '');
	}
	else {
		summaryLines.push(
			`**${behaviourDifferences.length} difference(s) from the baseline:**`,
			'',
			'```',
			...behaviourDifferences,
			'```',
			'',
		);
	}

	summaryLines.push(
		'| action | classic webhook | next-gen webhook |',
		'|---|---|---|',
	);

	const observedActions = Object.entries(observedBehaviour.actions);

	for (const [actionName, actionCalls] of observedActions) {
		const classicCell = actionCalls.classic.join('<br>') || '—';
		const nextGenCell = actionCalls.nextGen.join('<br>') || '—';
		summaryLines.push(`| ${actionName} | ${classicCell} | ${nextGenCell} |`);
	}

	const typeVerdicts = Object.entries(observedBehaviour.eventTypes);

	const acceptedTypes = typeVerdicts
		.filter(([, typeVerdict]) => typeVerdict === 'accepted')
		.map(([eventType]) => eventType);

	const refusedTypes = typeVerdicts
		.filter(([, typeVerdict]) => typeVerdict !== 'accepted')
		.map(([eventType, typeVerdict]) => `${eventType} (${typeVerdict})`);

	summaryLines.push(
		'',
		`**Accepted event types:** ${acceptedTypes.join(', ')}`,
		'',
		`**Refused event types:** ${refusedTypes.join(', ') || 'none'}`,
		'',
	);

	appendFileSync(summaryPath, `${redactSecrets(summaryLines.join('\n'))}\n`);
}

try {
	console.log(`== tunnel ${tunnelUrl} -> 127.0.0.1:${receiverPort}`);
	await waitForTunnel();
	console.log('  tunnel reachable');

	const nextGenUrl = `${tunnelUrl}/next-gen`;
	const classicUrl = `${tunnelUrl}/classic`;

	const observedBehaviour = {
		eventTypes: {},
		webhookCreation: [],
		envelopes: [],
		actions: {},
	};

	console.log('\n== next-gen event types');
	await deleteLeftoverWebhooks();
	await cancelLeftoverSubscriptions();
	observedBehaviour.eventTypes = await tryEventTypes(nextGenUrl);

	const acceptedEventTypes = Object.keys(observedBehaviour.eventTypes)
		.filter((eventType) => {
			return observedBehaviour.eventTypes[eventType] === 'accepted';
		});

	if (acceptedEventTypes.length === 0) {
		throw new Error('Mollie accepted none of the candidate event types');
	}

	console.log('\n== next-gen webhook');

	const createdWebhook = await callMollie('POST', '/webhooks', {
		bearerToken: accessToken,
		body: {
			name: probeWebhookPrefix,
			url: nextGenUrl,
			eventTypes: acceptedEventTypes,
			testmode: true,
		},
	});

	webhookSecret = createdWebhook.webhookSecret;
	console.log(`  created ${createdWebhook.id}`);

	cleanupSteps.push(async () => {
		await callMollie('DELETE', `/webhooks/${createdWebhook.id}`, {
			bearerToken: accessToken,
			body: { testmode: true },
		});

		console.log(`  deleted webhook ${createdWebhook.id}`);
	});

	// Before the ping, the only next-gen calls are the ones webhook creation
	// sends.
	const creationCalls = new Set();

	for (const capturedRequest of capturedRequests) {
		const parsedBody = parseCapturedBody(
			capturedRequest.path,
			capturedRequest.rawBody,
		);

		const signatureHeld = capturedRequest.signatureStatus === 'missing'
			? 'no signature header'
			: 'signature header';

		creationCalls.add(`${parsedBody.kind} body; ${signatureHeld}`);
	}

	observedBehaviour.webhookCreation = [...creationCalls].sort();

	await callMollie('POST', `/webhooks/${createdWebhook.id}/ping`, {
		bearerToken: accessToken,
		body: { testmode: true },
	});

	console.log('  ping sent');
	const actionEntityIds = { 'webhook ping': [createdWebhook.id] };

	console.log('\n== customer with a valid mandate');
	const mandateCustomerId = await findMandateCustomer();

	if (mandateCustomerId === null) {
		throw new Error(
			'no test customer has a valid mandate: create one with a first payment',
		);
	}

	console.log(`  ${mandateCustomerId}`);

	// Bancontact's test checkout offers every final state as a radio
	// (`final_state`); the card checkout has no "canceled" and sits in iframes.
	console.log('\n== one-off Bancontact payments, status picked by Playwright');

	const { chromium } = await import(
		process.env.PLAYWRIGHT_CORE_PATH ?? 'playwright-core'
	);

	const checkoutBrowser = await chromium.launch();
	cleanupSteps.push(async () => checkoutBrowser.close());
	const paymentStatuses = {};

	for (const wantedStatus of checkoutStatuses) {
		const createdPayment = await callMollie('POST', '/payments', {
			body: {
				amount: { currency: 'EUR', value: '1.00' },
				description: `scalabus probe ${wantedStatus}`,
				method: 'bancontact',
				redirectUrl: `${tunnelUrl}/return`,
				webhookUrl: classicUrl,
			},
		});

		const checkoutPage = await checkoutBrowser.newPage();

		await checkoutPage.goto(createdPayment._links.checkout.href, {
			waitUntil: 'networkidle',
		});

		await checkoutPage.check(
			`input[name="final_state"][value="${wantedStatus}"]`,
		);

		await Promise.all([
			// expired stops on Mollie's own completed page, with no redirect
			checkoutPage.waitForURL(
				(pageUrl) => {
					return pageUrl.href.startsWith(tunnelUrl)
						|| pageUrl.pathname === '/checkout/test-mode/completed';
				},
				{ timeout: 30_000 },
			),
			checkoutPage.click('button[name="submit"]'),
		]);

		await checkoutPage.close();

		const pickedPayment = await callMollie(
			'GET',
			`/payments/${createdPayment.id}`,
		);

		paymentStatuses[`one-off ${wantedStatus}`] = pickedPayment.status;
		actionEntityIds[`one-off ${wantedStatus}`] = [createdPayment.id];

		console.log(
			`  ${createdPayment.id} picked ${wantedStatus},`
			+ ` now ${pickedPayment.status}`,
		);
	}

	console.log('\n== recurring payment on the mandate, then a refund');

	const recurringPayment = await callMollie('POST', '/payments', {
		body: {
			amount: { currency: 'EUR', value: '1.00' },
			description: 'scalabus probe recurring',
			customerId: mandateCustomerId,
			sequenceType: 'recurring',
			webhookUrl: classicUrl,
		},
	});

	const recurringPath = `/payments/${recurringPayment.id}`;
	let recurringStatus = recurringPayment.status;

	for (
		let pollNumber = 0;
		pollNumber < 20 && recurringStatus !== 'paid';
		pollNumber++
	) {
		await waitSeconds(3);
		recurringStatus = (await callMollie('GET', recurringPath)).status;
	}

	paymentStatuses['recurring payment'] = recurringStatus;
	actionEntityIds['recurring payment'] = [recurringPayment.id];
	console.log(`  ${recurringPayment.id} ${recurringStatus}`);
	let createdRefund = null;

	if (recurringStatus === 'paid') {
		createdRefund = await callMollie('POST', `${recurringPath}/refunds`, {
			body: { amount: { currency: 'EUR', value: '1.00' } },
		});

		actionEntityIds['refund of the recurring payment'] = [createdRefund.id];
		console.log(`  refund ${createdRefund.id} ${createdRefund.status}`);
	}

	console.log('\n== subscription, created then canceled');

	const probeSubscription = await callMollie(
		'POST',
		`/customers/${mandateCustomerId}/subscriptions`,
		{
			body: {
				amount: { currency: 'EUR', value: '1.00' },
				interval: '1 month',
				description: `scalabus probe ${Date.now()}`,
				webhookUrl: classicUrl,
			},
		},
	);

	const subscriptionPath =
		`/customers/${mandateCustomerId}/subscriptions/${probeSubscription.id}`;

	let subscriptionCanceled = false;

	cleanupSteps.push(async () => {
		if (subscriptionCanceled) {
			return;
		}

		await callMollie('DELETE', subscriptionPath);
		console.log(`  canceled ${probeSubscription.id}`);
	});

	await waitSeconds(20);
	await callMollie('DELETE', subscriptionPath);
	subscriptionCanceled = true;

	actionEntityIds['subscription created then canceled'] = [
		probeSubscription.id,
	];

	console.log(`  ${probeSubscription.id} created, then canceled`);

	console.log(`\n== listening ${listenSeconds} s`);
	await waitSeconds(listenSeconds);

	if (createdRefund !== null) {
		const settledRefund = await callMollie(
			'GET',
			`${recurringPath}/refunds/${createdRefund.id}`,
		);

		paymentStatuses['refund of the recurring payment'] = settledRefund.status;
	}

	for (const [actionName, entityIds] of Object.entries(actionEntityIds)) {
		observedBehaviour.actions[actionName] = {
			status: paymentStatuses[actionName] ?? null,
			...describeCapturesFor(entityIds),
		};
	}

	observedBehaviour.envelopes = describeEventEnvelopes();
	const observedJson = `${JSON.stringify(observedBehaviour, null, '\t')}\n`;
	writeFileSync(join(outputDirectory, 'observed-behaviour.json'), observedJson);

	if (cliOptions['update-baseline']) {
		writeFileSync(baselinePath, observedJson);
		console.log(`\n== baseline rewritten: ${baselinePath}`);
	}
	else {
		const behaviourDifferences = listDifferences(
			JSON.parse(readFileSync(baselinePath, 'utf8')),
			observedBehaviour,
		);

		writeStepSummary(observedBehaviour, behaviourDifferences);

		if (behaviourDifferences.length === 0) {
			console.log('\n== matches the baseline');
		}
		else {
			console.log(
				`\n== ${behaviourDifferences.length} difference(s) from the baseline`,
			);

			for (const behaviourDifference of behaviourDifferences) {
				console.log(`  ${behaviourDifference}`);
			}

			process.exitCode = 1;
		}
	}
}
catch (probeError) {
	const errorText = redactSecrets(JSON.stringify(String(probeError)));
	console.log(`\nprobe failed: ${errorText}`);
	process.exitCode = 1;
}
finally {
	await runCleanup();
}
