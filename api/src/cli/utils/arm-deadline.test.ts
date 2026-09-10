import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useLogger } from '../../logger/index.js';
import { armDeadline } from './arm-deadline.js';

vi.mock('../../logger/index.js');

const error = vi.fn();
const warn = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();

	vi.mocked(useLogger).mockReturnValue(
		{ error, warn } as unknown as ReturnType<typeof useLogger>,
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	error.mockReset();
	warn.mockReset();
});

test('ends the process once the budget is spent', () => {
	const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);

	armDeadline(5000, 'the cache flush');

	vi.advanceTimersByTime(5000);

	expect(error).toHaveBeenCalledWith(
		'[cli] the cache flush did not finish within 5000ms',
	);

	expect(exit).toHaveBeenCalledWith(1);
});

// The deadline outlives the command it guards — a flush that took 2s of a 30s
// budget leaves 28s on the clock — so a referenced timer would hold the process
// open for the rest of it.
test('does not keep the process alive on its own', () => {
	const unref = vi.fn();
	vi.spyOn(global, 'setTimeout').mockReturnValue({ unref } as never);

	armDeadline(5000, 'the cache flush');

	expect(unref).toHaveBeenCalled();
});

// The call site reads the budget straight off the env rather than repeating the
// default that lives in `packages/env`, so an absent value arrives here as
// undefined — and `setTimeout(undefined)` fires on the next tick.
test('arms nothing when the budget does not parse', () => {
	const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);

	armDeadline(undefined, 'the cache flush');
	vi.advanceTimersByTime(60_000);

	expect(exit).not.toHaveBeenCalled();
	expect(warn).toHaveBeenCalledWith(
		'[cli] the cache flush has no usable budget, so none is armed',
	);
});
