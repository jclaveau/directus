/* eslint-disable no-console -- a CLI, stdout is its output */
// Probes what Stripe's test mode really sends and answers for the calls and
// events the subscriptions bundle relies on, then compares that with
// stripe-behaviour.baseline.json. The bundle's unit tests and the blackbox
// fake Stripe are written from that baseline, not from Stripe's docs.
//
// A run:
//   1. deletes the test clocks and webhook endpoints a previous run left;
//   2. opens a cloudflared quick tunnel to a local receiver;
//   3. creates a webhook endpoint for every event type on that tunnel, pinned to
//      the API version the bundle's stripe SDK sends;
//   4. on a test clock, creates a customer and a subscription paid by
//      pm_card_visa, then: sets cancel_at_period_end, unsets it, advances the
//      clock past the period end (renewal), cancels it now;
//   5. retrieves a subscription that does not exist;
//   6. after --listen-seconds, writes what each step returned and what reached
//      the webhook, and diffs it with the baseline.
//
// Usage:
//   SUBSCRIPTIONS_STRIPE_SECRET_KEY=sk_test_... \
//     node scripts/stripe-behaviour/stripe-webhook-probe.mjs \
//     [--listen-seconds 60] [--output-directory dir] [--update-baseline]
//
// Never prints the secret key nor the webhook secret, and writes neither to the
// output directory. One run at a time per account: a run's start deletes every
// test clock and webhook endpoint a probe made.

import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Resolver } from 'node:dns';
import {
	appendFileSync,
	existsSync,
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
		'listen-seconds': { type: 'string', default: '60' },
		'output-directory': { type: 'string', default: 'stripe-behaviour-output' },
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
	'stripe-behaviour.baseline.json',
);

// The version stripe@23.1.0 (the catalog's) sends: the bundle reads payloads
// shaped by it, so the probe asks for the same.
const stripeApiVersion = '2026-10-28.endive';
const probeName = 'scalabus-probe';
const probeProductId = 'scalabus_probe';
const probeDirectusSubscription = '424242';
const missingSubscriptionId = 'sub_scalabusprobemissing';

const secretKey = process.env.SUBSCRIPTIONS_STRIPE_SECRET_KEY ?? '';

if (!/^sk_test_[A-Za-z0-9]+$/.test(secretKey)) {
	throw new Error(
		'SUBSCRIPTIONS_STRIPE_SECRET_KEY is missing or is not an sk_test_ key',
	);
}

// The output directory is uploaded on a public repo.
function redactSecrets(rawText) {
	return String(rawText)
		.replace(/\b([sr]k_(?:test|live))_[A-Za-z0-9]+/g, '$1_REDACTED')
		.replace(/\bwhsec_[A-Za-z0-9]+/g, 'whsec_REDACTED');
}

mkdirSync(outputDirectory, { recursive: true });
const capturesPath = join(outputDirectory, 'captures.jsonl');
const cloudflaredLogPath = join(outputDirectory, 'cloudflared.log');
const capturedEvents = [];
let webhookSecret = null;

// Stripe takes form-encoded bodies, nested keys as `a[b][0]=c`.
function encodeStripeForm(formValue, keyPrefix = '', formParams = null) {
	const encodedParams = formParams ?? new URLSearchParams();

	for (const [childKey, childValue] of Object.entries(formValue)) {
		const fullKey = keyPrefix === ''
			? childKey
			: `${keyPrefix}[${childKey}]`;

		if (typeof childValue === 'object' && childValue !== null) {
			encodeStripeForm(childValue, fullKey, encodedParams);
			continue;
		}

		encodedParams.append(fullKey, String(childValue));
	}

	return encodedParams;
}

