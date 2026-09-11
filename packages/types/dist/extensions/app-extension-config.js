import { z } from 'zod';
export const SplitEntrypoint = z.object({
    app: z.string(),
    api: z.string(),
});
export const ExtensionSandboxRequestedScopes = z.object({
    request: z.optional(z.object({
        urls: z.array(z.string()),
        methods: z.array(z.union([z.literal('GET'), z.literal('POST'), z.literal('PATCH'), z.literal('PUT'), z.literal('DELETE')])),
    })),
    log: z.optional(z.object({})),
    sleep: z.optional(z.object({})),
});
export const ExtensionSandboxOptions = z.optional(z.object({
    enabled: z.boolean(),
    requestedScopes: ExtensionSandboxRequestedScopes,
}));
