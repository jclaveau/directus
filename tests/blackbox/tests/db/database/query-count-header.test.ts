import config, { getUrl, paths } from '@common/config';
import { CreateCollection, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const COLLECTION = 'query_count_header_articles';

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['QUERY_COUNT_HEADER'] = 'X-Query-Count';
	env[vendor]['QUERY_TRANSACTIONS_HEADER'] = 'X-Query-Transactions';
	env[vendor]['QUERY_TABLES_HEADER'] = 'X-Query-Tables';

	let instance: ChildProcess;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		await CreateCollection(vendor, {
			collection: COLLECTION,
			fields: [{ field: 'title', type: 'string', meta: {} }],
		});

		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);

		// The first request of a kind loads the schema and the admin's
		// permissions; every count below is the one of a warm instance.
		await createArticles();
		await readArticles();
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		await DeleteCollection(vendor, { collection: COLLECTION });
	});

	function createArticles() {
		return request(getUrl(vendor, env))
			.post(`/items/${COLLECTION}`)
			.send([{ title: 'a' }, { title: 'b' }, { title: 'c' }])
			.set('Authorization', auth);
	}

	function readArticles() {
		return request(getUrl(vendor, env))
			.get(`/items/${COLLECTION}`)
			.query({ fields: 'id,title', limit: '2' })
			.set('Authorization', auth);
	}

	it('reports nothing when no env var names a header', async () => {
		const response = await request(getUrl(vendor))
			.get(`/items/${COLLECTION}`)
			.set('Authorization', auth);

		expect(response.headers['x-query-count']).toBeUndefined();
		expect(response.headers['x-query-transactions']).toBeUndefined();
		expect(response.headers['x-query-tables']).toBeUndefined();
	});

	it.runIf(vendor === 'postgres')(
		'counts the statements a create ran',
		async () => {
			const response = await createArticles();

			expect(response.statusCode).toBe(200);

			expect(response.headers['x-query-count']).toBe(
				'total=0, select=0, insert=0, update=0, delete=0, transaction=0, other=0',
			);

			expect(response.headers['x-query-tables']).toBe('');
		},
	);

	it('counts each of two parallel requests as if it ran alone', async () => {
		const createdAlone = await createArticles();
		const readAlone = await readArticles();

		const [createdAlongside, readAlongside] = await Promise.all([
			createArticles(),
			readArticles(),
		]);

		expect(createdAlongside.headers['x-query-count']).toBe(
			createdAlone.headers['x-query-count'],
		);

		expect(createdAlongside.headers['x-query-tables']).toBe(
			createdAlone.headers['x-query-tables'],
		);

		expect(readAlongside.headers['x-query-count']).toBe(
			readAlone.headers['x-query-count'],
		);

		expect(readAlongside.headers['x-query-tables']).toBe(
			readAlone.headers['x-query-tables'],
		);
	});

	// sqlite's pool holds one connection: a pool read inside an open transaction
	// would wait on it forever.
	it.skipIf(vendor === 'sqlite3')(
		'reports two connections when a pool read runs inside a transaction',
		async () => {
			const response = await request(getUrl(vendor, env))
				.get('/query-count-probe/pool-inside-transaction')
				.set('Authorization', auth);

			expect(response.statusCode).toBe(200);

			expect(response.headers['x-query-transactions']).toMatch(
				/^count=1, rollback=0, savepoint=0, longest=\d+ms, maxConnections=2$/,
			);
		},
	);

	it(
'reports one connection when every read goes through the transaction',
		async () => {
			const response = await request(getUrl(vendor, env))
				.get('/query-count-probe/transaction-only')
				.set('Authorization', auth);

			expect(response.statusCode).toBe(200);

			expect(response.headers['x-query-transactions']).toMatch(
				/^count=1, rollback=0, savepoint=0, longest=\d+ms, maxConnections=1$/,
			);
		}
);

	it('counts the statements of an error response too', async () => {
		const response = await request(getUrl(vendor, env))
			.get('/items/query_count_header_missing')
			.set('Authorization', auth);

		expect(response.statusCode).toBe(403);

		expect(response.headers['x-query-count']).toMatch(/^total=\d+, select=/);
	});
});
