import { oneLine } from '@directus/utils';
import fc from 'fast-check';
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
			'[redis] connection: Error: NOAUTH Authentication required.',
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

	it(oneLine`
		reports every outage in a run of them, not the first — the throttle is per
		outage, and a record that fills and never empties passes each one-outage case
		and then goes quiet for good
	`, () => {
		for (let outage = 0; outage < 3; outage++) {
			emit('error', new Error('ECONNREFUSED'));
			emit('error', new Error('ECONNREFUSED'));
			emit('ready');
		}

		expect(warn).toHaveBeenCalledTimes(3);
	});

	it(oneLine`
		says which side raised a line, since a dropped socket and a command the store
		could not send over it are answered in different places
	`, () => {
		const connection: Record<string, ((arg?: any) => void)[]> = {};
		const store: Record<string, ((arg?: any) => void)[]> = {};

		const collect = (sink: Record<string, ((arg?: any) => void)[]>) => {
			return {
				on: (event: string, listener: (arg?: any) => void) => {
					(sink[event] ??= []).push(listener);
					return undefined;
				},
			} as any;
		};

		warnOncePerConnectionOutage(
			collect(connection),
			'response-cache',
			collect(store),
		);

		connection['error']![0]!(new Error('connect ECONNREFUSED'));
		store['error']![0]!(new Error('The client is offline'));

		expect(warn).toHaveBeenNthCalledWith(
			1,
			expect.any(Error),
			'[response-cache] connection: Error: connect ECONNREFUSED',
		);

		expect(warn).toHaveBeenNthCalledWith(
			2,
			expect.any(Error),
			'[response-cache] store: Error: The client is offline',
		);

		// Deliberately one throttle rather than two: the same text from both sides is
		// one failure seen twice, and counting it twice is how a log grows with traffic.
		connection['error']![0]!(new Error('Socket closed unexpectedly'));
		store['error']![0]!(new Error('Socket closed unexpectedly'));

		expect(warn).toHaveBeenCalledTimes(3);
	});

	it('reports the next outage from scratch once the client reconnects', () => {
		emit('error', new Error('ECONNREFUSED'));
		expect(warn).toHaveBeenCalledOnce();

		emit('ready');
		emit('error', new Error('ECONNREFUSED'));

		expect(warn).toHaveBeenCalledTimes(2);
	});
});

// The hand-written cases above each name one sequence somebody thought of. This one
// asks for sequences nobody thought of: fast-check generates runs of failures and
// reconnects, checks the same rule after every step, and on a violation shrinks to
// the shortest run that still breaks it. The alternating pair that defeated the
// original one-slot throttle is two commands long, so it falls out immediately.
describe('warnOncePerConnectionOutage over generated sequences', () => {
	// A small alphabet, deliberately: unique messages would never collide and the
	// throttle would never be asked to do anything. Two of these carry no message at
	// all and differ only by name, which is the pair a message-only key confuses.
	const FAILURES = [
		{ name: 'Error', message: 'connect ECONNREFUSED 127.0.0.1:6379' },
		{ name: 'Error', message: 'Socket closed unexpectedly' },
		{ name: 'Error', message: 'The client is offline' },
		{ name: 'AggregateError', message: '' },
		{ name: 'ClientClosedError', message: '' },
	];

	// What the log should hold: every distinct failure of the current outage, and a
	// reconnect is not itself news.
	interface OutageModel {
		reported: Set<string>;
	}

	type OutageClient = ReturnType<typeof listeningClient>;

	class Fail implements fc.Command<OutageModel, OutageClient> {
		constructor(private readonly failure: typeof FAILURES[number]) {}

		check(): boolean {
			return true;
		}

		run(model: OutageModel, client: OutageClient): void {
			const identity = `${this.failure.name}: ${this.failure.message}`;
			const before = warn.mock.calls.length;

			client.fail(Object.assign(new Error(this.failure.message), {
				name: this.failure.name,
			}));

			const lines = warn.mock.calls.length - before;

			const alreadyReported = model.reported.has(identity);

			expect(lines).toBe(
				alreadyReported
					? 0
					: 1,
			);

			model.reported.add(identity);
		}

		toString(): string {
			return `fail(${this.failure.name}: ${this.failure.message})`;
		}
	}

	class Reconnect implements fc.Command<OutageModel, OutageClient> {
		check(): boolean {
			return true;
		}

		run(model: OutageModel, client: OutageClient): void {
			const before = warn.mock.calls.length;

			client.recover();

			expect(warn.mock.calls.length).toBe(before);
			model.reported.clear();
		}

		toString(): string {
			return 'reconnect';
		}
	}

	function listeningClient() {
		const handlers: Record<string, ((arg?: any) => void)[]> = {};

		warnOncePerConnectionOutage({
			on: (event: string, listener: (arg?: any) => void) => {
				(handlers[event] ??= []).push(listener);
				return undefined;
			},
		} as any, 'redis');

		return {
			fail: (error: Error) => {
				handlers['error']?.forEach((listener) => listener(error));
			},
			recover: () => {
				handlers['ready']?.forEach((listener) => listener());
			},
		};
	}

	it(oneLine`
		reports each distinct failure once per outage, whatever order failures and
		reconnects arrive in
	`, () => {
		const commands = [
			fc.constantFrom(...FAILURES).map((failure) => new Fail(failure)),
			fc.constant(new Reconnect()),
		];

		fc.assert(
			fc.property(fc.commands(commands, { maxCommands: 50 }), (run) => {
				warn.mockClear();

				fc.modelRun(() => {
					return { model: { reported: new Set<string>() }, real: listeningClient() };
				}, run);
			}),
			{ numRuns: 200 },
		);
	});
});
