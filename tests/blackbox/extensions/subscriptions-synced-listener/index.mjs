// Logs each `subscriptions.synced` action, so a scenario reads what a listening
// extension receives: the bundle emits it on the extensions' own emitter.
export default (_register, { emitter, logger }) => {
	emitter.onAction('subscriptions.synced', (syncedPayload) => {
		logger.info(`subscriptions.synced ${JSON.stringify(syncedPayload)}`);
	});
};
