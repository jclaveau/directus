import type { Request, Response } from 'express';
import { expect, test } from 'vitest';
import { recordScopedCachePurged } from '../scoped-cache/purged-record.js';
import { requestStore } from '../utils/request-store.js';
import openRequestStore from './request-store.js';

test('opens an empty purged list the rest of the request records into', () => {
	let requestState: unknown;

	openRequestStore({} as Request, {} as Response, () => {
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
