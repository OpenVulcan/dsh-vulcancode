/** The "Vulcan style" row in Settings › General: theme choice and the square-corner switch. */

import { useCallback, useState, useSyncExternalStore } from 'react'

import type { SettingsWriter } from './controller'
import type { ConfigForm } from './dsh-client'
import type { Translate } from './i18n'
import type { Palette } from './palette'
import { settingsOf, THEME_CHOICES, type StyleSettings, type ThemeChoice } from './shared'
import { PALETTES } from './themes'

export interface StyleRowInjected {
  readonly form: ConfigForm<StyleSettings>
  readonly writer: SettingsWriter
}

/** Colour strip previewing a choice: canvas, panel, ink and the ember accent. */
const swatchOf = (choice: ThemeChoice): readonly Palette[] => {
  switch (choice) {
    case 'vulcan-auto': return [PALETTES['vulcan-light'], PALETTES['vulcan-dark']]
    case 'dsh': return []
    default: return [PALETTES[choice]]
  }
}

function Swatch({ choice }: { choice: ThemeChoice }) {
  const palettes = swatchOf(choice)
  if (palettes.length === 0) {
    return <span className="vst-swatch" aria-hidden="true">
      <span style={{ background: 'var(--dsw-alias-bg-base)' }} />
      <span style={{ background: 'var(--dsw-alias-bg-module-platform)' }} />
      <span style={{ background: 'var(--dsw-alias-label-primary)' }} />
    </span>
  }
  return <span className="vst-swatch" aria-hidden="true">
    {palettes.map(p => [
      <span key={`${p.ground}g`} style={{ background: p.ground }} />,
      <span key={`${p.ground}p`} style={{ background: p.panel }} />,
      <span key={`${p.ground}i`} style={{ background: p.ink }} />,
    ])}
    <span data-accent style={{ background: palettes[0]?.ember }} />
  </span>
}

export function StyleRow({ form, writer, t }: StyleRowInjected & { t: (key: string) => string }) {
  const translate = t as Translate
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const snapshot = useSyncExternalStore(subscribe, () => form.getSnapshot())
  const settings = settingsOf(snapshot.value)
  const writable = snapshot.status === 'ready' && snapshot.writable
  const [failed, setFailed] = useState(false)

  const write = (change: Partial<StyleSettings>): void => {
    setFailed(false)
    writer.write(change).then(accepted => { if (!accepted) setFailed(true) }, () => { setFailed(true) })
  }

  return <div className="vst">
    <div className="vst-head">
      <div className="vst-title">{translate('title')}</div>
      <div className="vst-desc">{translate('description')}</div>
    </div>
    <div className="vst-choices" role="group" aria-label={translate('title')}>
      {THEME_CHOICES.map(choice => (
        <button
          key={choice}
          type="button"
          className="vst-choice"
          aria-pressed={settings.theme === choice}
          disabled={!writable}
          onClick={() => { if (settings.theme !== choice) write({ theme: choice }) }}
        >
          <Swatch choice={choice} />
          {translate(`choice.${choice}`)}
        </button>
      ))}
    </div>
    <div className="vst-switch-row">
      <div className="vst-head">
        <div className="vst-title">{translate('square.title')}</div>
        <div className="vst-desc">{translate('square.description')}</div>
      </div>
      <button
        type="button"
        role="switch"
        className="vst-switch"
        aria-checked={settings.squareCorners}
        aria-label={translate('square.title')}
        disabled={!writable}
        onClick={() => { write({ squareCorners: !settings.squareCorners }) }}
      />
    </div>
    {snapshot.status === 'ready' && !snapshot.writable && <div className="vst-desc">{translate('readOnly')}</div>}
    {failed && <div className="vst-error" role="alert">{translate('saveFailed')}</div>}
  </div>
}
