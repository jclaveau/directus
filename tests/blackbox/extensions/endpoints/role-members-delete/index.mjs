// Deletes a membership (#746) through RoleMembersService, as an extension or a
// flow script reaching for the service does, with no PATCH /users around it
// (cache-membership-peer.feature).
//
//   POST /role-members-delete/delete-one { membership } → { deleted }
//
// Routes here have no asyncHandler around them, so an escaping rejection would exit
// the process and take the whole shard with it: the route answers with a status
// instead of throwing.

export default function registerEndpoint(router, { services, getSchema }) {
	router.post('/delete-one', async (req, res) => {
		try {
			const deleted = await new services.RoleMembersService({
				schema: await getSchema(),
				accountability: req.accountability,
			}).deleteOne(req.body.membership);

			res.json({ deleted });
		}
		catch (error) {
			res.status(500).json({ message: error?.message ?? null });
		}
	});
}
