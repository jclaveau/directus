import { expect, test } from 'vitest';
import { listPolicySources } from './list-policy-sources';

test('lists direct, member role and ancestor policies in that order', () => {
	expect(
		listPolicySources(
			'u1',
			['editors', 'reviewers'],
			[
				{ id: 'staff', name: 'Staff', parent: null },
				{ id: 'editors', name: 'Editors', parent: 'staff' },
				{ id: 'reviewers', name: 'Reviewers', parent: null },
			],
			[
				{ user: null, role: 'staff', policy: { id: 'p3', name: 'Staff app' } },
				{ user: 'u1', role: null, policy: { id: 'p1', name: 'Own drafts' } },
				{ user: null, role: 'reviewers', policy: { id: 'p4', name: 'Review' } },
				{ user: null, role: 'editors', policy: { id: 'p2', name: 'Edit' } },
				{ user: 'u2', role: null, policy: { id: 'p5', name: 'Other user' } },
			],
		),
	).toEqual([
		{ policy: { id: 'p1', name: 'Own drafts' }, source: 'direct' },
		{
			policy: { id: 'p2', name: 'Edit' },
			source: 'role',
			role: { id: 'editors', name: 'Editors', parent: 'staff' },
		},
		{
			policy: { id: 'p3', name: 'Staff app' },
			source: 'ancestor',
			role: { id: 'staff', name: 'Staff', parent: null },
			memberRole: { id: 'editors', name: 'Editors', parent: 'staff' },
		},
		{
			policy: { id: 'p4', name: 'Review' },
			source: 'role',
			role: { id: 'reviewers', name: 'Reviewers', parent: null },
		},
	]);
});

test('lists a policy reached through two member roles twice', () => {
	expect(
		listPolicySources(
			'u1',
			['editors', 'reviewers'],
			[
				{ id: 'staff', name: 'Staff', parent: null },
				{ id: 'editors', name: 'Editors', parent: 'staff' },
				{ id: 'reviewers', name: 'Reviewers', parent: 'staff' },
			],
			[{ user: null, role: 'staff', policy: { id: 'p3', name: 'Staff app' } }],
		),
	).toEqual([
		{
			policy: { id: 'p3', name: 'Staff app' },
			source: 'ancestor',
			role: { id: 'staff', name: 'Staff', parent: null },
			memberRole: { id: 'editors', name: 'Editors', parent: 'staff' },
		},
		{
			policy: { id: 'p3', name: 'Staff app' },
			source: 'ancestor',
			role: { id: 'staff', name: 'Staff', parent: null },
			memberRole: { id: 'reviewers', name: 'Reviewers', parent: 'staff' },
		},
	]);
});

test('stops at a role already visited in a parent cycle', () => {
	expect(
		listPolicySources(
			'u1',
			['a'],
			[
				{ id: 'a', name: 'A', parent: 'b' },
				{ id: 'b', name: 'B', parent: 'a' },
			],
			[{ user: null, role: 'b', policy: { id: 'p1', name: 'B policy' } }],
		),
	).toEqual([
		{
			policy: { id: 'p1', name: 'B policy' },
			source: 'ancestor',
			role: { id: 'b', name: 'B', parent: 'a' },
			memberRole: { id: 'a', name: 'A', parent: 'b' },
		},
	]);
});

test('refuses a member role missing from the roles read', () => {
	expect(() => listPolicySources('u1', ['ghost'], [], [])).toThrow(
		new Error('Role "ghost" is not among the roles read'),
	);
});
