import { getMilliseconds } from "./utils/get-milliseconds.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";
import bytes from "bytes";

//#region src/constants.ts
const env = useEnv();
const SYSTEM_ASSET_ALLOW_LIST = [
	{
		key: "system-small-cover",
		format: "auto",
		transforms: [["resize", {
			width: 64,
			height: 64,
			fit: "cover"
		}]]
	},
	{
		key: "system-small-contain",
		format: "auto",
		transforms: [["resize", {
			width: 64,
			fit: "contain"
		}]]
	},
	{
		key: "system-medium-cover",
		format: "auto",
		transforms: [["resize", {
			width: 300,
			height: 300,
			fit: "cover"
		}]]
	},
	{
		key: "system-medium-contain",
		format: "auto",
		transforms: [["resize", {
			width: 300,
			fit: "contain"
		}]]
	},
	{
		key: "system-large-cover",
		format: "auto",
		transforms: [["resize", {
			width: 800,
			height: 800,
			fit: "cover"
		}]]
	},
	{
		key: "system-large-contain",
		format: "auto",
		transforms: [["resize", {
			width: 800,
			fit: "contain"
		}]]
	}
];
const ASSET_TRANSFORM_QUERY_KEYS = [
	"key",
	"transforms",
	"width",
	"height",
	"format",
	"fit",
	"quality",
	"withoutEnlargement",
	"focal_point_x",
	"focal_point_y"
];
const FILTER_VARIABLES = [
	"$NOW",
	"$CURRENT_USER",
	"$CURRENT_ROLE"
];
const ALIAS_TYPES = [
	"alias",
	"o2m",
	"m2m",
	"m2a",
	"o2a",
	"files",
	"translations"
];
const DEFAULT_AUTH_PROVIDER = "default";
const COLUMN_TRANSFORMS = [
	"year",
	"month",
	"day",
	"weekday",
	"hour",
	"minute",
	"second"
];
const GENERATE_SPECIAL = [
	"uuid",
	"date-created",
	"role-created",
	"user-created"
];
const UUID_REGEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REFRESH_COOKIE_OPTIONS = {
	httpOnly: true,
	domain: env["REFRESH_TOKEN_COOKIE_DOMAIN"],
	maxAge: getMilliseconds(env["REFRESH_TOKEN_TTL"]),
	secure: Boolean(env["REFRESH_TOKEN_COOKIE_SECURE"]),
	sameSite: env["REFRESH_TOKEN_COOKIE_SAME_SITE"] || "strict"
};
const SESSION_COOKIE_OPTIONS = {
	httpOnly: true,
	domain: env["SESSION_COOKIE_DOMAIN"],
	maxAge: getMilliseconds(env["SESSION_COOKIE_TTL"]),
	secure: Boolean(env["SESSION_COOKIE_SECURE"]),
	sameSite: env["SESSION_COOKIE_SAME_SITE"] || "strict"
};
const OAS_REQUIRED_SCHEMAS = ["Query", "x-metadata"];
/** Formats from which transformation is supported */
const SUPPORTED_IMAGE_TRANSFORM_FORMATS = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/tiff",
	"image/avif"
];
/** Formats where metadata extraction is supported */
const SUPPORTED_IMAGE_METADATA_FORMATS = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/tiff",
	"image/avif"
];
/** Resumable uploads */
const RESUMABLE_UPLOADS = {
	ENABLED: toBoolean(env["TUS_ENABLED"]),
	CHUNK_SIZE: bytes.parse(env["TUS_CHUNK_SIZE"]),
	MAX_SIZE: bytes.parse(env["FILES_MAX_UPLOAD_SIZE"]),
	EXPIRATION_TIME: getMilliseconds(env["TUS_UPLOAD_EXPIRATION"], 6e5),
	SCHEDULE: String(env["TUS_CLEANUP_SCHEDULE"])
};
const ALLOWED_DB_DEFAULT_FUNCTIONS = ["gen_random_uuid()"];

//#endregion
export { ALIAS_TYPES, ALLOWED_DB_DEFAULT_FUNCTIONS, ASSET_TRANSFORM_QUERY_KEYS, COLUMN_TRANSFORMS, DEFAULT_AUTH_PROVIDER, FILTER_VARIABLES, GENERATE_SPECIAL, OAS_REQUIRED_SCHEMAS, REFRESH_COOKIE_OPTIONS, RESUMABLE_UPLOADS, SESSION_COOKIE_OPTIONS, SUPPORTED_IMAGE_METADATA_FORMATS, SUPPORTED_IMAGE_TRANSFORM_FORMATS, SYSTEM_ASSET_ALLOW_LIST, UUID_REGEX };