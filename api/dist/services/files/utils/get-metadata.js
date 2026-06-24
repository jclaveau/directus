import { useLogger } from "../../../logger/index.js";
import { getSharpInstance } from "../lib/get-sharp-instance.js";
import { parseIptc, parseXmp } from "./parse-image-metadata.js";
import { useEnv } from "@directus/env";
import { pick } from "lodash-es";
import { pipeline } from "node:stream/promises";
import exif from "exif-reader";
import { parse } from "icc";

//#region src/services/files/utils/get-metadata.ts
const env = useEnv();
const logger = useLogger();
async function getMetadata(stream, allowList = env["FILE_METADATA_ALLOW_LIST"]) {
	const transformer = getSharpInstance();
	return new Promise((resolve) => {
		pipeline(stream, transformer.metadata(async (err, sharpMetadata) => {
			if (err) {
				logger.error(err);
				return resolve({});
			}
			const metadata = {};
			if (sharpMetadata.orientation && sharpMetadata.orientation >= 5) {
				metadata.height = sharpMetadata.width ?? null;
				metadata.width = sharpMetadata.height ?? null;
			} else {
				metadata.width = sharpMetadata.width ?? null;
				metadata.height = sharpMetadata.height ?? null;
			}
			const fullMetadata = {};
			if (sharpMetadata.exif) try {
				const { Image, ThumbnailTags, Iop, GPSInfo, Photo } = exif(sharpMetadata.exif);
				if (Image) fullMetadata.ifd0 = Image;
				if (ThumbnailTags) fullMetadata.ifd1 = ThumbnailTags;
				if (Iop) fullMetadata.interop = Iop;
				if (GPSInfo) fullMetadata.gps = GPSInfo;
				if (Photo) fullMetadata.exif = Photo;
			} catch (err$1) {
				logger.warn(`Couldn't extract Exif metadata from file`);
				logger.warn(err$1);
			}
			if (sharpMetadata.icc) try {
				fullMetadata.icc = parse(sharpMetadata.icc);
			} catch (err$1) {
				logger.warn(`Couldn't extract ICC profile data from file`);
				logger.warn(err$1);
			}
			if (sharpMetadata.iptc) try {
				fullMetadata.iptc = parseIptc(sharpMetadata.iptc);
			} catch (err$1) {
				logger.warn(`Couldn't extract IPTC Photo Metadata from file`);
				logger.warn(err$1);
			}
			if (sharpMetadata.xmp) try {
				fullMetadata.xmp = parseXmp(sharpMetadata.xmp);
			} catch (err$1) {
				logger.warn(`Couldn't extract XMP data from file`);
				logger.warn(err$1);
			}
			if (fullMetadata?.iptc?.["caption"] && typeof fullMetadata.iptc["caption"] === "string") metadata.description = fullMetadata.iptc["caption"];
			if (fullMetadata?.iptc?.["headline"] && typeof fullMetadata.iptc["headline"] === "string") metadata.title = fullMetadata.iptc["headline"];
			if (fullMetadata?.iptc?.["keywords"]) metadata.tags = fullMetadata.iptc["keywords"];
			if (allowList === "*" || allowList?.[0] === "*") metadata.metadata = fullMetadata;
			else metadata.metadata = pick(fullMetadata, allowList);
			for (const section of Object.keys(metadata.metadata)) for (const [key, value] of Object.entries(metadata.metadata[section])) if (typeof value === "string") metadata.metadata[section][key] = value.trim();
			resolve(metadata);
		}));
	});
}

//#endregion
export { getMetadata };