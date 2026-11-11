import type { Request, Response } from 'express';
import { expect, test } from 'vitest';
import {
	recordScopedCachePurged,
	scopedCachePurgedStore,
} from '../scoped-cache/purged-record.js';
import recordRequestScopedCachePurges from './scoped-cache-purged.js';

test('opens an empty purged list the rest of the request records into', () => {
	let purgedRecord: unknown;

	recordRequestScopedCachePurges({} as Request, {} as Response, () => {
		recordScopedCachePurged([{ collection: 'rounds' }]);
		purgedRecord = scopedCachePurgedStore.getStore();
	});

	expect(purgedRecord).toEqual({ purged: [{ collection: 'rounds' }] });
});
