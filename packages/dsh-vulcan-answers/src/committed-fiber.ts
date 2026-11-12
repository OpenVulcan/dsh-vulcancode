/**
 * React links each committed fiber to its work-in-progress alternate and the root's active tree.
 * React 将已提交的 Fiber 与工作中的副本关联，并由根节点指向当前生效的树。
 */
export interface Fiber {
  readonly tag: number
  readonly memoizedProps: unknown
  readonly return: Fiber | null
  readonly child: Fiber | null
  readonly sibling: Fiber | null
  readonly alternate: Fiber | null
  readonly stateNode: unknown
}

// React's HostRoot tag identifies the owner of the committed tree.
// React 的 HostRoot 标记标识已提交树的所有者。
const HOST_ROOT = 3

/**
 * Given a DOM-owned fiber, return its committed path from the element to the root, or undefined if detached.
 * 给定 DOM 节点持有的 Fiber，返回它从元素到根节点的已提交路径，节点脱离时返回 undefined。
 */
export function committedFiberPath(fiber: Fiber): readonly Fiber[] | undefined {
  // A bailout can share children across alternates, leaving their return pointers on the previous tree.
  // React 跳过重渲染时，两个副本可能共用子节点，子节点的父指针仍指向上一轮的树。
  const candidates = new Set<Fiber>()
  // Follow both copies upward so the later search only visits possible ancestors of this element.
  // 沿两个副本向上收集节点，让后续搜索只访问该元素可能的祖先。
  const pending = [fiber]
  // The root state is shared across alternates and identifies the currently committed root.
  // 两个根副本共用根状态，其中记录当前已提交的根节点。
  let root: Fiber | undefined
  for (const candidate of pending) {
    if (candidates.has(candidate)) continue
    candidates.add(candidate)
    if (candidate.tag === HOST_ROOT) {
      // Require the root's current pointer to identify one of its own fiber copies.
      // 根状态的 current 必须指向该根节点的两个副本之一。
      const state = candidate.stateNode
      if (typeof state === 'object' && state !== null && 'current' in state) {
        if (state.current === candidate) root = candidate
        else if (candidate.alternate !== null && state.current === candidate.alternate) root = candidate.alternate
      }
      continue
    }
    if (candidate.return !== null) pending.push(candidate.return)
    if (candidate.alternate !== null) pending.push(candidate.alternate)
  }

  /**
   * Return the path from the requested fiber to this committed ancestor, if this branch owns it.
   * 若此分支包含目标 Fiber，返回目标 Fiber 到当前已提交祖先的路径。
   */
  function findPath(parent: Fiber): Fiber[] | undefined {
    if (parent === fiber || parent === fiber.alternate) return [parent]
    // Only the committed parent's child list establishes membership in the current tree.
    // 只有已提交父节点的子节点列表能确定节点是否属于当前树。
    for (let child = parent.child; child !== null; child = child.sibling) {
      if (!candidates.has(child)) continue
      // A candidate reached from the root is committed. Verify that its branch reaches the element.
      // 从根节点走到的候选节点已提交，再确认该分支能到达目标元素。
      const path = findPath(child)
      if (path !== undefined) {
        path.push(parent)
        return path
      }
    }
    return undefined
  }

  return root === undefined ? undefined : findPath(root)
}
