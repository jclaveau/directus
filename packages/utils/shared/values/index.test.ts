import { expect, test, vi } from 'vitest';
import * as values from './index.js';

// A mock factory runs when its module is first imported, so a factory that
// records itself and hands the original back witnesses what the entry reaches.
const reached = vi.hoisted(() => new Set<string>());

vi.mock('joi', async (importOriginal) => {
	reached.add('joi');
	return importOriginal();
});

vi.mock('../date-fns-used.js', async (importOriginal) => {
	reached.add('date-fns');
	return importOriginal();
});

vi.mock('micromustache', async (importOriginal) => {
	reached.add('micromustache');
	return importOriginal();
});

vi.mock('@directus/system-data', async (importOriginal) => {
	reached.add('@directus/system-data');
	return importOriginal();
});

test('reaches nothing of its own and is what the barrel exports', async () => {
	expect([...reached]).toEqual([]);

	const barrel: Record<string, unknown> = await import('../index.js');

	for (const [name, value] of Object.entries(values)) {
		expect(barrel[name], name).toBe(value);
	}

	expect([...reached].sort()).toEqual([
		'@directus/system-data',
		'date-fns',
		'joi',
		'micromustache',
	]);
});
