import { DiffKind, type SnapshotDiff } from '@directus/types';
import chalk from 'chalk';
import type { Diff } from 'deep-diff';
import { isNestedMetaUpdate } from '../../../utils/apply-diff.js';

export function filterSnapshotDiff(
	snapshot: SnapshotDiff,
	filters: string[],
): SnapshotDiff {
	const filterSet = new Set(filters);

	function shouldKeep(item: { collection: string; field?: string }): boolean {
		if (filterSet.has(item.collection)) {
			return false;
		}

		if (item.field && filterSet.has(`${item.collection}.${item.field}`)) {
			return false;
		}

		return true;
	}

	return {
		collections: snapshot.collections.filter((item) => shouldKeep(item)),
		fields: snapshot.fields.filter((item) => shouldKeep(item)),
		relations: snapshot.relations.filter((item) => shouldKeep(item)),
	};
}

export function isEmptySnapshotDiff(snapshotDiff: SnapshotDiff): boolean {
	return (
		snapshotDiff.collections.length === 0
		&& snapshotDiff.fields.length === 0
		&& snapshotDiff.relations.length === 0
	);
}

/**
 * The listing `schema apply` shows before it asks, one section per kind of item.
 */
export function formatSnapshotDiff(snapshotDiff: SnapshotDiff): string {
	const sections = [];

	if (snapshotDiff.collections.length > 0) {
		const lines = [chalk.underline.bold('Collections:')];

		for (const { collection, diff } of snapshotDiff.collections) {
			lines.push(...formatItem(collection, diff, { onlyEdits: true }));
		}

		sections.push(lines.join('\n'));
	}

	if (snapshotDiff.fields.length > 0) {
		const lines = [chalk.underline.bold('Fields:')];

		for (const { collection, field, diff } of snapshotDiff.fields) {
			lines.push(...formatItem(`${collection}.${field}`, diff, {
				onlyEdits: false,
			}));
		}

		sections.push(lines.join('\n'));
	}

	if (snapshotDiff.relations.length > 0) {
		const lines = [chalk.underline.bold('Relations:')];

		for (const relation of snapshotDiff.relations) {
			const { collection, field, related_collection, diff } = relation;

			// Related collection doesn't exist for a2o relationship types
			const target = related_collection
				? ` → ${related_collection}`
				: '';

			lines.push(...formatItem(`${collection}.${field}${target}`, diff, {
				onlyEdits: true,
			}));
		}

		sections.push(lines.join('\n'));
	}

	return sections.join('\n\n');
}

// A field's meta can also arrive as nested additions and removals, which the
// collection and relation listings leave out
function formatItem(
	name: string,
	diff: Diff<any>[],
	{ onlyEdits }: { onlyEdits: boolean },
): string[] {
	const first = diff[0];

	if (first === undefined) {
		return [];
	}

	if (
		first.kind === DiffKind.EDIT
		|| (!onlyEdits && isNestedMetaUpdate(first as Diff<any>))
	) {
		const lines = [`  - ${chalk.magenta('Update')} ${name}`];

		for (const change of diff) {
			const path = change.path!.length === 1
				? change.path!.toString()
				: change.path!.slice(1).join('.');

			if (change.kind === DiffKind.EDIT) {
				lines.push(`    - Set ${path} to ${change.rhs}`);
			}
			else if (!onlyEdits && change.kind === DiffKind.DELETE) {
				lines.push(`    - Remove ${path}`);
			}
			else if (!onlyEdits && change.kind === DiffKind.NEW) {
				lines.push(`    - Add ${path} and set it to ${change.rhs}`);
			}
		}

		return lines;
	}

	if (first.kind === DiffKind.DELETE) {
		return [`  - ${chalk.red('Delete')} ${name}`];
	}

	if (first.kind === DiffKind.NEW) {
		return [`  - ${chalk.green('Create')} ${name}`];
	}

	if (first.kind === DiffKind.ARRAY) {
		return [`  - ${chalk.magenta('Update')} ${name}`];
	}

	return [];
}
