import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noiseFor, redactPayload, redactText, similarity } from './text-policy.js'

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
  const input = { turn_id: '000-12-3456', target_turn: { raw_turn: { user: '000-12-3456', assistant: 'Test.' } } }
  assert.deepEqual(redactPayload(input, 'en-US'),
    { turn_id: input.turn_id, target_turn: { raw_turn: { user: '[US_SSN_MASKED]', assistant: 'Test.' } } })
})

test('noise rules use user categories and cosine scores independent of vector length', () => {
  // Match recall probes and keep a durable engineering statement eligible.
  // 命中回忆探测，同时保留长期工程约束的提炼资格。
  assert.ok(noiseFor('你还记得吗').some(rule => rule.regex.some(regex => regex.test('你还记得吗'))))
  assert.ok(!noiseFor('我不确定').some(rule => rule.regex.some(regex => regex.test('我不确定'))))
  assert.ok(!noiseFor('发布必须签名').some(rule => rule.regex.some(regex => regex.test('发布必须签名'))))
  assert.equal(similarity([3, 0], [2, 0]), 1)
  assert.equal(similarity([3, 0], [0, 2]), 0)
})
