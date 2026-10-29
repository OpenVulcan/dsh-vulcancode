/**
 * The components' look, after VulcanCode's ui-kit answer styles (`apps/vulcan-code-web/src/ui-kit/styles/
 * {answer,answer-math,prose}.css`): square corners, hairline frames with an ember corner tick, tinted badges
 * and plain tables. Neutral surfaces, lines and text take dsh's `--dsw-*` theme tokens, so the components
 * follow dsh's light and dark themes; the literal after each token is only a fallback. Every rule is scoped
 * under `.vda` (components) or `.vda-mode` (the composer pill), so nothing leaks into dsh.
 */

const TOKENS = `
  --vk-u: 4px;
  --vk-panel: var(--dsw-alias-bg-layer-1, #fff);
  --vk-raised: var(--dsw-alias-bg-layer-2, #fff);
  --vk-sunken: var(--dsw-alias-bg-module-platform, #f6f7f9);
  --vk-hover: var(--dsw-alias-interactive-bg-hover, #eef1f4);
  --vk-line-soft: var(--dsw-alias-border-l1, #eaecef);
  --vk-line: var(--dsw-alias-border-l2, #dde1e6);
  --vk-line-strong: var(--dsw-alias-border-l3, #c3c9d1);
  --vk-ink: var(--dsw-alias-label-primary, #14171c);
  --vk-ink-2: var(--dsw-alias-label-secondary, #4a515c);
  --vk-ink-3: var(--dsw-alias-label-tertiary, #626973);
  --vk-ink-inverse: var(--dsw-alias-label-primary-foreground, #fff);
  --vk-ok: var(--dsw-alias-state-success-primary, #18774a);
  --vk-warn: var(--dsw-alias-state-warn-primary, #945d09);
  --vk-bad: var(--dsw-alias-state-error-primary, #c3303d);
  --vk-info: var(--dsw-alias-link, #2e58cc);
  --vk-signal: var(--dsw-alias-link, #2e58cc);
  --vk-signal-soft: color-mix(in srgb, var(--vk-signal) 9%, var(--vk-panel));
  --vk-ember: #e2511a;
  --vk-code-bg: var(--dsw-alias-markdown-inline-code, #f1f3f5);
  --vk-font-mono: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  --vk-fs-xs: 11px; --vk-fs-sm: 12px; --vk-fs-md: 13px; --vk-fs-read: 14px; --vk-fs-xl: 20px;
  --vk-tick-w: 28px; --vk-tick-h: 2px;
  --vk-shadow-1: 0 1px 2px rgba(20, 23, 28, 0.06);
  --vk-shadow-2: 0 16px 40px rgba(20, 23, 28, 0.18), 0 2px 8px rgba(20, 23, 28, 0.08);
  --vk-t-fast: 120ms;
`

const DARK_TOKENS = `
  --vk-ember: #ff6a2b;
  --vk-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --vk-shadow-2: 0 16px 40px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4);
`

