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
	env[vendor]['QUERY_AUDIT_LEVEL'] = 'statements';
	env[vendor]['CORS_ENABLED'] = 'true';
	env[vendor]['CORS_ORIGIN'] = 'true';

	let instance: ChildProcess;
	let cappedInstance: ChildProcess | undefined;

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

		// An instance still shutting down would answer beside the next file.
		await Promise.all([instance, cappedInstance].map((stoppedInstance) => {
			return stoppedInstance && exitOf(stoppedInstance);
		}));
	});

	function exitOf(runningInstance: ChildProcess) {
		return new Promise<void>((resolve) => {
			if (runningInstance.exitCode !== null || runningInstance.signalCode !== null) {
				return resolve();
			}

			runningInstance.once('exit', () => resolve());
			runningInstance.kill();
		});
	}

	// An instance that starts anyway is stopped after 30 seconds, and exits with
	// no code.
	function refusedStartOf(refusedEnv: Record<string, string>) {
		return new Promise<{ code: number | null; output: string }>((resolve) => {
			const refusedInstance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: { ...env[vendor], ...refusedEnv },
			});

			const stopTimer = setTimeout(() => refusedInstance.kill(), 30_000);
			let output = '';

			refusedInstance.stdout.on('data', (chunk) => (output += String(chunk)));
			refusedInstance.stderr.on('data', (chunk) => (output += String(chunk)));

			refusedInstance.on('exit', (code) => {
				clearTimeout(stopTimer);
				resolve({ code, output });
			});
		});
	}

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

	type RequestCell = {
		method: 'GET' | 'POST';
		path: string;
		payload?: unknown;
		headers?: Record<string, string>;
	};

	type TransactionEntry = {
		ms: number;
		outcome?: string;
		tables: Record<string, Record<string, number>>;
		statements?: { bindings?: unknown[][] }[];
		entriesDropped?: number;
	};

	// A cell is YAML: the fork's multiline notation dedents it as a block.
	function sendRequest(instanceUrl: string, requestCell: string) {
		const { method, path, payload, headers = {} } = loadYaml(
			requestCell,
		) as RequestCell;

		const pendingRequest = method === 'POST'
			? request(instanceUrl).post(path)
			: request(instanceUrl).get(path);

		pendingRequest.set('Authorization', auth);

		for (const [headerName, headerValue] of Object.entries(headers)) {
			pendingRequest.set(
				headerName,
				headerValue.replace('<app access token>', USER.APP_ACCESS.TOKEN),
			);
		}

		return payload === undefined
			? pendingRequest
			: pendingRequest.send(payload as object);
	}

	function auditOf(response: Response): TransactionEntry[] | null {
		return response.headers[queryAuditHeader] === undefined
			? null
			: JSON.parse(response.headers[queryAuditHeader]);
	}

	// A response cell states the keys it checks, so the rest of a response is
	// matched loosely; an array still has to hold as many items as it states.
	async function expectExchanges(
		instanceUrl: string,
		table: { request: string; response: string }[],
	) {
		const responses: Response[] = [];

		for (const { request: requestCell } of table) {
			responses.push(await sendRequest(instanceUrl, requestCell));
		}

		expect(responses.map((response) => {
			return {
				code: response.statusCode,
				body: response.body,
				headers: {
					...response.headers,
					[queryAuditHeader]: auditOf(response),
				},
			};
		})).toMatchObject(table.map(({ response }) => loadYaml(response)));

		return responses;
	}

	// Durations vary from run to run: two runs of a request compare the rest.
	function entriesWithoutDurations(response: Response) {
		return JSON.stringify(auditOf(response)!.map(({ outcome, tables }) => {
			return { outcome, tables };
		}));
	}

	defineFeature(feature, (scenario) => {
		type ExchangeTable = { request: string; response: string }[];

		scenario(
			'a create reports its transaction and the reads around it',
			({ then }) => {
				// The statements a create runs differ by dialect.
				then(
					'on postgres these requests get these responses:',
					async (table: ExchangeTable) => {
						if (vendor === 'postgres') {
							await expectExchanges(getUrl(vendor, env), table);
						}
					},
				);
			},
		);

		scenario(
			'a pool read inside a transaction is an entry of its own',
			({ then }) => {
				// sqlite's pool holds one connection: a pool read inside an open
				// transaction would wait on it forever.
				then(
					'except on sqlite3, these requests get these responses:',
					async (table: ExchangeTable) => {
						if (vendor !== 'sqlite3') {
							await expectExchanges(getUrl(vendor, env), table);
						}
					},
				);
			},
		);

		scenario(
			'reads through the transaction share its entry',
			({ then, and }) => {
				then(
					'these requests get these responses:',
					async (table: ExchangeTable) => {
						await expectExchanges(getUrl(vendor, env), table);
					},
				);

				// Quoting differs by dialect.
				and(
					'on postgres these requests get these responses:',
					async (table: ExchangeTable) => {
						if (vendor === 'postgres') {
							await expectExchanges(getUrl(vendor, env), table);
						}
					},
				);
			},
		);

		scenario(
			"an admin asking full gets each run's bound values",
			({ then }) => {
				then(
					'on postgres these requests get these responses:',
					async (table: ExchangeTable) => {
						if (vendor === 'postgres') {
							await expectExchanges(getUrl(vendor, env), table);
						}
					},
				);
			},
		);

		// Authenticating a static token binds the token itself: the values a
		// request runs with are not for anyone but an admin to read.
		scenario(
			'anyone else asking full gets the statements alone',
			({ then, and }) => {
				let responses: Response[];

				then(
					'these requests get these responses:',
					async (table: ExchangeTable) => {
						responses = await expectExchanges(getUrl(vendor, env), table);
					},
				);

				and('no statement carries its bound values', () => {
					expect(responses[0]!.headers[queryAuditHeader])
						.not.toContain('"bindings"');
				});
			},
		);

		scenario('a level outside the list is refused', ({ then }) => {
			then(
				'these requests get these responses:',
				async (table: ExchangeTable) => {
					await expectExchanges(getUrl(vendor, env), table);
				},
			);
		});

		scenario(
			'a browser can read the refusal of a level outside the list',
			({ then }) => {
				then(
					'these requests get these responses:',
					async (table: ExchangeTable) => {
						await expectExchanges(getUrl(vendor, env), table);
					},
				);
			},
		);

		scenario(
			"a savepoint's rollback leaves its transaction open",
			({ then }) => {
				then(
					'these requests get these responses:',
					async (table: ExchangeTable) => {
						await expectExchanges(getUrl(vendor, env), table);
					},
				);
			},
		);

		// A raw newline or non-ASCII character in a header value makes Node
		// refuse the whole response.
		scenario('SQL a header cannot carry raw is escaped', ({ then, and }) => {
			let responses: Response[];

			then(
				'these requests get these responses:',
				async (table: ExchangeTable) => {
					responses = await expectExchanges(getUrl(vendor, env), table);
				},
			);

			and('the query audit header holds printable ASCII alone', () => {
				expect(responses[0]!.headers[queryAuditHeader])
					.toMatch(/^[\x20-\x7e]+$/);
			});
		});

		// Only postgres casts a bound value with `::`.
		scenario('a bound BigInt reads as its digits', ({ then }) => {
			then(
				'on postgres these requests get these responses:',
				async (table: ExchangeTable) => {
					if (vendor === 'postgres') {
						await expectExchanges(getUrl(vendor, env), table);
					}
				},
			);
		});

		scenario(
			'past QUERY_AUDIT_HEADER_MAX_SIZE, details are dropped and counted',
			({ given, then }) => {
				const cappedEnv = cloneDeep(env);

				given(
					'an instance whose QUERY_AUDIT_HEADER_MAX_SIZE is 240',
					async () => {
						const port = await getPort();

						cappedEnv[vendor].PORT = String(port);
						cappedEnv[vendor]['QUERY_AUDIT_HEADER_MAX_SIZE'] = '240';

						cappedInstance = spawn('node', [paths.cli, 'start'], {
							cwd: paths.cwd,
							env: cappedEnv[vendor],
						});

						await awaitDirectusConnection(port);

						// The first request loads the schema; the scenario's is warm.
						await request(getUrl(vendor, cappedEnv))
							.get('/query-audit-probe/transaction-only')
							.set('Authorization', auth);
					},
				);

				then(
					'these requests get these responses:',
					async (table: ExchangeTable) => {
						await expectExchanges(getUrl(vendor, cappedEnv), table);
					},
				);
			},
			60_000,
		);

		// Dropping every statement still leaves each entry its tables.
		scenario(
			'with no detail left to drop, the last entries are dropped and counted',
			({ then, and }) => {
				let responses: Response[];

				then(
					'these requests get these responses:',
					async (table: ExchangeTable) => {
						responses = await expectExchanges(getUrl(vendor, env), table);
					},
				);

				and(
					'the query audit header fits in 8kb, '
					+ 'its last entry counting the entries dropped',
					() => {
						expect(responses[0]!.headers[queryAuditHeader].length)
							.toBeLessThanOrEqual(8192);

						expect(auditOf(responses[0]!)!.at(-1))
							.toEqual({ entriesDropped: expect.any(Number) });
					},
				);
			},
		);

		scenario(
			'an instance with a level outside the list refuses to start',
			({ when, then }) => {
				let exit: { code: number | null; output: string };

				when('an instance starts with QUERY_AUDIT_LEVEL every', async () => {
					exit = await refusedStartOf({
						PORT: String(await getPort()),
						QUERY_AUDIT_LEVEL: 'every',
					});
				});

				then('it exits naming QUERY_AUDIT_LEVEL and the levels', () => {
					expect(exit.code, exit.output).toBe(1);
					expect(exit.output).toContain('QUERY_AUDIT_LEVEL');

					expect(exit.output)
						.toContain('which is not one of counts, statements, full.');
				});
			},
			60_000,
		);

		// Node refuses such a name on every response the instance would send.
		scenario(
			'an instance with a header name Node cannot write refuses to start',
			({ when, then }) => {
				let exit: { code: number | null; output: string };

				when(
					'an instance starts with QUERY_AUDIT_HEADER "x query audit"',
					async () => {
						exit = await refusedStartOf({
							PORT: String(await getPort()),
							QUERY_AUDIT_HEADER: 'x query audit',
						});
					},
				);

				then('it exits naming QUERY_AUDIT_HEADER', () => {
					expect(exit.code, exit.output).toBe(1);

					expect(exit.output).toContain(
						'"QUERY_AUDIT_HEADER" Environment Variable is "x query audit", '
						+ 'which is not a valid header name.',
					);
				});
			},
			60_000,
		);

		scenario(
			'two requests at once each report what they report alone',
			({ when, then }) => {
				let responsesAlone: Response[];
				let responsesAlongside: Response[];

				when(
					'these requests run one after the other, then all at once:',
					async (table: { request: string }[]) => {
						responsesAlone = [];

						for (const { request: requestCell } of table) {
							responsesAlone.push(
								await sendRequest(getUrl(vendor, env), requestCell),
							);
						}

						responsesAlongside = await Promise.all(table.map(
							({ request: requestCell }) => {
								return sendRequest(getUrl(vendor, env), requestCell);
							},
						));
					},
				);

				then('each reports the same entries both times', () => {
					expect(responsesAlongside.map(entriesWithoutDurations))
						.toEqual(responsesAlone.map(entriesWithoutDurations));
				});
			},
		);

		scenario(
			'an error response reports the statements it ran',
			({ then }) => {
				then(
					'these requests get these responses:',
					async (table: ExchangeTable) => {
						await expectExchanges(getUrl(vendor, env), table);
					},
				);
			},
		);

		scenario('no header without QUERY_AUDIT_HEADER', ({ given, then }) => {
			given('the instance without QUERY_AUDIT_HEADER', () => {});

			then(
				'these requests get these responses:',
				async (table: ExchangeTable) => {
					await expectExchanges(getUrl(vendor), table);
				},
			);
		});
	});
});
