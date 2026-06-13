import { describe, expect, it } from 'vitest';
// Import through the package barrel so the new `export * from './items.js'` line in
// index.ts is exercised too (otherwise it shows as an uncovered patch line).
import { ALTERATIONS_KEYS } from './index.js';

describe('ALTERATIONS_KEYS', () => {
	it('lists the create/update/delete alteration keys in order', () => {
		expect(ALTERATIONS_KEYS).toEqual(['create', 'update', 'delete']);
	});
});
