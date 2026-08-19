import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogger } from '../../logger/index.js';
import { warnOncePerConnectionOutage } from './warn-once-per-connection-outage.js';

vi.mock('../../logger/index.js');

const warn = vi.fn();

// Stands in for the client: keeps the listeners so a test can fire the events a
// reconnect loop really emits, in the order it emits them.
const listeners: Record<string, ((arg?: any) => void)[]> = {};

function emit(event: string, arg?: unknown) {
	for (const listener of listeners[event] ?? []) {
		listener(arg);
	}
}

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ warn } as any);

	for (const event of Object.keys(listeners)) {
		delete listeners[event];
	}

	warnOncePerConnectionOutage({
		on: (event: string, listener: (arg?: any) => void) => {
			(listeners[event] ??= []).push(listener);
			return undefined;
		},
	} as any, 'redis');
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('warnOncePerConnectionOutage', () => {
	it(oneLine`
		registers the error listener without which the client reports for itself
	`, () => {
		expect(listeners['error']).toHaveLength(1);

		expect(() => emit('error', new Error('ECONNREFUSED'))).not.toThrow();
		expect(warn).toHaveBeenCalledOnce();
	});

	it(oneLine`
		logs one line for a repeating failure, not one per reconnect — the default retry
		policy never gives up, so a day-long outage would write for a day
	`, () => {
		for (let attempt = 0; attempt < 20; attempt++) {
			emit('error', new Error('ECONNREFUSED'));
		}

		expect(warn).toHaveBeenCalledOnce();
	});

	it('still reports a different failure during the same outage', () => {
		emit('error', new Error('ECONNREFUSED'));
		emit('error', new Error('NOAUTH Authentication required.'));
		emit('error', new Error('NOAUTH Authentication required.'));

		expect(warn).toHaveBeenCalledTimes(2);

		expect(warn).toHaveBeenLastCalledWith(
			expect.any(Error),
			'[redis] Error: NOAUTH Authentication required.',
		);
	});

	it(oneLine`
		tells two message-less failures apart — a dual-stack connect fails as an
		AggregateError whose own message is empty, and so does more than one thing
	`, () => {
		emit('error', new AggregateError([], ''));
		emit('error', new AggregateError([], ''));
		emit('error', Object.assign(new Error(''), { name: 'ClientClosedError' }));

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it(oneLine`
		collapses two failures that alternate, not only two that repeat — a refused
		command and the reconnect it races report different things, turn and turn about
	`, () => {
		for (let attempt = 0; attempt < 10; attempt++) {
			emit('error', new Error('ECONNREFUSED'));
			emit('error', new Error('The client is offline'));
		}

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('reports the next outage from scratch once the client reconnects', () => {
		emit('error', new Error('ECONNREFUSED'));
		expect(warn).toHaveBeenCalledOnce();

		emit('ready');
		emit('error', new Error('ECONNREFUSED'));

		expect(warn).toHaveBeenCalledTimes(2);
	});
});
