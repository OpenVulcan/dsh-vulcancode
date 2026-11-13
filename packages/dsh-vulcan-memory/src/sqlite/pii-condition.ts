// Represent values of the bounded VulcanCode condition language.
// 表示 VulcanCode 有界条件语言中的值。
type Value = string | bigint | boolean | readonly bigint[] | undefined
// Read a value from numeric captures, with undefined representing an evaluation fault.
// 从数字捕获中读取值，undefined 表示求值错误。
type Expression = (captures: readonly (string | undefined)[]) => Value

// Match the authoritative precedence and arity tables.
// 与上游的优先级及参数数量表保持一致。
const precedence: Readonly<Record<string, number>> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>=': 3, '<=': 3, '>': 3, '<': 3, '%': 4 }
const arity = new Map([['len', 1], ['is_luhn', 1], ['is_base64', 1], ['weight_sum', 2], ['cn_check', 1]])

/** Evaluate a validated builtin with the supplied arguments.
 *  使用给定参数求值已验证的内建函数。 */
function builtin(name: string, [text, weights]: Value[]): Value {
  if (typeof text !== 'string') return undefined
  switch (name) {
    case 'len': return BigInt(Buffer.byteLength(text))
    case 'is_base64': return text.length > 0 && text.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(text)
    case 'is_luhn': {
      const digits = text.trim()
      if (!/^\d+$/.test(digits)) return false
      return [...digits].reverse().reduce((sum, digit, index) => {
        const value = Number(digit) * (index % 2 + 1)
        return sum + (value > 9 ? value - 9 : value)
      }, 0) % 10 === 0
    }
    case 'weight_sum': {
      const digits = text.trim()
      if (!Array.isArray(weights) || !/^\d+$/.test(digits) || digits.length !== weights.length) return undefined
      return [...digits].reduce((sum, digit, index) => BigInt.asIntN(64, sum + BigInt(digit) * weights[index]), 0n)
    }
    case 'cn_check': {
      const index = text.length === 1 ? '10X98765432'.indexOf(text.toUpperCase()) : -1
      return index < 0 ? undefined : BigInt(index)
    }
    default: return undefined
  }
}

/** Combine two expressions with strict typed operators and Boolean short-circuiting.
 *  通过严格类型运算符与布尔短路组合两个表达式。 */
function binary(operator: string, left: Expression, right: Expression): Expression {
  return captures => {
    const a = left(captures)
    if (operator === '&&' || operator === '||') {
      if (typeof a !== 'boolean') return undefined
      if ((operator === '&&' && !a) || (operator === '||' && a)) return a
      const b = right(captures)
      return typeof b === 'boolean' ? b : undefined
    }
    const b = right(captures)
    if (operator === '==' || operator === '!=') {
      if ((typeof a !== 'bigint' && typeof a !== 'boolean' && typeof a !== 'string') || typeof a !== typeof b) return undefined
      return (a === b) === (operator === '==')
    }
    if (typeof a !== 'bigint' || typeof b !== 'bigint') return undefined
    switch (operator) {
      case '>': return a > b
      case '>=': return a >= b
      case '<': return a < b
      case '<=': return a <= b
      case '%': return b === 0n ? undefined : a % b
      default: return undefined
    }
  }
}

/** Parse a bounded condition with numeric captures and return its masking predicate.
 *  解析含数字捕获的有界条件并返回脱敏谓词。 */
export function compileCondition(source: string, captureCount: number): (captures: readonly (string | undefined)[]) => boolean {
  if (source.trim() === '') return () => true
  // A sticky lexer rejects skipped characters and limits editor-supplied work.
  // 粘滞词法扫描拒绝跳过字符，并限制编辑器输入的处理量。
  const lexer = /\s*(\$[0-9]+|-?[0-9]+|[a-z_]+|\|\||&&|==|!=|>=|<=|[%<>()[\],])/gy
  const tokens: string[] = []
  const text = source.trim()
  while (lexer.lastIndex < text.length) {
    const match = lexer.exec(text)
    if (match === null || tokens.length >= 256) throw new Error('Invalid or oversized PII condition.')
    tokens.push(match[1]!)
  }
  let cursor = 0
  /** Consume the exact expected token or reject the condition.
   *  消费准确的预期标记，否则拒绝条件。 */
  const expect = (token: string): void => {
    if (tokens[cursor++] !== token) throw new Error('Invalid PII condition syntax.')
  }
  /** Parse one signed integer token within the upstream 64-bit range.
   *  解析符合上游 64 位范围的有符号整数标记。 */
  const integer = (token: string | undefined): bigint => {
    if (token === undefined || !/^-?\d+$/.test(token)) throw new Error('Expected an integer in the PII condition.')
    const value = BigInt(token)
    if (BigInt.asIntN(64, value) !== value) throw new Error('PII condition integer is out of range.')
    return value
  }
  /** Parse a primary expression and validate all captures and function arguments.
   *  解析基本表达式，校验全部捕获和函数参数。 */
  const primary = (depth: number): Expression => {
    if (depth > 24) throw new Error('PII condition is nested too deeply.')
    const token = tokens[cursor++]
    if (token === '(') {
      const expression = parse(1, depth + 1)
      expect(')')
      return expression
    }
    if (token === '[') {
      const values: bigint[] = []
      if (tokens[cursor] !== ']') {
        values.push(integer(tokens[cursor++]))
        while (tokens[cursor] === ',') { cursor++; values.push(integer(tokens[cursor++])) }
      }
      expect(']')
      return () => values
    }
    if (token?.startsWith('$')) {
      const index = Number(token.slice(1))
      if (!Number.isSafeInteger(index) || index >= captureCount) throw new Error('Unknown PII condition capture.')
      return captures => captures[index]
    }
    const argumentsCount = token === undefined ? undefined : arity.get(token)
    if (token !== undefined && argumentsCount !== undefined) {
      expect('(')
      const args: Expression[] = []
      for (let index = 0; index < argumentsCount; index++) {
        if (index > 0) expect(',')
        args.push(parse(1, depth + 1))
      }
      expect(')')
      return captures => builtin(token, args.map(argument => argument(captures)))
    }
    const value = integer(token)
    return () => value
  }
  /** Parse binary expressions in precedence order with a bounded recursion depth.
   *  按运算符优先级解析二元表达式并限制递归深度。 */
  const parse = (minimum: number, depth: number): Expression => {
    let left = primary(depth)
    while (cursor < tokens.length) {
      const operator = tokens[cursor]!
      const rank = precedence[operator]
      if (rank === undefined || rank < minimum) break
      cursor++
      left = binary(operator, left, parse(rank + 1, depth + 1))
    }
    return left
  }
  const expression = parse(1, 0)
  if (cursor !== tokens.length) throw new Error('Unexpected PII condition token.')
  // Only a successfully evaluated false permits the matched text through.
  // 仅条件成功求值为假时放行匹配文本。
  return captures => expression(captures) !== false
}
