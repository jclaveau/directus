import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A read filtering a related collection by its own scoped field (`tag.label._eq X`)
// bounds it to that value, so it pins `sf_tag:label=X` — not its pk, not bare.
const ROOT = 'sf_root';
const TAG = 'sf_tag';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read pins a related collection by the scoped field its filter names (#416)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-scoped-field-filter-${vendor}`;

		let instance: ChildProcess;
		let alphaTagId: number;
		let betaTagId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROOT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						// `label` and `kind` are flat scope fields, so a filter on
						// either can pin — and naming both bares (the conflict guard).
						collection: TAG,
						meta: { scoped_cache_fields: ['label', 'kind'] },
						fields: [
							{ field: 'label', type: 'string', meta: {} },
							{ field: 'kind', type: 'string', meta: {} },
							{ field: 'body', type: 'string', meta: {} },
						],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: ROOT,
				field: 'tag',
				otherCollection: TAG,
			});

			const tags = await CreateItem(vendor, {
				collection: TAG,
				item: [
					{ label: 'alpha', kind: 'k1', body: 'a' },
					{ label: 'beta', kind: 'k1', body: 'b' },
					{ label: 'gamma', kind: 'k2', body: 'g' },
				],
			});

			alphaTagId = tags[0].id;
			betaTagId = tags[1].id;

			await CreateItem(vendor, {
				collection: ROOT,
				item: [
					{ name: 'r-alpha', tag: tags[0].id },
					{ name: 'r-beta', tag: tags[1].id },
					{ name: 'r-gamma', tag: tags[2].id },
				],
			});

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance.kill();

			await DeleteCollection(vendor, { collection: ROOT });
			await DeleteCollection(vendor, { collection: TAG });
		});

		// Filters the root by its tag's scoped `label` value.
		function readRootsByTagLabel() {
			return request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({ 'filter[tag][label][_eq]': 'alpha', fields: '*' })
				.set('Authorization', auth);
		}

		function updateTagBody(id: number, body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${TAG}/${id}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('pins the tag by its scoped label value, not by pk, never bare', async () => {
			const tags = (await readRootsByTagLabel()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${TAG}:label=alpha(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${TAG}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${TAG}:id=`));
		});

		it('a write to a tag with another label keeps the read cached', async () => {
			await clearCache();

			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('HIT');

			await updateTagBody(betaTagId, 'beta touched');

			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a write to a tag with the filtered label evicts the read', async () => {
			await clearCache();

			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('HIT');

			await updateTagBody(alphaTagId, 'alpha touched');

			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it('inserting a tag with the filtered label evicts the read', async () => {
			await clearCache();

			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('HIT');

			// A pk filter cannot be matched by an insert; a scoped-field one can, and the
			// create emits `sf_tag:label=alpha`, so the pin must catch it.
			await request(getUrl(vendor, env))
				.post(`/items/${TAG}`)
				.send({ label: 'alpha', kind: 'k1', body: 'a2' })
				.set('Authorization', auth);

			expect((await readRootsByTagLabel()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it('slices each value of an _in filter on the scoped field', async () => {
			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({ 'filter[tag][label][_in]': 'alpha,gamma', fields: '*' })
				.set('Authorization', auth)).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${TAG}:label=alpha(,|$)`));
			expect(tags).toMatch(new RegExp(`(^|, )${TAG}:label=gamma(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${TAG}(,|$)`));
		});

		it('unions the slices of an _or over one scoped field', async () => {
			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({
					'filter[_or][0][tag][label][_eq]': 'alpha',
					'filter[_or][1][tag][label][_eq]': 'gamma',
					fields: '*',
				})
				.set('Authorization', auth)).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${TAG}:label=alpha(,|$)`));
			expect(tags).toMatch(new RegExp(`(^|, )${TAG}:label=gamma(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${TAG}(,|$)`));
		});

		it('bares the collection when the filter names two scoped fields', async () => {
			// Two different scoped fields name no single slice — the pin must decline to
			// bare rather than mix the axes, and the bare tag still evicts soundly.
			const readByTwoFields = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${ROOT}`)
					.query({
						'filter[tag][label][_eq]': 'alpha',
						'filter[tag][kind][_eq]': 'k1',
						fields: '*',
					})
					.set('Authorization', auth);
			};

			const tags = (await readByTwoFields()).headers[cacheTagsHeader];
			expect(tags).toMatch(new RegExp(`(^|, )${TAG}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${TAG}:`));

			await clearCache();
			expect((await readByTwoFields()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readByTwoFields()).headers[cacheStatusHeader]).toBe('HIT');

			await updateTagBody(alphaTagId, 'alpha conflict touched');

			expect((await readByTwoFields()).headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
