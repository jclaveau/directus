import config, { getUrl, paths } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A login and a session refresh stamp `last_access` with a raw update — no
// activity, no revision, no hook — so nothing purged the user's cached reads,
// and `/users/me` served `fields=*` kept the stamp of the fill until its TTL.
// The preview audit caught it on the entry of a user whose session refreshed.

const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a login or a refresh drops the user's cached reads with the stamp it moved
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-users-last-access-${vendor}`;

		let instance: ChildProcess;

		beforeAll(async () => {
			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(() => {
			instance.kill();
		});

		// The admin: the stamp has to be readable for the witness to see it move,
		// and app access alone does not read `last_access`.
		const credentials = {
			email: USER.ADMIN.EMAIL,
			password: USER.ADMIN.PASSWORD,
		};

		async function login() {
			const response = await request(getUrl(vendor, env))
				.post('/auth/login')
				.send(credentials);

			expect(response.statusCode).toBe(200);

			return response.body.data as { access_token: string; refresh_token: string };
		}

		function readMe(accessToken: string) {
			return request(getUrl(vendor, env))
				.get('/users/me')
				.query({ fields: 'id,last_access' })
				.set('Authorization', `Bearer ${accessToken}`);
		}

		it('a refresh: the entry is refilled with the new stamp', async () => {
			const session = await login();

			const filled = await readMe(session.access_token);
			expect(filled.headers[cacheStatusHeader]).toBe('MISS');

			// Non-vacuity: the entry is served from the cache before the refresh.
			const hit = await readMe(session.access_token);
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');

			const refreshed = await request(getUrl(vendor, env))
				.post('/auth/refresh')
				.send({ refresh_token: session.refresh_token });

			expect(refreshed.statusCode).toBe(200);

			const after = await readMe(refreshed.body.data.access_token);

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(filled.body.data.last_access).toEqual(expect.any(String));
			expect(after.body.data.last_access).not.toBe(filled.body.data.last_access);
		});

		it('a login elsewhere: the first session reads the new stamp', async () => {
			const first = await login();

			const filled = await readMe(first.access_token);
			expect(filled.headers[cacheStatusHeader]).toBe('MISS');

			await login();

			const after = await readMe(first.access_token);

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(filled.body.data.last_access).toEqual(expect.any(String));
			expect(after.body.data.last_access).not.toBe(filled.body.data.last_access);
		});
	});
});
