import type { AbstractServiceOptions } from '@directus/types';
import { withoutMeta } from '../../utils/read-meta.js';
import { withCache } from './with-cache.js';

export interface ShareInfo {
	collection: string;
	item: string;
	role: string | null;
	user_created: {
		id: string;
	};
}

export const fetchShareInfo = withCache('share-info', _fetchShareInfo);

export async function _fetchShareInfo(shareId: string, context: AbstractServiceOptions): Promise<ShareInfo> {
	const { SharesService } = await import('../../services/shares.js');
	const sharesService = new SharesService(context);

	return withoutMeta(await sharesService.readOne(shareId, {
		fields: ['collection', 'item', 'role', 'user_created.id'],
	})) as ShareInfo;
}
