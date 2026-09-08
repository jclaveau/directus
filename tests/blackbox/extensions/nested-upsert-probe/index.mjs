// Drives ItemsService.upsertMany directly, because no HTTP route calls it the way
// its real caller does. `processO2M` always hands it a mutation tracker and always
// one parent's worth of children, so two things it promises have never been checked
// from the outside: that it makes its own tracker when the caller offers none, and
// that the keys it returns line up with the payloads it was given.
//
//   POST /upsert-many   — upsertMany over the given payloads, returns its keys.
//
// The second matters most to the batching work: the keys are consumed inside
// processO2M and never reach a response, so index alignment is invisible over HTTP
// even though every nested write depends on it.
//
// Routes here have no asyncHandler around them, so an escaping rejection would exit
// the process and take the whole shard with it: every one answers with a status
// instead of throwing.

const COLLECTION = 'test_nested_upsert_child';

export default function registerEndpoint(router, { services, getSchema }) {
	router.post('/upsert-many', async (req, res) => {
		try {
			const service = new services.ItemsService(COLLECTION, {
				schema: await getSchema(),
				accountability: req.accountability,
			});

			// No mutationTracker and no other option: the defaults its own caller
			// never leaves it to fill in.
			const keys = await service.upsertMany(req.body.payloads);

			res.json({ keys });
		}
		catch (error) {
			res.status(500).json({ message: error?.message ?? null });
		}
	});
}
