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
import { createWebSocketConn } from '@common/transport';
import { ROLE, USER } from '@common/variables';
import { oneLine } from '@directus/utils';
import { awaitDirectusConnection } from '@utils/await-connection';
import { sleep } from '@utils/sleep';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex, { Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe('Impersonation', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['REDIS'] = 'redis://localhost:6108';
		env[vendor]['IMPERSONATION_ENABLED'] = 'true';
		env[vendor]['IMPERSONATION_WRITES'] = 'true';

		const readOnlyEnv = cloneDeep(config.envs);
		readOnlyEnv[vendor]['IMPERSONATION_ENABLED'] = 'true';

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
			const messages = await ws.getMessages(1);

			expect(messages![0]).toMatchObject({
				type: 'auth',
				status: 'error',
				error: { code: 'SESSION_ENDED' },
			});

			await ws.waitForState(ws.conn.CLOSED);
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

			for (const instanceEnv of [env, readOnlyEnv]) {
				instances.push(spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: instanceEnv[vendor],
				}));
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
		});

		it('json mode: a token as the target, credited to the admin', async () => {
			const response = await impersonate(
				USER.ADMIN.TOKEN,
				{ user: targetId, mode: 'json' },
			).expect(200);

			const token = response.body.data.access_token;
			expect(typeof token).toBe('string');

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

			const written = await db(ITEMS)
				.where({ note: 'read-only' })
				.first();

			expect(written).toBeUndefined();
		});

		it('ending an impersonation never reaches the target', async () => {
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

			// Logging out of the cookie-mode impersonation ends the admin's own
			// session with it
			await request(url)
				.post('/auth/logout')
				.send({ mode: 'cookie' })
				.set('Cookie', `${REFRESH_COOKIE}=${refreshToken}`)
				.expect(204);

			await expectEnded(adminWs);
			await expectAlive(targetWs, target);
			await me(adminSession).expect(401);

			const minted = await db('directus_sessions')
				.where({ impersonator: adminId });

			expect(minted).toEqual([]);

			const ends = await db('directus_activity')
				.where({ action: 'impersonate_end', item: targetId })
				.select('user', 'impersonator');

			expect(ends).toEqual([
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
	});
});
