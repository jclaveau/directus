import { useEnv } from '@directus/env';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, test, vi } from 'vitest';
import {
	auditStatementStart,
	formatQueryAudit,
	queryAuditStore,
} from '../database/query-audit.js';
import {
	auditMessageQueries,
	reportQueryAuditInReplies,
} from './query-audit.js';
import type { WebSocketClient } from './types.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.restoreAllMocks();
});

test('adds the statements a message ran to its reply', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const send = vi.fn();

	const client = Object.assign(new EventEmitter(), {
		send,
		accountability: null,
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(client);

	await auditMessageQueries(client, { type: 'items', uid: 1 }, async () => {
		auditStatementStart(
			queryAuditStore.getStore()!,
			'select * from "articles"',
			'a',
		)();

		client.send('{"type":"items","data":[],"uid":1}');
	});

	expect(send.mock.calls).toEqual([
		[
			'{"type":"items","data":[],"uid":1,"query_audit":'
			+ '{"ms":0,"db":0,"wait":0,"maxPoolConnections":1,"statements":['
			+ '{"stmt":"select * from \\"articles\\"","ms":0,"wait":0}]}}',
		],
	]);
});

test('sends the reply as is while QUERY_AUDIT_HEADER is unset', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const send = vi.fn();

	const client = Object.assign(new EventEmitter(), {
		send,
		accountability: null,
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(client);

	await auditMessageQueries(client, { type: 'items', uid: 1 }, async () => {
		expect(queryAuditStore.getStore()).toBeUndefined();

		client.send('{"type":"items","data":[],"uid":1}');
	});

	expect(send.mock.calls).toEqual([
		['{"type":"items","data":[],"uid":1}'],
	]);

	expect(client.send).toBe(send);
});

test('reports statements to a non-admin asking bindings', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const send = vi.fn();

	const client = Object.assign(new EventEmitter(), {
		send,
		accountability: { admin: false },
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(client);

	const message = {
		type: 'items',
		uid: 'a',
		query_audit: 'bindings; no-timings',
	};

	await auditMessageQueries(client, message, async () => {
		auditStatementStart(
			queryAuditStore.getStore()!,
			'select * from "articles" where "id" = ?',
			'a',
			[7],
		)();

		client.send('{"type":"items","data":[],"uid":"a"}');
	});

	expect(send.mock.calls).toEqual([
		[
			'{"type":"items","data":[],"uid":"a","query_audit":'
			+ '{"maxPoolConnections":1,"statements":['
			+ '{"stmt":"select * from \\"articles\\" where \\"id\\" = ?"}]}}',
		],
	]);
});

test('records no bound value of a non-admin asking bindings', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const client = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		accountability: { admin: false },
	}) as unknown as WebSocketClient;

	const message = { type: 'items', uid: 'a', query_audit: 'bindings' };

	const formattedAudits: string[] = [];

	await auditMessageQueries(client, message, async () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'select ?', 'a', [7])();

		formattedAudits.push(formatQueryAudit(audit, {
			level: 'bindings',
			maxSize: 0,
			timings: false,
		}));
	});

	expect(formattedAudits).toEqual([
		'{"maxPoolConnections":1,"statements":['
		+ '{"stmt":"select ?","bindings":[]}]}',
	]);
});

test('reports the bound values to an admin asking bindings', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const send = vi.fn();

	const client = Object.assign(new EventEmitter(), {
		send,
		accountability: { admin: true },
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(client);

	const message = {
		type: 'items',
		uid: 'a',
		query_audit: 'bindings; no-timings',
	};

	await auditMessageQueries(client, message, async () => {
		auditStatementStart(
			queryAuditStore.getStore()!,
			'select * from "articles" where "id" = ?',
			'a',
			[7],
		)();

		client.send('{"type":"items","data":[],"uid":"a"}');
	});

	expect(send.mock.calls).toEqual([
		[
			'{"type":"items","data":[],"uid":"a","query_audit":'
			+ '{"maxPoolConnections":1,"statements":['
			+ '{"stmt":"select * from \\"articles\\" where \\"id\\" = ?",'
			+ '"bindings":[[7]]}]}}',
		],
	]);
});

test('adds the audit to its reply alone, never a push or a second', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const send = vi.fn();

	const client = Object.assign(new EventEmitter(), {
		send,
		accountability: null,
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(client);

	const message = { type: 'items', uid: 'a', query_audit: 'no-timings' };

	await auditMessageQueries(client, message, async () => {
		client.send('{"type":"subscription","event":"create","uid":"b"}');
		client.send('{"type":"items","data":[],"uid":"a"}');
		client.send('{"type":"items","data":[],"uid":"a"}');
	});

	expect(send.mock.calls).toEqual([
		['{"type":"subscription","event":"create","uid":"b"}'],
		[
			'{"type":"items","data":[],"uid":"a","query_audit":'
			+ '{"maxPoolConnections":0,"statements":[]}}',
		],
		['{"type":"items","data":[],"uid":"a"}'],
	]);
});

test('leaves a reply to another client as is', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const send = vi.fn();

	const client = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		accountability: null,
	}) as unknown as WebSocketClient;

	const otherClient = Object.assign(new EventEmitter(), {
		send,
		accountability: null,
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(otherClient);

	await auditMessageQueries(client, { type: 'items', uid: 'a' }, async () => {
		otherClient.send('{"type":"subscription","event":"create","uid":"a"}');
	});

	expect(send.mock.calls).toEqual([
		['{"type":"subscription","event":"create","uid":"a"}'],
	]);
});

test('does not audit a message without a uid', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const client = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		accountability: null,
	}) as unknown as WebSocketClient;

	await auditMessageQueries(client, { type: 'ping' }, async () => {
		expect(queryAuditStore.getStore()).toBeUndefined();
	});
});

