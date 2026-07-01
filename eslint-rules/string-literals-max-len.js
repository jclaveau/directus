// max-len can't break a string literal — it's one unsplittable token — so `ignoreStrings` /
// `ignoreTemplateLiterals` end up exempting whole lines, letting strings grow without bound. This
// rule is the max-len arm for the string literals that CAN be broken safely: a `test`/`it`/
// `describe` title is a display string, so it can be wrapped in the `oneLine` tag (which collapses
// the wrapped source back to one line at runtime) and word-wrapped so every source line fits the
// cap — nothing soft-wraps in a diff/review pane. Both a plain over-length literal and an already-
// wrapped `oneLine` whose body lines still overflow are (re)wrapped to fit.
//
//     test('null scopedCacheTags falls back to a full flush (unresolvable mutation)', async () => {
//
//   →
//
//     test(oneLine`
//       null scopedCacheTags falls back to a full flush (unresolvable mutation)
//     `, async () => {
//
// The fixer also injects the `oneLine` import when it's missing, so --fix leaves working code.
// Scope is title-position string literals only — collapsing whitespace is safe for a title, but not
// for a value-bearing string (a URL, SQL); those stay plain and fall to core max-len.

import path from 'node:path'

const TITLE_CALLERS = new Set([`test`, `it`, `describe`])

// The module a missing `oneLine` is imported from: a fixed specifier (`@directus/utils`) if given,
// else a path relative to the file being fixed (importDir/importFile).
function resolveImportModule(fromFile, options) {
  if (options.importModule) {
    return options.importModule
  }
  if (!options.importDir) {
    return null
  }
  let relative = path.relative(path.dirname(fromFile), options.importDir).split(path.sep).join(`/`)
  if (!relative.startsWith(`.`)) {
    relative = `./${relative}`
  }
  return `${relative}/${options.importFile ?? `one-line.js`}`
}

function bindsLocalName(sourceCode, name) {
  return sourceCode.ast.body.some((statement) => {
    return statement.type === `ImportDeclaration`
      && statement.specifiers.some((spec) => spec.local.name === name)
  })
}

// Merge `oneLine` into an existing named import from the same module if there is one (avoids a
// duplicate import declaration), else add a fresh import line at the top.
function importFix(fixer, sourceCode, tag, module) {
  const fromModule = sourceCode.ast.body.find((statement) => {
    return statement.type === `ImportDeclaration` && statement.source.value === module
  })
  const namedSpecifiers = fromModule?.specifiers.filter((spec) => spec.type === `ImportSpecifier`)

  if (namedSpecifiers?.length) {
    return fixer.insertTextAfter(namedSpecifiers[namedSpecifiers.length - 1], `, ${tag}`)
  }

  const statement = `import { ${tag} } from '${module}';\n`
  const firstImport = sourceCode.ast.body.find((s) => s.type === `ImportDeclaration`)
  return firstImport
    ? fixer.insertTextBefore(firstImport, statement)
    : fixer.insertTextBeforeRange([0, 0], statement)
}

// Walk `test` / `it.each(...)` / `describe.skip` etc. back to the root identifier name.
function rootCalleeName(callee) {
  let node = callee
  while (node) {
    if (node.type === `Identifier`) {
      return node.name
    }
    if (node.type === `MemberExpression`) {
      node = node.object
      continue
    }
    if (node.type === `CallExpression`) {
      node = node.callee
      continue
    }
    return null
  }
  return null
}

function visualWidth(text, tabWidth) {
  let width = 0
  for (const char of text) {
    width += char === `\t` ? tabWidth : 1
  }
  return width
}

// The title text, whether written as a plain string literal or already wrapped in `oneLine`…`.
// Returns null for anything else (a non-oneLine tag, or a template with interpolations we can't
// safely collapse).
function titleText(node, tag) {
  if (node.type === `Literal` && typeof node.value === `string`) {
    return node.value
  }
  if (
    node.type === `TaggedTemplateExpression`
    && node.tag.type === `Identifier`
    && node.tag.name === tag
    && node.quasi.expressions.length === 0
  ) {
    return node.quasi.quasis[0].value.cooked.replace(/\s+/g, ` `).trim()
  }
  return null
}

// Greedily pack the title words into `oneLine`…` where every source line — indentation included —
// fits the column cap, so nothing soft-wraps in a diff/review pane.
function wrapTitle(text, baseIndent, indentUnit, tag, code, tabWidth) {
  const escaped = text.replace(/\\/g, `\\\\`).replace(/`/g, `\\\``).replace(/\$\{/g, `\\\${`)
  const budget = code - visualWidth(baseIndent + indentUnit, tabWidth)

  const lines = []
  let current = ``
  for (const word of escaped.split(` `)) {
    if (current === ``) {
      current = word
    }
    else if (current.length + 1 + word.length <= budget) {
      current += ` ${word}`
    }
    else {
      lines.push(current)
      current = word
    }
  }
  if (current !== ``) {
    lines.push(current)
  }

  const body = lines.map((line) => `${baseIndent}${indentUnit}${line}`).join(`\n`)
  return `${tag}\`\n${body}\n${baseIndent}\``
}

export default {
  meta: {
    type: `layout`,
    fixable: `code`,
    docs: {
      description:
        `wrap an over-length test title in the oneLine tag instead of blowing the max-len cap`,
    },
    schema: [{
      type: `object`,
      properties: {
        code: { type: `number` },
        tabWidth: { type: `number` },
        indent: { type: `string` },
        tag: { type: `string` },
        importModule: { type: `string` },
        importDir: { type: `string` },
        importFile: { type: `string` },
      },
      additionalProperties: false,
    }],
    messages: {
      wrapTitle:
        `Title string exceeds the {{code}}-col cap — wrap it in \`{{tag}}\`\`…\`\` and word-wrap `
        + `so every source line fits (nothing soft-wraps in the review pane).`,
    },
  },

  create(context) {
    const options = context.options[0] ?? {}
    const code = options.code ?? 90
    const tabWidth = options.tabWidth ?? 2
    const indentUnit = options.indent ?? `\t`
    const tag = options.tag ?? `oneLine`
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    return {
      CallExpression(node) {
        if (!TITLE_CALLERS.has(rootCalleeName(node.callee))) {
          return
        }

        const title = node.arguments[0]
        if (!title) {
          return
        }

        const text = titleText(title, tag)
        if (text === null) {
          return
        }

        // Report when any source line the title occupies — a plain literal's `it(` line, or one of
        // an already-wrapped `oneLine`'s body lines — overflows the cap. A title that already fits
        // (short literal, or a correctly-wrapped template) is left alone.
        let overflows = false
        for (let ln = title.loc.start.line; ln <= title.loc.end.line; ln++) {
          if (visualWidth(sourceCode.lines[ln - 1], tabWidth) > code) {
            overflows = true
            break
          }
        }
        if (!overflows) {
          return
        }

        const baseIndent = sourceCode.lines[title.loc.start.line - 1].match(/^[ \t]*/)[0]

        context.report({
          node: title,
          messageId: `wrapTitle`,
          data: { code: String(code), tag },
          fix(fixer) {
            const wrapped = wrapTitle(text, baseIndent, indentUnit, tag, code, tabWidth)
            const fixes = [fixer.replaceText(title, wrapped)]

            const module = resolveImportModule(context.filename, options)
            if (module && !bindsLocalName(sourceCode, tag)) {
              fixes.push(importFix(fixer, sourceCode, tag, module))
            }

            return fixes
          },
        })
      },
    }
  },
}
