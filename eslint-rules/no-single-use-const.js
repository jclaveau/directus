function enclosingFunction(node) {
  let current = node

  while (current) {
    if (
      current.type === `FunctionDeclaration`
      || current.type === `FunctionExpression`
      || current.type === `ArrowFunctionExpression`
    ) {
      return current
    }

    current = current.parent
  }

  return null
}

export default {
  meta: {
    type: `suggestion`,
    docs: {
      description:
        `inline a const whose value is read exactly once, rather than naming it`,
    },
    // No fixer: it would drop the declaration and any comment sitting on it.
    schema: [{
      type: `object`,
      properties: {
        code: { type: `number` },
        tabWidth: { type: `number` },
        ignoreAwait: { type: `boolean` },
        ignoreAssertedValues: { type: `boolean` },
      },
      additionalProperties: false,
    }],
    messages: {
      singleUse:
        `\`{{name}}\` is read once — inline it at its one call site. A name used a `
        + `single time only sends the reader looking for uses that aren't there.`,
    },
  },

  create(context) {
    const options = context.options[0] ?? {}
    const code = options.code ?? 85
    const tabWidth = options.tabWidth ?? 4
    const ignoreAwait = options.ignoreAwait ?? true
    const ignoreAssertedValues = options.ignoreAssertedValues ?? true
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    return {
      VariableDeclarator(node) {
        // A destructuring pattern is a shape, not a name: nothing to inline.
        if (node.parent.kind !== `const` || node.id.type !== `Identifier`) {
          return
        }

        // Exported: the readers that would justify the name are in another file.
        if (!node.init || node.parent.parent.type === `ExportNamedDeclaration`) {
          return
        }

        // Inlining an `await` would relocate it against the awaits around it.
        if (
          ignoreAwait
          && sourceCode.getTokens(node.init).some((token) => {
            return token.type === `Identifier` && token.value === `await`
          })
        ) {
          return
        }

        const [variable] = sourceCode.getDeclaredVariables(node)

        if (!variable) {
          return
        }

        // The initializer is a write reference; reads are what "used once" counts.
        const reads = variable.references.filter((reference) => {
          return reference.isRead()
        })

        if (reads.length !== 1) {
          return
        }

        const [read] = reads

        // Across functions, inlining moves WHEN the initializer runs.
        if (enclosingFunction(read.identifier) !== enclosingFunction(node)) {
          return
        }

        // `const result = act()` read by `expect(result)` is arrange-act-assert:
        // folding the subject into the assertion reads worse, not better.
        if (
          ignoreAssertedValues
          && read.identifier.parent.type === `CallExpression`
          && read.identifier.parent.callee.type === `Identifier`
          && read.identifier.parent.callee.name === `expect`
        ) {
          return
        }

        // Only a single-line initializer has a measurable width once inlined.
        if (node.init.loc.start.line === node.init.loc.end.line) {
          const readLine = sourceCode.lines[read.identifier.loc.start.line - 1]

          // A tab counts as `tabWidth` columns, the way `max-len` measures a line.
          let inlinedWidth = 0

          for (const char of readLine.slice(0, read.identifier.loc.start.column)
            + sourceCode.getText(node.init)
            + readLine.slice(read.identifier.loc.end.column)) {
            inlinedWidth += char === `\t`
              ? tabWidth
              : 1
          }

          // The column cap is what forced the name; inlining would breach it again.
          if (inlinedWidth > code) {
            return
          }
        }

        context.report({
          node: node.id,
          messageId: `singleUse`,
          data: { name: node.id.name },
        })
      },
    }
  },
}
