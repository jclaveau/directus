import type { GraphQLService } from './index.js';
import type { GraphQLResolveInfo } from 'graphql';
export declare function bindPubSub(): void;
export declare function createSubscriptionGenerator(self: GraphQLService, event: string): (_x: unknown, _y: unknown, _z: unknown, request: GraphQLResolveInfo) => AsyncGenerator<{
    [x: string]: {
        key: any;
        data: import("../../types/items.js").Item;
        event: string;
    };
} | {
    [x: string]: {
        key: any;
        data: null;
        event: string;
    };
}, void, unknown>;
