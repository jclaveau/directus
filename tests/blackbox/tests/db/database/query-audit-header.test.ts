import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const COLLECTION = 'query_audit_header_articles';

const queryAuditHeader = 'x-query-audit';

const feature = loadFeature('./tests/db/database/query-audit-header.feature');

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['QUERY_AUDIT_HEADER'] = queryAuditHeader;
	env[vendor]['QUERY_AUDIT_STATEMENTS'] = 'true';

	let instance: ChildProcess;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	// The collection goes through the spawned instance only: a schema change on
	// the shared one would disturb the files running beside this one.
	beforeAll(async () => {
		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);

		await CreateCollection(vendor, {
			collection: COLLECTION,
			fields: [{ field: 'title', type: 'string', meta: {} }],
			env,
		});

		// The first request of a kind loads the schema and the admin's
		// permissions; every header below is the one of a warm instance.
		await createArticles();
		await readArticles();
	}, 60_000);

	afterAll(async () => {
		await request(getUrl(vendor, env))
			.delete(`/collections/${COLLECTION}`)
			.set('Authorization', auth);

		instance.kill();
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

	function requestProbe(route: string) {
		return request(getUrl(vendor, env))
			.get(`/query-audit-probe/${route}`)
			.set('Authorization', auth);
	}

	type TransactionEntry = {
		ms: number;
		outcome?: string;
		tables: Record<string, Record<string, number>>;
		statements: { sql: string; count: number; ms: number }[];
	};

	function auditOf(response: Response): TransactionEntry[] {
		return JSON.parse(response.headers[queryAuditHeader]);
	}

	// Durations vary from run to run, so they are checked apart: what is left is
	// compared stringified, in its key order, since the order is part of what the
	// header reports.
	function entriesWithoutDurations(response: Response) {
		return JSON.stringify(auditOf(response).map(({ outcome, tables }) => {
			return { outcome, tables };
		}));
	}

	function expectHeader(response: Response, docString: string) {
		expect(auditOf(response).map(({ ms }) => typeof ms))
			.toEqual(auditOf(response).map(() => 'number'));

		expect(entriesWithoutDurations(response))
			.toBe(JSON.stringify(loadYaml(docString)));
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a create reports its transaction and the reads around it',
			({ when, then }) => {
				let response: Response;

				when('three articles are created', async () => {
					response = await createArticles();

					expect(response.statusCode).toBe(200);
				});

				// The statements a create runs differ by dialect.
				then('on postgres the header reads:', (docString: string) => {
					if (vendor === 'postgres') {
						expectHeader(response, docString);
					}
				});
			},
		);

		scenario(
			'a pool read inside a transaction is an entry of its own',
			({ when, then }) => {
				let response: Response;

				// sqlite's pool holds one connection: a pool read inside an open
				// transaction would wait on it forever.
				when('the pool route is requested', async () => {
					if (vendor !== 'sqlite3') {
						response = await requestProbe('pool-inside-transaction');

						expect(response.statusCode).toBe(200);
					}
				});

				then(
					'the header reads, except on sqlite3:',
					(docString: string) => {
						if (vendor !== 'sqlite3') {
							expectHeader(response, docString);
						}
					},
				);
			},
		);

		scenario(
			'reads through the transaction share its entry',
			({ when, then, and }) => {
				let response: Response;

				when('the transaction route is requested', async () => {
					response = await requestProbe('transaction-only');

					expect(response.statusCode).toBe(200);
				});

				then('the header reads:', (docString: string) => {
					expectHeader(response, docString);
				});

				// Quoting differs by dialect.
				and(
					"on postgres the transaction's statements read:",
					(docString: string) => {
						if (vendor === 'postgres') {
							const { statements } = auditOf(response)[1]!;

							expect(statements.map(({ sql, count }) => ({ sql, count })))
								.toEqual(loadYaml(docString));
						}
					},
				);
			},
		);

		scenario(
			'two requests at once each report what they report alone',
			({ when, then }) => {
				let createdAlone: Response;
				let readAlone: Response;
				let createdAlongside: Response;
				let readAlongside: Response;

				when(
					'a create and a read run one after the other, then both at once',
					async () => {
						createdAlone = await createArticles();
						readAlone = await readArticles();

						[createdAlongside, readAlongside] = await Promise.all([
							createArticles(),
							readArticles(),
						]);
					},
				);

				then('each reports the same entries both times', () => {
					expect({
						created: entriesWithoutDurations(createdAlongside),
						read: entriesWithoutDurations(readAlongside),
					}).toEqual({
						created: entriesWithoutDurations(createdAlone),
						read: entriesWithoutDurations(readAlone),
					});
				});
			},
		);

		scenario(
			'an error response reports the statements it ran',
			({ when, then }) => {
				let response: Response;

				when('a missing collection is read', async () => {
					response = await request(getUrl(vendor, env))
						.get('/items/query_audit_header_missing')
						.set('Authorization', auth);
				});

				then(
					'the response is a 403 whose header reads:',
					(docString: string) => {
						expect(response.statusCode).toBe(403);

						expectHeader(response, docString);
					},
				);
			},
		);

		scenario('no header without QUERY_AUDIT_HEADER', ({ when, then }) => {
			let response: Response;

			when(
				'the collection is read from an instance without QUERY_AUDIT_HEADER',
				async () => {
					response = await request(getUrl(vendor))
						.get(`/items/${COLLECTION}`)
						.set('Authorization', auth);
				},
			);

			then('the response carries no query audit header', () => {
				expect(response.headers[queryAuditHeader]).toBeUndefined();
			});
		});
	});
});
