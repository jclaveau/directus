import { isNestedMetaUpdate } from "../../../utils/apply-diff.js";
import { DiffKind } from "@directus/types";
import chalk from "chalk";

//#region src/cli/commands/schema/report-diff.ts
function filterSnapshotDiff(snapshot, filters) {
	const filterSet = new Set(filters);
	function shouldKeep(item) {
		if (filterSet.has(item.collection)) return false;
		if (item.field && filterSet.has(`${item.collection}.${item.field}`)) return false;
		return true;
	}
	return {
		collections: snapshot.collections.filter((item) => shouldKeep(item)),
		fields: snapshot.fields.filter((item) => shouldKeep(item)),
		relations: snapshot.relations.filter((item) => shouldKeep(item))
	};
}
function isEmptySnapshotDiff(snapshotDiff) {
	return snapshotDiff.collections.length === 0 && snapshotDiff.fields.length === 0 && snapshotDiff.relations.length === 0;
}
/**
* The listing `schema apply` shows before it asks, one section per kind of item.
*/
function formatSnapshotDiff(snapshotDiff) {
	const sections = [];
	if (snapshotDiff.collections.length > 0) {
		const lines = [chalk.underline.bold("Collections:")];
		for (const { collection, diff } of snapshotDiff.collections) lines.push(...formatItem(collection, diff, { onlyEdits: true }));
		sections.push(lines.join("\n"));
	}
	if (snapshotDiff.fields.length > 0) {
		const lines = [chalk.underline.bold("Fields:")];
		for (const { collection, field, diff } of snapshotDiff.fields) lines.push(...formatItem(`${collection}.${field}`, diff, { onlyEdits: false }));
		sections.push(lines.join("\n"));
	}
	if (snapshotDiff.relations.length > 0) {
		const lines = [chalk.underline.bold("Relations:")];
		for (const relation of snapshotDiff.relations) {
			const { collection, field, related_collection, diff } = relation;
			const target = related_collection ? ` → ${related_collection}` : "";
			lines.push(...formatItem(`${collection}.${field}${target}`, diff, { onlyEdits: true }));
		}
		sections.push(lines.join("\n"));
	}
	return sections.join("\n\n");
}
function formatItem(name, diff, { onlyEdits }) {
	const first = diff[0];
	if (first === void 0) return [];
	if (first.kind === DiffKind.EDIT || !onlyEdits && isNestedMetaUpdate(first)) {
		const lines = [`  - ${chalk.magenta("Update")} ${name}`];
		for (const change of diff) {
			const path = change.path.length === 1 ? change.path.toString() : change.path.slice(1).join(".");
			if (change.kind === DiffKind.EDIT) lines.push(`    - Set ${path} to ${change.rhs}`);
			else if (!onlyEdits && change.kind === DiffKind.DELETE) lines.push(`    - Remove ${path}`);
			else if (!onlyEdits && change.kind === DiffKind.NEW) lines.push(`    - Add ${path} and set it to ${change.rhs}`);
		}
		return lines;
	}
	if (first.kind === DiffKind.DELETE) return [`  - ${chalk.red("Delete")} ${name}`];
	if (first.kind === DiffKind.NEW) return [`  - ${chalk.green("Create")} ${name}`];
	if (first.kind === DiffKind.ARRAY) return [`  - ${chalk.magenta("Update")} ${name}`];
	return [];
}

//#endregion
export { filterSnapshotDiff, formatSnapshotDiff, isEmptySnapshotDiff };