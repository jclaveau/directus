import { expect, test } from 'vitest';
import { RAILWAY_CLAUSES_PER_RULE, railwayAllowListRuleset } from './railway.js';

test('allows each root exactly and below it, then blocks the rest', () => {
	expect(railwayAllowListRuleset(['/', '/admin', '/items'], 404)).toEqual({
		version: 1,
		rules: [
			{
				description: `Allow the API's routes (1/1)`,
				priority: 1,
				enabled: true,
				if: {
					or: [
						{ attr: 'http.path', op: 'eq', value: '/' },
						{ attr: 'http.path', op: 'eq', value: '/admin' },
						{ attr: 'http.path', op: 'matches', value: '/admin/*' },
						{ attr: 'http.path', op: 'eq', value: '/items' },
						{ attr: 'http.path', op: 'matches', value: '/items/*' },
					],
				},
				then: { action: 'allow' },
			},
			{
				description: 'Block every other path',
				priority: 2,
				enabled: true,
				if: { attr: 'http.path', op: 'matches', value: '*' },
				then: { action: 'block', params: { status: 404 } },
			},
		],
	});
});

test('deals the clauses into as many rules as the per-rule cap needs', () => {
	const roots = Array.from({ length: 33 }, (_, i) => `/r${i}`);
	const { rules } = railwayAllowListRuleset(roots, 410);

	expect(rules.map((rule) => rule.priority)).toEqual([1, 2, 3, 4]);

	expect(rules.map((rule) => rule.description)).toEqual([
		`Allow the API's routes (1/3)`,
		`Allow the API's routes (2/3)`,
		`Allow the API's routes (3/3)`,
		'Block every other path',
	]);

	const sizes = rules
		.slice(0, 3)
		.map((rule) => {
			return 'or' in rule.if
				? rule.if.or.length
				: 1;
		});

	expect(sizes).toEqual([RAILWAY_CLAUSES_PER_RULE, RAILWAY_CLAUSES_PER_RULE, 2]);
	expect(rules[3]!.then).toEqual({ action: 'block', params: { status: 410 } });
});

test('writes a lone clause without the or-group', () => {
	const { rules } = railwayAllowListRuleset(['/'], 404);

	expect(rules[0]!.if).toEqual({ attr: 'http.path', op: 'eq', value: '/' });
});
