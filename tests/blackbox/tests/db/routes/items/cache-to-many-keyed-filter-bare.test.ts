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

// A filter on a TO-MANY alias names the roots holding at least one matching child —
// it never bounds the children the read nests. Here the report is matched because ONE
// attachment was uploaded by K, and the read nests the K2 attachment beside it. Keying
// the collection to K would leave the K2 row covered by nothing: a write to it purges
// `uploaded_by=K2` and the read serves a stale HIT. Only the bare tag covers this.

const OWNER = 'tm_owner';
const REPORT = 'tm_report';
const ATTACHMENT = 'tm_attachment';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a to-many filter does not key the children the read nests, so they stay bare (#446)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-to-many-keyed-${vendor}`;

		let instance: ChildProcess;
		let filteredOwnerId: number;
		let otherOwnerId: number;
		let otherAttachmentId: number;
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
				collection: ATTACHMENT,
				field: 'uploaded_by',
				otherCollection: OWNER,
			});

			await CreateFieldO2M(vendor, {
				collection: REPORT,
				field: 'attachments',
				otherCollection: ATTACHMENT,
				otherField: 'report_ref',
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'owner-in-filter' }, { name: 'owner-beside-it' }],
			});

			filteredOwnerId = owners[0].id;
			otherOwnerId = owners[1].id;

			const reports = await CreateItem(vendor, {
				collection: REPORT,
				item: [{ name: 'report' }],
			});

			const attachments = await CreateItem(vendor, {
				collection: ATTACHMENT,
				item: [
					{
						body: 'uploaded by the filtered owner',
						report_ref: reports[0].id,
						uploaded_by: filteredOwnerId,
					},
					{
						body: 'uploaded by somebody else',
						report_ref: reports[0].id,
						uploaded_by: otherOwnerId,
					},
				],
			});

			otherAttachmentId = attachments[1].id;

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

		// The filter keys the attachment alias, the fields nest every attachment.
		function readReport() {
			return request(getUrl(vendor, env))
				.get(`/items/${REPORT}`)
				.query({
					'filter[attachments][uploaded_by][id][_eq]': String(filteredOwnerId),
					fields: '*,attachments.*',
				})
				.set('Authorization', auth);
		}

		function updateOtherAttachment(body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${ATTACHMENT}/${otherAttachmentId}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			does not key the nested attachments to the filtered owner, and a write to the
			one beside it evicts the read
		`, async () => {
			await clearCache();

			const warm = await readReport();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			// The read nests both attachments, so keying it to the filtered owner leaves
			// the other one covered by nothing.
			expect(warm.headers[cacheTagsHeader]).not.toMatch(
				new RegExp(`(^|, )${ATTACHMENT}:uploaded_by=${filteredOwnerId}(,|$)`),
			);

			expect((await readReport()).headers[cacheStatusHeader]).toBe('HIT');

			await updateOtherAttachment('edited beside the filter');

			const after = await readReport();

			// The soundness half: the bare tag lets that write reach this entry.
			expect(after.headers[cacheStatusHeader]).toBe('MISS');

			const bodies = after.body.data[0].attachments.map((row: any) => row.body);
			expect(bodies).toContain('edited beside the filter');
		});
	});
});
