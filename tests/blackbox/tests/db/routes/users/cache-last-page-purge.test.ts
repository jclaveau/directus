import config, { getUrl, paths } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The app tracks every navigation through `PATCH /users/me/track/page`, which
// upstream writes with the purge off (a whole-cache flush per navigation in full
// mode). Silenced, the scoped purge never heard of it either: `/users/me` kept
// the `last_page` of the fill until its TTL and every navigation re-staled it.
// The dev audit reported it on every run. The purge stops at the user's own
// slices: the bare `directus_users` tag would hand any session a purge of every
// listing and user hop, at the limiter's rate, for a column none of them shows.

const cacheStatusHeader = 'x-cache-status';

describe.each([
	{
		mode: 'scoped',
		store: { CACHE_STORE: 'redis', REDIS_HOST: 'localhost', REDIS_PORT: '6108' },
		title: 'refills the entry with the tracked page',
		refilled: true,
	},
	{
		mode: 'full',
		store: { CACHE_STORE: 'memory' },
		title: 'keeps the silence upstream chose over a flush per navigation',
		refilled: false,
	},
])('tracking a page under the $mode purge', ({ mode, store, title, refilled }) => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = mode;
		env[vendor]['CACHE_NAMESPACE'] = `directus-users-last-page-${mode}-${vendor}`;
		Object.assign(env[vendor], store);

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

		function read(path: string, accessToken: string) {
			return request(getUrl(vendor, env))
				.get(path)
				.query({ fields: 'id,last_page' })
				.set('Authorization', `Bearer ${accessToken}`);
		}

		// An aggregate collapses rows across slices, so the read carries the bare
		// collection tag and nothing narrower: the entry every user write reaches.
		function count(accessToken: string) {
			return request(getUrl(vendor, env))
				.get('/users')
				.query({ 'aggregate[count]': 'id' })
				.set('Authorization', `Bearer ${accessToken}`);
		}

		it(title, async () => {
			const session = await request(getUrl(vendor, env))
				.post('/auth/login')
				.send({ email: USER.ADMIN.EMAIL, password: USER.ADMIN.PASSWORD });

			expect(session.statusCode).toBe(200);
			const accessToken = session.body.data.access_token as string;
			const page = `/content/articles/${Date.now()}`;

			const filled = await read('/users/me', accessToken);
			expect(filled.headers[cacheStatusHeader]).toBe('MISS');

			// Non-vacuity: both entries are served from the cache before the write.
			const hit = await read('/users/me', accessToken);
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');

			await read('/collections', accessToken);
			const unrelated = await read('/collections', accessToken);
			expect(unrelated.headers[cacheStatusHeader]).toBe('HIT');

			await count(accessToken);
			const bare = await count(accessToken);
			expect(bare.headers[cacheStatusHeader]).toBe('HIT');

			const tracked = await request(getUrl(vendor, env))
				.patch('/users/me/track/page')
				.send({ last_page: page })
				.set('Authorization', `Bearer ${accessToken}`);

			expect(tracked.statusCode).toBe(204);

			const after = await read('/users/me', accessToken);

			const expected = refilled
				? { status: 'MISS', lastPage: page }
				: { status: 'HIT', lastPage: filled.body.data.last_page };

			expect(after.headers[cacheStatusHeader]).toBe(expected.status);
			expect(after.body.data.last_page).toBe(expected.lastPage);

			// Either way the write reaches no other collection: a purge, never a flush.
			const untouched = await read('/collections', accessToken);
			expect(untouched.headers[cacheStatusHeader]).toBe('HIT');

			// Nor the collection's bare tag: the user's own slices, nothing wider.
			const stillBare = await count(accessToken);
			expect(stillBare.headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
