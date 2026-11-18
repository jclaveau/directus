// Logs each `subscriptions.synced` action, so a scenario reads what a listening
// extension receives: the bundle emits it on the extensions' own emitter. One
// `field=<json>` per field, so a scenario's docstring wraps at the spaces.
export default (_register, { emitter, logger }) => {
	// The emitter hands each action listener `{ event, ...payload }`: the line
	// already starts with the event's name, so `event` is left out.
	emitter.onAction('subscriptions.synced', (listenedPayload) => {
		const loggedFields = Object.entries(listenedPayload)
			.filter(([fieldName]) => fieldName !== 'event')
			.map(([fieldName, fieldValue]) => {
				return `${fieldName}=${JSON.stringify(fieldValue)}`;
			});

		logger.info(`subscriptions.synced ${loggedFields.join(' ')}`);
	});
};
