import { describe, expect, it } from 'vitest';
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
	it('renders whole hours and minutes on their own', () => {
		expect(formatDuration(3600)).toBe('1h');
		expect(formatDuration(300)).toBe('5m');
	});

	it('combines the non-zero parts, largest first', () => {
		expect(formatDuration(90)).toBe('1m 30s');
		expect(formatDuration(3661)).toBe('1h 1m 1s');
	});

	it('rounds and floors at zero', () => {
		expect(formatDuration(0)).toBe('0s');
		expect(formatDuration(-5)).toBe('0s');
		expect(formatDuration(59.6)).toBe('1m');
	});
});
