import config, { getUrl } from '@common/config';
import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
	rememberedText,
} from '@common/cucumber';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { createHmac, randomUUID } from 'crypto';
import { DEFAULT_SCHEMA, load as loadYaml, Type } from 'js-yaml';
import { setTimeout as sleep } from 'node:timers/promises';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

type RequestCell = {
	as?: string;
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
	form?: Record<string, string>;
	file?: { name: string; content: string };
	headers?: Record<string, string>;
	remember?: string;
	remember_session?: string;
	eventually?: boolean;
};

const REQUEST_CELL_KEYS = [
	'as',
	'method',
	'path',
	'query',
	'payload',
	'form',
	'file',
	'headers',
	'remember',
	'remember_session',
	'eventually',
] as const satisfies readonly (keyof RequestCell)[];

const RESPONSE_CELL_KEYS = ['code', 'body', 'text'] as const;

type Row = { request: string; response: string };

type ScenarioKeys = {
	run: string;
	keysByName: Record<string, string>;
};

type FeatureHooks = {
	beforeFeature?: (vendor: Vendor) => Promise<void>;
	afterFeature?: (vendor: Vendor) => Promise<void>;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const TOTP_STEP_MS = 30_000;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Binds every scenario of a singular-write feature: each holds an optional
 * `Given these requests are sent:` and a `Then these requests get these
 * responses:`, both a request|response table run row after row.
 */
export function defineSingularWriteFeature(
	featurePath: string,
	featureHooks: FeatureHooks = {},
) {
	const feature = loadFeature(featurePath);

	describe.each(vendors)('%s', (vendor) => {
		if (featureHooks.beforeFeature) {
			beforeAll(() => {
				return featureHooks.beforeFeature!(vendor);
			});
		}

		if (featureHooks.afterFeature) {
			afterAll(() => {
				return featureHooks.afterFeature!(vendor);
			});
		}

		defineFeature(feature, (scenario) => {
			for (const { title } of feature.scenarios) {
				scenario(title, ({ given, then }) => {
					const scenarioKeys: ScenarioKeys = {
						run: randomUUID(),
						keysByName: {},
					};

					given.optional('these requests are sent:', (table: Row[]) => {
						return sendRows(vendor, scenarioKeys, table);
					});

					then('these requests get these responses:', (table: Row[]) => {
						return sendRows(vendor, scenarioKeys, table);
					});
				}, 60_000);
			}
		});
	});
}

// `<run>` is unique to the scenario; a `<name>` met for the first time stands
// for a fresh uuid, or for the key a `remember: name` row stored before.
// `<name:upper>` spells that same value in upper case.
function withKeys(cell: string, scenarioKeys: ScenarioKeys) {
	return cell.replaceAll(
		/<([\w-]+)(:upper)?>/g,
		(_placeholder, name: string, upperSuffix?: string) => {
			const keyValue = name === 'run'
				? scenarioKeys.run
				: (scenarioKeys.keysByName[name] ??= randomUUID());

			if (upperSuffix) {
				return keyValue.toUpperCase();
			}

			return keyValue;
		},
	);
}

// The token Directus itself would sign: `!jwt` maps the claims it signs.
function signedToken(claims: object, secret: string) {
	const header = Buffer.from(
		JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
	).toString('base64url');

	const body = Buffer.from(
		JSON.stringify({ ...claims, iss: 'directus' }),
	).toString('base64url');

	return `${header}.${body}.${
		createHmac('sha256', secret)
			.update(`${header}.${body}`)
			.digest('base64url')
	}`;
}

function base32Bytes(secret: string) {
	const octets = [...secret.toUpperCase()]
		.map((character) => {
			return BASE32_ALPHABET.indexOf(character)
				.toString(2)
				.padStart(5, '0');
		})
		.join('')
		.match(/.{8}/g) ?? [];

	return Buffer.from(octets.map((octet) => parseInt(octet, 2)));
}

// The one-time password an authenticator app shows for `!totp <secret>` now.
function currentTotp(secret: string) {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / TOTP_STEP_MS)));

	const digest = createHmac('sha1', base32Bytes(secret))
		.update(counter)
		.digest();

	const offset = digest[digest.length - 1]! & 0x0f;
	const otpNumber = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;

	return String(otpNumber).padStart(6, '0');
}

