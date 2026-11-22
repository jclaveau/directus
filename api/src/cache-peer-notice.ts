import { useEnv } from '@directus/env';
import type { CacheFlushTarget } from '@directus/types';
import { useBus } from './bus/index.js';
import { useLogger } from './logger/index.js';
import { redisConfigAvailable } from './redis/index.js';
import { nodeId } from './utils/node-id.js';

/**
 * The tiers a flush dropped, for the other nodes to drop their own copy of.
 * `origin` names the node that sent it: the bus hands a message back to its
 * sender too, and that node cleared its own tiers already.
 */
export interface CacheClearMessage {
	targets: CacheFlushTarget[];
	origin?: string;
}

/**
 * What a flush tells the other nodes beside its responses: a write that changed
 * roles, access, policies or permissions names the permissions too, in the same
 * message, so a peer drops them before the responses it would refill from them.
 */
export type PeerNotice = { permissionsCleared: boolean };

/**
 * A memory store holds one response cache per node, so a flush that cleared
 * this node's tells the others to clear theirs: a membership, permission, field
 * or item write reaches every node, whichever path flushed it. A Redis store is
 * shared: the clear the flush made is the one clear it gets, so nothing is sent.
 *
 * Never throws: it runs after the write committed, as the flush does.
 */
export async function tellPeersResponseCacheCleared(
	peerNotice: PeerNotice = { permissionsCleared: false },
): Promise<void> {
	if (useEnv()['CACHE_STORE'] !== 'memory' || !redisConfigAvailable()) {
		return;
	}

	try {
		await useBus().publish<CacheClearMessage>('cacheCleared', {
			targets: peerNotice.permissionsCleared
				? ['permissions', 'response']
				: ['response'],
			origin: nodeId,
		});
	}
	catch (error) {
		useLogger().warn(
			error,
			`[cache] could not tell the other nodes to drop their responses: ${error}`,
		);
	}
}
