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

// Milliseconds before each new try of a refused peer notice: four tries in all,
// the last 1050 ms after the first.
const PEER_NOTICE_RETRY_DELAYS = [50, 200, 800];

/**
 * A Redis store holds one response cache for every node, so the flush clears it
 * once and no peer clears it again. Each node still holds its own copy of the
 * permissions, and a request reading the old copy would fill the shared store
 * again with the old roles: a write that cleared them names them to the peers
 * before its clear, for each to drop its own copy. A memory store's peers hear
 * them in the message naming their responses.
 *
 * A dropped connection already holds the publish in ioredis's offline queue,
 * which rejects it only past `maxRetriesPerRequest` (20 reconnects, ~10 s with
 * the default `REDIS_RETRY_*` delays). What rejects at once is a Redis
 * answering but not yet writable — a failover's `READONLY`, a restart's
 * `LOADING` — for well under a second, so a refused publish is tried again
 * after each of `PEER_NOTICE_RETRY_DELAYS`. Past the last, the peers keep their
 * permissions until their own cache of them expires, and the warning says so.
 *
 * Never throws: it runs after the write committed, as the flush does.
 */
export async function tellPeersPermissionsCleared(
	peerNotice: PeerNotice,
): Promise<void> {
	const sharedStore = useEnv()['CACHE_STORE'] !== 'memory';

	if (!peerNotice.permissionsCleared || !sharedStore || !redisConfigAvailable()) {
		return;
	}

	const clearMessage: CacheClearMessage = {
		targets: ['permissions'],
		origin: nodeId,
	};

	let lastRefusal: unknown;

	for (const retryDelay of [0, ...PEER_NOTICE_RETRY_DELAYS]) {
		if (retryDelay > 0) {
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}

		try {
			await useBus().publish<CacheClearMessage>('cacheCleared', clearMessage);

			return;
		}
		catch (error) {
			lastRefusal = error;
		}
	}

	const triedCount = PEER_NOTICE_RETRY_DELAYS.length + 1;

	useLogger().warn(
		lastRefusal,
		'[cache] could not tell the other nodes to drop their permissions: the bus'
		+ ` refused the ${JSON.stringify('cacheCleared')} message naming`
		+ ` ${JSON.stringify(clearMessage.targets)} ${triedCount} times, the last`
		+ ` with: ${lastRefusal}`,
	);
}

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
