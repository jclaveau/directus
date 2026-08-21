import {
  isExportReference,
  vueTemplateIdentifiers,
} from './vue-template-identifiers.js'

// Inlining moves the initializer to the read, so a read that runs a different
// number of times than its declaration changes when the value is computed.
const REPEATING_STATEMENTS = new Set([
  `ForStatement`,
  `ForInStatement`,
  `ForOfStatement`,
  `WhileStatement`,
  `DoWhileStatement`,
])

function runsWithItsDeclaration(read, declarationBlock) {
  let current = read

  while (current && current.parent && current !== declarationBlock) {
    const parent = current.parent

    if (
      REPEATING_STATEMENTS.has(parent.type)
      || parent.type === `SwitchCase`
      // Moving the initializer inside a `try` also hands it that catch clause.
      || parent.type === `TryStatement`
      || parent.type === `CatchClause`
      || ((parent.type === `IfStatement` || parent.type === `ConditionalExpression`)
        && parent.test !== current)
      || (parent.type === `LogicalExpression` && parent.right === current)
    ) {
      return false
    }

    current = parent
  }

  return true
}

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
        `inline a const whose value is read exactly once, rather than naming it. `
        + `Quiet when inlining would move the initializer: across a function, into `
        + `a loop, or under a branch that may not run — and quiet when the one read `
        + `is a Vue template, which this rule cannot edit`,
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
    const templateNames = vueTemplateIdentifiers(sourceCode)

    return {
      VariableDeclarator(node) {
        // A destructuring pattern is a shape, not a name: nothing to inline.
        if (node.parent.kind !== `const` || node.id.type !== `Identifier`) {
          return
        }

        if (!node.init) {
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

        // Used from markup: a template expression cannot take a multi-line
        // initializer, and what it can reach from there is not what the script can.
        if (templateNames.has(node.id.name)) {
          return
        }

        const [variable] = sourceCode.getDeclaredVariables(node)

        if (!variable) {
          return
        }

        // The initializer is a write reference; reads are what "used once" counts.
        // `<script setup>` also marks the declaration itself as read so that a
        // template-only binding is not reported unused, and that is not a use.
        const reads = variable.references.filter((reference) => {
          return reference.isRead()
            && reference.identifier !== node.id
            && !isExportReference(reference)
        })

        if (reads.length !== 1) {
          return
        }

        const [read] = reads

        // Across functions, inlining moves WHEN the initializer runs.
        if (enclosingFunction(read.identifier) !== enclosingFunction(node)) {
          return
        }

        // A loop or a branch does the same within one function.
        if (!runsWithItsDeclaration(read.identifier, node.parent.parent)) {
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
          const declaration = node.parent

          // The declaration goes away with the inlining, so when it shares the
          // read's line its text must not be measured as if it stayed.
          const before = declaration.loc.end.line === read.identifier.loc.start.line
            ? readLine
              .slice(declaration.loc.end.column, read.identifier.loc.start.column)
              .replace(/^[\s;]+/u, ``)
            : readLine.slice(0, read.identifier.loc.start.column)

          // A tab counts as `tabWidth` columns, the way `max-len` measures a line.
          let inlinedWidth = 0

          for (const char of before
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
