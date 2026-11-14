import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Upstream release SHA-256 values for the exact archives accepted by this build.
// 本构建仅接受下列上游发行归档对应的 SHA-256。
const inputs = {
  'linux-arm64': ['df14545d54b5fc34b161feb28e84c73e75c88c1618ce2b13ad460239228ac325', 'a8680a765fb8cd3ed1be0b15eadc304dede4f83beee620ea6b897fd1bc592eda'],
  'linux-x64': ['f456235c26ad31e74620d98c8f9f5ba0258a7c0304b6bdbc9d223752c2dd6969', '143bdcd57fe9dea48aaccc9b2b6e476698085a8c17a03190f2df22f6ef883fea'],
  'macos-arm64': ['b14f33adbdff158b840a73d656b488e134ad24a2d1a0f718e6313e9ea9ab76c4', '08fe3871f120f11b388d9849b870c9ae26bbe71dbaf7e20ecaa0e048c00f9193'],
  'macos-x64': ['c35d6b1701aa8a98f303aa96cd849f03d19b7f7107f3439d7eaef21e15b1b780', 'df48c1d77cde43ca53cc1e45166828b57abb6f66c9369a86df1375f68908866d'],
}

/** Run one build tool with exact arguments and return its text output.
 * 使用明确参数执行一个构建工具并返回文本输出。 */
function run(tool, args) {
  return execFileSync(tool, args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 32 * 1024 * 1024 })
}

/** Return the SHA-256 hex digest of a release file.
 * 返回发行文件的 SHA-256 十六进制摘要。 */
function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Verify the pinned archive and extract it into the supplied empty directory.
 * 校验固定版本归档并将其解压到指定空目录。 */
function extract(archive, expected, dir) {
  if (digest(archive) !== expected) throw new Error(`Unexpected SHA-256 for ${archive}`)
  mkdirSync(dir)
  run('tar', ['-xzf', archive, '-C', dir])
}

/** Return all regular file paths below a native artifact directory.
 * 返回原生制品目录下的所有普通文件路径。 */
function files(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name))
}

/** Read install-name and dependency commands from one non-fat Mach-O file.
 * 读取单架构 Mach-O 的动态库标识与依赖加载命令。 */
function macLinks(file) {
  // The pinned files have no LC_RPATH. Reject future layout changes explicitly.
  // 固定版本文件没有 LC_RPATH，发现新布局时显式失败。
  const rows = run('llvm-otool', ['-l', file])
  for (const [, major, minor] of rows.matchAll(/\b(?:minos|version) (\d+)\.(\d+)(?:\.\d+)?\s*\n\s*(?:ntools|sdk)\b/g)) {
    if (+major > 15 || (+major === 15 && +minor > 5)) throw new Error(`${file} requires macOS ${major}.${minor}`)
  }
  if (/\bcmd LC_RPATH\b/.test(rows)) throw new Error(`Unexpected runpath in ${file}`)
  return [...rows.matchAll(/\bcmd (LC_(?:ID|LOAD|LOAD_WEAK|REEXPORT|LAZY_LOAD|LOAD_UPWARD)_DYLIB)\s+cmdsize \d+\s+name (.+?) \(offset \d+\)/g)]
    .map(([, command, name]) => ({ command, name }))
}

/** Replace build-machine links with the same portable paths as VulcanCode.
 * 将构建机依赖改为与 VulcanCode 相同的可迁移路径。 */
