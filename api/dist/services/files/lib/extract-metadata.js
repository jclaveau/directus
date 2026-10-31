import { SUPPORTED_IMAGE_METADATA_FORMATS } from "../../../constants.js";
import { getStorage } from "../../../storage/index.js";
import { getMetadata } from "../utils/get-metadata.js";

//#region src/services/files/lib/extract-metadata.ts
async function extractMetadata(storageLocation, data) {
	const storage = await getStorage();
	const fileMeta = {};
	if (data.type && SUPPORTED_IMAGE_METADATA_FORMATS.includes(data.type)) {
		const { height, width, description, title, tags, metadata } = await getMetadata(await storage.location(storageLocation).read(data.filename_disk));
		if (!data.height && height) fileMeta.height = height;
		if (!data.width && width) fileMeta.width = width;
		if (!data.metadata && metadata) fileMeta.metadata = metadata;
		if (!data.description && description) fileMeta.description = description;
		if (!data.title && title) fileMeta.title = title;
		if (!data.tags && tags) fileMeta.tags = tags;
	}
	return fileMeta;
}

//#endregion
export { extractMetadata };