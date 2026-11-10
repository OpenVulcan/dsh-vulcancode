import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

// Test the compiled client module, as loaded by the dsh browser bundle.
// 测试 dsh 浏览器包实际加载的已编译客户端模块。
const exports: Record<string, (...args: never[]) => unknown> = {}
runInNewContext(readFileSync(new URL('../build/client/shared.js', import.meta.url), 'utf8'), { exports })

/**
 * Call the compiled browser helper and compare its JSON output in the test realm.
 * 调用已编译的浏览器辅助函数，并在测试上下文中比较其 JSON 输出。
 */
function call(name: string, ...args: unknown[]): unknown {
  // The CommonJS export name is fixed by each test case.
  // CommonJS 导出名由每个用例明确指定。
  const fn = exports[name]
  assert.ok(fn, name)
  return structuredClone(Reflect.apply(fn, undefined, args))
}

test('encodes inherit, disabled and custom reasoning as distinct native values', () => {
  assert.deepEqual(call('encodeDraft', { mode: 'inherit', values: {} }), { ok: true, value: undefined })
  assert.deepEqual(call('encodeDraft', { mode: 'disabled', values: {} }), { ok: true, value: false })
  assert.deepEqual(call('encodeDraft', { mode: 'custom', values: { off: '', xhigh: ' max ' } }), {
    ok: true, value: { off: null, xhigh: 'max' },
  })
  assert.deepEqual(call('draftOf', { off: null, xhigh: 'max' }), {
    mode: 'custom', values: { off: '', xhigh: 'max' },
  })
})

test('requires at least one thinking level and a wire value for each non-off level', () => {
  assert.deepEqual(call('encodeDraft', { mode: 'custom', values: { off: '' } }), { ok: false, issue: 'levelRequired' })
  assert.deepEqual(call('encodeDraft', { mode: 'custom', values: { high: ' ' } }), { ok: false, issue: 'wireRequired' })
})

test('keeps the configured provider default available for requests that omit an effort', () => {
  assert.deepEqual(call('encodeDraft', { mode: 'custom', values: { xhigh: 'max' } }, 'high'), { ok: false, issue: 'providerDefault' })
  assert.deepEqual(call('encodeDraft', { mode: 'disabled', values: {} }, 'high'), { ok: false, issue: 'providerDefault' })
  assert.deepEqual(call('encodeDraft', { mode: 'disabled', values: {} }, 'off'), { ok: true, value: false })
  assert.deepEqual(call('encodeDraft', { mode: 'custom', values: { high: 'max' } }, 'high'), { ok: true, value: { high: 'max' } })
})

test('updates only the selected model field in an explicit catalog and can restore inheritance', () => {
  // Keep other model settings and rows to detect accidental replacement.
  // 保留模型其他配置及同级条目，以检测意外的覆盖。
  const models = [
    { id: 'deepseek-v4-flash', contextWindow: 1048576, reasoningEfforts: false },
    { id: 'glm-5', input: ['text'], reasoningEfforts: { high: 'high' } },
  ]
  assert.deepEqual(call('reasoningOp', { models }, 'qwen-token-plan-cn', 'deepseek-v4-flash', { high: 'max' }), {
    op: 'set', path: ['providers', 'qwen-token-plan-cn', 'models'],
    value: [{ ...models[0], reasoningEfforts: { high: 'max' } }, models[1]],
  })
  assert.deepEqual(call('reasoningOp', { models }, 'qwen-token-plan-cn', 'deepseek-v4-flash', undefined), {
    op: 'set', path: ['providers', 'qwen-token-plan-cn', 'models'],
    value: [{ id: 'deepseek-v4-flash', contextWindow: 1048576 }, models[1]],
  })
  assert.throws(() => call('reasoningOp', { models }, 'qwen-token-plan-cn', 'removed-model', false), /no longer available/)
})

test('uses a sparse override for inherited catalog models, preserving the ID as one path segment', () => {
  // Provider and model IDs come from the host's profile and catalog respectively.
  // 提供商及模型标识分别来自宿主的配置与目录。
  const provider = 'openrouter'
  const modelId = 'vendor/model.v2'
  const profile = { models: [], modelOverrides: { [modelId]: { reasoningEfforts: false } } }
  assert.deepEqual(call('modelOptions', profile, [{ id: modelId, name: 'Model' }]), [
    { id: modelId, name: 'Model', efforts: false },
  ])
  assert.deepEqual(call('reasoningOp', profile, provider, modelId, { low: 'minimum' }), {
    op: 'set', path: ['providers', provider, 'modelOverrides', modelId, 'reasoningEfforts'], value: { low: 'minimum' },
  })
  assert.deepEqual(call('reasoningOp', profile, provider, modelId, undefined), {
    op: 'unset', path: ['providers', provider, 'modelOverrides', modelId, 'reasoningEfforts'],
  })
})
