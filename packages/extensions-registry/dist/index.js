import ky from "ky";
import { OutOfDateError } from "@directus/errors";
import { z } from "zod";
import { EXTENSION_TYPES } from "@directus/extensions";

//#region src/constants.ts
const DEFAULT_REGISTRY = "https://registry.directus.io";
const SUPPORTED_VERSION = "2024-01-29";

//#endregion
//#region src/schemas/registry-version-response.ts
const RegistryVersionResponse = z.object({ version: z.string() });

//#endregion
//#region src/utils/get-api-version.ts
const _cache = /* @__PURE__ */ new Map();
const getApiVersion = async (options) => {
	const registry = options?.registry ?? DEFAULT_REGISTRY;
	if (_cache.has(registry)) return _cache.get(registry);
	const response = await ky.get(new URL("/version", registry)).json();
	const { version } = await RegistryVersionResponse.parseAsync(response);
	_cache.set(registry, version);
	setTimeout(() => _cache.delete(registry), 360 * 60 * 1e3);
	return _cache.get(registry);
};

//#endregion
//#region src/utils/assert-version-compatibility.ts
const assertVersionCompatibility = async (options) => {
	/**
	* The Registry API always targets the latest release of Directus. If the current installation is
	* out of date, the registry operations should fail with an instance out-of-date error.
	*/
	if (await getApiVersion(options) !== SUPPORTED_VERSION) throw new OutOfDateError();
};

//#endregion
//#region src/modules/account/lib/construct-url.ts
const constructUrl$3 = (id, options) => {
	const registry = options?.registry ?? DEFAULT_REGISTRY;
	return new URL(`/accounts/${id}`, registry);
};

//#endregion
//#region src/modules/account/schemas/registry-account-response.ts
const RegistryAccountResponse = z.object({ data: z.object({
	id: z.string(),
	username: z.string(),
	verified: z.boolean(),
	github_username: z.string().nullable(),
	github_avatar_url: z.string().nullable(),
	github_name: z.string().nullable(),
	github_company: z.string().nullable(),
	github_blog: z.string().nullable(),
	github_location: z.string().nullable(),
	github_bio: z.string().nullable()
}) });

//#endregion
//#region src/modules/account/account.ts
const account = async (id, options) => {
	await assertVersionCompatibility(options);
	const url = constructUrl$3(id, options);
	const response = await ky.get(url).json();
	return await RegistryAccountResponse.parseAsync(response);
};

//#endregion
//#region src/modules/describe/lib/construct-url.ts
const constructUrl$2 = (id, options) => {
	const registry = options?.registry ?? DEFAULT_REGISTRY;
	return new URL(`/extensions/${id}`, registry);
};

//#endregion
//#region src/modules/describe/schemas/registry-describe-response.ts
const RegistryDescribeResponse = z.object({ data: z.object({
	id: z.string(),
	name: z.string(),
	description: z.union([z.null(), z.string()]),
	total_downloads: z.number(),
	downloads: z.union([z.null(), z.array(z.object({
		date: z.string(),
		count: z.number()
	}))]),
	verified: z.boolean(),
	readme: z.union([z.null(), z.string()]),
	type: z.enum(EXTENSION_TYPES),
	license: z.string().nullable(),
	versions: z.array(z.object({
		id: z.string(),
		version: z.string(),
		verified: z.boolean(),
		type: z.enum(EXTENSION_TYPES),
		host_version: z.string(),
		publish_date: z.string(),
		unpacked_size: z.number(),
		file_count: z.number(),
		url_bugs: z.union([z.null(), z.string()]),
		url_homepage: z.union([z.null(), z.string()]),
		url_repository: z.union([z.null(), z.string()]),
		license: z.string().nullable(),
		publisher: z.object({
			id: z.string(),
			username: z.string(),
			verified: z.boolean(),
			github_name: z.string().nullable(),
			github_avatar_url: z.string().nullable()
		}),
		bundled: z.array(z.object({
			name: z.string(),
			type: z.string()
		})),
		maintainers: z.array(z.object({ accounts_id: z.object({
			id: z.string(),
			username: z.string(),
			verified: z.boolean(),
			github_name: z.string().nullable(),
			github_avatar_url: z.string().nullable()
		}) })).nullable()
	}))
}) });

//#endregion
//#region src/modules/describe/describe.ts
const describe = async (id, options) => {
	await assertVersionCompatibility(options);
	const url = constructUrl$2(id, options);
	const response = await ky.get(url).json();
	return await RegistryDescribeResponse.parseAsync(response);
};

//#endregion
//#region src/modules/download/lib/construct-url.ts
const constructUrl$1 = (versionId, requireSandbox = false, options) => {
	const registry = options?.registry ?? DEFAULT_REGISTRY;
	const url = new URL(`/download/${versionId}`, registry);
	if (requireSandbox) url.searchParams.set("sandbox", "true");
	return url;
};

//#endregion
//#region src/modules/download/download.ts
const download = async (versionId, requireSandbox = false, options) => {
	await assertVersionCompatibility(options);
	const url = constructUrl$1(versionId, requireSandbox, options);
	return (await ky.get(url)).body;
};

//#endregion
//#region src/modules/list/lib/construct-url.ts
const constructUrl = (query, options) => {
	const registry = options?.registry ?? DEFAULT_REGISTRY;
	const url = new URL("/extensions", registry);
	if (query.search) url.searchParams.set("search", query.search);
	if (query.type) url.searchParams.set("type", query.type);
	if (query.limit) url.searchParams.set("limit", String(query.limit));
	if (query.offset) url.searchParams.set("offset", String(query.offset));
	if (query.by) url.searchParams.set("by", query.by);
	if (query.sort) url.searchParams.set("sort", query.sort);
	if (query.sandbox) url.searchParams.set("sandbox", "true");
	return url;
};

//#endregion
//#region src/modules/list/schemas/registry-list-response.ts
const RegistryListResponse = z.object({
	meta: z.object({ filter_count: z.number() }),
	data: z.array(z.object({
		id: z.string(),
		name: z.string(),
		description: z.union([z.null(), z.string()]),
		total_downloads: z.number(),
		verified: z.boolean(),
		type: z.enum(EXTENSION_TYPES),
		last_updated: z.string(),
		host_version: z.string(),
		sandbox: z.boolean(),
		license: z.string().nullable(),
		publisher: z.object({
			username: z.string(),
			verified: z.boolean(),
			github_name: z.string().nullable()
		})
	}))
});

//#endregion
//#region src/modules/list/list.ts
const list = async (query, options) => {
	await assertVersionCompatibility(options);
	const url = constructUrl(query, options);
	const response = await ky.get(url).json();
	return await RegistryListResponse.parseAsync(response);
};

//#endregion
export { account, describe, download, list };