test('refuses a message asking an unknown level', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const send = vi.fn();
	const handleMessage = vi.fn();

	const client = Object.assign(new EventEmitter(), {
		send,
		accountability: null,
	}) as unknown as WebSocketClient;

	const message = { type: 'items', uid: 'a', query_audit: 'everything' };

	await auditMessageQueries(client, message, handleMessage);

	expect(handleMessage).not.toHaveBeenCalled();

	expect(send.mock.calls).toEqual([
		[
			'{"type":"items","status":"error","error":{"code":"INVALID_QUERY",'
			+ '"message":"\\"query_audit\\" must be a level, a timings word, '
			+ 'or both as \\"<level>; <timings word>\\". Levels: counts, '
			+ 'statements, bindings, full. Timings words: timings, no-timings"},'
			+ '"uid":"a"}',
		],
	]);
});

test('refuses a message asking a number as its query audit', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const send = vi.fn();
	const handleMessage = vi.fn();

	await auditMessageQueries(
		Object.assign(new EventEmitter(), {
			send,
			accountability: null,
		}) as unknown as WebSocketClient,
		{ type: 'items', uid: 'a', query_audit: 1 },
		handleMessage,
	);

	expect(handleMessage).not.toHaveBeenCalled();

	expect(send.mock.calls).toEqual([
		[
			'{"type":"items","status":"error","error":{"code":"INVALID_QUERY",'
			+ '"message":"\\"query_audit\\" must be a level, a timings word, '
			+ 'or both as \\"<level>; <timings word>\\". Levels: counts, '
			+ 'statements, bindings, full. Timings words: timings, no-timings"},'
			+ '"uid":"a"}',
		],
	]);
});

test('refuses a message asking its query audit as an array', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const send = vi.fn();
	const handleMessage = vi.fn();

	await auditMessageQueries(
		Object.assign(new EventEmitter(), {
			send,
			accountability: null,
		}) as unknown as WebSocketClient,
		{ type: 'items', uid: 'a', query_audit: ['full'] },
		handleMessage,
	);

	expect(handleMessage).not.toHaveBeenCalled();

	expect(send.mock.calls).toEqual([
		[
			'{"type":"items","status":"error","error":{"code":"INVALID_QUERY",'
			+ '"message":"\\"query_audit\\" must be a level, a timings word, '
			+ 'or both as \\"<level>; <timings word>\\". Levels: counts, '
			+ 'statements, bindings, full. Timings words: timings, no-timings"},'
			+ '"uid":"a"}',
		],
	]);
});

test('closes an unreplied message audit on disconnect', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const client = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		accountability: null,
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(client);

	const audits: unknown[] = [];

	void auditMessageQueries(client, { type: 'items', uid: 'a' }, () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'select 1', 'a')();
		audits.push(audit);

		return new Promise<void>(() => undefined);
	});

	client.emit('close');

	expect(audits).toMatchObject([{ closed: true, transactionAudits: [] }]);
});

test('closes a message audit once its handler settles without a reply', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const client = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		accountability: null,
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(client);

	const audits: unknown[] = [];

	await auditMessageQueries(client, { type: 'items', uid: 'a' }, async () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'select 1', 'a')();
		audits.push(audit);
		client.send('{"type":"items","status":"error"}');
	});

	expect(audits).toMatchObject([{ closed: true, transactionAudits: [] }]);
});

test('closes a message audit once its handler throws', async () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const client = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		accountability: null,
	}) as unknown as WebSocketClient;

	reportQueryAuditInReplies(client);

	const audits: unknown[] = [];

	await expect(auditMessageQueries(
		client,
		{ type: 'items', uid: 'a' },
		async () => {
			const audit = queryAuditStore.getStore()!;

			auditStatementStart(audit, 'select 1', 'a')();
			audits.push(audit);

			throw new Error('handler failed');
		},
	)).rejects.toThrow('handler failed');

	expect(audits).toMatchObject([{ closed: true, transactionAudits: [] }]);
});
