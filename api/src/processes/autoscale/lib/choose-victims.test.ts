import { expect, test } from 'vitest';
import { chooseVictims } from './choose-victims.js';

test('stops a worker with nothing in flight over the one pm2 would pick', () => {
	const pool = [
		{ pmId: 0, inFlight: 3 },
		{ pmId: 1, inFlight: 0 },
	];

	expect(chooseVictims(pool, 1)).toEqual([1]);
});

// pm2 walks the app's processes from the first one, so a pool that reports
// nothing has to come out in `pm_id` order or a deployment without the signal
// is being released on a rule nothing has exercised.
test('falls back to pm2 own order when no worker has reported', () => {
	const pool = [
		{ pmId: 2, inFlight: null },
		{ pmId: 0, inFlight: null },
		{ pmId: 1, inFlight: null },
	];

	expect(chooseVictims(pool, 2)).toEqual([0, 1]);
});

// Silence is not idleness: a worker too busy to run its report, or one on a
// build that does not send one, says exactly what an empty queue says.
test('prefers a worker reporting nothing in flight to a silent one', () => {
	const pool = [
		{ pmId: 0, inFlight: null },
		{ pmId: 1, inFlight: 0 },
	];

	expect(chooseVictims(pool, 1)).toEqual([1]);
});

test('takes the quietest worker where none of them is idle', () => {
	const pool = [
		{ pmId: 0, inFlight: 9 },
		{ pmId: 1, inFlight: 2 },
		{ pmId: 2, inFlight: 5 },
	];

	expect(chooseVictims(pool, 1)).toEqual([1]);
});

// A worker serving requests ranks behind one that has told us nothing, because
// the silent worker might be idle and this one is provably not.
test('leaves a serving worker behind a silent one', () => {
	const pool = [
		{ pmId: 0, inFlight: 1 },
		{ pmId: 1, inFlight: null },
	];

	expect(chooseVictims(pool, 1)).toEqual([1]);
});

test('orders a release of several worst first', () => {
	const pool = [
		{ pmId: 0, inFlight: 4 },
		{ pmId: 1, inFlight: null },
		{ pmId: 2, inFlight: 0 },
		{ pmId: 3, inFlight: 0 },
	];

	expect(chooseVictims(pool, 3)).toEqual([2, 3, 1]);
});

test('asks for no more workers than the pool holds', () => {
	expect(chooseVictims([{ pmId: 0, inFlight: 0 }], 4)).toEqual([0]);
});
