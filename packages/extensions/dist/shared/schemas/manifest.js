import { EXTENSION_PKG_KEY } from "../constants/pkg-key.js";
import { ExtensionOptions } from "./options.js";
import { z } from "zod";

//#region src/shared/schemas/manifest.ts
const ExtensionManifest = z.object({
	name: z.string(),
	version: z.string(),
	type: z.union([z.literal("module"), z.literal("commonjs")]).optional(),
	description: z.string().optional(),
	icon: z.string().optional(),
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
	[EXTENSION_PKG_KEY]: ExtensionOptions
});

//#endregion
export { ExtensionManifest };