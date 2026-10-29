#!/usr/bin/env node
// Bundle the browser half into the lazy factory that dsh's page module loader registers:
// `window.__ModuleLoader__.load({ id, factory(require) })`, as described in dsh's client module
// system README. Unlike the decision guard, this half uses third-party libraries (lucide-react,
// KaTeX, dagre), so esbuild bundles them in; only the modules dsh serves to every plugin stay
// external and are answered by the loader's `require`.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { name } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
/** Requests answered by dsh's baseline page module table (`packages/client/web/src/platform.ts`). */
const PLATFORM_MODULES = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

const shared = readFileSync(path.join(root, 'client/shared.ts'), 'utf8')
if (shared.match(/\bPACKAGE_NAME = '([^']+)'/)?.[1] !== name) {
  console.error(`bundle-client: PACKAGE_NAME in client/shared.ts must equal the package name ${name}`)
  process.exit(1)
}

const result = await build({
  absWorkingDir: root,
  entryPoints: ['client/index.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  minify: true,
  legalComments: 'eof',
  logLevel: 'warning',
})
const code = result.outputFiles[0].text
// A member call such as lodash's guarded `freeModule.require("util")` is not a module request.
for (const [, request] of code.matchAll(/(?<![.\w$])require\(\s*["']([^"']+)["']\s*\)/g)) {
  if (!PLATFORM_MODULES.includes(request)) {
    console.error(`bundle-client: the bundle requests ${request}, which dsh's page module table does not serve`)
    process.exit(1)
  }
}

const bundle = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(name)},
\tfactory: (platformRequire) => {
\t\tvar module = { exports: {} };
\t\t(function (module, exports, require) {
${code}
\t\t})(module, module.exports, platformRequire);
\t\treturn module.exports;
\t}
});
`
writeFileSync(path.join(root, 'lib/client.js'), bundle)
console.log(`bundle-client: wrote lib/client.js (${Math.round(bundle.length / 1024)} KiB)`)
