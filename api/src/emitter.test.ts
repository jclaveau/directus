import type { EventContext } from '@directus/types';
import { afterEach, describe, expect, it } from 'vitest';
import emitter from './emitter.js';

const context = {} as EventContext;

describe('emitFilter', () => {
	afterEach(() => {
		emitter.offAll();
	});

	it('chains: each filter receives the previous filter output', async () => {
		emitter.onFilter<number>('test.event', (payload) => payload + 1);
		emitter.onFilter<number>('test.event', (payload) => payload * 10);

		// second filter sees 2 (not the original 1), so 2 * 10 = 20
		expect(await emitter.emitFilter('test.event', 1, {}, context)).toBe(20);
	});

	it('swallows undefined: payload is unchanged when a filter returns undefined', async () => {
		emitter.onFilter('test.event', () => undefined);

		expect(await emitter.emitFilter('test.event', { a: 1 }, {}, context)).toEqual({ a: 1 });
	});

	it('exposes the untouched input as meta.originalPayload after chaining', async () => {
		emitter.onFilter('test.event', (payload: any) => ({ ...payload, step: 1 }));
		emitter.onFilter('test.event', (_payload, meta) => meta['originalPayload']);

		// the second filter recovers the original input despite the first having mutated the payload
		expect(await emitter.emitFilter('test.event', { a: 1 }, {}, context)).toEqual({ a: 1 });
	});

	it('takes over: a filter returning a primary key surfaces that key', async () => {
		emitter.onFilter<object, number>('test.event', () => 42);

		expect(await emitter.emitFilter<object, number>('test.event', { a: 1 }, {}, context)).toBe(42);
	});

	it('runs a filter registered to run last after one registered later', async () => {
		emitter.onFilter<number>('test.event', (payload) => payload * 10, {
			runsLast: true,
		});

		emitter.onFilter<number>('test.event', (payload) => payload + 1);

		expect(await emitter.emitFilter('test.event', 1, {}, context)).toBe(20);
	});

	it('runs a last filter after the filters of every event emitted', async () => {
		emitter.onFilter<number>('first.event', (payload) => payload * 10, {
			runsLast: true,
		});

		emitter.onFilter<number>('second.event', (payload) => payload + 1);

		expect(await emitter.emitFilter(
			['first.event', 'second.event'],
			1,
			{},
			context,
		)).toBe(20);
	});

	it('counts a filter registered to run last as a listener', () => {
		emitter.onFilter('test.event', () => undefined, { runsLast: true });

		expect(emitter.hasFilterListeners('test.event')).toBe(true);
	});

	it('stops running a last filter once it is removed', async () => {
		const lastFilter = (payload: number) => payload * 10;

		emitter.onFilter<number>('test.event', lastFilter, { runsLast: true });
		emitter.offFilter('test.event', lastFilter);

		expect(await emitter.emitFilter('test.event', 1, {}, context)).toBe(1);
	});

	it('returns the payload untouched when no filter is registered', async () => {
		expect(await emitter.emitFilter('test.event', { a: 1 }, {}, context)).toEqual({ a: 1 });
	});
});
