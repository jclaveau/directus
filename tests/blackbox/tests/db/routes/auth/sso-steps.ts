import config, { getUrl, paths, type Env } from '@common/config';
import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
	rememberedText,
	responseCellOf,
} from '@common/cucumber';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import {
	auditEnvForFeature,
	defineStatementCountsStep,
	warmUpAuditedInstance,
} from '@common/query-audit-steps';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { yamlSchemaFor } from '../system/singular-write-steps';
import { spawn, type ChildProcess } from 'child_process';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import {
	MockIdentityProvider,
	type IdentityProfile,
} from './sso-identity-provider';

type LoginCell = {
	login: string;
	invite?: string;
	profile: IdentityProfile;
	remember_session?: string;
	remember_token?: string;
};

type RequestCell = {
	on?: 'peer';
	as?: string;
	method: 'GET' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
};

const LOGIN_CELL_KEYS = [
	'login',
	'invite',
	'profile',
	'remember_session',
	'remember_token',
] as const satisfies readonly (keyof LoginCell)[];

const REQUEST_CELL_KEYS = [
	'on',
	'as',
	'method',
	'path',
	'query',
	'payload',
] as const satisfies readonly (keyof RequestCell)[];

const RESPONSE_CELL_KEYS = ['code', 'body', 'headers'] as const;

type Row = { request: string; response: string };

type SsoInstance = {
	vendorEnv: Env;
	peerEnv: Env | null;
	providersByName: Record<string, MockIdentityProvider>;
	keysByName: Record<string, string>;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

export const SSO_CLIENT_ID = 'sso-blackbox-client';

/**
 * Binds a feature whose scenarios each hold `Then these requests get these
 * responses:`, against an instance of its own trusting the `mockoauth` (OAuth2)
 * and `mockopenid` (OpenID) providers this file starts. A row is a request to
 * that instance, or a `login: <provider>` walking the code flow with `profile`
 * as the provider's answer, an `invite` token riding the login as the
 * invitation link sends it; `!jwt` signs its claims with the instance's
 * secret. A scenario may end with the statements its
 * requests ran on postgres. With `spawnsPeer`, a second instance on the same
 * env takes the requests sent `on: peer`; a request sent `as` a token
 * authenticates with it instead of as the admin.
 */
export function defineSsoFeature(
	featurePath: string,
	authEnv: (issuerUrlByProvider: Record<string, string>) => Record<
		string,
		string
	>,
	hooks: {
		beforeFeature?: (vendor: Vendor) => Promise<void>;
		afterFeature?: (vendor: Vendor) => Promise<void>;
		spawnsPeer?: boolean;
		keysByName?: Record<string, string>;
	} = {},
) {
	const feature = loadFeature(featurePath);

	describe.each(vendors)('%s', (vendor) => {
		const ssoInstance: SsoInstance = {
			vendorEnv: cloneDeep(config.envs),
			peerEnv: null,
			providersByName: {
				mockoauth: new MockIdentityProvider(SSO_CLIENT_ID, false),
				mockopenid: new MockIdentityProvider(SSO_CLIENT_ID, true),
			},
			keysByName: { ...hooks.keysByName },
		};

		let instance: ChildProcess;
		let peerInstance: ChildProcess | null = null;

		beforeAll(async () => {
			await hooks.beforeFeature?.(vendor);

			for (const provider of Object.values(ssoInstance.providersByName)) {
				await provider.start();
			}

			const vendorEnv = ssoInstance.vendorEnv[vendor];

			vendorEnv.PORT = String(await freePortOfWorker());
			vendorEnv['PUBLIC_URL'] = `http://127.0.0.1:${vendorEnv.PORT}`;

			Object.assign(vendorEnv, authEnv({
				mockoauth: ssoInstance.providersByName['mockoauth']!.issuerUrl,
				mockopenid: ssoInstance.providersByName['mockopenid']!.issuerUrl,
			}));

			Object.assign(vendorEnv, auditEnvForFeature(feature, vendor));

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: vendorEnv,
			});

			await awaitDirectusConnection(Number(vendorEnv.PORT));

			await warmUpAuditedInstance(
				feature,
				vendor,
				getUrl(vendor, ssoInstance.vendorEnv),
			);

			if (hooks.spawnsPeer) {
				const peerEnv = cloneDeep(ssoInstance.vendorEnv);

				peerEnv[vendor].PORT = String(await freePortOfWorker());
				peerEnv[vendor]['PUBLIC_URL'] = `http://127.0.0.1:${peerEnv[vendor].PORT}`;
				ssoInstance.peerEnv = peerEnv;

				peerInstance = spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: peerEnv[vendor],
				});

				await awaitDirectusConnection(Number(peerEnv[vendor].PORT));
			}
		}, 60_000);

		afterAll(async () => {
			await stopSpawnedInstance(instance);

			if (peerInstance !== null) {
				await stopSpawnedInstance(peerInstance);
			}

			for (const provider of Object.values(ssoInstance.providersByName)) {
				await provider.stop();
			}

			await hooks.afterFeature?.(vendor);
		}, 60_000);

		defineFeature(feature, (scenario) => {
			for (const { title } of feature.scenarios) {
				scenario(title, ({ then, and }) => {
					const receivedResponses: Response[] = [];

					then(
						'these requests get these responses:',
						async (table: Row[]) => {
							receivedResponses.push(
								...await sendRows(vendor, ssoInstance, table),
							);
						},
					);

					defineStatementCountsStep(and, vendor, receivedResponses);
				}, 60_000);
			}
		});
	});
}

