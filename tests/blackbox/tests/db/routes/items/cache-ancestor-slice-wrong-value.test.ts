import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
	CreateFieldO2M,
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

// RED until fixed. `ancestorSliceTagsFor` (item-scoped-cache-service.ts) stamps a
// would-be-bare nested collection with an ancestor's pinned VALUE whenever that
// ancestor is pinned ANYWHERE in the read — never checking the collection reaches
// that ancestor by the path that pinned it. Here `owner` is pinned to the report's
// owner (K) by the root filter, but the nested `attachment` reaches `owner` through
// its own `uploaded_by` fk, which points at a DIFFERENT owner (K2). The read is
// stamped `attachment:uploaded_by=K`; a write to the K2 attachment purges
// `uploaded_by=K2`, never K, so the read serves a stale HIT.

const OWNER = 'anc_wrongval_owner';
const REPORT = 'anc_wrongval_report';
const ATTACHMENT = 'anc_wrongval_attachment';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a nested collection reaches a pinned ancestor by a value the ancestor was not
	pinned to, so its ancestor slice names the wrong owner (#402)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-anc-wrongval-${vendor}`;

		let instance: ChildProcess;
		let pinnedOwnerId: number;
		let realUploaderId: number;
		let attachmentId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: REPORT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: ATTACHMENT,
						meta: { scoped_cache_fields: ['uploaded_by'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: REPORT,
				field: 'for_owner',
				otherCollection: OWNER,
			});

			await CreateFieldM2O(vendor, {
				collection: ATTACHMENT,
				field: 'uploaded_by',
				otherCollection: OWNER,
			});

			// Reverse fk `report_ref` is NOT scoped, so the child o2m pin declines and
			// attachment falls to the ancestor-slice-or-bare path under test.
			await CreateFieldO2M(vendor, {
				collection: REPORT,
				field: 'attachments',
				otherCollection: ATTACHMENT,
				otherField: 'report_ref',
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'owner-of-report' }, { name: 'owner-of-upload' }],
			});

			pinnedOwnerId = owners[0].id;
			realUploaderId = owners[1].id;

			const reports = await CreateItem(vendor, {
				collection: REPORT,
				item: [{ name: 'report', for_owner: pinnedOwnerId }],
			});

			const attachments = await CreateItem(vendor, {
				collection: ATTACHMENT,
				item: [{
					body: 'a first draft',
					report_ref: reports[0].id,
					uploaded_by: realUploaderId,
				}],
			});

			attachmentId = attachments[0].id;

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance?.kill();

			await DeleteCollection(vendor, { collection: ATTACHMENT });
			await DeleteCollection(vendor, { collection: REPORT });
			await DeleteCollection(vendor, { collection: OWNER });
		});

		// Pins `owner` to the report's owner (K) via the root filter, while nesting
		// the attachment whose real `uploaded_by` is K2.
		function readReport() {
			return request(getUrl(vendor, env))
				.get(`/items/${REPORT}`)
				.query({
					'filter[for_owner][id][_eq]': String(pinnedOwnerId),
					fields: '*,attachments.*',
				})
				.set('Authorization', auth);
		}

		function updateAttachment(body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${ATTACHMENT}/${attachmentId}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			does not stamp the nested attachment with the report owner's slice value,
			then evicts the report read on a write to that attachment
		`, async () => {
			await clearCache();

			const warm = await readReport();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			// PRIMARY (RED until fixed): the attachment reaches `owner` by its own
			// `uploaded_by` fk (K2), so the read must not stamp K (pinnedOwnerId).
			expect(warm.headers[cacheTagsHeader]).not.toMatch(
				new RegExp(`${ATTACHMENT}:uploaded_by=${pinnedOwnerId}(,|$)`),
			);

			expect((await readReport()).headers[cacheStatusHeader]).toBe('HIT');

			await updateAttachment('a corrected draft');

			const after = await readReport();

			// Secondary: a sound tag lets the attachment write purge this read.
			expect(after.body.data[0].attachments[0].body).toBe('a corrected draft');
		});
	});
});