// A password read near the end of its step could expire before the server
// checks it: wait for the next one instead.
async function awaitFreshTotpStep() {
	const msLeft = TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS);

	if (msLeft < 3_000) {
		await sleep(msLeft);
	}
}

function yamlSchemaFor(vendor: Vendor) {
	const secret = config.envs[vendor]['SECRET']!;

	return DEFAULT_SCHEMA.extend([
		new Type('!jwt', {
			kind: 'mapping',
			construct: (claims: object) => signedToken(claims, secret),
		}),
		new Type('!totp', {
			kind: 'scalar',
			construct: (totpSecret: string) => currentTotp(totpSecret),
		}),
	]);
}

function sessionTokenOf(response: Response) {
	return ([] as string[])
		.concat(response.headers['set-cookie'] ?? [])
		.find((cookie) => {
			return cookie.startsWith('directus_session_token=');
		})
		?.split(';')[0]
		?.split('=')[1];
}

function sendRequest(vendor: Vendor, requestCell: RequestCell) {
	const {
		as: token,
		method,
		path,
		query = {},
		headers = {},
		payload,
		file,
	} = requestCell;

	const pendingRequest = {
		DELETE: () => request(getUrl(vendor)).delete(path),
		GET: () => request(getUrl(vendor)).get(path),
		PATCH: () => request(getUrl(vendor)).patch(path),
		POST: () => request(getUrl(vendor)).post(path),
	}[method]();

	pendingRequest
		.query(query)
		.set(headers)
		.set(
			'Authorization',
			token === undefined
				? AUTH
				: `Bearer ${token}`,
		);

	// A multipart upload: Directus wants every form field before the file.
	if (file !== undefined) {
		for (const [fieldName, fieldValue] of Object.entries(
			requestCell.form ?? {},
		)) {
			pendingRequest.field(fieldName, fieldValue);
		}

		return pendingRequest.attach(
			'file',
			Buffer.from(file.content),
			file.name,
		);
	}

	return payload === undefined
		? pendingRequest
		: pendingRequest.send(payload as object);
}

function codeBodyAndText(response: Response) {
	return {
		code: response.statusCode,
		body: response.body,
		text: response.text,
	};
}

// One row at a time, so a row can name the key one before it remembered. A
// response cell states the keys it checks; an array still has to hold as many
// items as it states.
async function sendRows(
	vendor: Vendor,
	scenarioKeys: ScenarioKeys,
	table: Row[],
) {
	const schema = yamlSchemaFor(vendor);

	for (const { request: requestText, response: responseText } of table) {
		if (requestText.includes('!totp')) {
			await awaitFreshTotpStep();
		}

		const requestCell = cellOfKnownKeys<RequestCell>(
			'request',
			loadYaml(withKeys(requestText, scenarioKeys), { schema }),
			REQUEST_CELL_KEYS,
			'singular-write-steps.ts',
		);

		const expectedResponse = cellOfKnownKeys<object>(
			'response',
			loadYaml(withKeys(responseText, scenarioKeys), { schema }) ?? {},
			RESPONSE_CELL_KEYS,
			'singular-write-steps.ts',
		);

		let response!: Response;

		if (requestCell.eventually) {
			await expect.poll(async () => {
				response = await sendRequest(vendor, requestCell);

				return codeBodyAndText(response);
			}, { timeout: 10_000, interval: 250 }).toMatchObject(
				expectedResponse,
			);
		}
		else {
			response = await sendRequest(vendor, requestCell);

			expect(codeBodyAndText(response)).toMatchObject(expectedResponse);
		}

		if (requestCell.remember !== undefined) {
			scenarioKeys.keysByName[requestCell.remember] = rememberedText(
				requestCell.remember,
				response.body.data?.id,
			);
		}

		if (requestCell.remember_session !== undefined) {
			scenarioKeys.keysByName[requestCell.remember_session] = rememberedText(
				requestCell.remember_session,
				sessionTokenOf(response),
			);
		}
	}
}
