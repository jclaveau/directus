import { useEnv } from '@directus/env';
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { recordScopedCachePurged } from '../scoped-cache/purged-record.js';
import { requestStore } from '../utils/request-store.js';
import auditRequestQueries from './query-audit.js';
import openRequestStore from './request-store.js';

vi.mock('@directus/env');

test('opens an empty purged list the rest of the request records into', () => {
	const res = new EventEmitter() as unknown as Response;
	let requestState: unknown;

	openRequestStore({} as Request, res, () => {
		recordScopedCachePurged([{ collection: 'rounds' }]);
		requestState = requestStore.getStore();
	});

	expect(requestState).toEqual({
		scopedCachePurged: {
			purged: [{ collection: 'rounds' }],
			queuedPurges: [],
		},
	});
});

test('empties the store of an audited request once its response closed', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader: vi.fn(),
	}) as unknown as Response;

	const req = { get: vi.fn() } as unknown as Request;
	let requestState: unknown;

	openRequestStore(req, res, () => {
		auditRequestQueries(req, res, () => {
			recordScopedCachePurged([{ collection: 'rounds' }]);
			requestState = requestStore.getStore();
		});
	});

	res.emit('close');

	expect(requestState).toStrictEqual({
		scopedCachePurged: undefined,
		queryAudit: undefined,
	});
});
