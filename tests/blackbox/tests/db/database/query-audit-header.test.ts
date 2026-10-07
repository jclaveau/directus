import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep, omit } from 'lodash-es';
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

	function requestProbe(route: string) {
		return request(getUrl(vendor, env))
			.get(`/query-audit-probe/${route}`)
			.set('Authorization', auth);
	}

	function requestProbeAtLevel(level: string, token = USER.ADMIN.TOKEN) {
		return request(getUrl(vendor, env))
			.get('/query-audit-probe/transaction-only')
			.set('Authorization', `Bearer ${token}`)
			.set(queryAuditHeader, level);
	}

	type TransactionEntry = {
		ms: number;
		outcome?: string;
		tables: Record<string, Record<string, number>>;
		statements: {
			sql: string;
			count: number;
			ms: number;
			bindings?: unknown[][];
		}[];
		bindingsDropped?: number;
		statementsDropped?: number;
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
			"an admin asking full gets each run's bound values",
			({ when, then }) => {
				let response: Response;

				when('the transaction route is requested at the full level', async () => {
					response = await requestProbeAtLevel('full');

					expect(response.statusCode).toBe(200);
				});

				// Quoting differs by dialect.
				then(
					"on postgres the transaction's statements read:",
					(docString: string) => {
						if (vendor === 'postgres') {
							const { statements } = auditOf(response)[1]!;

							expect(statements.map(({ sql, count, bindings }) => {
								return { sql, count, bindings };
							})).toEqual(loadYaml(docString));
						}
					},
				);
			},
		);

		// Authenticating a static token binds the token itself: the values a
		// request runs with are not for anyone but an admin to read.
		scenario(
			'anyone else asking full gets the statements alone',
			({ when, then }) => {
				let response: Response;

				when(
					'a user who is no admin requests the transaction route at the full level',
					async () => {
						response = await requestProbeAtLevel(
							'full',
							USER.APP_ACCESS.TOKEN,
						);
					},
				);

				then(
					'the response is a 403 whose header lists statements without bound values',
					() => {
						expect(response.statusCode).toBe(403);
						expect(response.headers[queryAuditHeader]).toContain('"statements"');
						expect(response.headers[queryAuditHeader]).not.toContain('"bindings"');
					},
				);
			},
		);

		scenario('a level outside the list is refused', ({ when, then }) => {
			let response: Response;

			when('the transaction route is requested at the every level', async () => {
				response = await requestProbeAtLevel('every');
			});

			then('the response is a 400 naming the levels', () => {
				expect(response.statusCode).toBe(400);

				expect(response.body.errors[0].message).toBe(
					'Invalid query. "x-query-audit" must be one of counts, statements, full.',
				);
			});
		});

		scenario(
			"a savepoint's rollback leaves its transaction open",
			({ when, then }) => {
				let response: Response;

				when('the savepoint route is requested', async () => {
					response = await requestProbe('rollback-past-savepoint');

					expect(response.statusCode).toBe(200);
				});

				then('the header reads:', (docString: string) => {
					expectHeader(response, docString);
				});
			},
		);

		// A raw newline or non-ASCII character in a header value makes Node
		// refuse the whole response.
		scenario('SQL a header cannot carry raw is escaped', ({ when, then, and }) => {
			let response: Response;

			when('the accented multi-line route is requested', async () => {
				response = await requestProbe('accented-multiline');

				expect(response.statusCode).toBe(200);
			});

			then('the header holds printable ASCII alone', () => {
				expect(response.headers[queryAuditHeader]).toMatch(/^[\x20-\x7e]+$/);
			});

			and("the second entry's statements read:", (docString: string) => {
				const { statements } = auditOf(response)[1]!;

				expect(statements.map(({ sql, count }) => ({ sql, count })))
					.toEqual(loadYaml(docString));
			});
		});

		scenario(
			'past QUERY_AUDIT_HEADER_MAX_SIZE, details are dropped and counted',
			({ when, then }) => {
				let response: Response;

				when(
					'an instance capped at 240 bytes serves the transaction route at full',
					async () => {
						const cappedEnv = cloneDeep(env);
						const port = await getPort();

						cappedEnv[vendor].PORT = String(port);
						cappedEnv[vendor]['QUERY_AUDIT_HEADER_MAX_SIZE'] = '240';

						cappedInstance = spawn('node', [paths.cli, 'start'], {
							cwd: paths.cwd,
							env: cappedEnv[vendor],
						});

						await awaitDirectusConnection(port);

						const requestCapped = () => {
							return request(getUrl(vendor, cappedEnv))
								.get('/query-audit-probe/transaction-only')
								.set('Authorization', auth)
								.set(queryAuditHeader, 'full');
						};

						// The first request loads the schema; the second is warm.
						await requestCapped();
						response = await requestCapped();

						expect(response.statusCode).toBe(200);
					},
				);

				then('the header reads, durations aside:', (docString: string) => {
					expect(auditOf(response).map(({ ms }) => typeof ms))
						.toEqual(auditOf(response).map(() => 'number'));

					expect(JSON.stringify(auditOf(response).map((entry) => {
						return omit(entry, 'ms');
					}))).toBe(JSON.stringify(loadYaml(docString)));
				});
			},
			60_000,
		);

		// Dropping every statement still leaves each entry its tables.
		scenario(
			'past QUERY_AUDIT_HEADER_MAX_SIZE with no detail left, '
			+ 'the last entries are dropped and counted',
			({ when, then }) => {
				let response: Response;

				when('the many pool reads route is requested', async () => {
					response = await requestProbe('many-pool-reads');

					expect(response.statusCode).toBe(200);
				});

				then(
					'the header fits in 8kb and its last entry counts the entries dropped',
					() => {
						expect(response.headers[queryAuditHeader].length)
							.toBeLessThanOrEqual(8192);

						expect(auditOf(response).at(-1))
							.toEqual({ entriesDropped: expect.any(Number) });
					},
				);
			},
		);

		scenario('a bound BigInt reads as its digits', ({ when, then }) => {
			let response: Response;

			// Only postgres casts a bound value with `::`.
			when('the BigInt route is requested at the full level', async () => {
				if (vendor === 'postgres') {
					response = await requestProbe('bigint-binding')
						.set(queryAuditHeader, 'full');

					expect(response.statusCode).toBe(200);
				}
			});

			then(
				"on postgres the second entry's statements read:",
				(docString: string) => {
					if (vendor === 'postgres') {
						const { statements } = auditOf(response)[1]!;

						expect(statements.map(({ sql, count, bindings }) => {
							return { sql, count, bindings };
						})).toEqual(loadYaml(docString));
					}
				},
			);
		});

		scenario(
			'a browser can read the refusal of a level outside the list',
			({ when, then }) => {
				let response: Response;

				when(
					'a browser requests the transaction route at the every level',
					async () => {
						response = await requestProbeAtLevel('every')
							.set('Origin', 'http://example.com');
					},
				);

				then('the response is a 400 the browser may read', () => {
					expect(response.statusCode).toBe(400);

					expect(response.headers['access-control-allow-origin'])
						.toBe('http://example.com');
				});
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
