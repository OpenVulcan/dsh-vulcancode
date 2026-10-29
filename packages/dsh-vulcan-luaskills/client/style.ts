/**
 * The plugin's look, after VulcanCode's ui-kit (`apps/vulcan-code-web/src/ui-kit/styles`): the
 * same `.vac` tokens and rules as the account plugin, plus the LuaSkills page, install progress,
 * settings groups and Hub cards under `vls-*`. Every rule is scoped under `.vac` or `vls-`, so
 * nothing leaks into dsh; dark values follow dsh's `body[data-ds-dark-theme]`.
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
.vac-link { border: 0; padding: 0; background: none; color: var(--vk-signal); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

.vac-btn:focus-visible, .vac-site:focus-visible { outline: 2px solid var(--vk-signal); outline-offset: 1px; }

.vac-badge { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border: 1px solid color-mix(in srgb, var(--tone, var(--vk-ink-3)) 32%, transparent); background: color-mix(in srgb, var(--tone, var(--vk-ink-3)) 9%, transparent); color: var(--tone, var(--vk-ink-2)); font-size: 11px; font-weight: 500; white-space: nowrap; }
.vac-badge.ok { --tone: var(--vk-ok); }
.vac-badge.warn { --tone: var(--vk-warn); }
.vac-badge.bad { --tone: var(--vk-bad); }
.vac-badge.info { --tone: var(--vk-signal); }
.vac-badge.outline { --tone: var(--vk-ink-3); background: transparent; }

.vac-alert { padding: calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 3); border: 1px solid var(--vk-line); border-left: 3px solid var(--tone, var(--vk-ink-3)); background: var(--vk-sunken); color: var(--vk-ink-2); font-size: 12px; overflow-wrap: anywhere; }
.vac-alert.warn { --tone: var(--vk-warn); }
.vac-alert.bad { --tone: var(--vk-bad); }

.vac-btn.danger { color: var(--vk-bad); }
.vac-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--vk-bad) 9%, transparent); }
.vac-alert.info { --tone: var(--vk-signal); }

/* The LuaSkills page fills dsh's main column and scrolls on its own. */
.vls-panel { height: 100%; overflow-y: auto; background: var(--vk-sunken); }
.vls-panel-inner { max-width: 960px; margin: 0 auto; padding: calc(var(--vk-u) * 6) calc(var(--vk-u) * 6) calc(var(--vk-u) * 8); }
.vls-pad { padding: 0 calc(var(--vk-u) * 4) calc(var(--vk-u) * 3); }

.vls-banner { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--vk-u) * 3); flex-wrap: wrap; padding: calc(var(--vk-u) * 3); border: 1px solid var(--vk-line); border-left: 3px solid var(--tone, var(--vk-ember)); background: var(--vk-sunken); }
.vls-banner > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.vls-banner.warn { --tone: var(--vk-warn); }
.vls-banner.bad { --tone: var(--vk-bad); }

.vls-progress { display: flex; flex-direction: column; gap: calc(var(--vk-u) * 2.5); }
.vls-bar { position: relative; height: 4px; overflow: hidden; background: var(--vk-line-soft); }
.vls-bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--vk-ember); transition: width .2s linear; }
.vls-bar-fill.indeterminate { width: 30%; animation: vls-slide 1.2s ease-in-out infinite; }
@keyframes vls-slide { from { left: -30%; } to { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .vls-bar-fill.indeterminate { animation: none; width: 100%; opacity: .5; } }
.vls-steps { display: flex; flex-wrap: wrap; gap: calc(var(--vk-u) * 1) calc(var(--vk-u) * 4); margin: 0; padding: 0; list-style: none; counter-reset: vls-step; color: var(--vk-ink-3); font-size: 12px; }
.vls-steps li { display: flex; align-items: center; gap: 6px; }
.vls-steps li::before { counter-increment: vls-step; content: counter(vls-step); display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 1px solid var(--vk-line-strong); font-family: var(--vk-mono); font-size: 10px; }
.vls-steps li.done { color: var(--vk-ink-2); }
.vls-steps li.done::before { content: "\2713"; border-color: var(--vk-ok); color: var(--vk-ok); }
.vls-steps li.now { color: var(--vk-ink); font-weight: 500; }
.vls-steps li.now::before { border-color: var(--vk-ember); color: var(--vk-ember); }

.vls-group { display: flex; flex-direction: column; gap: calc(var(--vk-u) * 2.5); margin: 0; padding: calc(var(--vk-u) * 3); border: 1px solid var(--vk-line-soft); min-width: 0; }
.vls-group:disabled { opacity: .6; }
.vls-group legend { padding: 0 calc(var(--vk-u) * 1); font-size: 12px; font-weight: 600; color: var(--vk-ink-2); }
.vls-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: calc(var(--vk-u) * 3); }
.vls-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 12px; color: var(--vk-ink-2); }
.vls-field.wide { grid-column: 1 / -1; }
.vls-input { height: 28px; padding: 0 calc(var(--vk-u) * 2); border: 1px solid var(--vk-line-strong); border-radius: 0; background: var(--vk-panel); color: var(--vk-ink); font: inherit; font-size: 12px; min-width: 0; }
.vls-input:focus { outline: 2px solid var(--vk-signal); outline-offset: -1px; }
.vls-input:disabled { background: var(--vk-sunken); color: var(--vk-ink-3); }
.vls-check { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); font-size: 12px; color: var(--vk-ink-2); cursor: pointer; }
.vls-check input { margin: 0; accent-color: var(--vk-ember); }

