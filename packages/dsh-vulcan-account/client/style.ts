/**
 * The plugin's look, after VulcanCode's ui-kit (`apps/vulcan-code-web/src/ui-kit/styles`): square
 * corners, hairline borders, numbered sections with an ember corner tick, tinted badges and plain
 * tables, for the account page. Every rule is scoped under `.vac`, so nothing leaks into dsh; dark values follow dsh's
 * `body[data-ds-dark-theme]`.
 */

const CSS = `
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

.vac-sites { display: grid; grid-template-columns: 1fr 1fr; gap: calc(var(--vk-u) * 2); }
.vac-site { display: flex; flex-direction: column; gap: 2px; padding: calc(var(--vk-u) * 3); border: 1px solid var(--vk-line); background: var(--vk-panel); text-align: left; color: inherit; font: inherit; cursor: pointer; }
.vac-site:hover:not(:disabled) { background: var(--vk-hover); border-color: var(--vk-line-strong); }
.vac-site:disabled { cursor: default; opacity: .6; }
.vac-site strong { font-weight: 600; }
.vac-site span { color: var(--vk-ink-3); font-family: var(--vk-mono); font-size: 12px; }

.vac-mono { font-family: var(--vk-mono); }

.vac-between > .vac-hint:last-child { font-variant-numeric: tabular-nums; }

/* Sidebar foot row, above Settings: dsh's own sidebar colours and the Settings trigger's inset. */
.vac-foot {
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; height: 40px; margin: 4px 0 0;
  padding: 0 calc(var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px));
  border: none; border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent; background: transparent; background-clip: padding-box;
  border-radius: var(--dsw-radius-md, 0); box-sizing: border-box;
  color: var(--dsw-alias-label-primary, #14171c); font-family: inherit; font-size: 13px; line-height: 18px; text-align: left;
}
button.vac-foot { cursor: pointer; }
.vac-foot.rail { position: relative; flex: none; width: 36px; height: 36px; margin: 0; padding: 0; justify-content: center; border-inline: 0; }
@media (hover: hover) {
  button.vac-foot:hover, .vac-foot-home:hover { background-color: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
}
.vac-foot-home { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 100%; margin: 0 0 0 -6px; padding: 0 6px; border: none; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: var(--dsw-radius-sm, 0); }
.vac-foot-mark { flex: none; width: 16px; height: 18px; }
.vac-foot-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.vac-foot-name, .vac-foot-sub { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.vac-foot-name { font-weight: 500; }
.vac-foot-sub { color: var(--dsw-alias-label-tertiary, #626973); font-size: 11px; line-height: 14px; }
.vac-foot-sub.warn { color: #c2410c; }
.vac-foot-plan {
  flex: none; padding: 0 5px; border: 1px solid color-mix(in srgb, #e2511a 40%, transparent); color: #e2511a;
  font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; line-height: 16px; letter-spacing: .06em; text-transform: uppercase;
}
.vac-foot-actions { display: flex; flex: none; gap: 4px; }
.vac-foot-chip {
  display: inline-flex; align-items: center; height: 22px; padding: 0 7px; border: 1px solid var(--dsw-alias-border-l2, #dde1e6);
  background: transparent; color: var(--dsw-alias-label-secondary, #4a515c); font: inherit; font-size: 11px; text-decoration: none; cursor: pointer; white-space: nowrap;
}
.vac-foot-chip:hover:not(:disabled) { border-color: #e2511a; color: #e2511a; }
.vac-foot-chip:disabled { cursor: default; opacity: .55; }
.vac-foot-dot { position: absolute; right: 7px; bottom: 7px; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary, #18a058); box-shadow: 0 0 0 2px var(--dsw-specific-sidebar-fill, #fff); }
.vac-foot:focus-visible, .vac-foot-home:focus-visible, .vac-foot-chip:focus-visible { outline: 2px solid #2e58cc; outline-offset: -2px; }
`

/** Add the stylesheet once per page; returns a function that removes it again. */
export function installStyle(): () => void {
  const existing = document.querySelector<HTMLStyleElement>('style[data-plugin="openvulcan-account"]')
  if (existing !== null) existing.remove()
  const tag = document.createElement('style')
  tag.dataset['plugin'] = 'openvulcan-account'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