function relocateMac(modules, libs) {
  const curl = /^libcurl(?:\.\d+)*\.dylib$/
  const systemCurl = '/usr/lib/libcurl.4.dylib'
  const originals = files(modules).filter(file => file.endsWith('.so'))
  for (const file of originals) renameSync(file, file.slice(0, -3) + '.dylib')
  const names = new Set(readdirSync(libs))
  for (const file of [...files(modules), ...files(libs)].filter(file => /\.(?:so|dylib)$/.test(file))) {
    const basename = path.basename(file)
    if (curl.test(basename)) {
      rmSync(file)
      continue
    }
    // Calculate each loader path independently, including nested mime/socket modules.
    // 分别计算各模块的加载路径，包括嵌套的 mime 和 socket 模块。
    const relative = path.relative(path.dirname(file), libs)
    const prefix = relative ? `@loader_path/${relative}/` : '@loader_path/'
    const edits = []
    const expected = macLinks(file).map(({ command, name }) => {
      if (command === 'LC_ID_DYLIB') {
        const identity = name === '/usr/local/lib/libluajit-5.1.2.dylib' ? 'libluajit-5.1.dylib' : path.basename(name)
        if (!names.has(identity)) throw new Error(`Missing dylib identity ${identity} for ${file}`)
        if (name !== `@rpath/${identity}`) edits.push('-id', `@rpath/${identity}`)
        return `@rpath/${identity}`
      }
      if (/^\/(?:usr\/lib\/|System\/Library\/Frameworks\/)/.test(name)) return name
      const dep = path.basename(name)
      const isCurl = basename === 'lcurl.dylib' && name === '@rpath/libcurl.4.dylib'
      if (!isCurl && (!names.has(dep) || curl.test(dep) || !/^(?:@rpath\/[^/]+$|\/Users\/runner\/work\/luaskills-packages\/luaskills-packages\/luaskills\/third_party\/deps\/)/.test(name))) {
        throw new Error(`Unexpected dependency ${name} for ${file}`)
      }
      const relocated = isCurl ? systemCurl : prefix + dep
      edits.push('-change', name, relocated)
      return relocated
    })
    if (basename === 'lcurl.dylib' && !expected.includes(systemCurl)) throw new Error('LuaCurl is missing the system libcurl link')
    if (!edits.length) continue
    run('llvm-install-name-tool', [...edits, file])
    run('rcodesign', ['sign', file])
    if (macLinks(file).map(({ name }) => name).join('\n') !== expected.join('\n')) {
      throw new Error(`Incorrect macOS load commands in ${file}`)
    }
  }
}

/** Return the dynamic Lua API imports or exports of one native file.
 * 返回指定原生文件的动态 Lua API 导入或导出列表。 */
function luaSymbols(file, mac, imports) {
  // Only inspect the dynamic symbol surface used by the platform loader.
  // 仅检查平台加载器使用的动态符号表。
  const rows = mac ? run('llvm-objdump', ['--macho', imports ? '--syms' : '--exports-trie', file])
    : run('readelf', ['--dyn-syms', '--wide', file])
  return new Set(rows.split('\n').flatMap(line => {
    const name = line.match(/\s(_?lua(?:L|JIT|open)?_\w+)(?:@\S+)?(?:\s+\(\d+\))?$/)?.[1]
    const undefinedSymbol = mac ? /\*UND\*/.test(line) : /\bUND\b/.test(line)
    return name !== undefined && undefinedSymbol === imports ? [name] : []
  }))
}

/** Check every native module's symbol resolution and the Linux loader paths and glibc floor.
 * 校验所有原生模块的符号解析及 Linux 加载路径、glibc 最低版本。 */
function verify(modules, libs, core, mac) {
  const exported = luaSymbols(core, mac, false)
  if (!exported.has(mac ? '_lua_gettop' : 'lua_gettop')) throw new Error('The shared core does not expose its Lua API')
  const nativeModules = files(modules).filter(file => file.endsWith(mac ? '.dylib' : '.so'))
  if (!nativeModules.includes(path.join(modules, mac ? '_openssl.dylib' : '_openssl.so'))) {
    throw new Error('The prepared runtime is missing the OpenSSL module')
  }
  for (const file of nativeModules) {
    const missing = [...luaSymbols(file, mac, true)].filter(name => !exported.has(name))
    if (missing.length) throw new Error(`${file} cannot resolve ${missing.join(', ')} from the LuaSkills core`)
  }
  if (mac) return
  for (const file of [...nativeModules, ...files(libs).filter(file => /\.so(?:\.\d+)*$/.test(file))]) {
    const needs = run('readelf', ['--version-info', '--wide', file]).split('Version needs section')[1] ?? ''
    for (const [, major, minor] of needs.matchAll(/Name: GLIBC_(\d+)\.(\d+)\b/g)) {
      if (+major > 2 || (+major === 2 && +minor > 35)) throw new Error(`${file} requires glibc ${major}.${minor}`)
    }
    if (file === core) continue
    const relative = path.relative(path.dirname(file), libs)
    const expected = relative ? `$ORIGIN/${relative}` : '$ORIGIN'
    const paths = [...run('readelf', ['-dW', file]).matchAll(/\((?:RUNPATH|RPATH)\).*\[([^\]]*)\]/g)]
    if (paths.length !== 1 || paths[0][1] !== expected) throw new Error(`${file} must use ${expected} for its native dependencies`)
  }
}

