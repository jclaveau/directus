import { API_EXTENSION_TYPES, APP_EXTENSION_TYPES, HYBRID_EXTENSION_TYPES } from "../constants/index.js";
import { z } from "zod";

//#region src/shared/schemas/options.ts
const SplitEntrypoint = z.object({
	app: z.string(),
	api: z.string()
});
const ExtensionSandboxRequestedScopes = z.object({
	request: z.optional(z.object({
		urls: z.array(z.string()),
		methods: z.array(z.union([
			z.literal("GET"),
			z.literal("POST"),
			z.literal("PATCH"),
			z.literal("PUT"),
			z.literal("DELETE")
		]))
	})),
	log: z.optional(z.object({})),
	sleep: z.optional(z.object({}))
});
const ExtensionSandboxOptions = z.optional(z.object({
	enabled: z.boolean(),
	requestedScopes: ExtensionSandboxRequestedScopes
}));
const ExtensionOptionsBundleEntry = z.union([
	z.object({
		type: z.enum(API_EXTENSION_TYPES),
		name: z.string(),
		source: z.string()
	}),
	z.object({
		type: z.enum(APP_EXTENSION_TYPES),
		name: z.string(),
		source: z.string()
	}),
	z.object({
		type: z.enum(HYBRID_EXTENSION_TYPES),
		name: z.string(),
		source: SplitEntrypoint
	})
]);
const ExtensionOptionsBase = z.object({
	host: z.string(),
	hidden: z.boolean().optional(),
	coverage: z.string().optional()
});
const ExtensionOptionsApp = z.object({
	type: z.enum(APP_EXTENSION_TYPES),
	path: z.string(),
	source: z.string()
});
const ExtensionOptionsApi = z.object({
	type: z.enum(API_EXTENSION_TYPES),
	path: z.string(),
	source: z.string(),
	sandbox: ExtensionSandboxOptions
});
const ExtensionOptionsHybrid = z.object({
	type: z.enum(HYBRID_EXTENSION_TYPES),
	path: SplitEntrypoint,
	source: SplitEntrypoint,
	sandbox: ExtensionSandboxOptions
});
const ExtensionOptionsBundle = z.object({
	type: z.literal("bundle"),
	partial: z.boolean().optional(),
	path: SplitEntrypoint,
	entries: z.array(ExtensionOptionsBundleEntry)
});
const ExtensionOptionsBundleEntries = z.array(ExtensionOptionsBundleEntry);
const ExtensionOptions = ExtensionOptionsBase.and(z.union([
	ExtensionOptionsApp,
	ExtensionOptionsApi,
	ExtensionOptionsHybrid,
	ExtensionOptionsBundle
])).superRefine((options, context) => {
	const appTypes = APP_EXTENSION_TYPES;
	if (options.coverage !== void 0 && appTypes.includes(options.type)) context.addIssue({
		code: "custom",
		path: ["coverage"],
		message: `coverage is only read for an api, hybrid or bundle extension, not for an extension of type "${options.type}".`
	});
});

//#endregion
export { ExtensionOptions, ExtensionOptionsApi, ExtensionOptionsApp, ExtensionOptionsBase, ExtensionOptionsBundle, ExtensionOptionsBundleEntries, ExtensionOptionsBundleEntry, ExtensionOptionsHybrid, ExtensionSandboxOptions, ExtensionSandboxRequestedScopes, SplitEntrypoint };