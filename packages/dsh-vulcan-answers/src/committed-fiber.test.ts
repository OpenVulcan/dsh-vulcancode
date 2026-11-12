import assert from 'node:assert/strict'
import { test } from 'node:test'
import { committedFiberPath, type Fiber } from './committed-fiber.js'

// Build a mutable version of the fiber shape so the tests can link both halves of a commit.
// 构建可修改的 Fiber 结构，让测试能连接两轮提交的副本。
type MutableFiber = { -readonly [Key in keyof Fiber]: Fiber[Key] }

/**
 * Create an unlinked fiber with the supplied React tag and rendered props.
 * 使用给定的 React 标记与渲染属性创建尚未连接的 Fiber。
 */
function createFiber(tag: number, memoizedProps: unknown = null): MutableFiber {
  return { tag, memoizedProps, return: null, child: null, sibling: null, alternate: null, stateNode: null }
}

test('reads settled code props when the unchanged host fiber still points to the streaming render', () => {
  // The initial CodeBlock and the DOM host retain their streaming-era parent links.
  // 初始 CodeBlock 与 DOM 宿主仍保留流式输出期间的父节点链接。
  const streamingRoot = createFiber(3)
  // The finished root commits new code props while sharing the same DOM host.
  // 结束流式输出的根节点提交新的代码属性，同时共用原来的 DOM 宿主。
  const settledRoot = createFiber(3)
  // Use a sibling before the CodeBlock so membership must follow the full committed child list.
  // 在 CodeBlock 前插入一个兄弟节点，验证查找会遍历已提交的子节点链表。
  const preceding = createFiber(0)
  // The two code fibers hold different streaming values for the same content.
  // 两个代码 Fiber 对应同一内容，但记录不同的流式输出状态。
  const streamingCode = createFiber(0, { code: 'pass | 6\n', lang: 'ui-kv', streaming: true })
  const settledCode = createFiber(0, { code: 'pass | 6\n', lang: 'ui-kv', streaming: false })
  // React's DOM attachment refers to the host fiber created on the first render.
  // React 的 DOM 关联仍指向首次渲染时创建的宿主 Fiber。
  const host = createFiber(5)

  streamingRoot.stateNode = settledRoot.stateNode = { current: settledRoot }
  streamingRoot.alternate = settledRoot
  settledRoot.alternate = streamingRoot
  streamingRoot.child = streamingCode
  settledRoot.child = preceding
  preceding.sibling = settledCode
  preceding.return = settledRoot
  streamingCode.return = streamingRoot
  settledCode.return = settledRoot
  streamingCode.alternate = settledCode
  settledCode.alternate = streamingCode
  streamingCode.child = settledCode.child = host
  host.return = streamingCode

  assert.deepEqual(committedFiberPath(host), [host, settledCode, settledRoot])
  settledRoot.child = preceding
  preceding.sibling = null
  assert.equal(committedFiberPath(host), undefined)
})
