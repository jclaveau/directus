import { useLogger } from "../../../logger/index.js";
import { DiffKind } from "../../../packages/types/dist/index.js";
import database_default, { isInstalled, validateDatabaseConnection } from "../../../database/index.js";
import { isNestedMetaUpdate } from "../../../utils/apply-diff.js";
import { getSnapshotDiff } from "../../../utils/get-snapshot-diff.js";
import { getSnapshot } from "../../../utils/get-snapshot.js";
import { applySnapshot } from "../../../utils/apply-snapshot.js";
import path from "path";
import { parseJSON } from "@directus/utils";
import { load } from "js-yaml";
import { promises } from "fs";
import chalk from "chalk";
import inquirer from "inquirer";

//#region src/cli/commands/schema/apply.ts
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
		systemFields: snapshot.systemFields.filter((item) => shouldKeep(item)),
		relations: snapshot.relations.filter((item) => shouldKeep(item))
	};
}
async function apply(snapshotPath, options) {
	const logger = useLogger();
	const filename = path.resolve(process.cwd(), snapshotPath);
	const database = database_default();
	await validateDatabaseConnection(database);
	if (await isInstalled() === false) {
		logger.error(`Directus isn't installed on this database. Please run "directus bootstrap" first.`);
		database.destroy();
		process.exit(0);
	}
	let snapshot;
	try {
		const fileContents = await promises.readFile(filename, "utf8");
		if (filename.endsWith(".yaml") || filename.endsWith(".yml")) snapshot = await load(fileContents);
		else snapshot = parseJSON(fileContents);
		const currentSnapshot = await getSnapshot({ database });
		let snapshotDiff = getSnapshotDiff(currentSnapshot, snapshot);
		if (options?.ignoreRules) snapshotDiff = filterSnapshotDiff(snapshotDiff, options.ignoreRules.split(","));
		if (snapshotDiff.collections.length === 0 && snapshotDiff.fields.length === 0 && snapshotDiff.systemFields.length === 0 && snapshotDiff.relations.length === 0) {
			logger.info("No changes to apply.");
			database.destroy();
			process.exit(0);
		}
		const dryRun = options?.dryRun === true;
		const promptForChanges = !dryRun && options?.yes !== true;
		if (dryRun || promptForChanges) {
			const sections = [];
			if (snapshotDiff.collections.length > 0) {
				const lines = [chalk.underline.bold("Collections:")];
				for (const { collection, diff } of snapshotDiff.collections) if (diff[0]?.kind === DiffKind.EDIT) {
					lines.push(`  - ${chalk.magenta("Update")} ${collection}`);
					for (const change of diff) if (change.kind === DiffKind.EDIT) {
						const path$1 = formatPath(change.path);
						lines.push(`    - Set ${path$1} to ${change.rhs}`);
					}
				} else if (diff[0]?.kind === DiffKind.DELETE) lines.push(`  - ${chalk.red("Delete")} ${collection}`);
				else if (diff[0]?.kind === DiffKind.NEW) lines.push(`  - ${chalk.green("Create")} ${collection}`);
				else if (diff[0]?.kind === DiffKind.ARRAY) lines.push(`  - ${chalk.magenta("Update")} ${collection}`);
				sections.push(lines.join("\n"));
			}
			if (snapshotDiff.fields.length > 0) {
				const lines = [chalk.underline.bold("Fields:")];
				for (const { collection, field, diff } of snapshotDiff.fields) if (diff[0]?.kind === DiffKind.EDIT || isNestedMetaUpdate(diff[0])) {
					lines.push(`  - ${chalk.magenta("Update")} ${collection}.${field}`);
					for (const change of diff) {
						const path$1 = formatPath(change.path);
						if (change.kind === DiffKind.EDIT) lines.push(`    - Set ${path$1} to ${change.rhs}`);
						else if (change.kind === DiffKind.DELETE) lines.push(`    - Remove ${path$1}`);
						else if (change.kind === DiffKind.NEW) lines.push(`    - Add ${path$1} and set it to ${change.rhs}`);
					}
				} else if (diff[0]?.kind === DiffKind.DELETE) lines.push(`  - ${chalk.red("Delete")} ${collection}.${field}`);
				else if (diff[0]?.kind === DiffKind.NEW) lines.push(`  - ${chalk.green("Create")} ${collection}.${field}`);
				else if (diff[0]?.kind === DiffKind.ARRAY) lines.push(`  - ${chalk.magenta("Update")} ${collection}.${field}`);
				sections.push(lines.join("\n"));
			}
			if (snapshotDiff.systemFields.length > 0) {
				const lines = [chalk.underline.bold("System Fields:")];
				for (const { collection, field, diff } of snapshotDiff.systemFields) if (diff[0]?.kind === DiffKind.EDIT) {
					lines.push(`  - ${chalk.magenta("Update")} ${collection}.${field}`);
					for (const change of diff) {
						const path$1 = formatPath(change.path);
						if (change.kind === DiffKind.EDIT) lines.push(`    - Set ${path$1} to ${change.rhs}`);
						else if (change.kind === DiffKind.DELETE) lines.push(`    - Remove ${path$1}`);
						else if (change.kind === DiffKind.NEW) lines.push(`    - Add ${path$1} and set it to ${change.rhs}`);
					}
				}
				sections.push(lines.join("\n"));
			}
			if (snapshotDiff.relations.length > 0) {
				const lines = [chalk.underline.bold("Relations:")];
				for (const { collection, field, related_collection, diff } of snapshotDiff.relations) {
					const relatedCollection = formatRelatedCollection(related_collection);
					if (diff[0]?.kind === DiffKind.EDIT) {
						lines.push(`  - ${chalk.magenta("Update")} ${collection}.${field}${relatedCollection}`);
						for (const change of diff) if (change.kind === DiffKind.EDIT) {
							const path$1 = formatPath(change.path);
							lines.push(`    - Set ${path$1} to ${change.rhs}`);
						}
					} else if (diff[0]?.kind === DiffKind.DELETE) lines.push(`  - ${chalk.red("Delete")} ${collection}.${field}${relatedCollection}`);
					else if (diff[0]?.kind === DiffKind.NEW) lines.push(`  - ${chalk.green("Create")} ${collection}.${field}${relatedCollection}`);
					else if (diff[0]?.kind === DiffKind.ARRAY) lines.push(`  - ${chalk.magenta("Update")} ${collection}.${field}${relatedCollection}`);
				}
				sections.push(lines.join("\n"));
			}
			const message = "The following changes will be applied:\n\n" + sections.join("\n\n");
			if (dryRun) {
				console.log(message);
				process.exit(0);
			}
			const { proceed } = await inquirer.prompt([{
				type: "confirm",
				name: "proceed",
				message: message + "\n\nWould you like to continue?"
			}]);
			if (proceed === false) process.exit(0);
		}
		await applySnapshot(snapshot, {
			current: currentSnapshot,
			diff: snapshotDiff,
			database
		});
		logger.info(`Snapshot applied successfully`);
		database.destroy();
		process.exit(0);
	} catch (err) {
		logger.error(err);
		database.destroy();
		process.exit(1);
	}
}
function formatPath(path$1) {
	if (path$1.length === 1) return path$1.toString();
	return path$1.slice(1).join(".");
}
function formatRelatedCollection(relatedCollection) {
	if (relatedCollection) return ` → ${relatedCollection}`;
	return "";
}

//#endregion
export { apply, filterSnapshotDiff, formatPath, formatRelatedCollection };