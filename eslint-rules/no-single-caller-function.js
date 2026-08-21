import {
  isExportReference,
  vueTemplateIdentifiers,
} from './vue-template-identifiers.js'

export default {
  meta: {
    type: `suggestion`,
    docs: {
      description:
        `inline a named function with exactly one caller, unless the name carries `
        + `domain meaning or fences off cumbersome logic`,
    },
    // No fixer: the body has to be threaded into the call site's expression by hand.
    schema: [],
    // The two reasons to keep a single-caller function are judgements no rule can
    // make, so the message states them for the reader deciding, and a kept function
    // takes an `eslint-disable-line` naming this rule.
    messages: {
      singleCaller:
        `\`{{name}}\` has one caller — inline it there. An extraction with a single `
        + `call site hides the flow instead of naming a shared step. Keep it only `
        + `where the name earns its place: it states a real business-domain `
        + `step, or fences off logic too cumbersome to read at the call site.`,
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    // A template calls its script's functions from an AST scope analysis never links
    // to, so those calls are counted here rather than the whole component exempted.
    const templateNames = vueTemplateIdentifiers(sourceCode)

    return {
      FunctionDeclaration(node) {
        if (!node.id) {
          return
        }

        const [variable] = sourceCode.getDeclaredVariables(node)

        if (!variable) {
          return
        }

        let callerCount = templateNames.has(node.id.name)
          ? 1
          : 0

        for (const reference of variable.references) {
          if (!reference.isRead() || isExportReference(reference)) {
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
