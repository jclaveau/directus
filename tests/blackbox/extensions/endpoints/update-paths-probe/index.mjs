// Drives ItemsService's update paths with the mutation options no HTTP route can
// set, so they are covered from the outside rather than by reaching into the
// service from a unit test.
//
//   POST /not-an-array     — updateBatch refuses a payload that is not a list.
//   POST /pre-mutation     — preMutationError throws before anything is written.
//   POST /silent           — emitEvents: false writes without firing the events.
//
// Routes here have no asyncHandler around them, so an escaping rejection would
// exit the process and take the whole shard with it: every one answers with a
// status instead of throwing.

const COLLECTION = 'test_update_paths';

function serviceFor(services, schema, accountability) {
	return new services.ItemsService(COLLECTION, { schema, accountability });
}

export default function registerEndpoint(router, { services, getSchema }) {
	router.post('/not-an-array', async (req, res) => {
		try {
			const service = serviceFor(services, await getSchema(), req.accountability);

			// A list is the whole contract of updateBatch; anything else is refused
			// before a transaction opens.
			await service.updateBatch('not a list');

			res.json({ threw: false });
		}
		catch (error) {
			res.json({
				threw: true,
				code: error?.code ?? null,
				message: error?.message ?? null,
			});
		}
	});

	router.post('/pre-mutation', async (req, res) => {
		try {
			const service = serviceFor(services, await getSchema(), req.accountability);

			await service.updateOne(
				req.body.key,
				{ name: 'never written' },
				{ preMutationError: new Error('pre-mutation refusal') },
			);

			res.json({ threw: false });
		}
		catch (error) {
			res.json({ threw: true, message: error?.message ?? null });
		}
	});

	router.post('/silent', async (req, res) => {
		try {
			const service = serviceFor(services, await getSchema(), req.accountability);

			const keys = await service.updateMany(
				req.body.keys,
				{ name: req.body.name },
				{ emitEvents: false },
			);

			res.json({ keys });
		}
		catch (error) {
			res.status(500).json({ message: error?.message ?? null });
		}
	});
}
