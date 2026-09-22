import { oneLine } from '@directus/utils';
import { describe, expect, it, vi } from 'vitest';
import { shareFirstDial } from './share-first-dial.js';

// Stands in for the adapter over node-redis: the dial marks the client open
// before it settles, as `socket.connect()` does, and settles when the test says.
function dialingStore() {
	let settle!: () => void;
	let fail!: (error: Error) => void;

	const client = { isOpen: false };

	const dial = vi.fn(() => {
		client.isOpen = true;

		return new Promise<unknown>((resolve, reject) => {
			settle = () => resolve(client);
			fail = reject;
		});
	});

	const store = { client, getClient: dial };
	shareFirstDial(store);

	return { store, dial, settle: () => settle(), fail: (error: Error) => fail(error) };
}

async function settled(promise: Promise<unknown>) {
	let state = 'pending';

	promise.then(() => (state = 'resolved'), () => (state = 'rejected'));
	await new Promise((resolve) => setImmediate(resolve));

	return state;
}

describe('shareFirstDial', () => {
	it(oneLine`
		holds a command sent while the store is dialing until the dial answers,
		rather than handing it a client that is open and not yet ready
	`, async () => {
		const { store, dial, settle } = dialingStore();

		const first = store.getClient();
		const second = store.getClient();

		expect(dial).toHaveBeenCalledTimes(1);
		expect(await settled(second)).toBe('pending');

		settle();

		expect(await first).toBe(store.client);
		expect(await second).toBe(store.client);
	});

	it('hands the client over at once when it is open and no dial is pending', async () => {
		const { store, dial, settle } = dialingStore();

		const first = store.getClient();
		settle();
		await first;

		expect(await store.getClient()).toBe(store.client);
		expect(dial).toHaveBeenCalledTimes(1);
	});

	it(oneLine`
		dials again after a dial that rejected, rather than holding every later
		command on the one that failed
	`, async () => {
		const { store, dial, fail, settle } = dialingStore();

		const first = store.getClient();
		fail(new Error('ECONNREFUSED'));

		await expect(first).rejects.toThrow('ECONNREFUSED');

		store.client.isOpen = false;

		const second = store.getClient();
		settle();

		expect(await second).toBe(store.client);
		expect(dial).toHaveBeenCalledTimes(2);
	});
});
