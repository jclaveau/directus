import { describe, expect, it } from 'vitest';
import { isDynamicVariable } from './is-dynamic-variable.js';

const tests: [string, boolean][] = [
	['$NOW', true],
	['$NOW(- 1 year)', true],
	['test', false],
	['$CUSTOM', false],
	['$CURRENT_USER', true],
	['$CURRENT_ROLE', false],
	['$CURRENT_USER.role.name', true],
	['$CURRENT_ROLE.users.id', false],
	['$CURRENT_MEMBER_ROLES', true],
	['$CURRENT_MEMBER_ROLES.name', true],
	['$CURRENT_ROLES', true],
];

describe('is extension type', () => {
	for (const [value, result] of tests) {
		it(value, () => {
			expect(isDynamicVariable(value)).toBe(result);
		});
	}
});
