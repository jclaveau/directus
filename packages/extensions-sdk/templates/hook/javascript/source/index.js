export default ({ filter, action }) => {
	filter('items.create.one', () => {
		console.log('Creating Item!');
	});

	action('items.create.one', () => {
		console.log('Item created!');
	});
};
