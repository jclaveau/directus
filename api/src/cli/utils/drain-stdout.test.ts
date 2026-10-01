import { expect, test, vi } from 'vitest';
import { drainStdout } from './drain-stdout.js';

test('resolves once the stream reports the write through, not before', async () => {
	let flush: (() => void) | undefined;

	const stream = {
		write: vi.fn((_chunk: string, callback: () => void) => {
			flush = callback;
			return false;
		}),
	} as unknown as NodeJS.WriteStream;

	let drained = false;
	const waiting = drainStdout(stream).then(() => (drained = true));

	await Promise.resolve();

	expect(drained).toBe(false);

	flush!();
	await waiting;

	expect(drained).toBe(true);
});
