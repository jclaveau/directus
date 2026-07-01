// A `test`/`it`/`describe` title is an unbreakable string literal — a long one blows the max-len
// cap with nowhere to wrap. Rather than exempt those lines (which lets titles grow without bound),
// this rule wraps an over-length single-line title in the `oneLine` tag, which renders the wrapped
// source back to one line at runtime:
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
// Only single-line string-literal titles over the cap are touched; template-literal titles (already
// wrappable) and short titles are left alone.

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
        `Test title exceeds the {{code}}-col cap — wrap it in \`{{tag}}\`\`…\`\` `
        + `so it can span multiple source lines.`,
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

        // Only single-line string literals — a template literal is already wrappable.
        if (
          !title
          || title.type !== `Literal`
          || typeof title.value !== `string`
          || title.loc.start.line !== title.loc.end.line
        ) {
          return
        }

        const line = sourceCode.lines[title.loc.start.line - 1]
        if (visualWidth(line, tabWidth) <= code) {
          return
        }

        context.report({
          node: title,
          messageId: `wrapTitle`,
          data: { code: String(code), tag },
          fix(fixer) {
            const baseIndent = line.match(/^[ \t]*/)[0]
            const body = title.value.replace(/\\/g, `\\\\`).replace(/`/g, `\\\``).replace(/\$\{/g, `\\\${`)
            const wrapped =
              `${tag}\`\n${baseIndent}${indentUnit}${body}\n${baseIndent}\``

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
