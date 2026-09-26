// Declaration-only purge (cache-declared-pin.feature). Creating a signal row
// rewrites a slot's note behind the items service, so the framework never sees
// the write, and declares through `scopedCache.purgeBy` the fingerprints the
// signal carries: the declaration is the only thing that can purge the slot's
// cached reads.

const SIGNAL = 'declared_pin_signal';

export default function registerHooks({ filter }) {
	filter(`${SIGNAL}.items.create`, async (payload, _meta, context) => {
		await context.database(payload.rewritten_collection)
			.where({ id: payload.rewritten_id })
			.update({ note: payload.rewritten_note });

		context.scopedCache?.purgeBy(payload.declared);

		return payload;
	});
}