// A `<name>` stands for what a `remember_session: name` row stored, or for
// a value the feature names in `keysByName`.
function withKeys(cell: string, ssoInstance: SsoInstance) {
	return cell.replaceAll(/<([\w-]+)>/g, (_placeholder, name: string) => {
		return ssoInstance.keysByName[name] ?? `<${name}>`;
	});
}

function pathOf(location: string) {
	const { pathname, search } = new URL(location);

	return `${pathname}${search}`;
}

// The browser's part of the code flow: Directus sends it to the provider with
// a signed cookie, the provider sends it back with a code, the callback trades
// the code under that cookie.
async function logIn(
	vendor: Vendor,
	ssoInstance: SsoInstance,
	loginCell: LoginCell,
) {
	const instanceUrl = getUrl(vendor, ssoInstance.vendorEnv);
	const provider = ssoInstance.providersByName[loginCell.login]!;

	provider.nextProfile = loginCell.profile;

	const loginQuery = loginCell.invite === undefined
		? {}
		: { invite: loginCell.invite };

	const loginStart = await request(instanceUrl)
		.get(`/auth/login/${loginCell.login}`)
		.query(loginQuery);

	expect(loginStart.statusCode).toBe(302);

	// `oauth2.<provider>` or `openid.<provider>`, after the driver.
	const flowCookie = ([] as string[])
		.concat(loginStart.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.includes(`.${loginCell.login}=`))
		?.split(';')[0];

	const authorizeAnswer = await request(provider.issuerUrl)
		.get(pathOf(loginStart.headers['location']!));

	expect(authorizeAnswer.statusCode).toBe(302);

	return request(instanceUrl)
		.get(pathOf(authorizeAnswer.headers['location']!))
		.set('Cookie', flowCookie ?? '');
}

function sendRequest(
	vendor: Vendor,
	ssoInstance: SsoInstance,
	requestCell: RequestCell,
) {
	const { on, as, method, path, query = {}, payload } = requestCell;

	if (on === 'peer' && ssoInstance.peerEnv === null) {
		throw new Error(
			'A request sent on the peer of a feature spawning none:'
			+ ` ${JSON.stringify(requestCell)}`,
		);
	}

	const instanceUrl = on === 'peer'
		? getUrl(vendor, ssoInstance.peerEnv!)
		: getUrl(vendor, ssoInstance.vendorEnv);

	const pendingRequest = method === 'GET'
		? request(instanceUrl).get(path)
		: request(instanceUrl).post(path);

	const authorizationHeader = as === undefined
		? AUTH
		: `Bearer ${as}`;

	pendingRequest
		.query(query)
		.set('Authorization', authorizationHeader);

	return payload === undefined
		? pendingRequest
		: pendingRequest.send(payload as object);
}

async function sendRows(
	vendor: Vendor,
	ssoInstance: SsoInstance,
	table: Row[],
) {
	const receivedResponses: Response[] = [];

	for (const { request: requestText, response: responseText } of table) {
		const requestCell = loadYaml(
			withKeys(requestText, ssoInstance),
			{ schema: yamlSchemaFor(vendor) },
		) as LoginCell | RequestCell;

		cellOfKnownKeys(
			'request',
			requestCell,
			'login' in requestCell
? LOGIN_CELL_KEYS
: REQUEST_CELL_KEYS,
			'sso-steps.ts',
		);

		const response = 'login' in requestCell
			? await logIn(vendor, ssoInstance, requestCell)
			: await sendRequest(vendor, ssoInstance, requestCell);

		expect({
			code: response.statusCode,
			body: response.body,
			headers: response.headers,
		})
			.toMatchObject(responseCellOf<object>(
				loadYaml(withKeys(responseText, ssoInstance)),
				RESPONSE_CELL_KEYS,
				'sso-steps.ts',
			));

		if ('login' in requestCell && requestCell.remember_session) {
			ssoInstance.keysByName[requestCell.remember_session] = rememberedText(
				requestCell.remember_session,
				response.body.data.refresh_token,
			);
		}

		if ('login' in requestCell && requestCell.remember_token) {
			ssoInstance.keysByName[requestCell.remember_token] = rememberedText(
				requestCell.remember_token,
				response.body.data.access_token,
			);
		}

		// A login's statements are those of its callback, the last request
		// of the flow.
		receivedResponses.push(response);
	}

	return receivedResponses;
}
