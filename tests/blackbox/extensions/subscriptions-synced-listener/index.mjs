// Logs each `subscriptions.synced` action, so a scenario reads what a listening
// extension receives: the bundle emits it on the extensions' own emitter. One
// `field=<json>` per field, so a scenario's docstring wraps at the spaces.
export default (_register, { emitter, logger }) => {
	emitter.onAction('subscriptions.synced', (syncedPayload) => {
		const loggedFields = Object.entries(syncedPayload)
			.map(([fieldName, fieldValue]) => {
				return `${fieldName}=${JSON.stringify(fieldValue)}`;
			});

		logger.info(`subscriptions.synced ${loggedFields.join(' ')}`);
	});
};
