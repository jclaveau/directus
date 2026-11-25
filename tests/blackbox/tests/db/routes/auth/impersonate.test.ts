import config, { getUrl, paths } from '@common/config';
import {
	CreateCollection,
	CreateField,
	CreateItem,
	CreatePermission,
	CreateUser,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { createWebSocketConn, createWebSocketGql } from '@common/transport';
import { ROLE, USER } from '@common/variables';
import { oneLine } from '@directus/utils';
import { awaitDirectusConnection } from '@utils/await-connection';
import { sleep } from '@utils/sleep';
import { ChildProcess, spawn } from 'child_process';
import { createHmac } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import getPort from 'get-port';
import knex, { Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import { join } from 'node:path';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

// An admin acts as another user on a token of its own, attributed to the admin
// (#502). Two instances: one with writes allowed, where the websocket kicks are
// pinned, and a read-only one. The target's own sessions and sockets are never
// touched by an impersonation ending — only the rows the impersonation minted.

const ITEMS = 'test_impersonation_items';

// api/src/bots.ts — seeded by the bots migration, never a target
const CACHE_AUDIT_BOT = '60ae1046-adc0-4390-9470-69820b41d068';

const SESSION_COOKIE = 'directus_session_token';
const REFRESH_COOKIE = 'directus_refresh_token';

function cookieValue(response: Response, name: string): string {
	const cookies = response.get('Set-Cookie') ?? [];
	const cookie = cookies.find((entry) => entry.startsWith(`${name}=`));

	if (!cookie) {
		throw new Error(`No ${name} cookie on the response`);
	}

	return cookie.split(';')[0]!.slice(name.length + 1);
}

// A session cookie is a JWT; the row is keyed by its `session` claim
function sessionOf(cookie: string): string {
	const [, payload] = cookie.split('.');

	return JSON.parse(Buffer.from(payload!, 'base64url').toString()).session;
}

const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

// RFC 6238 on otplib's defaults (base32 secret, SHA-1, 30 s, six digits): the
// one-time code an enrolment as the target would need, from a secret the
// impersonator picked
function totp(secret: string): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

	const key = Buffer.from(
		[...secret]
			.map((char) => alphabet.indexOf(char).toString(2))
			.map((bits) => bits.padStart(5, '0'))
			.join('')
			.match(/.{8}/g)!
			.map((byte) => parseInt(byte, 2)),
	);

	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));

	const digest = createHmac('sha1', key)
		.update(counter)
		.digest();

	const code = digest.readUInt32BE(digest[19]! & 0xf) & 0x7fffffff;

	return String(code % 1_000_000).padStart(6, '0');
}

const MINUTE = 60_000;

function expectExpiresIn(expires: Date | string | number, ms: number) {
	const left = new Date(expires).getTime() - Date.now();

	expect(left).toBeGreaterThan(ms - 30_000);
	expect(left).toBeLessThanOrEqual(ms);
}

