import { readFileSync } from 'node:fs'
import { RE2JS } from 're2js'

// Limit editor content before parsing and use the same limit on the client.
// 在解析前限制编辑器内容，客户端使用相同上限。
export const RULE_FILE_LIMIT = 32_768

/** Read the bundled rule file identified by a validated group and selector.
 *  读取由已校验的分组和选择项标识的随包规则文件。 */
export function bundledRules(group: 'pii' | 'noise', selector: string): string {
  return readFileSync(new URL(`../../assets/text-policy/${group}/${selector}.json`, import.meta.url), 'utf8')
}

/** Compile a source pattern with the Go-style ASCII boundaries and Unicode scripts of RE2.
 *  以 RE2 的 Go 风格 ASCII 边界和 Unicode 文字系统编译来源正则。 */
export function rulePattern(pattern: string, caseInsensitive = false): RE2JS {
  try {
    return RE2JS.compile(pattern, caseInsensitive ? RE2JS.CASE_INSENSITIVE : 0)
  } catch {
    throw new Error('Invalid or unsupported rule pattern.')
  }
}
