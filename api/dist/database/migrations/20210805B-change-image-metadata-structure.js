import { parseJSON } from "@directus/utils";

//#region src/database/migrations/20210805B-change-image-metadata-structure.ts
async function up(knex) {
	const files = await knex.select("id", "metadata").from("directus_files").whereNotNull("metadata");
	for (const { id, metadata } of files) {
		let prevMetadata;
		try {
			prevMetadata = parseJSON(metadata);
		} catch {
			continue;
		}
		if (prevMetadata.exif) {
			const newMetadata = prevMetadata.exif;
			if (newMetadata.image) {
				newMetadata.ifd0 = newMetadata.image;
				delete newMetadata.image;
			}
			if (newMetadata.thumbnail) {
				newMetadata.ifd1 = newMetadata.thumbnail;
				delete newMetadata.thumbnail;
			}
			if (newMetadata.interoperability) {
				newMetadata.interop = newMetadata.interoperability;
				delete newMetadata.interoperability;
			}
			if (prevMetadata.icc) newMetadata.icc = prevMetadata.icc;
			if (prevMetadata.iptc) newMetadata.iptc = prevMetadata.iptc;
			await knex("directus_files").update({ metadata: JSON.stringify(newMetadata) }).where({ id });
		}
	}
}
async function down(knex) {
	const files = await knex.select("id", "metadata").from("directus_files").whereNotNull("metadata").whereNot("metadata", "{}");
	for (const { id, metadata } of files) {
		const prevMetadata = parseJSON(metadata);
		if (Object.keys(prevMetadata).filter((key) => key !== "icc" && key !== "iptc").length > 0) {
			const newMetadata = { exif: prevMetadata };
			if (newMetadata.exif["ifd0"]) {
				newMetadata.exif["image"] = newMetadata.exif["ifd0"];
				delete newMetadata.exif["ifd0"];
			}
			if (newMetadata.exif["ifd1"]) {
				newMetadata.exif["thumbnail"] = newMetadata.exif["ifd1"];
				delete newMetadata.exif["ifd1"];
			}
			if (newMetadata.exif["interop"]) {
				newMetadata.exif["interoperability"] = newMetadata.exif["interop"];
				delete newMetadata.exif["interop"];
			}
			if (newMetadata.exif["icc"]) {
				newMetadata.icc = newMetadata.exif["icc"];
				delete newMetadata.exif["icc"];
			}
			if (newMetadata.exif["iptc"]) {
				newMetadata.iptc = newMetadata.exif["iptc"];
				delete newMetadata.exif["iptc"];
			}
			await knex("directus_files").update({ metadata: JSON.stringify(newMetadata) }).where({ id });
		}
	}
}

//#endregion
export { down, up };