import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compilePii, defaultPii, piiRegions, piiSnapshot, redactPayload, redactText } from './pii.js'
import { detectNoise, evaluateNoise, noiseSnapshot, similarity } from './noise.js'

test('bundled regional PII rules preserve ordinary text and mask matching identifiers', () => {
  // Use synthetic values to exercise each bundled region and the shared Luhn rule.
  // 使用合成值验证各随包地区规则和通用 Luhn 规则。
  assert.match(redactText('联系方式 13800138000', 'zh-CN').text, /\[MOBILE_MASKED\]/)
  assert.match(redactText('测试 0912345678', 'zh-TW').text, /\[TW_MOBILE_MASKED\]/)
  assert.match(redactText('测试 A123456(7)', 'zh-HK').text, /\[HK_ID_MASKED\]/)
  assert.match(redactText('Test 000-12-3456', 'en-US').text, /\[US_SSN_MASKED\]/)
  assert.match(redactText('Test 4111111111111111', 'en-US').text, /\[CREDIT_CARD_MASKED\]/)
  assert.equal(redactText('Test 4111111111111112', 'en-US').text, 'Test 4111111111111112')
  assert.equal(redactText('api_key=fixture-secret', 'en-US').text, '[redacted]')
  assert.match(redactText('中山路12号', 'zh-CN').text, /\[SPECIFIC_ADDRESS_MASKED\]/)
})

test('cloud policy masks nested business text while preserving protocol identifiers', () => {
  // Keep opaque fields intact so server selection still matches local records.
  // 保留不透明字段，使服务端选择可继续映射本机记录。
  const input = { turn_id: 'fixture-session/17', target_turn: { raw_turn: { user: '000-12-3456', assistant: 'Test.' } } }
  assert.deepEqual(redactPayload(input, 'en-US'),
    { turn_id: input.turn_id, target_turn: { raw_turn: { user: '[US_SSN_MASKED]', assistant: 'Test.' } } })
  assert.deepEqual(redactPayload({ turn_id: '000-12-3456' }, 'en-US'), { turn_id: '[US_SSN_MASKED]' })
})

test('all 36 regions compile and match a distinct synthetic local example', () => {
  // Samples match the published rule formats without accessing real account data.
  // 样例符合已发布规则格式，无需读取真实账号数据。
  const samples = {
    'ar-AE': '784-2000-1234567-1', 'da-DK': '123456-7890', 'de-DE': 'DE123456789',
    'en-AU': '123-456-789', 'en-CA': '123-456-789', 'en-GB': 'AB123456C', 'en-IE': '1234567AB',
    'en-IN': 'ABCDE1234F', 'en-MY': '123456-12-3456', 'en-NZ': '123-456-789', 'en-PH': '123-456-789-000',
    'en-SG': 'S1234567A', 'en-US': '000-12-3456', 'es-AR': '12.345.678', 'es-CL': '12.345.678-9',
    'es-ES': '12345678A', 'es-MX': 'AAAA000101HDFBBB01', 'es-PE': '20123456789', 'fi-FI': '010101-123A',
    'fr-FR': '123 456 789', 'id-ID': '12.345.678.9-123.456', 'it-IT': 'RSSMRA85T10A562S',
    'ja-JP': '1234-5678-9012', 'ko-KR': '123456-1234567', 'nb-NO': 'NO123456789MVA',
    'nl-NL': 'NL123456789B01', 'pl-PL': '123-456-78-90', 'pt-BR': '123.456.789-00', 'pt-PT': '123456789',
    'sv-SE': '123456-7890', 'th-TH': '1-2345-67890-12-3', 'tr-TR': '12345678901', 'vi-VN': '0912345678',
    'zh-CN': '13800138000', 'zh-HK': 'A123456(7)', 'zh-TW': '0912345678',
  }
  assert.deepEqual(piiRegions, Object.keys(samples).sort())
  for (const [region, sample] of Object.entries(samples)) {
    const names = new Set(JSON.parse(defaultPii(region)).rules.map((rule: { name: string }) => rule.name))
    const result = redactText(sample, piiSnapshot(region))
    assert.ok(result.matches.some(name => names.has(name)), region)
    assert.equal(redactText('Keep the release notes.', region).text, 'Keep the release notes.', region)
  }
})

test('PII overrides retain rule order and count Unicode matches using the source formula', () => {
  // Replace a common rule in place, then exercise a byte-length and a missing-capture condition.
  // 原位替换通用规则，再验证字节长度条件与缺失捕获条件。
  const snapshot = compilePii('en-US',
    JSON.stringify({ language: 'common', version: '2.0.0', rules: [
      { name: 'local', pattern: 'x', replacement: 'wrong' },
      { name: 'second', pattern: 'x', replacement: 'wrong' },
    ] }),
    JSON.stringify({ language: 'en-US', version: '2.0.0', rules: [
      { name: 'local', pattern: '(街)(x)?', replacement: '$1[MASK]', condition: 'len($1) == 3 && len($2) > 0' },
    ] }))
  const result = redactText('🧪街x、街', snapshot)
  assert.equal(result.text, '🧪街[MASK]、街[MASK]')
  assert.deepEqual(result.redactions, [{ name: 'local', count: 2 }])
})

test('noise rules use user categories and cosine scores independent of vector length', () => {
  // Match recall probes and keep a durable engineering statement eligible.
  // 命中回忆探测，同时保留长期工程约束的提炼资格。
  const rules = noiseSnapshot('zh-CN', 0.88)
  assert.equal(detectNoise('你还记得吗', rules), 'meta_question')
  assert.equal(detectNoise('你还记得吗', noiseSnapshot('common', 0.88)), null)
  assert.equal(detectNoise('我不确定', rules), null)
  assert.equal(detectNoise('发布必须签名', rules), null)
  assert.equal(similarity([3, 0], [2, 0]), 1)
  assert.equal(similarity([3, 0], [0, 2]), 0)
})

test('semantic noise degrades on embedding failure while stale approval stops admission', async () => {
  // Use a two-dimensional authorized stand-in to test runtime routing without a cloud account.
  // 使用二维授权替身验证运行路由，无需云账号。
  const rules = noiseSnapshot('common', 0.88, JSON.stringify({ language: 'common', version: '1.0.0',
    categories: [{ name: 'fixture', patterns: ['^hello'], phrases: [' one   phrase ', 'one phrase'] }] }))
  const batches: string[][] = []
  let cached: number[][] | undefined
  let available = true
  let approved = true
  /** Evaluate through the same embedding, caching and approval boundary as distillation.
   *  通过与提炼相同的嵌入、缓存和授权边界执行评估。 */
  const run = (text: string, timeline = false) => evaluateNoise(text, timeline, true, true, rules, async texts => {
    batches.push(texts)
    if (!available) throw new Error('Embedding unavailable')
    return texts.map(() => [1, 0])
  }, () => cached, vectors => { cached = vectors }, () => { if (!approved) throw new Error('Approval changed') })
  assert.equal((await run('hello', true)).source, 'timeline')
  assert.equal((await run('Hello')).source, 'regex')
  assert.deepEqual(batches, [])
  assert.equal((await run('Similar message')).category, 'fixture')
  assert.deepEqual(batches, [['one phrase'], ['Similar message']])
  available = false
  assert.deepEqual(await run('Another message'), { source: 'regex-fallback', category: null, confidence: 0 })
  assert.deepEqual(batches.at(-1), ['Another message'])
  approved = false
  await assert.rejects(run('Stale work'), /Approval changed/)
})
