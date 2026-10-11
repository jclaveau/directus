import { z } from 'zod';
const zodStringOrNumber = z.union([z.string(), z.number()]);
export const WebSocketMessage = z
    .object({
    type: z.string(),
    uid: zodStringOrNumber.optional(),
})
    .passthrough();
