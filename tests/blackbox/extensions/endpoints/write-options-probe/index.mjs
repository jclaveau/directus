// Drives ItemsService with the options and callers no HTTP route reaches, for
// write-mutation-options.test.ts, so they are covered from the outside rather
// than by reaching into the service from a unit test.
//
//   POST /unawaited-create — createOne with awaitActionHooks: false.
//   POST /refused-delete   — deleteMany refused by its preMutationError.
//   POST /group-update     — updateGroups called with no options at all.
//   POST /system-create    — createOne with no accountability, as the system.
//
// Routes here have no asyncHandler around them, so an escaping rejection would
// exit the process and take the whole shard with it: every one answers with a
// status instead of throwing.

const COLLECTION = 'test_write_option_row';

function serviceFor(services, schema, accountability) {
	return new services.ItemsService(COLLECTION, { schema, accountability });
}

export default function registerEndpoint(router, { services, getSchema }) {
	router.post('/unawaited-create', async (req, res) => {
		try {
			const service = serviceFor(services, await getSchema(), req.accountability);

			const key = await service.createOne(
				{ id: req.body.key, name: req.body.name },
				{ awaitActionHooks: false },
			);

			res.json({ key });
		}
		catch (error) {
			res.status(500).json({ message: error?.message ?? null });
		}
	});

	router.post('/refused-delete', async (req, res) => {
		try {
			const service = serviceFor(services, await getSchema(), req.accountability);

			await service.deleteMany(
				[req.body.key],
				{ preMutationError: new Error('pre-mutation refusal') },
			);

			res.json({ threw: false });
		}
		catch (error) {
			res.json({ threw: true, message: error?.message ?? null });
		}
	});

	router.post('/group-update', async (req, res) => {
		try {
			const service = serviceFor(services, await getSchema(), req.accountability);

			const keys = await service.updateGroups([
				{ data: { name: req.body.name }, keys: [req.body.key] },
			]);

			res.json({ keys });
		}
		catch (error) {
			res.status(500).json({ message: error?.message ?? null });
		}
	});

	router.post('/system-create', async (req, res) => {
		try {
			const service = serviceFor(services, await getSchema(), null);

			const key = await service.createOne({
				id: req.body.key,
				name: req.body.name,
			});

			res.json({ key });
		}
		catch (error) {
			res.status(500).json({ message: error?.message ?? null });
		}
	});
}
