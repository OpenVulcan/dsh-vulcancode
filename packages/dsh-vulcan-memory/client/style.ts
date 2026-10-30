/**
 * The plugin's look, after VulcanCode's ui-kit (`apps/vulcan-code-web/src/ui-kit/styles`): the
 * same `.vac` tokens and base rules as the LuaSkills plugin, plus the memory page under `vmm-*`.
 * Every rule is scoped under `.vac` or `vmm-`, so nothing leaks into dsh; dark values follow
 * dsh's `body[data-ds-dark-theme]`.
 */

const CSS = String.raw`
.vac {
  --vk-u: 4px;
  --vk-panel: #fff; --vk-sunken: #f6f7f9; --vk-hover: #eef1f4; --vk-select: #e3e9f8;
  --vk-line: #dde1e6; --vk-line-strong: #c3c9d1; --vk-line-soft: #eaecef;
  --vk-ink: #14171c; --vk-ink-2: #4a515c; --vk-ink-3: #626973;
  --vk-ember: #e2511a; --vk-signal: #2e58cc; --vk-ok: #18774a; --vk-warn: #945d09; --vk-bad: #c3303d;
  --vk-shadow-1: 0 1px 2px rgba(20, 23, 28, 0.06);
  --vk-shadow-2: 0 16px 40px rgba(20, 23, 28, 0.18), 0 2px 8px rgba(20, 23, 28, 0.08);
  --vk-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px; line-height: 1.5; color: var(--vk-ink);
}
body[data-ds-dark-theme] .vac {
  --vk-panel: #15181d; --vk-sunken: #0f1215; --vk-hover: #1e2329; --vk-select: #1c2537;
  --vk-line: #23282f; --vk-line-strong: #343b45; --vk-line-soft: #1a1e24;
  --vk-ink: #e6e9ed; --vk-ink-2: #a2aab5; --vk-ink-3: #848c97;
  --vk-ember: #ff6a2b; --vk-signal: #7d9dff; --vk-ok: #3fc48a; --vk-warn: #e0a83a; --vk-bad: #f0646f;
  --vk-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --vk-shadow-2: 0 16px 40px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4);
}
.vac *, .vac *::before, .vac *::after { box-sizing: border-box; }
.vac-page { display: flex; flex-direction: column; gap: calc(var(--vk-u) * 4); counter-reset: vac-section; padding-bottom: calc(var(--vk-u) * 2); }
.vac-page-head h2 { margin: 0; font-size: 16px; font-weight: 600; }
.vac-lead { margin: calc(var(--vk-u) * 1) 0 0; color: var(--vk-ink-2); }
.vac-hint { margin: 0; color: var(--vk-ink-3); font-size: 12px; }
.vac-error { margin: 0; color: var(--vk-bad); font-size: 12px; overflow-wrap: anywhere; }

.vac-section { position: relative; border: 1px solid var(--vk-line); background: var(--vk-panel); box-shadow: var(--vk-shadow-1); }
.vac-section::before { content: ""; position: absolute; left: -1px; top: -1px; width: calc(var(--vk-u) * 7); height: 2px; background: var(--vk-ember); }
.vac-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: calc(var(--vk-u) * 3); padding: calc(var(--vk-u) * 3.5) calc(var(--vk-u) * 4) 0; }
.vac-section-title { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); margin: 0; font-size: 15px; font-weight: 600; }
.vac-section-title::before { counter-increment: vac-section; content: counter(vac-section, decimal-leading-zero); border: 1px solid var(--vk-line); color: var(--vk-ink-3); font-family: var(--vk-mono); font-size: 10px; font-weight: 400; letter-spacing: .06em; padding: 0 5px; line-height: 16px; }
.vac-section-lead { margin: calc(var(--vk-u) * 1) 0 0; color: var(--vk-ink-3); font-size: 12px; }
.vac-section-body { display: flex; flex-direction: column; gap: calc(var(--vk-u) * 3); padding: calc(var(--vk-u) * 3) calc(var(--vk-u) * 4) calc(var(--vk-u) * 4); }
.vac-section-body.flush { padding: calc(var(--vk-u) * 3) 0 0; gap: 0; }

.vac-inline { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); flex-wrap: wrap; }
.vac-between { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--vk-u) * 3); flex-wrap: wrap; }

.vac-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 calc(var(--vk-u) * 3); border: 1px solid var(--vk-line-strong); background: var(--vk-panel); color: var(--vk-ink); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; border-radius: 0; }
.vac-btn:hover:not(:disabled) { background: var(--vk-hover); }
.vac-btn:disabled { cursor: default; opacity: .55; }
.vac-btn.sm { height: 24px; padding: 0 calc(var(--vk-u) * 2); }
.vac-btn.primary { background: var(--vk-ink); border-color: var(--vk-ink); color: var(--vk-panel); }
.vac-btn.primary:hover:not(:disabled) { background: var(--vk-ink-2); }
.vac-btn.ghost { border-color: transparent; background: transparent; }
.vac-btn.ghost:hover:not(:disabled) { background: var(--vk-hover); }
.vac-btn.danger { color: var(--vk-bad); }
.vac-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--vk-bad) 9%, transparent); }
.vac-btn:focus-visible { outline: 2px solid var(--vk-signal); outline-offset: 1px; }

.vac-badge { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border: 1px solid color-mix(in srgb, var(--tone, var(--vk-ink-3)) 32%, transparent); background: color-mix(in srgb, var(--tone, var(--vk-ink-3)) 9%, transparent); color: var(--tone, var(--vk-ink-2)); font-size: 11px; font-weight: 500; white-space: nowrap; }
.vac-badge.ok { --tone: var(--vk-ok); }
.vac-badge.warn { --tone: var(--vk-warn); }
.vac-badge.bad { --tone: var(--vk-bad); }
.vac-badge.info { --tone: var(--vk-signal); }
.vac-badge.outline { --tone: var(--vk-ink-3); background: transparent; }

.vac-alert { padding: calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 3); border: 1px solid var(--vk-line); border-left: 3px solid var(--tone, var(--vk-ink-3)); background: var(--vk-sunken); color: var(--vk-ink-2); font-size: 12px; overflow-wrap: anywhere; }
.vac-alert.warn { --tone: var(--vk-warn); }
.vac-alert.bad { --tone: var(--vk-bad); }
.vac-alert.info { --tone: var(--vk-signal); }
.vac-alert.ok { --tone: var(--vk-ok); }

/* The memory page fills dsh's main column and scrolls on its own. */
.vmm-panel { height: 100%; overflow-y: auto; background: var(--vk-sunken); }
.vmm-panel-inner { max-width: 960px; margin: 0 auto; padding: calc(var(--vk-u) * 6) calc(var(--vk-u) * 6) calc(var(--vk-u) * 8); }
.vmm-pad { padding: 0 calc(var(--vk-u) * 4) calc(var(--vk-u) * 3); }
.vmm-mono { font-family: var(--vk-mono); font-size: 11px; color: var(--vk-ink-3); overflow-wrap: anywhere; }

.vmm-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--vk-line); flex-wrap: wrap; }
.vmm-tab { height: 34px; padding: 0 calc(var(--vk-u) * 4); border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; background: transparent; color: var(--vk-ink-3); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
.vmm-tab:hover { color: var(--vk-ink); }
.vmm-tab.on { color: var(--vk-ink); border-bottom-color: var(--vk-ember); }
.vmm-tab:focus-visible, .vmm-seg:focus-visible { outline: 2px solid var(--vk-signal); outline-offset: 1px; }

.vmm-segs { display: inline-flex; }
.vmm-seg { height: 26px; padding: 0 calc(var(--vk-u) * 3); border: 1px solid var(--vk-line-strong); background: var(--vk-panel); color: var(--vk-ink-2); font: inherit; font-size: 12px; cursor: pointer; }
.vmm-seg + .vmm-seg { margin-left: -1px; }
.vmm-seg.on { border-color: var(--vk-ink); background: var(--vk-ink); color: var(--vk-panel); position: relative; }
.vmm-seg:disabled { cursor: default; opacity: .55; }

.vmm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: calc(var(--vk-u) * 3); }
.vmm-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 12px; color: var(--vk-ink-2); }
.vmm-input, .vmm-select, .vmm-textarea { border: 1px solid var(--vk-line-strong); border-radius: 0; background: var(--vk-panel); color: var(--vk-ink); font: inherit; font-size: 12px; min-width: 0; }
.vmm-input, .vmm-select { height: 28px; padding: 0 calc(var(--vk-u) * 2); }
.vmm-textarea { padding: calc(var(--vk-u) * 2); resize: vertical; line-height: 1.5; }
.vmm-textarea.file { font-family: var(--vk-mono); min-height: 360px; }
.vmm-input:focus, .vmm-select:focus, .vmm-textarea:focus { outline: 2px solid var(--vk-signal); outline-offset: -1px; }
.vmm-input[aria-invalid="true"] { border-color: var(--vk-bad); }
.vmm-check { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); font-size: 12px; color: var(--vk-ink-2); cursor: pointer; }
.vmm-check input { margin: 0; accent-color: var(--vk-ember); }

.vmm-list { margin: 0; padding: 0; list-style: none; }
.vmm-row { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--vk-u) * 3); padding: calc(var(--vk-u) * 3) calc(var(--vk-u) * 4); border-top: 1px solid var(--vk-line-soft); }
.vmm-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }

.vmm-usage { display: flex; flex-direction: column; gap: calc(var(--vk-u) * 3); }
.vmm-usage-head { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); font-size: 12px; }
.vmm-usage-head span:first-child { font-weight: 500; }
.vmm-usage-head span:nth-child(2) { color: var(--vk-ink-3); font-family: var(--vk-mono); font-size: 11px; }
.vmm-bar { position: relative; height: 4px; margin-top: 4px; overflow: hidden; background: var(--vk-line-soft); }
.vmm-bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--vk-ok); }
.vmm-bar-fill.warn { background: var(--vk-warn); }
.vmm-bar-fill.bad { background: var(--vk-bad); }

.vmm-tree { margin: 0; padding: 0; list-style: none; }
.vmm-node { padding: calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 4); border-top: 1px solid var(--vk-line-soft); }
.vmm-node[data-level="1"] { background: var(--vk-sunken); }
.vmm-node[data-level="2"] { padding-left: calc(var(--vk-u) * 8); }
.vmm-node[data-level="3"] { padding-left: calc(var(--vk-u) * 12); }
.vmm-node[data-level="4"] { padding-left: calc(var(--vk-u) * 16); }
.vmm-node-head { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); flex-wrap: wrap; }
.vmm-node-head small { color: var(--vk-ink-3); font-size: 11px; }
.vmm-node-acts { margin-left: auto; display: inline-flex; gap: 2px; }
.vmm-node-body { margin: 4px 0 0; color: var(--vk-ink-2); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }

.vmm-dialog-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: calc(var(--vk-u) * 6); background: rgba(10, 12, 15, 0.42); }
.vmm-dialog { display: flex; flex-direction: column; width: min(560px, 100%); max-height: 100%; border: 1px solid var(--vk-line); background: var(--vk-panel); box-shadow: var(--vk-shadow-2); }
.vmm-dialog.wide { width: min(820px, 100%); }
.vmm-dialog-head { padding: calc(var(--vk-u) * 4) calc(var(--vk-u) * 4) 0; }
.vmm-dialog-head h3 { margin: 0; font-size: 15px; font-weight: 600; }
.vmm-dialog-head p { margin: calc(var(--vk-u) * 1) 0 0; color: var(--vk-ink-3); font-size: 12px; }
.vmm-dialog-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: calc(var(--vk-u) * 3); padding: calc(var(--vk-u) * 4); }
.vmm-dialog-foot { display: flex; justify-content: flex-end; gap: calc(var(--vk-u) * 2); padding: calc(var(--vk-u) * 3) calc(var(--vk-u) * 4); border-top: 1px solid var(--vk-line-soft); }

.vmm-import-project { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--vk-u) * 3); padding: calc(var(--vk-u) * 2) 0; border-top: 1px solid var(--vk-line-soft); }
.vmm-import-project > div { display: flex; flex-direction: column; min-width: 0; }
.vmm-import-scope { display: flex; flex-direction: column; gap: calc(var(--vk-u) * 2); padding-top: calc(var(--vk-u) * 2); border-top: 1px solid var(--vk-line-soft); }
.vmm-import-scope h4 { margin: 0; font-size: 13px; }
.vmm-conflict { display: flex; flex-direction: column; gap: calc(var(--vk-u) * 2); padding: calc(var(--vk-u) * 2.5); border: 1px solid var(--vk-line); }
.vmm-conflict-sides { display: grid; grid-template-columns: 1fr 1fr; gap: calc(var(--vk-u) * 2); }
.vmm-conflict-side { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 12px; }
.vmm-conflict-side span { color: var(--vk-ink-3); font-size: 11px; }
.vmm-conflict-side pre { margin: 0; padding: calc(var(--vk-u) * 2); border: 1px solid var(--vk-line-soft); background: var(--vk-sunken); font-family: var(--vk-mono); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow-y: auto; }
`

/** Add the stylesheet once per page; returns a function that removes it again. */
export function installStyle(): () => void {
  const existing = document.querySelector<HTMLStyleElement>('style[data-plugin="vulcan-memory"]')
  if (existing !== null) existing.remove()
  const tag = document.createElement('style')
  tag.dataset['plugin'] = 'vulcan-memory'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
