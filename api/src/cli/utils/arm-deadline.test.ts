import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useLogger } from '../../logger/index.js';
import { armDeadline } from './arm-deadline.js';

vi.mock('../../logger/index.js');

const error = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();

	vi.mocked(useLogger).mockReturnValue(
		{ error } as unknown as ReturnType<typeof useLogger>,
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	error.mockReset();
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
