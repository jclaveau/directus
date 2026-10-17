import config, { getUrl, paths, type Env } from '@common/config';
import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
} from '@common/cucumber';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { spawn, type ChildProcess } from 'child_process';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import {
	MockIdentityProvider,
	type IdentityProfile,
} from './sso-identity-provider';

type LoginCell = {
	login: string;
	profile: IdentityProfile;
	remember_session?: string;
};

type RequestCell = {
	method: 'GET' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
};

const LOGIN_CELL_KEYS = [
	'login',
	'profile',
	'remember_session',
] as const satisfies readonly (keyof LoginCell)[];

const REQUEST_CELL_KEYS = [
	'method',
	'path',
	'query',
	'payload',
] as const satisfies readonly (keyof RequestCell)[];

const RESPONSE_CELL_KEYS = ['code', 'body'] as const;

type Row = { request: string; response: string };

type SsoInstance = {
	vendorEnv: Env;
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
 * as the provider's answer.
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
	} = {},
) {
	const feature = loadFeature(featurePath);

	describe.each(vendors)('%s', (vendor) => {
		const ssoInstance: SsoInstance = {
			vendorEnv: cloneDeep(config.envs),
			providersByName: {
				mockoauth: new MockIdentityProvider(SSO_CLIENT_ID, false),
				mockopenid: new MockIdentityProvider(SSO_CLIENT_ID, true),
			},
			keysByName: {},
		};

		let instance: ChildProcess;

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

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: vendorEnv,
			});

			await awaitDirectusConnection(Number(vendorEnv.PORT));
		}, 60_000);

		afterAll(async () => {
			await stopSpawnedInstance(instance);

			for (const provider of Object.values(ssoInstance.providersByName)) {
				await provider.stop();
			}

			await hooks.afterFeature?.(vendor);
		}, 60_000);

		defineFeature(feature, (scenario) => {
			for (const { title } of feature.scenarios) {
				scenario(title, ({ then }) => {
					then('these requests get these responses:', (table: Row[]) => {
						return sendRows(vendor, ssoInstance, table);
					});
				}, 60_000);
			}
		});
	});
}

// A `<name>` stands for what a `remember_session: name` row stored.
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

	const loginStart = await request(instanceUrl)
		.get(`/auth/login/${loginCell.login}`);

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
	const { method, path, query = {}, payload } = requestCell;
	const instanceUrl = getUrl(vendor, ssoInstance.vendorEnv);

	const pendingRequest = method === 'GET'
		? request(instanceUrl).get(path)
		: request(instanceUrl).post(path);

	pendingRequest.query(query).set('Authorization', AUTH);

	return payload === undefined
		? pendingRequest
		: pendingRequest.send(payload as object);
}

async function sendRows(
	vendor: Vendor,
	ssoInstance: SsoInstance,
	table: Row[],
) {
	for (const { request: requestText, response: responseText } of table) {
		const requestCell = loadYaml(withKeys(requestText, ssoInstance)) as
			LoginCell | RequestCell;

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

		expect({ code: response.statusCode, body: response.body })
			.toMatchObject(cellOfKnownKeys<object>(
				'response',
				loadYaml(responseText) ?? {},
				RESPONSE_CELL_KEYS,
				'sso-steps.ts',
			));

		if ('login' in requestCell && requestCell.remember_session) {
			ssoInstance.keysByName[requestCell.remember_session]
				= response.body.data.refresh_token;
		}
	}
}
