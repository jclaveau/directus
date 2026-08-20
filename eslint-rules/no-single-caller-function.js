export default {
  meta: {
    type: `suggestion`,
    docs: {
      description:
        `inline a named function with exactly one caller instead of extracting it`,
    },
    // No fixer: the body has to be threaded into the call site's expression by hand.
    schema: [],
    messages: {
      singleCaller:
        `\`{{name}}\` has one caller — inline it there. An extraction with a single `
        + `call site hides the flow instead of naming a shared step.`,
    },
  },

  create(context) {
    // A template calls its script's functions from an AST this rule never sees, so
    // every helper in a component would read as callerless.
    if (context.filename.endsWith(`.vue`)) {
      return {}
    }

    const sourceCode = context.sourceCode ?? context.getSourceCode()

    return {
      FunctionDeclaration(node) {
        if (!node.id) {
          return
        }

        // Exported: the callers justifying the extraction are in another file.
        if (
          node.parent.type === `ExportNamedDeclaration`
          || node.parent.type === `ExportDefaultDeclaration`
        ) {
          return
        }

        const [variable] = sourceCode.getDeclaredVariables(node)

        if (!variable) {
          return
        }

        let callerCount = 0

        for (const reference of variable.references) {
          if (!reference.isRead()) {
            continue
          }

          let current = reference.identifier

          while (current && current !== node) {
            current = current.parent
          }

          // Walking up into the function itself is recursion, not a second caller.
          if (current !== node) {
            callerCount++
          }
        }

        if (callerCount !== 1) {
          return
        }

        context.report({
          node: node.id,
          messageId: `singleCaller`,
          data: { name: node.id.name },
        })
      },
    }
  },
}