const CSS = `
[data-vulcan-answer-hidden] { display: none !important; }
[data-vulcan-answer] { margin: 0 0 0.75em; }
[data-vulcan-answer]:last-child { margin-bottom: 0; }

.vda, .vda-mode {${TOKENS}}
body[data-ds-dark-theme] :is(.vda, .vda-mode) {${DARK_TOKENS}}
.vda {
  /* Chart series palette; its length matches ANSWER_CHART_MAX_SERIES. */
  --vda-series-1: var(--dsw-static-blue-500, #3b6fe0);
  --vda-series-2: var(--dsw-static-amber-500, #d99011);
  --vda-series-3: var(--dsw-static-green-500, #2f9e66);
  --vda-series-4: var(--dsw-static-red-400, #e5646e);
  --vda-series-5: var(--dsw-static-blue-300, #8eaaf0);
  --vda-series-6: color-mix(in srgb, var(--vda-series-3) 55%, var(--vda-series-4));
  --vda-series-7: color-mix(in srgb, var(--vda-series-2) 50%, var(--vda-series-5));
  --vda-series-8: var(--vk-ink-3);
  --vda-ground: var(--vk-panel);
  color: var(--vk-ink);
  font-size: var(--vk-fs-read);
  line-height: 1.6;
}
.vda *, .vda *::before, .vda *::after { box-sizing: border-box; border-radius: 0; }
.vda :is(p, ul, ol, dl, figure) { margin-top: 0; }
.vda :is(.vda-details-body, .vda-tabpanel, .vda-columns section, .vda-callout > div) > :last-child { margin-bottom: 0; }
.vda :is(.vda-checklist, .vda-steps, .vda-timeline, .vda-tree, .vda-files ul) { margin: 0; padding: 0; list-style: none; }
.vda :is(.vda-checklist, .vda-steps, .vda-timeline, .vda-tree, .vda-files ul) li { margin: 0; }

/* Component tones: severities, statuses and callout tones resolve onto one tone variable. */
.vda :is([data-tone="high"], [data-tone="no"], [data-tone="danger"]) { --vk-tone: var(--vk-bad); }
.vda :is([data-tone="medium"], [data-tone="warn"], [data-tone="warning"]) { --vk-tone: var(--vk-warn); }
.vda :is([data-tone="ok"], [data-tone="success"]) { --vk-tone: var(--vk-ok); }
.vda [data-tone="info"] { --vk-tone: var(--vk-info); }
.vda [data-tone="low"] { --vk-tone: var(--vk-ink-3); }

/* ---------- Frame, table, badge and controls ---------- */
.vda-figure { position: relative; max-width: 100%; overflow: hidden; border: 1px solid var(--vk-line); background: var(--vk-panel); box-shadow: var(--vk-shadow-1); }
.vda-figure::after { content: ""; position: absolute; top: 0; left: 0; z-index: 1; width: var(--vk-tick-w); height: var(--vk-tick-h); background: var(--vk-ember); opacity: 0.8; pointer-events: none; }
.vda-figure-head { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--vk-u) * 2.5); min-height: calc(var(--vk-u) * 8); padding: 0 calc(var(--vk-u) * 1.5) 0 calc(var(--vk-u) * 3); border-bottom: 1px solid var(--vk-line-soft); color: var(--vk-ink-3); font-size: var(--vk-fs-sm); }
.vda-figure-label { display: inline-flex; align-items: center; gap: calc(var(--vk-u) * 2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vda-figure-label strong { color: var(--vk-ink); font-weight: 600; }
.vda-figure-actions { display: inline-flex; flex: none; align-items: center; gap: 2px; }
.vda-figure-hover { position: absolute; top: var(--vk-u); right: var(--vk-u); z-index: 2; display: inline-flex; border: 1px solid var(--vk-line); background: var(--vk-raised); box-shadow: var(--vk-shadow-1); opacity: 0; transition: opacity var(--vk-t-fast); }
.vda-figure:hover > .vda-figure-hover, .vda-figure-hover:focus-within { opacity: 1; }
.vda-table-wrap { max-width: 100%; overflow-x: auto; }
.vda-table { width: 100%; margin: 0; border-collapse: collapse; font-size: var(--vk-fs-md); line-height: 1.5; }
.vda-table th { padding: calc(var(--vk-u) * 1.75) calc(var(--vk-u) * 3); border-bottom: 1px solid var(--vk-line); background: var(--vk-sunken); color: var(--vk-ink-2); font-size: var(--vk-fs-sm); font-weight: 600; text-align: start; white-space: nowrap; }
.vda-table td { padding: calc(var(--vk-u) * 2) calc(var(--vk-u) * 3); border-bottom: 1px solid var(--vk-line-soft); vertical-align: top; }
.vda-table tbody tr:last-child td { border-bottom: 0; }
.vda-table [data-numeric] { text-align: end; font-variant-numeric: tabular-nums; }
.vda-table-index { width: 1%; color: var(--vk-ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.vda-compare td:first-child { color: var(--vk-ink); font-weight: 600; }
.vda-badge { display: inline-flex; align-items: center; gap: var(--vk-u); padding: 0 calc(var(--vk-u) * 1.5); border: 1px solid color-mix(in srgb, var(--vk-tone, var(--vk-ink-3)) 35%, var(--vk-line)); background: color-mix(in srgb, var(--vk-tone, var(--vk-ink-3)) 10%, var(--vk-panel)); color: var(--vk-tone, var(--vk-ink-2)); font-size: var(--vk-fs-xs); font-weight: 600; line-height: 18px; white-space: nowrap; }
.vda-icon-button { display: inline-grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: var(--vk-ink-3); cursor: pointer; }
.vda-icon-button:hover { background: var(--vk-hover); color: var(--vk-ink); }
.vda-icon-button:focus-visible, .vda-button:focus-visible, .vda-seg > button:focus-visible { outline: 2px solid var(--vk-signal); outline-offset: 1px; }
.vda-seg { display: inline-flex; border: 1px solid var(--vk-line); }
.vda-seg > button { height: 20px; padding: 0 calc(var(--vk-u) * 2); border: 0; background: transparent; color: var(--vk-ink-3); font: inherit; font-size: var(--vk-fs-xs); cursor: pointer; }
.vda-seg > button + button { border-left: 1px solid var(--vk-line); }
.vda-seg > button[aria-pressed="true"] { background: var(--vk-sunken); color: var(--vk-ink); font-weight: 600; }
.vda-button { display: inline-flex; align-items: center; gap: calc(var(--vk-u) * 1.5); height: 28px; padding: 0 calc(var(--vk-u) * 3); border: 1px solid var(--vk-line-strong); background: var(--vk-panel); color: var(--vk-ink); font: inherit; font-size: var(--vk-fs-md); cursor: pointer; }
.vda-button:hover { background: var(--vk-hover); }
.vda-button[data-variant="primary"] { border-color: var(--vk-ink); background: var(--vk-ink); color: var(--vk-ink-inverse); }
.vda-button[data-variant="primary"]:hover { opacity: 0.88; }

/* ---------- Shared marks ---------- */
.vda-titled { display: grid; }
.vda-heading { display: block; margin-bottom: var(--vk-u); color: var(--vk-ink-2); font-size: var(--vk-fs-sm); font-weight: 600; }
.vda-tone-icon { display: inline-block; width: 0.9rem; height: 0.9rem; margin-inline-end: calc(var(--vk-u) * 1.5); color: var(--vk-tone); vertical-align: -0.15em; }
.vda-badge .vda-tone-icon { margin-inline-end: 0; }
.vda-path { padding: 0 calc(var(--vk-u) * 1.5); border: 1px solid var(--vk-line-soft); background: var(--vk-code-bg); color: var(--vk-ink); font-family: var(--vk-font-mono); font-size: var(--vk-fs-sm); overflow-wrap: anywhere; }
.vda-delta { font-family: var(--vk-font-mono); font-size: var(--vk-fs-sm); font-weight: 600; white-space: nowrap; }
.vda-delta > .vda-add { color: var(--vk-ok); }
.vda-delta > .vda-del { margin-inline-start: calc(var(--vk-u) * 1.5); color: var(--vk-bad); }

/* ---------- Metrics ---------- */
.vda-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr)); gap: calc(var(--vk-u) * 2); }
.vda-metric { position: relative; display: grid; gap: 2px; padding: calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 3); border: 1px solid var(--vk-line); border-top: 2px solid var(--vk-tone, color-mix(in srgb, var(--vk-ember) 75%, var(--vk-line-strong))); background: linear-gradient(180deg, color-mix(in srgb, var(--vk-tone, var(--vk-ember)) 7%, var(--vk-panel)), var(--vk-panel) 70%); box-shadow: var(--vk-shadow-1); }
.vda-metric > b { color: var(--vk-tone, var(--vk-ink)); font-size: var(--vk-fs-xl); font-weight: 650; line-height: 1.25; font-variant-numeric: tabular-nums; }
.vda-metric > b small { margin-inline-start: var(--vk-u); color: var(--vk-ink-3); font-size: var(--vk-fs-sm); font-weight: 500; }
.vda-metric > span { color: var(--vk-ink-2); font-size: var(--vk-fs-sm); }
.vda-meter-row { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); margin-top: calc(var(--vk-u) * 1.5); }
.vda-meter { flex: 1; height: 4px; overflow: hidden; background: var(--vk-sunken); box-shadow: inset 0 0 0 1px var(--vk-line-soft); }
.vda-meter > i { display: block; height: 100%; background: var(--vk-tone, var(--vk-ember)); }
.vda-metric[data-over] { --vk-tone: var(--vk-bad); }
.vda-meter-over { color: var(--vk-bad); font-size: var(--vk-fs-xs); font-weight: 600; white-space: nowrap; }

/* ---------- Callout ---------- */
.vda-callout { --vk-tone: var(--vk-info); display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px calc(var(--vk-u) * 2.5); padding: calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 3); border-left: 2px solid var(--vk-tone); background: linear-gradient(90deg, color-mix(in srgb, var(--vk-tone) 10%, transparent), color-mix(in srgb, var(--vk-tone) 3%, transparent)); }
.vda-callout[data-tone="info"] { --vk-tone: var(--vk-info); }
.vda-callout-icon { width: 1rem; height: 1rem; margin-top: 0.3em; color: var(--vk-tone); }
.vda-callout strong:first-child { display: block; }

/* ---------- Key-value ---------- */
.vda-kv { position: relative; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0 calc(var(--vk-u) * 4.5); margin: 0; padding-inline-start: calc(var(--vk-u) * 3.5); border-inline-start: var(--vk-tick-h) solid var(--vk-line); font-size: var(--vk-fs-md); }
.vda-kv::before { content: ""; position: absolute; top: 0; left: calc(var(--vk-tick-h) * -1); width: var(--vk-tick-h); height: var(--vk-tick-w); background: var(--vk-ember); opacity: 0.8; }
.vda-kv :is(dt, dd) { margin: 0; padding: calc(var(--vk-u) * 1.25) 0; border-bottom: 1px solid var(--vk-line-soft); }
.vda-kv dt { color: var(--vk-ink-3); font-size: var(--vk-fs-sm); letter-spacing: 0.02em; }

/* ---------- Checklist ---------- */
.vda-checklist li { display: grid; grid-template-columns: 1.125rem minmax(0, 1fr); gap: 0 calc(var(--vk-u) * 2.5); padding: var(--vk-u) 0; }
.vda-status { display: grid; place-items: center; width: 1.125rem; height: 1.125rem; margin-top: 0.3em; border: 1px solid var(--vk-tone, var(--vk-line-strong)); background: color-mix(in srgb, var(--vk-tone, transparent) 12%, transparent); color: var(--vk-tone); font-size: var(--vk-fs-xs); font-weight: 700; line-height: 1; }
.vda-status[data-status="ok"] { --vk-tone: var(--vk-ok); }
.vda-status[data-status="no"] { --vk-tone: var(--vk-bad); }
.vda-status[data-status="warn"] { --vk-tone: var(--vk-warn); }
.vda-checklist li[data-status="todo"] > span:nth-child(2) { color: var(--vk-ink-2); }
.vda-checklist small { grid-column: 2; color: var(--vk-ink-3); font-size: var(--vk-fs-md); }

/* ---------- Steps ---------- */
.vda-steps li { position: relative; display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap: 0 calc(var(--vk-u) * 3); padding-bottom: calc(var(--vk-u) * 3.5); }
.vda-steps li:last-child { padding-bottom: 0; }
.vda-steps li:not(:last-child)::before { content: ""; position: absolute; top: 1.625rem; bottom: 2px; left: calc(0.75rem - 1px); width: 2px; background: linear-gradient(180deg, var(--vk-line-strong), var(--vk-line)); }
.vda-steps li[data-status="done"]:not(:last-child)::before { background: color-mix(in srgb, var(--vk-ok) 50%, var(--vk-line)); }
.vda-step-number { display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border: 1px solid var(--vk-line-strong); background: var(--vk-panel); color: var(--vk-ink-3); font-family: var(--vk-font-mono); font-size: var(--vk-fs-sm); font-weight: 600; }
.vda-steps li[data-status="done"] .vda-step-number { border-color: var(--vk-ok); background: var(--vk-ok); color: var(--vk-ink-inverse); }
.vda-steps li[data-status="now"] .vda-step-number { border-color: var(--vk-ember); color: var(--vk-ember); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vk-ember) 16%, transparent); }
.vda-steps b { display: block; font-weight: 600; line-height: 1.5rem; }
.vda :is(.vda-steps, .vda-timeline) p { margin: 0; color: var(--vk-ink-2); font-size: var(--vk-fs-md); }

/* ---------- Timeline ---------- */
.vda-timeline li { display: grid; grid-template-columns: minmax(3.5rem, max-content) 0.75rem minmax(0, 1fr); gap: 0 calc(var(--vk-u) * 2.5); padding-bottom: calc(var(--vk-u) * 2.5); }
.vda-timeline time { color: var(--vk-ink-3); font-family: var(--vk-font-mono); font-size: var(--vk-fs-sm); font-weight: 600; line-height: 1.5rem; text-align: end; }
.vda-timeline-dot { position: relative; }
.vda-timeline-dot::before { content: ""; position: absolute; top: calc(0.75rem - 3.5px); left: calc(0.375rem - 3.5px); width: 7px; height: 7px; background: var(--vk-ember); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vk-ember) 15%, transparent); }
.vda-timeline li:not(:last-child) .vda-timeline-dot::after { content: ""; position: absolute; top: calc(0.75rem + 7px); bottom: calc(var(--vk-u) * -3); left: calc(0.375rem - 0.5px); width: 1px; background: linear-gradient(180deg, color-mix(in srgb, var(--vk-ember) 45%, var(--vk-line)), var(--vk-line)); }

/* ---------- Files ---------- */
.vda-files li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: calc(var(--vk-u) * 2.5); padding: calc(var(--vk-u) * 1.75) calc(var(--vk-u) * 3); border-top: 1px solid var(--vk-line-soft); font-size: var(--vk-fs-md); }
.vda-files li:first-child { border-top: 0; }
.vda-files-path { min-width: 0; overflow: hidden; }
.vda-files-path .vda-path { padding: 0; border: 0; background: transparent; }
.vda-files-path small { margin-inline-start: calc(var(--vk-u) * 2.5); color: var(--vk-ink-3); }

/* ---------- Cards ---------- */
.vda-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13.75rem), 1fr)); gap: calc(var(--vk-u) * 2); }
.vda-card { position: relative; display: grid; align-content: start; gap: var(--vk-u); padding: calc(var(--vk-u) * 3) calc(var(--vk-u) * 3.5); border: 1px solid var(--vk-line); background: linear-gradient(180deg, color-mix(in srgb, var(--vk-ember) 5%, var(--vk-panel)), var(--vk-panel) calc(var(--vk-u) * 14)); box-shadow: var(--vk-shadow-1); }
.vda-card:hover { border-color: var(--vk-line-strong); }
.vda-card header { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--vk-u) * 2); }
.vda-card strong { font-weight: 600; }
.vda-card p { margin: 0; color: var(--vk-ink-2); font-size: var(--vk-fs-md); }
:is(.vda-card, .vda-details, .vda-columns section, .vda-math)::before { content: ""; position: absolute; top: -1px; left: -1px; width: var(--vk-tick-w); height: var(--vk-tick-h); background: var(--vk-ember); opacity: 0.8; pointer-events: none; }

/* ---------- Tree ---------- */
.vda ul.vda-tree { padding: calc(var(--vk-u) * 2) calc(var(--vk-u) * 3.5) calc(var(--vk-u) * 2.5); font-size: var(--vk-fs-md); }
.vda .vda-tree ul { margin: 0 0 0 calc(var(--vk-u) * 1.5); padding: 0 0 0 calc(var(--vk-u) * 4.5); border-inline-start: 1px solid var(--vk-line); list-style: none; }
.vda-tree li { padding: 2px 0; }
.vda-tree-label { font-family: var(--vk-font-mono); font-size: var(--vk-fs-sm); }
.vda-tree small { margin-inline-start: calc(var(--vk-u) * 2); color: var(--vk-ink-3); }
.vda-tree li[data-mark="add"] > .vda-tree-label { color: var(--vk-ok); }
.vda-tree li[data-mark="add"] > .vda-tree-label::before { content: "+ "; font-weight: 700; }
.vda-tree li[data-mark="del"] > .vda-tree-label { color: var(--vk-bad); text-decoration: line-through; }
.vda-tree li[data-mark="chg"] > .vda-tree-label { color: var(--vk-warn); }
.vda-tree li[data-mark="chg"] > .vda-tree-label::before { content: "~ "; font-weight: 700; }

/* ---------- Details, tabs and columns ---------- */
.vda-details { position: relative; border: 1px solid var(--vk-line); background: var(--vk-panel); box-shadow: var(--vk-shadow-1); }
.vda-details summary { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); padding: calc(var(--vk-u) * 2) calc(var(--vk-u) * 3); font-size: var(--vk-fs-md); font-weight: 600; list-style: none; cursor: pointer; }
.vda-details summary::-webkit-details-marker { display: none; }
.vda-details summary::before { content: ""; width: 0.4rem; height: 0.4rem; border: solid var(--vk-ink-3); border-width: 0 1.5px 1.5px 0; transform: rotate(-45deg); transition: transform var(--vk-t-fast); }
.vda-details[open] summary::before { transform: rotate(45deg); }
.vda-details[open] > summary { margin-bottom: calc(var(--vk-u) * 2); border-bottom: 1px solid var(--vk-line-soft); }
.vda-details summary:hover { background: var(--vk-hover); }
.vda-details-body { padding: 0 calc(var(--vk-u) * 3) calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 7.5); }
.vda-tablist { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--vk-line); }
.vda-tablist button { margin-bottom: -1px; padding: calc(var(--vk-u) * 1.5) calc(var(--vk-u) * 3); border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--vk-ink-2); font: inherit; font-size: var(--vk-fs-md); cursor: pointer; }
.vda-tablist button:hover { color: var(--vk-ink); }
.vda-tablist button[aria-selected="true"] { border-bottom-color: var(--vk-ember); color: var(--vk-ink); font-weight: 600; }
.vda-tabpanel { padding-top: calc(var(--vk-u) * 2.5); }
.vda-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: calc(var(--vk-u) * 4); }
.vda-columns section { position: relative; padding-top: calc(var(--vk-u) * 2); border-top: 2px solid var(--vk-line-strong); }
.vda-columns section::before { top: -2px; left: 0; }
.vda-columns h4 { margin: 0 0 var(--vk-u); font-size: var(--vk-fs-read); font-weight: 600; }

/* ---------- Chart ---------- */
.vda-chart-body { padding: 2px calc(var(--vk-u) * 3.5) calc(var(--vk-u) * 3); }
.vda-chart-body .vda-table-wrap { margin: 0 calc(var(--vk-u) * -3.5) calc(var(--vk-u) * -3); }
.vda-chart-svg { display: block; width: 100%; height: auto; }
.vda-chart-body text { fill: var(--vk-ink-3); font-family: var(--vk-font-mono); font-size: var(--vk-fs-xs); }
.vda-chart-grid { stroke: var(--vk-line); stroke-dasharray: 3 3; }
.vda-chart-axis { stroke: var(--vk-line-strong); }
.vda-chart-point { stroke: var(--vk-panel); stroke-width: 1.5; }
.vda-chart-body .vda-chart-total { fill: var(--vk-ink); font-family: inherit; font-size: var(--vk-fs-read); font-weight: 650; }
.vda .vda-chart-legend { display: flex; flex-wrap: wrap; gap: var(--vk-u) calc(var(--vk-u) * 3.5); margin: 0 0 var(--vk-u); padding: 0; color: var(--vk-ink-2); font-size: var(--vk-fs-sm); list-style: none; }
.vda .vda-chart-legend li { margin: 0; }
.vda-chart-legend i { display: inline-block; width: 9px; height: 9px; margin-inline-end: calc(var(--vk-u) * 1.5); }
.vda .vda-chart-legend[data-layout="column"] { flex-direction: column; gap: calc(var(--vk-u) * 1.5); }
.vda-chart-legend b { margin-inline-start: calc(var(--vk-u) * 1.5); color: var(--vk-ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.vda-chart-circular { display: flex; flex-wrap: wrap; align-items: center; gap: calc(var(--vk-u) * 3) calc(var(--vk-u) * 7); }
.vda-chart-circular svg { flex: none; width: 150px; }

/* ---------- Layered diagrams (flow and entity) ---------- */
.vda-diagram { --vda-stroke: color-mix(in srgb, var(--vk-ink) 52%, var(--vk-line)); --vda-edge: var(--vk-ink-3); }
.vda-diagram-scroll { overflow-x: auto; padding: calc(var(--vk-u) * 3.5) calc(var(--vk-u) * 3); }
.vda-diagram svg { display: block; width: var(--vda-diagram-width); min-width: min(var(--vda-diagram-width), 520px); max-width: 100%; height: auto; margin: 0 auto; overflow: visible; font-family: inherit; }
.vda-diagram-legend { display: flex; flex-wrap: wrap; gap: var(--vk-u) calc(var(--vk-u) * 3.5); padding: calc(var(--vk-u) * 2) calc(var(--vk-u) * 3) 0; color: var(--vk-ink-3); font-size: var(--vk-fs-xs); }
.vda-diagram-legend span { display: inline-flex; align-items: center; gap: calc(var(--vk-u) * 1.5); }
.vda-diagram-legend i { width: 14px; height: 9px; border: 1.5px solid var(--vda-mark); background: var(--vda-mark-tint); }
.vda-diagram-legend [data-mark="del"] i { border-style: dashed; }
.vda-diagram [data-mark="add"] { --vda-mark: var(--vk-ok); --vda-mark-tint: color-mix(in srgb, var(--vk-ok) 11%, var(--vk-panel)); }
.vda-diagram [data-mark="chg"] { --vda-mark: var(--vk-warn); --vda-mark-tint: color-mix(in srgb, var(--vk-warn) 12%, var(--vk-panel)); }
.vda-diagram [data-mark="del"] { --vda-mark: var(--vk-bad); --vda-mark-tint: color-mix(in srgb, var(--vk-bad) 11%, var(--vk-panel)); }
.vda-graph-edge { fill: none; stroke: var(--vda-edge); stroke-width: 1.4; }
.vda-graph-edge[data-dashed] { stroke-dasharray: 5 4; }
.vda-graph-edge[data-mark] { stroke: var(--vda-mark); stroke-width: 1.8; }
.vda-graph-edge[data-mark="del"] { stroke-dasharray: 5 4; }
.vda-graph-arrow { fill: var(--vda-edge); }
.vda-graph marker[data-mark] .vda-graph-arrow { fill: var(--vda-mark); }
.vda-graph-label rect { fill: var(--vk-panel); }
.vda-graph-label text { fill: var(--vk-ink-3); font-size: 11.5px; }
.vda-graph-label[data-mark] text { fill: var(--vda-mark); }
.vda-graph-node :is(rect, polygon, path, ellipse) { fill: var(--vk-panel); stroke: var(--vda-stroke); stroke-width: 1.3; }
.vda-graph-node text { fill: var(--vk-ink); font-size: 13px; font-weight: 500; }
.vda-graph-node[data-shape="terminal"] rect { fill: var(--vk-sunken); }
.vda-graph-node[data-shape="decision"] polygon { fill: color-mix(in srgb, var(--vk-warn) 9%, var(--vk-panel)); }
.vda-graph-node[data-shape="store"] :is(path, ellipse) { fill: color-mix(in srgb, var(--vk-info) 9%, var(--vk-panel)); }
.vda-graph-node[data-mark] :is(rect, polygon, path, ellipse) { fill: var(--vda-mark-tint); stroke: var(--vda-mark); stroke-width: 1.8; }
.vda-graph-node[data-mark="del"] :is(rect, polygon, path, ellipse) { stroke-dasharray: 5 3; }
.vda-graph-node[data-mark="del"] text { opacity: 0.7; text-decoration: line-through; }
.vda-er-card { fill: var(--vk-panel); stroke: var(--vda-stroke); stroke-width: 1.2; }
.vda-er-head { fill: var(--vk-sunken); }
.vda-er-table[data-mark] .vda-er-card { fill: var(--vda-mark-tint); stroke: var(--vda-mark); stroke-width: 1.8; }
.vda-er-table[data-mark="del"] .vda-er-card { stroke-dasharray: 5 3; }
.vda-er-table[data-mark] .vda-er-head { fill: color-mix(in srgb, var(--vda-mark) 16%, var(--vk-panel)); }
.vda-er-rule { stroke: var(--vk-line-soft); stroke-width: 1; }
.vda-er-foot { fill: none; stroke: var(--vda-edge); stroke-width: 1.4; }
.vda-er-title { fill: var(--vk-ink); font-size: 13px; font-weight: 650; }
.vda-er-field { fill: var(--vk-ink); font-family: var(--vk-font-mono); font-size: 12.5px; }
.vda-er-type, .vda-er-note { fill: var(--vk-ink-3); font-size: 11.5px; }
.vda-er-row[data-mark] .vda-er-field { fill: var(--vda-mark); font-weight: 600; }
.vda-er-row[data-mark="del"] text { text-decoration: line-through; }
.vda-er-key rect { fill: var(--vk-sunken); }
.vda-er-key text { fill: var(--vk-ink-3); font-family: var(--vk-font-mono); font-size: 9.5px; font-weight: 700; letter-spacing: 0.02em; }
.vda-er-key[data-key="PK"] rect { fill: color-mix(in srgb, var(--vk-warn) 20%, var(--vk-panel)); }
.vda-er-key[data-key="PK"] text { fill: var(--vk-warn); }
.vda-er-key[data-key="FK"] rect { fill: color-mix(in srgb, var(--vk-info) 18%, var(--vk-panel)); }
.vda-er-key[data-key="FK"] text { fill: var(--vk-info); }

/* ---------- Sequence ---------- */
.vda-sequence-frame { --vda-ground: var(--vk-panel); margin: 0; padding: calc(var(--vk-u) * 3.5) calc(var(--vk-u) * 3) calc(var(--vk-u) * 2.5); }
.vda-sequence { display: grid; grid-template-columns: repeat(var(--vda-actors), minmax(0, 1fr)); row-gap: calc(var(--vk-u) * 2); padding-bottom: var(--vk-u); background: linear-gradient(90deg, transparent calc(50% - 0.5px), var(--vk-line) calc(50% - 0.5px), var(--vk-line) calc(50% + 0.5px), transparent calc(50% + 0.5px)) 0 0 / calc(100% / var(--vda-actors)) 100% repeat-x; font-size: var(--vk-fs-md); }
.vda-sequence-actor { justify-self: center; max-width: 100%; padding: var(--vk-u) calc(var(--vk-u) * 3); background: var(--vk-ink); color: var(--vk-ink-inverse); font-weight: 600; text-align: center; box-shadow: inset 0 calc(var(--vk-tick-h) * -1) 0 var(--vk-ember); }
.vda-sequence-message { --vda-arrow: var(--vk-ink-3); position: relative; min-height: 1.9em; margin: 0 calc(50% / var(--vda-span)); border-bottom: 1.5px solid var(--vda-arrow); text-align: center; }
.vda-sequence-message > span { display: inline-block; padding: 0 calc(var(--vk-u) * 1.5); background: var(--vda-ground); }
.vda-sequence-message::after { content: ""; position: absolute; right: -1px; bottom: -5.5px; border: 5px solid transparent; border-right: 0; border-left: 8px solid var(--vda-arrow); }
.vda-sequence-message:is([data-direction="left"], [data-direction="self"])::after { right: auto; left: -1px; border-right: 8px solid var(--vda-arrow); border-left: 0; }
.vda-sequence-message[data-direction="self"] { margin: 0 0 0 50%; border: 1.5px solid var(--vda-arrow); border-left: 0; text-align: start; }
.vda-sequence-message[data-dashed] { border-bottom-style: dashed; }
.vda-sequence-message[data-mark="add"] { --vda-arrow: var(--vk-ok); }
.vda-sequence-message[data-mark="del"] { --vda-arrow: var(--vk-bad); text-decoration: line-through; }
.vda-sequence-message[data-mark="chg"] { --vda-arrow: var(--vk-warn); }
.vda-sequence-note { position: relative; justify-self: stretch; margin: 0 max(4px, calc(50% / var(--vda-span) - 28px)); padding: 3px calc(var(--vk-u) * 2.5); border: 1px solid color-mix(in srgb, var(--vk-warn) 45%, var(--vk-line)); background: color-mix(in srgb, var(--vk-warn) 12%, var(--vk-panel)); font-size: var(--vk-fs-sm); text-align: center; }
.vda-sequence-note[data-single] { justify-self: center; max-width: calc(100% - 8px); margin: 0 4px; }
.vda-sequence-phase { display: flex; grid-column: 1 / -1; align-items: center; gap: calc(var(--vk-u) * 2); color: var(--vk-ink-3); font-size: var(--vk-fs-sm); font-weight: 600; }
.vda-sequence-phase::before, .vda-sequence-phase::after { content: ""; flex: 1; height: 1px; background: var(--vk-line); }
.vda-sequence-phase span { padding: 0 var(--vk-u); background: var(--vda-ground); }

/* ---------- Math ---------- */
.vda-math { position: relative; margin: 0; padding: calc(var(--vk-u) * 3) calc(var(--vk-u) * 4); border: 1px solid var(--vk-line); background: var(--vk-panel); box-shadow: var(--vk-shadow-1); }
.vda-math figcaption { margin-bottom: var(--vk-u); color: var(--vk-ink-3); font-size: var(--vk-fs-sm); font-weight: 600; }
.vda-math-equations { overflow-x: auto; overflow-y: hidden; }
.vda-math-display { display: block; }
.vda-math-display .katex-display { margin: 0.55em 0; }
.vda-math .katex { font-size: 1.12em; }
.vda-math-inline .katex { font-size: 1.05em; }
.vda-math-legend { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: calc(var(--vk-u) * 1.25) calc(var(--vk-u) * 3.5); margin: calc(var(--vk-u) * 2) 0 0; padding-top: calc(var(--vk-u) * 2.5); border-top: 1px solid var(--vk-line-soft); font-size: var(--vk-fs-sm); }
.vda-math-legend dt { text-align: end; }
.vda-math-legend dd { margin: 0; color: var(--vk-ink-2); }
.vda-math-source { font-family: var(--vk-font-mono); font-size: var(--vk-fs-sm); }
.vda-math-source[data-display] { display: block; margin: calc(var(--vk-u) * 1.5) 0; white-space: pre-wrap; }

/* ---------- Decision ---------- */
.vda-decision-head { display: flex; align-items: center; gap: calc(var(--vk-u) * 2); padding: calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 3) calc(var(--vk-u) * 1.5); }
.vda-decision-head strong { flex: 1 1 auto; min-width: 0; color: var(--vk-ink); font-weight: 600; }
.vda-decision-head small { color: var(--vk-ink-3); font-size: var(--vk-fs-sm); white-space: nowrap; }
.vda-decision-options { display: grid; gap: calc(var(--vk-u) * 1.5); padding: 0 calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 2.5); }
.vda-decision-option { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: calc(var(--vk-u) * 2.5); width: 100%; padding: calc(var(--vk-u) * 2) calc(var(--vk-u) * 2.5); border: 1px solid var(--vk-line); background: var(--vk-panel); color: var(--vk-ink); font: inherit; text-align: left; cursor: pointer; transition: border-color var(--vk-t-fast), background var(--vk-t-fast); }
.vda-decision-option:disabled { cursor: default; }
.vda-decision-option:hover:not(:disabled) { border-color: var(--vk-line-strong); background: var(--vk-hover); }
.vda-decision-option:focus-visible { outline: 2px solid var(--vk-signal); outline-offset: 1px; }
.vda-decision-option[aria-checked="true"] { border-color: var(--vk-signal); background: var(--vk-signal-soft); }
.vda-decision-option[data-recommended]:disabled { border-color: color-mix(in srgb, var(--vk-ok) 40%, var(--vk-line)); }
.vda-decision-mark { display: grid; place-items: center; width: 1rem; height: 1rem; border: 1px solid var(--vk-line-strong); background: var(--vk-panel); color: var(--vk-ink-inverse); }
.vda-decision-option[aria-checked="true"] .vda-decision-mark { border-color: var(--vk-signal); background: var(--vk-signal); }
.vda-decision-option:not([data-multiple]) .vda-decision-mark > svg { display: none; }
.vda-decision-option:not([data-multiple])[aria-checked="true"] .vda-decision-mark::after { content: ""; width: 0.4rem; height: 0.4rem; background: var(--vk-ink-inverse); }
.vda-decision-text { display: grid; gap: 1px; min-width: 0; }
.vda-decision-text > span { font-weight: 500; }
.vda-decision-text small { color: var(--vk-ink-3); font-size: var(--vk-fs-sm); }
.vda-decision-hint { margin: 0; padding: 0 calc(var(--vk-u) * 3) calc(var(--vk-u) * 2.5); color: var(--vk-ink-3); font-size: var(--vk-fs-sm); }
.vda-decision-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: calc(var(--vk-u) * 2); padding: 0 calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 2.5); }
.vda-decision-actions small { margin-right: auto; color: var(--vk-ink-3); font-size: var(--vk-fs-sm); }
.vda-decision-actions small[data-tone="no"] { color: var(--vk-bad); }
.vda-note { display: flex; margin: 0 calc(var(--vk-u) * 2.5) calc(var(--vk-u) * 2.5); padding: calc(var(--vk-u) * 1.5) calc(var(--vk-u) * 2.5); border: 1px solid color-mix(in srgb, var(--vk-signal) 40%, var(--vk-line)); border-left: 2px solid var(--vk-signal); background: color-mix(in srgb, var(--vk-signal) 4%, var(--vk-panel)); }
.vda-note textarea { flex: 1 1 auto; min-height: 2.6em; padding: 2px 0; border: 0; background: transparent; color: var(--vk-ink); font: inherit; font-size: var(--vk-fs-md); line-height: 1.5; resize: vertical; outline: none; }

/* ---------- Composer pill ---------- */
.vda-mode { position: relative; display: inline-flex; align-items: center; color: var(--vk-ink); font-size: 12px; line-height: 1.5; }
.vda-mode *, .vda-mode *::before, .vda-mode *::after { box-sizing: border-box; border-radius: 0; }
.vda-trigger { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--vk-line); background: var(--vk-panel); color: var(--vk-ink-2); font: inherit; white-space: nowrap; cursor: pointer; }
.vda-trigger:hover, .vda-trigger[aria-expanded="true"] { background: var(--vk-hover); color: var(--vk-ink); }
.vda-trigger:focus-visible { outline: 2px solid var(--vk-signal); outline-offset: 1px; }
.vda-dot { width: 7px; height: 7px; background: var(--vk-line-strong); }
.vda-dot[data-mode="interactive"] { background: var(--vk-ember); box-shadow: 0 0 0 2px color-mix(in srgb, var(--vk-ember) 18%, transparent); }
.vda-popover { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 50; width: 280px; border: 1px solid var(--vk-line); background: var(--vk-raised); box-shadow: var(--vk-shadow-2); }
.vda-popover::before { content: ""; position: absolute; top: -1px; left: -1px; width: var(--vk-tick-w); height: var(--vk-tick-h); background: var(--vk-ember); }
.vda-popover-title { margin: 0; padding: 10px 12px 6px; color: var(--vk-ink); font-size: 13px; font-weight: 600; }
.vda-choices { display: grid; gap: 6px; padding: 0 10px; }
.vda-choice { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; width: 100%; padding: 8px 10px; border: 1px solid var(--vk-line); background: var(--vk-panel); color: var(--vk-ink); font: inherit; text-align: left; cursor: pointer; }
.vda-choice:hover:not(:disabled) { background: var(--vk-hover); }
.vda-choice:disabled { cursor: default; opacity: 0.6; }
.vda-choice:focus-visible { outline: 2px solid var(--vk-signal); outline-offset: 1px; }
.vda-choice[aria-checked="true"] { border-color: var(--vk-ember); box-shadow: inset 2px 0 0 var(--vk-ember); background: var(--vk-sunken); }
.vda-choice-mark { grid-row: 1 / 3; width: 12px; height: 12px; margin-top: 3px; border: 1px solid var(--vk-line-strong); }
.vda-choice[aria-checked="true"] .vda-choice-mark { border-color: var(--vk-ember); background: radial-gradient(var(--vk-ember) 0 0) center / 6px 6px no-repeat; }
.vda-choice strong { font-weight: 600; }
.vda-choice small { color: var(--vk-ink-3); font-size: 12px; }
.vda-popover-foot { margin: 0; padding: 8px 12px 10px; color: var(--vk-ink-3); font-size: 12px; }
.vda-popover-foot[data-tone="no"] { color: var(--vk-bad); overflow-wrap: anywhere; }
`

/** Add the stylesheet; returns its removal. */
export function installStyle(): () => void {
  const existing = document.querySelector<HTMLStyleElement>('style[data-plugin="vulcan-answers"]')
  if (existing !== null) existing.remove()
  const tag = document.createElement('style')
  tag.dataset['plugin'] = 'vulcan-answers'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
