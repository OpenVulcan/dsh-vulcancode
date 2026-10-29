/** The runtime section: install prompt, install progress, status, restart and removal. */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { fill, type Key, type Translate } from './i18n'
import { callHost, HostWatch, messageOf, PHASES, type RuntimeView, type Versions } from './shared'

/** Poll the Host while it is busy, so progress moves and the end shows on its own. */
export function useRuntime(view: HostWatch<RuntimeView | null>): RuntimeView | null | undefined {
  const live = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const busy = live != null && (live.state.kind === 'installing' || live.state.kind === 'starting')
  useEffect(() => {
    view.refresh()
    if (!busy) return undefined
    const timer = setInterval(() => { view.refresh() }, 700)
    return () => { clearInterval(timer) }
  }, [view, busy])
  return live
}

export function RuntimeSection({ view, live, t }: { view: HostWatch<RuntimeView | null>; live: RuntimeView; t: Translate }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const act = (work: () => Promise<unknown>): void => {
    setBusy(true)
    setError(undefined)
    work().catch((failure: unknown) => { setError(messageOf(failure)) }).finally(() => {
      setBusy(false)
      view.refresh()
    })
  }
  const install = () => { act(() => callHost('POST', 'install')) }
  const remove = () => {
    if (window.confirm(t('runtime.removeConfirm'))) act(() => callHost('POST', 'remove'))
  }
  const state = live.state
  const now = Date.now()
  // When this page first saw the current archive fully downloaded; the SDK then verifies and
  // unpacks it with no progress of its own, so the time since is shown instead.
  const downloaded = state.kind === 'installing' && state.total !== null && state.received >= state.total ? state.phase : undefined
  const unpackedFrom = useRef<{ phase: string; at: number } | undefined>(undefined)
  if (downloaded === undefined) unpackedFrom.current = undefined
  else if (unpackedFrom.current?.phase !== downloaded) unpackedFrom.current = { phase: downloaded, at: now }
  const unpackingSince = unpackedFrom.current?.at

  let body
  switch (state.kind) {
    case 'absent':
      body = (
        <div className="vls-banner">
          <div>
            <strong>{t('runtime.absent')}</strong>
            <p className="vac-hint">{fill(t('runtime.absentLead'), { size: live.sizeMb, location: live.location })}</p>
          </div>
          <button type="button" className="vac-btn primary" disabled={busy} onClick={install}>{t('runtime.install')}</button>
        </div>
      )
      break
    case 'installing': {
      const index = PHASES.indexOf(state.phase)
      const unpacking = unpackingSince !== undefined
      const share = !unpacking && state.total !== null && state.total > 0 ? Math.min(1, state.received / state.total) : null
      body = (
        <div className="vls-progress">
          <div className="vac-between">
            <span className="vac-inline">
              <span className="vac-badge info">{fill(t('runtime.step'), { index: index + 1, count: PHASES.length })}</span>
              <strong>{t(`runtime.phase.${state.phase}` as Key)}</strong>
              {unpacking ? (
                <span className="vac-hint">{fill(t('runtime.unpacking'), { seconds: Math.max(0, Math.floor((now - unpackingSince) / 1000)) })}</span>
              ) : null}
            </span>
            <span className="vac-inline">
              {state.received > 0 ? (
                <span className="vac-hint vac-mono">
                  {state.total === null
                    ? fill(t('runtime.bytesOnly'), { received: mb(state.received) })
                    : fill(t('runtime.bytes'), { received: mb(state.received), total: mb(state.total) })}
                </span>
              ) : null}
              <button type="button" className="vac-btn sm" disabled={busy} onClick={() => { act(() => callHost('POST', 'install/cancel')) }}>{t('runtime.cancel')}</button>
            </span>
          </div>
          <div className="vls-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share === null ? undefined : Math.round(share * 100)}>
            <span className={share === null ? 'vls-bar-fill indeterminate' : 'vls-bar-fill'} style={share === null ? undefined : { width: `${share * 100}%` }} />
          </div>
          {unpacking && state.phase === 'core' ? <p className="vac-hint">{t('runtime.unpackingSlow')}</p> : null}
          <ol className="vls-steps">
            {PHASES.map((phase, at) => (
              <li key={phase} className={at < index ? 'done' : at === index ? 'now' : ''}>{t(`runtime.phase.${phase}` as Key)}</li>
            ))}
          </ol>
        </div>
      )
      break
    }
    case 'starting':
      body = <div className="vac-inline"><span className="vac-badge info">{t('runtime.starting')}</span><Versions versions={live.versions} t={t} /></div>
      break
    case 'ready':
      body = (
        <div className="vac-between">
          <div className="vac-inline">
            <span className="vac-badge ok">{t('runtime.ready')}</span>
            <Versions versions={live.versions} t={t} />
          </div>
          <span className="vac-inline">
            <button type="button" className="vac-btn sm" disabled={busy} onClick={() => { act(() => callHost('POST', 'restart')) }}>{t('runtime.restart')}</button>
            <button type="button" className="vac-btn sm ghost danger" disabled={busy} onClick={remove}>{t('runtime.remove')}</button>
          </span>
        </div>
      )
      break
    case 'outdated':
      body = (
        <div className="vls-banner warn">
          <p className="vac-hint">{fill(t('runtime.outdated'), { installed: versionText(state.installed), wanted: versionText(live.versions) })}</p>
          <button type="button" className="vac-btn primary" disabled={busy} onClick={() => { act(async () => { await callHost('POST', 'remove'); await callHost('POST', 'install') }) }}>
            {t('runtime.reinstall')}
          </button>
        </div>
      )
      break
    case 'failed':
      body = state.installed ? (
        <div className="vls-banner bad">
          <p className="vac-error">{fill(t('runtime.engineFailed'), { error: state.error })}</p>
          <span className="vac-inline">
            <button type="button" className="vac-btn sm" disabled={busy} onClick={() => { act(() => callHost('POST', 'restart')) }}>{t('runtime.restart')}</button>
            <button type="button" className="vac-btn sm ghost danger" disabled={busy} onClick={remove}>{t('runtime.remove')}</button>
          </span>
        </div>
      ) : (
        <div className="vls-banner bad">
          <p className="vac-error">{fill(t('runtime.failed'), { error: state.error })}</p>
          <button type="button" className="vac-btn primary" disabled={busy} onClick={install}>{t('runtime.retry')}</button>
        </div>
      )
      break
  }

  return (
    <section className="vac-section">
      <div className="vac-section-head">
        <div>
          <h3 className="vac-section-title">{t('runtime.title')}</h3>
          <p className="vac-section-lead vac-mono">{fill(t('runtime.location'), { location: live.location })}</p>
        </div>
      </div>
      <div className="vac-section-body">
        {body}
        {error === undefined ? null : <p className="vac-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}

function Versions({ versions, t }: { versions: Versions; t: Translate }) {
  return <span className="vac-hint vac-mono">{fill(t('runtime.versions'), { ...versions })}</span>
}

function versionText(versions: Versions): string {
  return `${versions.sdk} / ${versions.luaskills} / ${versions.luaRuntime}`
}

function mb(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1)
}
