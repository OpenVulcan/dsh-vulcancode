import { PACKAGE_NAME } from './shared'

// Use dsh's colors so the editor follows both Vulcan and native themes.
// 使用 dsh 的颜色，使编辑器同时适配 Vulcan 主题和原生主题。
const CSS = `
.vrs { min-width: 0; color: var(--dsw-alias-label-primary); font-size: 13px; }
.vrs > summary { cursor: pointer; width: fit-content; color: var(--dsw-alias-label-secondary); }
.vrs > summary:focus-visible, .vrs :is(button,input,select):focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.vrs-form, .vrs-fields, .vrs-levels { display: grid; gap: 10px; min-width: 0; }
.vrs-form { margin-top: 10px; }
.vrs-fields { padding: 0; margin: 0; border: 0; }
.vrs-control { display: grid; gap: 4px; min-width: 0; }
.vrs-control select, .vrs-level input[type="text"] { box-sizing: border-box; min-width: 0; width: 100%; padding: 5px 8px; color: inherit; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); font: inherit; }
.vrs-level { display: grid; grid-template-columns: minmax(5rem, 1fr) minmax(0, 2fr); align-items: center; gap: 8px; }
.vrs-level label { display: flex; align-items: center; gap: 6px; }
.vrs-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.vrs button { padding: 5px 10px; font: inherit; cursor: pointer; color: inherit; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); }
.vrs button[type="submit"] { color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-primary-fill); }
.vrs :is(button,input,select):disabled { opacity: .6; cursor: default; }
.vrs p { margin: 0; overflow-wrap: anywhere; }
.vrs-hint { color: var(--dsw-alias-label-secondary); }
.vrs-error { color: var(--dsw-alias-state-error-primary); }
`

/**
 * Mount the editor's stylesheet and return a disposer for the mounted node.
 * 挂载编辑器样式表，并返回用于移除该节点的清理函数。
 */
export function installStyle(): () => void {
  // The stylesheet belongs to the loaded plugin's lifetime.
  // 样式表的生命周期与插件加载周期一致。
  const tag = document.createElement('style')
  tag.dataset['plugin'] = PACKAGE_NAME
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
