// Scope the Vulcan cards and compact controls to the voice plugin and follow the active host palette.
// 将 Vulcan 卡片和紧凑控件限定在语音插件范围内，并跟随当前宿主配色。
const CSS = String.raw`
:is(.vvi-settings, .vvi-composer, .vvi-quick, .vvi-feedback) {
  --voice-ink: var(--vulcan-ink, var(--dsw-alias-label-primary));
  --voice-muted: var(--vulcan-ink-2, var(--dsw-alias-label-secondary));
  --voice-panel: var(--vulcan-panel, var(--dsw-alias-bg-layer-1));
  --voice-line: var(--vulcan-line, var(--dsw-alias-border-l3));
  --voice-focus: var(--dsw-alias-state-business-primary);
  --voice-error: var(--dsw-alias-state-error-primary);
  --voice-ember: var(--vulcan-ember, #e2511a);
  --voice-ready: #18774a;
  color: var(--voice-ink);
}
body[data-ds-dark-theme] :is(.vvi-settings, .vvi-composer, .vvi-quick, .vvi-feedback) {
  --voice-ember: var(--vulcan-ember, #ff6a2b);
  --voice-ready: #3fc48a;
  color-scheme: dark;
}
.vvi-settings { display: grid; gap: 16px; min-width: 0; padding-bottom: 8px; font-size: 13px; line-height: 1.5; }
.vvi-head h2, .vvi-card h3 { margin: 0; font-weight: 600; }
.vvi-head h2 { font-size: 16px; }
.vvi-card h3 { font-size: 14px; }
.vvi-settings p, .vvi-settings small { margin: 0; color: var(--voice-muted); }
.vvi-head p { margin-top: 4px; }
.vvi-card {
  position: relative; display: grid; gap: 10px; min-width: 0; padding: 14px 16px;
  border: 1px solid var(--voice-line); background: var(--voice-panel);
}
.vvi-card::before { position: absolute; top: -1px; left: -1px; width: 28px; height: 2px; background: var(--voice-ember); content: ''; }
.vvi-row, .vvi-state, .vvi-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.vvi-row { justify-content: space-between; gap: 10px 16px; }
.vvi-device-row { justify-content: flex-start; }
.vvi-state { color: var(--voice-muted); }
.vvi-badge {
  padding: 1px 6px; border: 1px solid var(--voice-line); color: var(--voice-muted);
  font-size: 11px; font-weight: 600;
}
.vvi-badge[data-voice-status=ready] { color: var(--voice-ready); }
.vvi-badge[data-voice-status=signed_out] { color: var(--voice-ember); }
:is(.vvi-settings, .vvi-quick) :is(button, select, input), :is(.vvi-composer, .vvi-feedback) button {
  box-sizing: border-box; min-height: 28px; padding: 3px 8px; border: 1px solid var(--voice-line);
  border-radius: 0; background: var(--voice-panel); color: var(--voice-ink); font: inherit;
}
:is(.vvi-settings, .vvi-composer, .vvi-quick, .vvi-feedback) button { cursor: pointer; }
:is(.vvi-settings, .vvi-composer, .vvi-quick, .vvi-feedback) button:hover:not(:disabled) {
  border-color: var(--voice-focus);
}
:is(.vvi-settings, .vvi-quick) :is(button, select):disabled { opacity: .6; cursor: default; }
.vvi-settings .vvi-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
:is(.vvi-settings, .vvi-quick) :is(button, select, input):focus-visible, :is(.vvi-composer, .vvi-feedback) button:focus-visible {
  outline: 2px solid var(--voice-focus); outline-offset: 2px;
}
.vvi-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 10px 14px; }
.vvi-fields > :is(label, .vvi-quick-shortcut) { display: grid; gap: 4px; min-width: 0; color: var(--voice-muted); }
.vvi-fields select, .vvi-shortcut-row input { min-width: 0; width: 100%; }
.vvi-shortcut-row { display: flex; gap: 8px; align-items: center; max-width: 380px; }
.vvi-shortcut-row button { flex: none; }
.vvi-settings .vvi-device-row select { flex: 1 1 200px; max-width: 380px; min-width: 0; }
.vvi-settings meter { display: block; width: 100%; height: 8px; border: 0; border-radius: 0; background: var(--voice-line); }
.vvi-settings meter::-webkit-meter-bar { height: 8px; border: 0; border-radius: 0; background: var(--voice-line); }
.vvi-settings meter::-webkit-meter-optimum-value { border-radius: 0; background: var(--voice-ready); }
.vvi-settings meter::-moz-meter-bar { background: var(--voice-ready); }
.vvi-settings .vvi-error { color: var(--voice-error); }
.vvi-composer { display: inline-flex; align-items: center; font-size: 12px; }
.vvi-composer .vvi-mic { display: inline-flex; align-items: center; justify-content: center; width: 28px; padding: 0; touch-action: none; }
.vvi-composer .vvi-mic[aria-pressed=true] { color: var(--voice-error); border-color: currentColor; }
.vvi-recording { display: inline-flex; align-items: center; gap: 5px; color: var(--voice-error); }
.vvi-timer { min-width: 4ch; font-variant-numeric: tabular-nums; text-align: right; }
.vvi-dot { width: 6px; height: 6px; background: currentColor; }
.vvi-notice { max-width: 18rem; color: var(--voice-muted); }
:is(.vvi-quick, .vvi-feedback) {
  position: fixed; z-index: 60; box-sizing: border-box; overflow: auto;
  border: 1px solid var(--vulcan-line-strong, var(--voice-line)); border-radius: 0;
  background: var(--voice-panel); box-shadow: var(--vulcan-shadow-2, 0 8px 24px #0003);
  font-size: 12px; line-height: 1.4;
}
.vvi-quick { width: 336px; display: grid; gap: 10px; padding: 12px; }
.vvi-feedback { width: max-content; padding: 6px 8px; }
.vvi-feedback-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; overflow-wrap: anywhere; }
.vvi-feedback-row button { flex: none; min-height: 24px; white-space: nowrap; }
.vvi-quick > .vvi-feedback-row { padding-bottom: 8px; border-bottom: 1px solid var(--voice-line); }
.vvi-quick::before { position: absolute; top: 0; left: 0; width: 28px; height: 2px; background: var(--voice-ember); content: ''; }
.vvi-quick-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.vvi-quick-head strong { font-size: 13px; font-weight: 600; }
.vvi-quick p, .vvi-quick small { margin: 0; color: var(--voice-muted); }
.vvi-quick footer { display: flex; justify-content: flex-end; border-top: 1px solid var(--voice-line); padding-top: 8px; }
`

/**
 * Mount the scoped voice styles and return a disposer for plugin reload.
 * 挂载语音模块限定样式，并返回用于插件重载的注销函数。
 */
export function installStyle(): () => void {
  const node = document.createElement('style')
  node.textContent = CSS
  document.head.append(node)
  return () => node.remove()
}
