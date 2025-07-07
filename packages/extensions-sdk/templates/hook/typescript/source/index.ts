import { defineHook } from '@directus/extensions-sdk';

import {
  // ItemsService,
  PayloadService,
} from '@directus/api/services/index'


export default defineHook(({ filter, action }) => {
	filter('items.create', (
		input,
		meta,
		ctx
	) => {
		const test = new PayloadService('items', {
			schema: ctx.schema!,
			accountability: ctx.accountability,
			// database: ctx.database,
		})
		console.log('Creating Item!');
	});

	action('items.create', () => {
		console.log('Item created!');
	});
});