describe('Impersonation', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['REDIS'] = 'redis://localhost:6108';
		env[vendor]['IMPERSONATION_ENABLED'] = 'true';
		env[vendor]['IMPERSONATION_WRITES'] = 'true';
		// The suite's 25d token would hide what an impersonation's lifetime is
		env[vendor]['ACCESS_TOKEN_TTL'] = '15m';
		// The websocket handshake only says why it failed at this level
		env[vendor]['LOG_LEVEL'] = 'debug';

		const readOnlyEnv = cloneDeep(config.envs);
		readOnlyEnv[vendor]['IMPERSONATION_ENABLED'] = 'true';
		readOnlyEnv[vendor]['ACCESS_TOKEN_TTL'] = '15m';

		const instances: ChildProcess[] = [];
		let db: Knex;
		let url: string;
		let readOnlyUrl: string;
		let adminId: string;
		let targetId: string;
		let itemId: number;

		const targetEmail = `impersonation-target-${vendor}@example.com`;
		const targetPassword = 'ImpersonationTargetPassword';
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;

		async function login(email: string, password: string) {
			const response = await request(url)
				.post('/auth/login')
				.send({ email, password, mode: 'session' })
				.expect(200);

			return cookieValue(response, SESSION_COOKIE);
		}

		function me(token: string, host = url) {
			return request(host)
				.get('/users/me')
				.query({ fields: ['id'] })
				.set('Authorization', `Bearer ${token}`);
		}

		function impersonate(
			token: string,
			body: Record<string, unknown>,
			host = url,
		) {
			return request(host)
				.post('/auth/impersonate')
				.send(body)
				.set('Authorization', `Bearer ${token}`);
		}

		function reason(response: Response): string {
			return response.body.errors[0].extensions.reason;
		}

		function socket(token: string) {
			return createWebSocketConn(url, { auth: { access_token: token } });
		}

		async function expectEnded(ws: ReturnType<typeof socket>) {
			// The kick lands while the request that caused it is still in flight;
			// waiting for OPEN on a socket the server already closed times out
			const messages = await ws.getMessages(1, { targetState: ws.conn.CLOSED });

			expect(messages![0]).toMatchObject({
				type: 'auth',
				status: 'error',
				error: { code: 'SESSION_ENDED' },
			});
		}

		async function expectAlive(ws: ReturnType<typeof socket>, token: string) {
			const received = ws.getMessageCount();

			// A kick is a bus hop away; give one time to arrive
			await sleep(500);
			await ws.waitForState(ws.conn.OPEN);
			expect(ws.getMessageCount()).toBe(received);
			await me(token).expect(200);
		}

		beforeAll(async () => {
			await CreateCollection(vendor, { collection: ITEMS });

			await CreateField(vendor, {
				collection: ITEMS,
				field: 'note',
				type: 'string',
			});

			for (const action of ['create', 'read', 'update'] as const) {
				await CreatePermission(vendor, {
					role: 'APP_ACCESS',
					policyName: 'impersonation',
					permission: { collection: ITEMS, action, fields: ['*'] },
				});
			}

			const target = await CreateUser(vendor, {
				token: `impersonation-target-${vendor}`,
				email: targetEmail,
				password: targetPassword,
				roleName: ROLE.APP_ACCESS.NAME,
			});

			targetId = target.id;

			const item = await CreateItem(vendor, {
				collection: ITEMS,
				item: { note: 'seed' },
			});

			itemId = item.id;

			const port = await getPort();
			const readOnlyPort = await getPort();
			env[vendor].PORT = String(port);
			readOnlyEnv[vendor].PORT = String(readOnlyPort);

			const spawned = [['writes', env], ['read-only', readOnlyEnv]] as const;

			for (const [name, instanceEnv] of spawned) {
				const instance = spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: instanceEnv[vendor],
				});

				// Shown by the workflow's server-log tail on a failed shard
				if (process.env['TEST_SAVE_LOGS']) {
					const log = createWriteStream(
						join(paths.cwd, `server-log-${vendor}-impersonation-${name}.txt`),
					);

					instance.stdout.pipe(log);
					instance.stderr.pipe(log);
				}

				instances.push(instance);
			}

			db = knex(config.knexConfig[vendor]!);
			url = getUrl(vendor, env);
			readOnlyUrl = getUrl(vendor, readOnlyEnv);

			await Promise.all([
				awaitDirectusConnection(port),
				awaitDirectusConnection(readOnlyPort),
			]);

			adminId = (await me(USER.ADMIN.TOKEN)).body.data.id;
		}, 120_000);

		afterAll(async () => {
			for (const instance of instances) {
				instance.kill();
			}

			await db.destroy();
			await DeleteCollection(vendor, { collection: ITEMS });
		});

		it('is not there while disabled', async () => {
			await impersonate(USER.ADMIN.TOKEN, { user: targetId }, getUrl(vendor))
				.expect(404);
		});

		it('refuses the wrong actor or target', async () => {
			const cases: [string, string][] = [
				[adminId, 'impersonation_self'],
				[CACHE_AUDIT_BOT, 'impersonation_target_bot'],
				['00000000-0000-4000-8000-000000000000', 'impersonation_target_inactive'],
			];

			for (const [user, expected] of cases) {
				const response = await impersonate(USER.ADMIN.TOKEN, { user }).expect(403);

				expect(reason(response)).toBe(expected);
			}

			const target = await login(targetEmail, targetPassword);
			await impersonate(target, { user: adminId }).expect(403);

			// Refused before the lookup: Postgres would answer a 500 to it
			await impersonate(USER.ADMIN.TOKEN, { user: 'not-a-uuid' }).expect(400);
		});

		it('json mode: a token as the target, credited to the admin', async () => {
			const response = await impersonate(
				USER.ADMIN.TOKEN,
				{ user: targetId, mode: 'json' },
			).expect(200);

			const token = response.body.data.access_token;
			expect(typeof token).toBe('string');
			expect(response.body.data.expires).toBe(15 * MINUTE);

			expect((await me(token).expect(200)).body.data.id).toBe(targetId);

			const banner = await request(url)
				.get('/auth/impersonate')
				.set('Authorization', `Bearer ${token}`)
				.expect(200);

			expect(banner.body.data.impersonator).toMatchObject({ id: adminId });

			const nested = await impersonate(token, { user: adminId }).expect(403);
			expect(reason(nested)).toBe('impersonation_nested');

			await request(url)
				.patch(`/items/${ITEMS}/${itemId}`)
				.send({ note: 'json' })
				.set('Authorization', `Bearer ${token}`)
				.expect(200);

			const update = await db('directus_activity')
				.where({ collection: ITEMS, item: String(itemId), action: 'update' })
				.orderBy('id', 'desc')
				.first('user', 'impersonator');

			expect(update).toEqual({ user: targetId, impersonator: adminId });

			const start = await db('directus_activity')
				.where({ action: 'impersonate', item: targetId })
				.first('user', 'impersonator');

			expect(start).toEqual({ user: adminId, impersonator: null });

			// Credentials are the one write no setting allows
			const password = await request(url)
				.patch('/users/me')
				.send({ password: 'changed' })
				.set('Authorization', `Bearer ${token}`)
				.expect(403);

			expect(reason(password)).toBe('impersonation_credentials');

			const tfa = await request(url)
				.post('/users/me/tfa/generate')
				.send({ password: targetPassword })
				.set('Authorization', `Bearer ${token}`)
				.expect(403);

			expect(reason(tfa)).toBe('impersonation_credentials');

			// Express routes this to the same handler
			const spelled = await request(url)
				.post('/Users/Me/tfa/generate')
				.send({ password: targetPassword })
				.set('Authorization', `Bearer ${token}`)
				.expect(403);

			expect(reason(spelled)).toBe('impersonation_credentials');

			// GraphQL skips the REST paths: the service refuses an enrolment on a
			// secret of the impersonator's choosing, valid code and all
			const enrol = await request(url)
				.post('/graphql/system')
				.send({
					query: oneLine`
						mutation {
							users_me_tfa_enable(
								otp: "${totp(TOTP_SECRET)}",
								secret: "${TOTP_SECRET}",
							)
						}
					`,
				})
				.set('Authorization', `Bearer ${token}`);

			expect(reason(enrol)).toBe('impersonation_credentials');

			const enrolled = await db('directus_users')
				.where({ id: targetId })
				.first('tfa_secret');

			expect(enrolled).toEqual({ tfa_secret: null });

			// A login is a session of one's own, on either transport
			const login = await request(url)
				.post('/auth/login')
				.send({ email: targetEmail, password: targetPassword })
				.set('Authorization', `Bearer ${token}`)
				.expect(403);

			expect(reason(login)).toBe('impersonation_login');

			const gqlLogin = await request(url)
				.post('/graphql/system')
				.send({
					query: oneLine`
						mutation {
							auth_login(email: "${targetEmail}", password: "${targetPassword}") {
								access_token
							}
						}
					`,
				})
				.set('Authorization', `Bearer ${token}`);

			expect(reason(gqlLogin)).toBe('impersonation_login');

			// The token dies with its impersonator, however it was suspended
			const setAdminStatus = (status: string) => {
				return db('directus_users')
					.where({ id: adminId })
					.update({ status });
			};

			await setAdminStatus('suspended');

			try {
				await me(token).expect(401);
			}
			finally {
				await setAdminStatus('active');
			}

			await me(token).expect(200);
		});

		it('is read-only unless IMPERSONATION_WRITES is on', async () => {
			const response = await impersonate(
				USER.ADMIN.TOKEN,
				{ user: targetId, mode: 'json' },
				readOnlyUrl,
			).expect(200);

			const token = response.body.data.access_token;

			await request(readOnlyUrl)
				.get(`/items/${ITEMS}`)
				.set('Authorization', `Bearer ${token}`)
				.expect(200);

			const rest = await request(readOnlyUrl)
				.patch(`/items/${ITEMS}/${itemId}`)
				.send({ note: 'read-only' })
				.set('Authorization', `Bearer ${token}`)
				.expect(403);

			expect(reason(rest)).toBe('impersonation_read_only');

			const graphql = await request(readOnlyUrl)
				.post('/graphql')
				.send({
					query: oneLine`
						mutation {
							update_${ITEMS}_item(id: ${itemId}, data: { note: "gql" }) { id }
						}
					`,
				})
				.set('Authorization', `Bearer ${token}`);

			expect(reason(graphql)).toBe('impersonation_read_only');

			// The websocket path keeps the claim
			const ws = createWebSocketConn(readOnlyUrl, { auth: { access_token: token } });

			await ws.sendMessage({
				type: 'items',
				action: 'create',
				collection: ITEMS,
				data: { note: 'ws' },
			});

			const messages = await ws.getMessages(1);

			expect(messages![0]).toMatchObject({
				type: 'items',
				status: 'error',
				error: { code: 'FORBIDDEN' },
			});

			ws.conn.close();

			// graphql-ws runs a mutation like any query
			const gql = createWebSocketGql(readOnlyUrl, { auth: { access_token: token } });
			await gql.waitForState(WebSocket.OPEN);

			const refused = await new Promise<unknown>((resolve, reject) => {
				gql.client.subscribe(
					{
						query: oneLine`
							mutation {
								update_${ITEMS}_item(id: ${itemId}, data: { note: "ws-gql" }) { id }
							}
						`,
					},
					{
						next: (data) => reject(new Error(`Ran: ${JSON.stringify(data)}`)),
						error: resolve,
						complete: () => reject(new Error('Completed unrefused')),
					},
				);
			});

			expect(refused).toEqual([
				expect.objectContaining({
					message: expect.stringContaining('impersonation_read_only'),
				}),
			]);

			gql.client.dispose();

			const written = await db(ITEMS)
				.whereIn('note', ['read-only', 'gql', 'ws', 'ws-gql'])
				.first();

			expect(written).toBeUndefined();
		});

		it('lives one access token past its last refresh, in every mode', async () => {
			const adminSession = await login(USER.ADMIN.EMAIL, USER.ADMIN.PASSWORD);

			const session = await impersonate(
				adminSession,
				{ user: targetId, mode: 'session' },
			).expect(200);

			expect(session.body.data.expires).toBe(15 * MINUTE);

			const cookie = await impersonate(
				adminSession,
				{ user: targetId, mode: 'cookie' },
			).expect(200);

			const refreshToken = cookieValue(cookie, REFRESH_COOKIE);

			// The rows: an access token's worth each, the admin's own a login's
			// (REFRESH_TOKEN_TTL, whatever the mode, until a refresh)
			const rows = await db('directus_sessions')
				.whereIn('token', [
					sessionOf(adminSession),
					sessionOf(cookieValue(session, SESSION_COOKIE)),
					refreshToken,
				])
				.select('token', 'expires');

			expect(rows).toHaveLength(3);

			for (const row of rows) {
				const lifetime = row.token === sessionOf(adminSession)
					? 7 * 24 * 60 * MINUTE
					: 15 * MINUTE;

				expectExpiresIn(row.expires, lifetime);
			}

			// Refreshed, the impersonation gets one more access token, not a session
			const refreshed = await request(url)
				.post('/auth/refresh')
				.send({ refresh_token: refreshToken, mode: 'json' })
				.expect(200);

			expect(refreshed.body.data.expires).toBe(15 * MINUTE);

			const rolled = await db('directus_sessions')
				.where({ token: refreshed.body.data.refresh_token })
				.first('expires', 'impersonator');

			expect(rolled.impersonator).toBe(adminId);
			expectExpiresIn(rolled.expires, 15 * MINUTE);

			// Where impersonation is off, a live impersonated row is refused and ended
			const disabled = await request(getUrl(vendor))
				.post('/auth/refresh')
				.send({ refresh_token: refreshed.body.data.refresh_token, mode: 'json' })
				.expect(401);

			expect(disabled.body.errors[0].extensions.code).toBe('INVALID_CREDENTIALS');

			const gone = await db('directus_sessions')
				.where({ token: refreshed.body.data.refresh_token })
				.first();

			expect(gone).toBeUndefined();

			await request(url)
				.post('/auth/logout')
				.send({ mode: 'session' })
				.set('Cookie', `${SESSION_COOKIE}=${adminSession}`)
				.expect(204);
		});

		it('ends with its impersonator\'s admin access', async () => {
			// A second admin, demoted by policy while impersonating
			const role = await request(url)
				.post('/roles')
				.send({ name: `impersonation-second-admin-${vendor}` })
				.set('Authorization', admin)
				.expect(200);

			const policy = await request(url)
				.post('/policies')
				.send({
					name: `impersonation-second-admin-${vendor}`,
					admin_access: true,
					app_access: true,
					roles: [{ role: role.body.data.id }],
				})
				.set('Authorization', admin)
				.expect(200);

			// Concealed on the response: kept here to log in with
			const secondToken = `impersonation-second-admin-${vendor}`;

			const second = await request(url)
				.post('/users')
				.send({
					email: `impersonation-second-admin-${vendor}@example.com`,
					password: 'ImpersonationSecondAdminPassword',
					role: role.body.data.id,
					token: secondToken,
				})
				.set('Authorization', admin)
				.expect(200);

			const setAdminAccess = (admin_access: boolean) => {
				return request(url)
					.patch(`/policies/${policy.body.data.id}`)
					.send({ admin_access })
					.set('Authorization', admin)
					.expect(200);
			};

			try {
				const json = await impersonate(
					secondToken,
					{ user: targetId, mode: 'json' },
				).expect(200);

				const cookie = await impersonate(
					secondToken,
					{ user: targetId, mode: 'cookie' },
				).expect(200);

				const token = json.body.data.access_token;
				const refreshToken = cookieValue(cookie, REFRESH_COOKIE);

				await me(token).expect(200);
				await setAdminAccess(false);

				// Every request checks; a refresh ends the row for good
				await me(token).expect(401);

				await request(url)
					.post('/auth/refresh')
					.send({ refresh_token: refreshToken, mode: 'json' })
					.expect(401);

				const rows = await db('directus_sessions')
					.where({ impersonator: second.body.data.id });

				expect(rows).toEqual([]);

				await setAdminAccess(true);
				await me(token).expect(200);
			}
			finally {
				for (const path of [
					`/users/${second.body.data.id}`,
					`/policies/${policy.body.data.id}`,
					`/roles/${role.body.data.id}`,
				]) {
					await request(url)
						.delete(path)
						.set('Authorization', admin)
						.expect(204);
				}
			}
		});

		it('ending an impersonation never reaches the target', async () => {
			// The trails the tests above left behind
			const earlierEnds = await db('directus_activity')
				.where({ action: 'impersonate_end', item: targetId })
				.pluck('id');

			const target = await login(targetEmail, targetPassword);
			const targetWs = socket(target);
			await targetWs.subscribe({ collection: ITEMS });

			const adminSession = await login(USER.ADMIN.EMAIL, USER.ADMIN.PASSWORD);
			const adminWs = socket(adminSession);
			await adminWs.waitForState(adminWs.conn.OPEN);

			// Session mode: the admin's Data Studio becomes the target's
			const session = cookieValue(
				await impersonate(adminSession, { user: targetId, mode: 'session' })
					.expect(200),
				SESSION_COOKIE,
			);

			const asTargetWs = socket(session);
			await asTargetWs.waitForState(asTargetWs.conn.OPEN);
			expect((await me(session).expect(200)).body.data.id).toBe(targetId);

			// Cookie mode: the project website's refresh cookie
			const cookie = await impersonate(
				adminSession,
				{ user: targetId, mode: 'cookie' },
			).expect(200);

			const refreshToken = cookieValue(cookie, REFRESH_COOKIE);
			const accessToken = cookie.body.data.access_token;

			// A write as the target reaches the target's own subscription
			await request(url)
				.patch(`/items/${ITEMS}/${itemId}`)
				.send({ note: 'as target' })
				.set('Authorization', `Bearer ${accessToken}`)
				.expect(200);

			const events = await targetWs.getMessages(1);
			expect(events![0]).toMatchObject({ type: 'subscription', event: 'update' });

			// Stop: the admin's cookie is theirs again, the as-target socket is ended
			const stop = await request(url)
				.delete('/auth/impersonate')
				.set('Authorization', `Bearer ${session}`)
				.expect(200);

			const restored = cookieValue(stop, SESSION_COOKIE);
			expect((await me(restored).expect(200)).body.data.id).toBe(adminId);
			await me(session).expect(401);

			await expectEnded(asTargetWs);
			await expectAlive(adminWs, adminSession);
			await expectAlive(targetWs, target);

			// Logging out of the cookie-mode impersonation ends every impersonation
			// the admin runs — this row, here — never the admin's Studio session
			await request(url)
				.post('/auth/logout')
				.send({ mode: 'cookie' })
				.set('Cookie', `${REFRESH_COOKIE}=${refreshToken}`)
				.expect(204);

			await expectAlive(adminWs, adminSession);
			await expectAlive(targetWs, target);

			// Logging out of a session-mode impersonation is a logout: the admin's
			// own session goes with it, Stop was the only way back
			const again = cookieValue(
				await impersonate(adminSession, { user: targetId, mode: 'session' })
					.expect(200),
				SESSION_COOKIE,
			);

			await request(url)
				.post('/auth/logout')
				.send({ mode: 'session' })
				.set('Cookie', `${SESSION_COOKIE}=${again}`)
				.expect(204);

			await expectEnded(adminWs);
			await expectAlive(targetWs, target);
			await me(adminSession).expect(401);
			await me(again).expect(401);

			const minted = await db('directus_sessions')
				.where({ impersonator: adminId });

			expect(minted).toEqual([]);

			const ends = await db('directus_activity')
				.where({ action: 'impersonate_end', item: targetId })
				.whereNotIn('id', earlierEnds)
				.select('user', 'impersonator');

			expect(ends).toEqual([
				{ user: adminId, impersonator: null },
				{ user: adminId, impersonator: null },
				{ user: adminId, impersonator: null },
			]);

			targetWs.conn.close();
		});

		it(oneLine`
			clearing a user's sessions reaches the sockets run as them, never as others
		`, async () => {
			const target = await login(targetEmail, targetPassword);
			const targetWs = socket(target);
			await targetWs.waitForState(targetWs.conn.OPEN);

			const adminSession = await login(USER.ADMIN.EMAIL, USER.ADMIN.PASSWORD);

			const session = cookieValue(
				await impersonate(adminSession, { user: targetId, mode: 'session' })
					.expect(200),
				SESSION_COOKIE,
			);

			const asTargetWs = socket(session);
			await asTargetWs.waitForState(asTargetWs.conn.OPEN);

			// The admin's credentials change: every session they hold or run ends
			await request(url)
				.patch(`/users/${adminId}`)
				.send({ password: USER.ADMIN.PASSWORD })
				.set('Authorization', admin)
				.expect(200);

			await expectEnded(asTargetWs);
			await expectAlive(targetWs, target);

			// The target's do: their own sockets go
			await request(url)
				.patch(`/users/${targetId}`)
				.send({ password: targetPassword })
				.set('Authorization', admin)
				.expect(200);

			await expectEnded(targetWs);
			await me(target).expect(401);
		});

		it(oneLine`
			the admin's own session ending by its token ends what it opened, on record
		`, async () => {
			const target = await login(targetEmail, targetPassword);
			const targetWs = socket(target);
			await targetWs.waitForState(targetWs.conn.OPEN);

			const adminSession = await login(USER.ADMIN.EMAIL, USER.ADMIN.PASSWORD);

			const session = cookieValue(
				await impersonate(adminSession, { user: targetId, mode: 'session' })
					.expect(200),
				SESSION_COOKIE,
			);

			const asTargetWs = socket(session);
			await asTargetWs.waitForState(asTargetWs.conn.OPEN);

			// And a project-website one: no session of the admin's behind it
			const cookie = await impersonate(
				adminSession,
				{ user: targetId, mode: 'cookie' },
			).expect(200);

			const refreshToken = cookieValue(cookie, REFRESH_COOKIE);

			const ended = () => {
				return db('directus_activity')
					.where({ action: 'impersonate_end', item: targetId })
					.count({ count: '*' })
					.first()
					.then((row) => Number(row?.count));
			};

			const before = await ended();

			// An API client holding the admin's own session token logs it out: every
			// impersonation the admin runs is ended with it — sockets told, trail
			// written — not dropped by the foreign key behind its back
			await request(url)
				.post('/auth/logout')
				.send({ mode: 'session' })
				.set('Cookie', `${SESSION_COOKIE}=${adminSession}`)
				.expect(204);

			await expectEnded(asTargetWs);
			await expectAlive(targetWs, target);
			await me(session).expect(401);

			await request(url)
				.post('/auth/refresh')
				.send({ refresh_token: refreshToken, mode: 'json' })
				.expect(401);

			expect(await ended()).toBe(before + 2);

			targetWs.conn.close();
		});
	});
});
