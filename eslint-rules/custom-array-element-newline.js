// Drop-in replacement for the built-in `array-element-newline: consistent`,
// with one extra affordance for command-builder arrays (the args array passed
// to child_process `spawn`/`spawnSync`/`exec*`):
//   - every array → consistent element newlines (all on one line, or all on
//     their own line — never mixed)
//   - command-arg arrays (when `pairCommandArgs` is on) → instead, one CLI
//     token group per line: a flag (`-x` / `--long`) and its value stay
//     together, the next flag or positional starts a new line. The built-in
//     `consistent` can't express this pairing (forces all-flat or all-exploded).

const defaultCommands = [
  `spawn`,
  `spawnSync`,
  `exec`,
  `execSync`,
  `execFile`,
  `execFileSync`,
]


const flagValueOf = (node) => {
  if (! node || node.type === `SpreadElement`) {
    return null
  }
  if (node.type === `Literal` && typeof node.value === `string`) {
    return node.value
  }
  if (node.type === `TemplateLiteral` && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  return null
}

const isFlagNode = (node) => {
  const value = flagValueOf(node)
  return typeof value === `string` && value.startsWith(`-`)
}


export default {
  meta: {
    type: `layout`,
    docs: {
      description:
        `one CLI flag/value group per line in command-arg arrays; `
        + `consistent element newlines (all or none) in every other array`,
    },
    fixable: `whitespace`,
    schema: [{
      type: `object`,
      properties: {
        pairCommandArgs: { type: `boolean` },                   // pair flag+value on one line in spawn/exec arrays (default true)
        commands: { type: `array`, items: { type: `string` } }, // callee names treated as command builders
      },
      additionalProperties: false,
    }],
    messages: {
      newlineBeforeFlag: `Flag should start a new line.`,
      newlinePositional: `Argument should start a new line.`,
      sameLineValue: `Flag value should stay on its flag's line.`,
      consistentNewline: `Array element should start a new line (consistent with the first).`,
      consistentSameLine: `Array element should stay on the same line (consistent with the first).`,
    },
  },

  create(context) {
    const commands = context.options[0]?.commands ?? defaultCommands
    const pairCommandArgs = context.options[0]?.pairCommandArgs ?? true
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    const calleeName = (callee) => {
      if (callee.type === `Identifier`) {
        return callee.name
      }
      if (callee.type === `MemberExpression` && callee.property.type === `Identifier`) {
        return callee.property.name
      }
      return null
    }

    const isCommandArgArray = (node) => {
      const parent = node.parent
      return Boolean(
        parent
        && parent.type === `CallExpression`
        && parent.arguments.includes(node)
        && commands.includes(calleeName(parent.callee)),
      )
    }

    const gapStart = (curStart, fallbackToken) => {
      const before = sourceCode.getTokenBefore(curStart)
      return before && before.value === `,` ? before.range[1] : fallbackToken.range[1]
    }

    const reportNewline = (beforeToken, curStart, cur, messageId) => {
      if (beforeToken.loc.end.line !== curStart.loc.start.line) {
        return
      }
      context.report({
        node: cur,
        messageId,
        fix: (fixer) => fixer.replaceTextRange([gapStart(curStart, beforeToken), curStart.range[0]], `\n`),
      })
    }

    const reportSameLine = (beforeToken, curStart, cur) => {
      if (beforeToken.loc.end.line === curStart.loc.start.line) {
        return
      }
      // a comment between the flag and its value means we can't safely join
      if (sourceCode.commentsExistBetween(beforeToken, curStart)) {
        return
      }
      context.report({
        node: cur,
        messageId: `sameLineValue`,
        fix: (fixer) => fixer.replaceTextRange([gapStart(curStart, beforeToken), curStart.range[0]], ` `),
      })
    }

    const breakBetween = (prev, cur) => (
      sourceCode.getLastToken(prev).loc.end.line !== sourceCode.getFirstToken(cur).loc.start.line
    )

    const checkCommandArgs = (node) => {
      const elements = node.elements.filter(Boolean)
      if (elements.length < 2 || node.loc.start.line === node.loc.end.line) {
        return
      }
      elements.forEach((cur, i) => {
        const curStart = sourceCode.getFirstToken(cur)
        if (i === 0) {
          reportNewline(sourceCode.getFirstToken(node), curStart, cur, `newlinePositional`)
          return
        }
        const prev = elements[i - 1]
        const prevLast = sourceCode.getLastToken(prev)
        const pairsWithFlag = isFlagNode(prev) && ! isFlagNode(cur) && cur.type !== `SpreadElement`
        if (pairsWithFlag) {
          reportSameLine(prevLast, curStart, cur)
        }
        else {
          reportNewline(prevLast, curStart, cur, isFlagNode(cur) ? `newlineBeforeFlag` : `newlinePositional`)
        }
      })
    }

    // Reimplements `array-element-newline: consistent` for non-command arrays:
    // the first element pair sets the baseline (linebreak or not) and every
    // later pair must match it.
    const checkConsistent = (node) => {
      const elements = node.elements
      if (elements.length < 2 || elements.some((element) => element === null)) {
        return // holes (sparse arrays) — leave to the built-in's own handling
      }
      const baseline = breakBetween(elements[0], elements[1])
      for (let i = 1; i < elements.length; i += 1) {
        const prev = elements[i - 1]
        const cur = elements[i]
        if (breakBetween(prev, cur) === baseline) {
          continue
        }
        const prevLast = sourceCode.getLastToken(prev)
        const curStart = sourceCode.getFirstToken(cur)
        if (baseline) {
          context.report({
            node: cur,
            messageId: `consistentNewline`,
            fix: (fixer) => fixer.replaceTextRange([gapStart(curStart, prevLast), curStart.range[0]], `\n`),
          })
        }
        else if (sourceCode.commentsExistBetween(prevLast, curStart)) {
          context.report({ node: cur, messageId: `consistentSameLine` })
        }
        else {
          context.report({
            node: cur,
            messageId: `consistentSameLine`,
            fix: (fixer) => fixer.replaceTextRange([gapStart(curStart, prevLast), curStart.range[0]], ` `),
          })
        }
      }
    }

    return {
      ArrayExpression(node) {
        if (pairCommandArgs && isCommandArgArray(node)) {
          checkCommandArgs(node)
        }
        else {
          checkConsistent(node)
        }
      },
    }
  },
}
