import { getSchema } from "../../utils/get-schema.js";
import { ExtensionsService } from "../../services/extensions.js";
import "knex";

//#region src/telemetry/utils/get-extension-count.ts
const getExtensionCount = async (db) => {
	const extensions = await new ExtensionsService({
		knex: db,
		schema: await getSchema({ database: db })
	}).readAll();
	let totalEnabled = 0;
	for (const extension of extensions) if (extension.meta.enabled && extension.schema && extension.schema.type !== "bundle") totalEnabled++;
	return { totalEnabled };
};

//#endregion
export { getExtensionCount };