import path from "node:path";
import { parseJSON } from "@directus/utils";
import { load } from "js-yaml";
import { promises } from "node:fs";

//#region src/cli/commands/schema/load-snapshot.ts
/**
* Read a snapshot the way `schema apply` takes one, and also the layouts
* directus-extension-schema-sync writes: a whole snapshot carrying its `hash`, an
* older one nested under `snapshot`, or a header whose `partial` flag says the
* collections live one per file in the directory of the same name beside it
* (`data/schema.json` → `data/schema/<collection>.json`), stitched by the rule
* that extension applies them with.
*/
async function loadSnapshotFile(filename) {
	const file = await readSnapshotFile(filename);
	const { partial, hash: _hash,...parsed } = file.snapshot ?? file;
	if (partial !== true) return parsed;
	const snapshot = {
		version: parsed.version,
		directus: parsed.directus,
		collections: [],
		fields: [],
		relations: []
	};
	if (parsed.vendor) snapshot.vendor = parsed.vendor;
	const directory = path.join(path.dirname(filename), path.basename(filename, path.extname(filename)));
	const entries = (await promises.readdir(directory)).filter((entry) => entry.endsWith(".json")).sort();
	if (entries.length === 0) throw new Error(`No collection files found in ${directory}`);
	for (const entry of entries) {
		const { fields, relations,...collection } = await readSnapshotFile(path.join(directory, entry));
		if (collection.meta) snapshot.collections.push(collection);
		for (const field of fields) snapshot.fields.push(Object.assign({ collection: collection.collection }, field));
		for (const relation of relations) snapshot.relations.push(Object.assign({ collection: collection.collection }, relation));
	}
	return snapshot;
}
async function readSnapshotFile(filename) {
	const contents = await promises.readFile(filename, "utf8");
	if (filename.endsWith(".yaml") || filename.endsWith(".yml")) return load(contents);
	return parseJSON(contents);
}

//#endregion
export { loadSnapshotFile };