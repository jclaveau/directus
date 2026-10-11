import { defineHook } from '@directus/extensions-sdk';

export default defineHook(({ filter, action }) => {
	filter('items.create.one', () => {
		console.log('Creating Item!');
	});

	action('items.create.one', () => {
		console.log('Item created!');
	});
});