.vls-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--vk-line); }
.vls-tab { height: 34px; padding: 0 calc(var(--vk-u) * 4); border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; background: transparent; color: var(--vk-ink-3); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
.vls-tab:hover { color: var(--vk-ink); }
.vls-tab.on { color: var(--vk-ink); border-bottom-color: var(--vk-ember); }
.vls-seg { height: 24px; padding: 0 calc(var(--vk-u) * 2.5); border: 1px solid var(--vk-line-strong); background: var(--vk-panel); color: var(--vk-ink-2); font: inherit; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; }
.vls-seg + .vls-seg { margin-left: calc(var(--vk-u) * -2 - 1px); }
.vls-seg.on { border-color: var(--vk-ink); background: var(--vk-ink); color: var(--vk-panel); }
.vls-seg:disabled { cursor: default; opacity: .55; }
.vls-tab:focus-visible, .vls-seg:focus-visible, .vac-link:focus-visible { outline: 2px solid var(--vk-signal); outline-offset: 1px; }

.vls-list { margin: 0; padding: 0; list-style: none; }
.vls-row { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--vk-u) * 3); padding: calc(var(--vk-u) * 3) calc(var(--vk-u) * 4); border-top: 1px solid var(--vk-line-soft); }
.vls-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.vls-row-main .vac-hint { overflow-wrap: anywhere; }
.vls-tools { margin: 0; color: var(--vk-ink-3); font-size: 11px; overflow-wrap: anywhere; }

.vls-search { width: 100%; height: 32px; font-size: 13px; }
.vls-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: calc(var(--vk-u) * 2.5); margin: 0; padding: 0; list-style: none; }
.vls-card { display: flex; flex-direction: column; gap: calc(var(--vk-u) * 1.5); padding: calc(var(--vk-u) * 3); border: 1px solid var(--vk-line); background: var(--vk-panel); min-width: 0; }
.vls-card:hover { border-color: var(--vk-line-strong); }
.vls-card .vac-hint { overflow-wrap: anywhere; }
.vls-summary { margin: 0; color: var(--vk-ink-2); font-size: 12px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

.vls-sheet { position: fixed; top: 0; right: 0; bottom: 0; z-index: 50; display: flex; flex-direction: column; width: min(560px, 100vw); border-left: 1px solid var(--vk-line); background: var(--vk-panel); box-shadow: var(--vk-shadow-2); }
.vls-sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: calc(var(--vk-u) * 3); padding: calc(var(--vk-u) * 4); border-bottom: 1px solid var(--vk-line); }
.vls-sheet-head strong { font-size: 15px; }
.vls-sheet-body { flex: 1; overflow-y: auto; padding: calc(var(--vk-u) * 4); display: flex; flex-direction: column; gap: calc(var(--vk-u) * 2); }
.vls-sheet-body h4 { margin: calc(var(--vk-u) * 2) 0 0; font-size: 13px; }
.vls-sheet-body p, .vls-sheet-body ul { margin: 0; color: var(--vk-ink-2); }
.vls-readme { margin: 0; padding: calc(var(--vk-u) * 3); border: 1px solid var(--vk-line-soft); background: var(--vk-sunken); font-family: var(--vk-mono); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
`

/** Add the stylesheet once per page; returns a function that removes it again. */
export function installStyle(): () => void {
  const existing = document.querySelector<HTMLStyleElement>('style[data-plugin="vulcan-luaskills"]')
  if (existing !== null) existing.remove()
  const tag = document.createElement('style')
  tag.dataset['plugin'] = 'vulcan-luaskills'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
