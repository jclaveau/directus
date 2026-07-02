// Concise arrow bodies (`() => expr`) are for ONE-LINERS only. A concise body that spans more
// than one line — e.g.
//     readByQuery: async () =>
//       withMeta([{ id: 2 }], {
//         scopedCacheTags: [{ collection: `directus_files` }],
//       }),
// reads as a dangling `=>` with the value floating below it. Force such bodies into an explicit
// block with a `return`:
//     readByQuery: async () => {
//       return withMeta([{ id: 2 }], {
//         scopedCacheTags: [{ collection: `directus_files` }],
//       })
//     },
// Single-line concise bodies are left alone. (arrow-body-style:as-needed does the opposite — it
// pushes toward concise even when multiline — which is why this is a custom rule.)

export default {
  meta: {
    type: `suggestion`,
    docs: {
      description:
        `a concise arrow body must stay on one line; a multiline body must use a block + return`,
    },
    // Report-only: no autofix. Wrapping a multiline body in `{ return … }` correctly needs to
    // re-indent the body one level deeper, which requires the `indent` rule — disabled here to
    // avoid a whole-file reindent. A naive fixer mis-indents (it can't tell an inline-wrapped body
    // from a dangling one), and a wrong autofix is worse than a hand fix. Convert by hand.
    schema: [],
    messages: {
      multilineConcise:
        `Multiline arrow body must be a block with an explicit \`return\` — `
        + `the concise \`=> expr\` form is for single-line bodies only.`,
    },
  },

  create(context) {
    return {
      ArrowFunctionExpression(node) {
        const body = node.body
        if (body.type === `BlockStatement`) {
          return // already a block
        }
        if (body.loc.start.line === body.loc.end.line) {
          return // single-line concise body — allowed
        }

        context.report({ node: body, messageId: `multilineConcise` })
      },
    }
  },
}
