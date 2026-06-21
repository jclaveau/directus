import { describe, expect, test } from 'vitest';
import { validateCron } from './schedule.js';

// Pins the accept/reject contract of validateCron so the cron-parser bump can't
// silently change which expressions directus treats as valid. Values reflect
// cron-parser 5.x behaviour.
//
// Known before/after delta: cron-parser 4.9.0 REJECTED `0 0 * * JAN` (a month
// name in the day-of-week field) whereas 5.x ACCEPTS it. That single case is
// asserted explicitly below so the change is visible and tracked.
describe('validateCron', () => {
	test.each([
		// standard 5-field
		['0 0 * * *', true],
		['*/2 * * * *', true],
		['0 9-17 * * 1-5', true],
		// 6-field (with seconds) — used by the schedule-hook flow
		['*/2 * * * * *', true],
		// macros + names
		['@yearly', true],
		['@hourly', true],
		['0 0 * * MON', true],
		['5 4 * * sun', true],
		// invalid
		['60 * * * *', false], // minute out of range
		['* * * * * * *', false], // too many fields
		['0 0 31 2 *', false], // 31 February
		['not a cron', false],
	])('%s -> %s', (expression, expected) => {
		expect(validateCron(expression)).toBe(expected);
	});

	// Documented behaviour change vs cron-parser 4.9.0 (was false).
	test('accepts month-name in the day-of-week field (5.x leniency)', () => {
		expect(validateCron('0 0 * * JAN')).toBe(true);
	});
});
