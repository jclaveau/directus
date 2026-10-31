import { z } from 'zod';
import type { WebSocket } from 'ws';
import type { Accountability } from './accountability.js';
export declare const WebSocketMessage: z.ZodObject<{
    type: z.ZodString;
    uid: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
}, z.core.$loose>;
export type WebSocketMessage = z.infer<typeof WebSocketMessage>;
export type AuthenticationState = {
    accountability: Accountability | null;
    expires_at: number | null;
    refresh_token?: string;
};
export type WebSocketClient = WebSocket & AuthenticationState & {
    uid: string | number;
    auth_timer: NodeJS.Timeout | null;
};