/** Build one platform archive from the verified release inputs and report its SHA-256.
 * 从经过校验的发行输入生成单平台归档并报告 SHA-256。 */
function build(platform, runtimeArchive, ffiArchive, output) {
  if (!Object.hasOwn(inputs, platform)) throw new Error(`Unsupported platform: ${platform}`)
  const mac = platform.startsWith('macos-')
  const architecture = platform.endsWith('-arm64') ? 'aarch64' : 'x86_64'
  const temp = mkdtempSync(path.join(tmpdir(), 'dsh-luaskills-native-'))
  try {
    const root = path.join(temp, 'runtime')
    const ffi = path.join(temp, 'ffi')
    extract(runtimeArchive, inputs[platform][0], root)
    extract(ffiArchive, inputs[platform][1], ffi)
    const libs = path.join(root, 'libs')
    const modules = path.join(root, 'lua_packages', 'lib', 'lua')
    const staticCore = path.join(ffi, 'lib', 'libluaskills.a')
    const core = path.join(libs, mac ? 'libluaskills.dylib' : 'libluaskills.so')
    cpSync(path.join(ffi, 'include'), path.join(root, 'include'), { recursive: true })
    cpSync(path.join(ffi, 'licenses'), path.join(root, 'licenses', 'luaskills-ffi'), { recursive: true })
    cpSync(path.join(ffi, 'contracts', 'embedded', 'v1', 'contract.sha256'), path.join(root, 'resources', 'dsh-ffi-contract.sha256'))
    if (mac) {
      relocateMac(modules, libs)
      const sdk = process.env.DSH_MACOS_SDK
      if (!sdk) throw new Error('Set DSH_MACOS_SDK to the macOS 15.5 SDK')
      // Export and retain the very same LuaJIT objects that run the engine.
      // 保留并导出实际执行引擎的同一份 LuaJIT 对象。
      run('ld64.lld', ['-dylib', '-arch', architecture === 'aarch64' ? 'arm64' : 'x86_64',
        '-platform_version', 'macos', '15.5', '15.5', '-syslibroot', sdk,
        '-install_name', '@rpath/libluaskills.dylib', '-force_load', staticCore,
        '-framework', 'CoreFoundation', '-framework', 'CoreServices', '-liconv', '-lSystem',
        '-dead_strip', '-x', '-exported_symbol', '_lua*', '-adhoc_codesign', '-o', core])
      macLinks(core)
    } else {
      // Linking against Zig's glibc 2.35 sysroot drops the upstream binary's glibc 2.39 dependency.
      // 使用 Zig 的 glibc 2.35 系统根重新链接，消除原官方动态库的 glibc 2.39 依赖。
      const exports = path.join(temp, 'core.exports')
      writeFileSync(exports, '{ global: luaskills_*; lua_*; luaL_*; luaJIT_*; luaopen_*; local: *; };\n')
      run('zig', ['cc', '-target', `${architecture}-linux-gnu.2.35`, '-shared',
        '-Wl,--whole-archive', staticCore, '-Wl,--no-whole-archive', '-Wl,-Bsymbolic',
        `-Wl,--version-script=${exports}`, '-lc', '-lm', '-ldl', '-lpthread', '-lrt', '-lutil', '-o', core])
      run('llvm-strip', ['--strip-unneeded', core])
    }
    verify(modules, libs, core, mac)
    // Fixed metadata makes the artifact reproducible with the same build tools and release files.
    // 固定元数据使相同构建工具及输入能够重建制品。
    mkdirSync(path.dirname(output), { recursive: true })
    run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', output, '-C', root,
      'include', 'libs', 'licenses', 'lua_packages', 'resources'])
    const checksum = digest(output)
    writeFileSync(`${output}.sha256`, `${checksum}\n`)
    console.log(`${checksum}  ${output}`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

// CLI input names are explicit; no network or platform detection happens in this script.
// 命令行显式提供输入文件，本脚本不联网也不猜测目标平台。
const [platform, runtimeArchive, ffiArchive, output] = process.argv.slice(2)
if (!platform || !runtimeArchive || !ffiArchive || !output) {
  throw new Error('Usage: node scripts/prepare-luaskills-unix.mjs <platform> <lua-v0.1.9.tar.gz> <ffi-v0.9.0.tar.gz> <output.tar.gz>')
}
build(platform, path.resolve(runtimeArchive), path.resolve(ffiArchive), path.resolve(output))