// Answers `{ httpStatus, requestId, body }`, a 4xx included: a refusal is a
// behaviour the baseline records. A 5xx or a network failure throws.
async function callStripeOutcome(method, path, formValue) {
	const stripeResponse = await fetch(`https://api.stripe.com${path}`, {
		method,
		headers: {
			'Authorization': `Bearer ${secretKey}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'Stripe-Version': stripeApiVersion,
		},
		body: formValue === undefined
			? undefined
			: encodeStripeForm(formValue).toString(),
	});

	const responseText = await stripeResponse.text();

	if (stripeResponse.status >= 500) {
		throw new Error(
			`Stripe ${method} ${path} answered ${stripeResponse.status}:`
			+ ` ${redactSecrets(responseText)}`,
		);
	}

	return {
		httpStatus: stripeResponse.status,
		requestId: stripeResponse.headers.get('request-id'),
		body: JSON.parse(responseText),
	};
}

async function callStripe(method, path, formValue) {
	const stripeOutcome = await callStripeOutcome(method, path, formValue);

	if (stripeOutcome.httpStatus >= 400) {
		const responseText = JSON.stringify(stripeOutcome.body);

		throw new Error(
			`Stripe ${method} ${path} answered ${stripeOutcome.httpStatus}:`
			+ ` ${redactSecrets(responseText)}`,
		);
	}

	return stripeOutcome;
}

// What stripe.webhooks.constructEvent checks: `t=<unix>` plus one `v1=` holding
// the hex HMAC-SHA256 of `<t>.<raw body>` under the endpoint's secret. Names
// the header's keys too, so a new scheme shows in the baseline diff.
function checkSignature(rawBodyBytes, signatureHeader) {
	if (signatureHeader === undefined) {
		return 'missing';
	}

	if (Array.isArray(signatureHeader)) {
		return `${signatureHeader.length} header lines`;
	}

	const headerParts = signatureHeader.split(',').map((headerPart) => {
		const separatorIndex = headerPart.indexOf('=');

		return [
			headerPart.slice(0, separatorIndex),
			headerPart.slice(separatorIndex + 1),
		];
	});

	const headerKeys = [...new Set(headerParts.map(([partKey]) => partKey))]
		.sort()
		.join(',');

	const signedAt = headerParts.find(([partKey]) => partKey === 't')?.[1];

	if (webhookSecret === null || signedAt === undefined) {
		return `unchecked (${headerKeys})`;
	}

	const expectedHex = createHmac('sha256', webhookSecret)
		.update(`${signedAt}.`)
		.update(rawBodyBytes)
		.digest('hex');

	const hasValidSignature = headerParts.some(([partKey, partValue]) => {
		return partKey === 'v1'
			&& partValue.length === expectedHex.length
			&& timingSafeEqual(Buffer.from(partValue), Buffer.from(expectedHex));
	});

	return `${hasValidSignature
		? 'valid'
		: 'invalid'} (${headerKeys})`;
}

let currentActionName = 'setup';

const receiverServer = createServer((incomingRequest, serverResponse) => {
	const bodyChunks = [];
	incomingRequest.on('data', (bodyChunk) => bodyChunks.push(bodyChunk));

	incomingRequest.on('end', () => {
		if (incomingRequest.method === 'GET') {
			serverResponse.writeHead(200).end('ok');
			return;
		}

		const rawBodyBytes = Buffer.concat(bodyChunks);
		const rawBody = rawBodyBytes.toString('utf8');
		let eventBody = null;

		try {
			eventBody = JSON.parse(rawBody);
		}
		catch {
			eventBody = null;
		}

		const capturedEvent = {
			receivedAt: new Date().toISOString(),
			actionAtArrival: currentActionName,
			contentType: incomingRequest.headers['content-type'] ?? null,
			userAgent: incomingRequest.headers['user-agent'] ?? null,
			signatureStatus: checkSignature(
				rawBodyBytes,
				incomingRequest.headers['stripe-signature'],
			),
			eventBody,
		};

		capturedEvents.push(capturedEvent);

		appendFileSync(
			capturesPath,
			`${redactSecrets(JSON.stringify(capturedEvent))}\n`,
		);

		console.log(
			`  <- ${eventBody?.type ?? 'unparsed'}`
			+ ` signature=${capturedEvent.signatureStatus}`,
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

// Deleting a test clock deletes its customers and their subscriptions.
async function deleteLeftovers() {
	const clockList = await callStripe(
		'GET',
		'/v1/test_helpers/test_clocks?limit=100',
	);

	for (const testClock of clockList.body.data) {
		if (testClock.name?.startsWith(probeName)) {
			await callStripe('DELETE', `/v1/test_helpers/test_clocks/${testClock.id}`);
			console.log(`  deleted leftover test clock ${testClock.id}`);
		}
	}

	const endpointList = await callStripe('GET', '/v1/webhook_endpoints?limit=100');

	for (const webhookEndpoint of endpointList.body.data) {
		if (webhookEndpoint.description?.startsWith(probeName)) {
			await callStripe('DELETE', `/v1/webhook_endpoints/${webhookEndpoint.id}`);
			console.log(`  deleted leftover webhook endpoint ${webhookEndpoint.id}`);
		}
	}
}

// A fixed id, so runs share one product instead of piling them up.
async function ensureProbeProduct() {
	const productOutcome = await callStripeOutcome(
		'GET',
		`/v1/products/${probeProductId}`,
	);

	if (productOutcome.httpStatus === 200) {
		return;
	}

	await callStripe('POST', '/v1/products', {
		id: probeProductId,
		name: probeName,
	});
}

async function waitForClockReady(testClockId) {
	for (let pollNumber = 0; pollNumber < 60; pollNumber++) {
		const clockOutcome = await callStripe(
			'GET',
			`/v1/test_helpers/test_clocks/${testClockId}`,
		);

		if (clockOutcome.body.status === 'ready') {
			return;
		}

		if (clockOutcome.body.status !== 'advancing') {
			throw new Error(
				`test clock ${JSON.stringify(testClockId)} is`
				+ ` ${JSON.stringify(clockOutcome.body.status)}`,
			);
		}

		await waitSeconds(5);
	}

	throw new Error(
		`test clock ${JSON.stringify(testClockId)} still advancing after 300 s`,
	);
}

function countMonths(fromSeconds, toSeconds) {
	const fromDate = new Date(fromSeconds * 1_000);
	const toDate = new Date(toSeconds * 1_000);

	return (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12
		+ toDate.getUTCMonth() - fromDate.getUTCMonth();
}

// The fields StripeProvider.fetchSubscription reads, as it would read them.
function describeSubscription(stripeSubscription, startPeriodEnd) {
	const subscriptionItems = stripeSubscription.items.data;
	const firstItem = subscriptionItems[0];

	return {
		'status': stripeSubscription.status,
		'cancel_at_period_end': stripeSubscription.cancel_at_period_end,
		'customer': typeof stripeSubscription.customer,
		'metadata': stripeSubscription.metadata,
		'items.data': `${subscriptionItems.length} item(s)`,
		'items.data[0].current_period_end': typeof firstItem?.current_period_end,
		'items.data[0].current_period_end months after the first':
			countMonths(startPeriodEnd, firstItem.current_period_end),
		'items.data[0].price': {
			unit_amount: firstItem.price.unit_amount,
			currency: firstItem.price.currency,
			recurring: {
				interval: firstItem.price.recurring?.interval,
				interval_count: firstItem.price.recurring?.interval_count,
			},
		},
	};
}

// Which id StripeProvider.verifyWebhook would take from the event, or why it
// would ignore it.
function describeSubscriptionRead(eventBody, probeSubscriptionId) {
	const eventObject = eventBody.data?.object;
	let readSubscription = null;
	let readPath = null;

	if (eventBody.type.startsWith('customer.subscription.')) {
		readPath = 'data.object.id';
		readSubscription = eventObject?.id;
	}
	else if (eventBody.type.startsWith('invoice.')) {
		readPath = 'data.object.parent.subscription_details.subscription';
		readSubscription = eventObject?.parent?.subscription_details?.subscription;

		if (typeof readSubscription === 'object' && readSubscription !== null) {
			readSubscription = readSubscription.id;
		}
	}
	else {
		return 'not handled';
	}

	if (readSubscription === probeSubscriptionId) {
		return `subscription at ${readPath}`;
	}

	return readSubscription === undefined || readSubscription === null
		? `no subscription at ${readPath}`
		: `another subscription at ${readPath}`;
}

function describeActionEvents(actionRequestIds, probeSubscriptionId) {
	const describedEvents = {};

	for (const capturedEvent of capturedEvents) {
		if (capturedEvent.eventBody === null) {
			describedEvents['unparsed body'] ??= [];

			describedEvents['unparsed body'].push(
				`${capturedEvent.contentType}; signature ${capturedEvent.signatureStatus}`,
			);

			continue;
		}

		const eventRequestId = capturedEvent.eventBody.request?.id ?? null;

		// An event no API call caused (a test clock advance) belongs to the
		// action running when it arrived.
		const actionName = Object.entries(actionRequestIds)
			.find(([, requestIds]) => requestIds.includes(eventRequestId))?.[0]
			?? `${capturedEvent.actionAtArrival} (no request id)`;

		const eventLine = `${capturedEvent.eventBody.type};`
			+ ` ${describeSubscriptionRead(
				capturedEvent.eventBody,
				probeSubscriptionId,
			)}; signature ${capturedEvent.signatureStatus}`;

		describedEvents[actionName] ??= [];

		if (!describedEvents[actionName].includes(eventLine)) {
			describedEvents[actionName].push(eventLine);
		}
	}

	for (const eventLines of Object.values(describedEvents)) {
		eventLines.sort();
	}

	return describedEvents;
}

function describeEnvelopes() {
	const envelopeShapes = new Set();

	for (const capturedEvent of capturedEvents) {
		if (capturedEvent.eventBody === null) {
			continue;
		}

		const topKeys = Object.keys(capturedEvent.eventBody)
			.sort()
			.join(',');

		envelopeShapes.add(
			`${capturedEvent.contentType}; ${topKeys};`
			+ ` api_version ${capturedEvent.eventBody.api_version};`
			+ ` ${capturedEvent.userAgent}`,
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

	const summaryLines = ['## Stripe webhook behaviour', ''];

	if (behaviourDifferences === null) {
		summaryLines.push('No baseline yet: observed-behaviour.json is it.', '');
	}
	else if (behaviourDifferences.length === 0) {
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

	summaryLines.push('| action | events |', '|---|---|');

	for (const [actionName, eventLines] of Object.entries(observedBehaviour.events)) {
		summaryLines.push(`| ${actionName} | ${eventLines.join('<br>') || '—'} |`);
	}

	appendFileSync(summaryPath, `${redactSecrets(summaryLines.join('\n'))}\n`);
}

const actionRequestIds = {};

const observedBehaviour = {
	apiVersion: stripeApiVersion,
	subscriptionAfter: {},
	missingSubscription: null,
	events: {},
	envelopes: [],
};

try {
	console.log('== leftovers of a previous run');
	await deleteLeftovers();

	console.log(`\n== tunnel ${tunnelUrl}`);
	await waitForTunnel();

	const createdEndpoint = await callStripe('POST', '/v1/webhook_endpoints', {
		url: `${tunnelUrl}/stripe`,
		enabled_events: ['*'],
		api_version: stripeApiVersion,
		description: `${probeName} ${Date.now()}`,
	});

	webhookSecret = createdEndpoint.body.secret;

	cleanupSteps.push(async () => {
		await callStripe(
			'DELETE',
			`/v1/webhook_endpoints/${createdEndpoint.body.id}`,
		);

		console.log(`  deleted webhook endpoint ${createdEndpoint.body.id}`);
	});

	await ensureProbeProduct();

	const createdClock = await callStripe('POST', '/v1/test_helpers/test_clocks', {
		frozen_time: Math.floor(Date.now() / 1_000),
		name: `${probeName} ${Date.now()}`,
	});

	const testClockId = createdClock.body.id;

	cleanupSteps.push(async () => {
		await callStripe('DELETE', `/v1/test_helpers/test_clocks/${testClockId}`);
		console.log(`  deleted test clock ${testClockId}`);
	});

	console.log('\n== customer and subscription');
	currentActionName = 'subscription created';

	const createdCustomer = await callStripe('POST', '/v1/customers', {
		name: probeName,
		test_clock: testClockId,
	});

	const attachedMethod = await callStripe(
		'POST',
		'/v1/payment_methods/pm_card_visa/attach',
		{ customer: createdCustomer.body.id },
	);

	const createdSubscription = await callStripe('POST', '/v1/subscriptions', {
		customer: createdCustomer.body.id,
		default_payment_method: attachedMethod.body.id,
		items: [{
			price_data: {
				currency: 'eur',
				product: probeProductId,
				unit_amount: 1000,
				recurring: { interval: 'month' },
			},
		}],
		metadata: { directus_subscription: probeDirectusSubscription },
	});

	const probeSubscriptionId = createdSubscription.body.id;
	const subscriptionPath = `/v1/subscriptions/${probeSubscriptionId}`;

	const startPeriodEnd = createdSubscription.body.items.data[0]
		.current_period_end;

	actionRequestIds[currentActionName] = [
		createdCustomer.requestId,
		attachedMethod.requestId,
		createdSubscription.requestId,
	];

	async function recordSubscription(actionName) {
		const retrievedSubscription = await callStripe('GET', subscriptionPath);

		observedBehaviour.subscriptionAfter[actionName] = describeSubscription(
			retrievedSubscription.body,
			startPeriodEnd,
		);

		console.log(
			`  ${actionName}: ${retrievedSubscription.body.status},`
			+ ` cancel_at_period_end ${retrievedSubscription.body.cancel_at_period_end}`,
		);
	}

	async function runAction(actionName, actionCall) {
		currentActionName = actionName;
		const actionOutcome = await actionCall();
		actionRequestIds[actionName] = [actionOutcome.requestId];
		await waitSeconds(10);
		await recordSubscription(actionName);
	}

	await waitSeconds(10);
	await recordSubscription('subscription created');

	await runAction('cancel_at_period_end true', () => {
		return callStripe('POST', subscriptionPath, { cancel_at_period_end: true });
	});

	await runAction('cancel_at_period_end false', () => {
		return callStripe('POST', subscriptionPath, { cancel_at_period_end: false });
	});

	await runAction('renewal (test clock past the period end)', async () => {
		const advancedClock = await callStripe(
			'POST',
			`/v1/test_helpers/test_clocks/${testClockId}/advance`,
			// The renewal invoice finalizes an hour after the period end.
			{ frozen_time: startPeriodEnd + 7_200 },
		);

		await waitForClockReady(testClockId);

		return advancedClock;
	});

	await runAction('canceled now', () => {
		return callStripe('DELETE', subscriptionPath);
	});

	console.log('\n== subscription that does not exist');

	const missingOutcome = await callStripeOutcome(
		'GET',
		`/v1/subscriptions/${missingSubscriptionId}`,
	);

	observedBehaviour.missingSubscription = {
		httpStatus: missingOutcome.httpStatus,
		errorCode: missingOutcome.body.error?.code ?? null,
		errorType: missingOutcome.body.error?.type ?? null,
	};

	console.log(`\n== listening ${listenSeconds} s`);
	currentActionName = 'after the last action';
	await waitSeconds(listenSeconds);

	observedBehaviour.events = describeActionEvents(
		actionRequestIds,
		probeSubscriptionId,
	);

	observedBehaviour.envelopes = describeEnvelopes();
	const observedJson = `${JSON.stringify(observedBehaviour, null, '\t')}\n`;
	writeFileSync(join(outputDirectory, 'observed-behaviour.json'), observedJson);

	if (cliOptions['update-baseline']) {
		writeFileSync(baselinePath, observedJson);
		console.log(`\n== baseline rewritten: ${baselinePath}`);
	}
	else if (!existsSync(baselinePath)) {
		writeStepSummary(observedBehaviour, null);

		console.log(
			`\n== no baseline at ${JSON.stringify(baselinePath)}: commit`
			+ ' observed-behaviour.json from the output directory as it',
		);

		process.exitCode = 1;
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
