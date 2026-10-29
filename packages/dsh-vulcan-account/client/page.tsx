/** Settings › OpenVulcan account: the site, the credential's expiry, sign in and sign out. */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

import { fill, type Key, type Translate } from './i18n'
import { callAccount, GUARD_SECTION, messageOf, SETTINGS_SECTION, type AccountView, type HostWatch } from './shared'

const SITES = [
  { site: 'global', domain: 'openvulcan.com' },
  { site: 'cn', domain: 'openvulcan.cn' },
] as const

export function AccountPage({ view, t }: { view: HostWatch<AccountView | null>; t: Translate }) {
  const live = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const waiting = live != null && live.signIn !== null
  // While a sign-in waits for approval the page polls, so it turns signed-in on its own.
  useEffect(() => {
    view.refresh()
    if (!waiting) return undefined
    const timer = setInterval(() => { view.refresh() }, 1000)
    return () => { clearInterval(timer) }
  }, [view, waiting])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const act = (work: () => Promise<unknown>): void => {
    setBusy(true)
    setError(undefined)
    work().catch((failure: unknown) => {
      setError(messageOf(failure))
    }).finally(() => {
      setBusy(false)
      view.refresh()
    })
  }
  const signIn = (site: 'cn' | 'global'): void => {
    // Opened during the click, so no popup blocker stops it, and pointed at the page once known.
    const popup = window.open('about:blank', '_blank')
    act(async () => {
      try {
        const { approvalUrl } = await callAccount<{ approvalUrl: string }>('POST', `signin?site=${site}`)
        if (popup !== null) {
          popup.opener = null
          popup.location.href = approvalUrl
        }
      } catch (failure) {
        popup?.close()
        throw failure
      }
    })
  }

  let body: ReactNode
  if (live === undefined) body = <p className="vac-hint">{t('loading')}</p>
  else if (live === null) body = <div className="vac-alert bad">{t('unavailable')}</div>
  else if (live.account.signedIn) {
    const account = live.account
    body = (
      <div className="vac-between">
        <div>
          <div className="vac-inline">
            <span className="vac-badge ok">{t('account.signedIn')}</span>
            <strong>{t(`account.site.${account.site ?? 'global'}` as Key)}</strong>
            <span className="vac-hint vac-mono">{SITES.find(item => item.site === account.site)?.domain}</span>
          </div>
          {account.expiresAt === undefined ? null : <p className="vac-hint">{fill(t('account.expires'), { expires: when(account.expiresAt) })}</p>}
        </div>
        <button type="button" className="vac-btn" disabled={busy} onClick={() => { act(() => callAccount('POST', 'signout')) }}>
          {t('account.signOut')}
        </button>
      </div>
    )
  } else if (live.signIn !== null) {
    body = (
      <div className="vac-between">
        <span>{t('account.waiting')}</span>
        <span className="vac-inline">
          <a className="vac-link" href={live.signIn.approvalUrl} target="_blank" rel="noopener noreferrer">{t('account.openAgain')}</a>
          <button type="button" className="vac-btn sm" disabled={busy} onClick={() => { act(() => callAccount('POST', 'signin/cancel')) }}>
            {t('account.cancel')}
          </button>
        </span>
      </div>
    )
  } else {
    body = (
      <>
        {live.account.reauthRequired === true ? <div className="vac-alert warn">{t('account.reauth')}</div> : null}
        <div className="vac-sites">
          {SITES.map(item => (
            <button key={item.site} type="button" className="vac-site" disabled={busy} onClick={() => { signIn(item.site) }}>
              <strong>{t(`account.site.${item.site}` as Key)}</strong>
              <span>{item.domain}</span>
              <span style={{ fontFamily: 'inherit', color: 'var(--vk-signal)' }}>{t('account.signIn')} →</span>
            </button>
          ))}
        </div>
      </>
    )
  }

  const failure = live?.signInError === undefined ? error : fill(t('account.failed'), { error: live.signInError })
  return (
    <div className="vac vac-page">
      <div className="vac-page-head">
        <h2>{t('page.title')}</h2>
        <p className="vac-lead">{t('page.lead')}</p>
      </div>
      <section className="vac-section">
        <div className="vac-section-head">
          <div>
            <h3 className="vac-section-title">{t('account.title')}</h3>
            {live?.account.signedIn === true ? null : <p className="vac-section-lead">{t('account.lead')}</p>}
          </div>
        </div>
        <div className="vac-section-body">
          {body}
          {failure === undefined ? null : <p className="vac-error" role="alert">{failure}</p>}
        </div>
      </section>
    </div>
  )
}

/** The suite's entry on the Plugins page: what it holds, and the way to its settings. */
export function PluginPageSummary({ view, t, open }: { view: 'summary' | 'page'; t: (key: string) => string; open: (section: string) => void }) {
  if (view === 'summary') return t('summary')
  return (
    <div className="vac" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <p className="vac-lead" style={{ margin: 0 }}>{t('summary')}</p>
      <div className="vac-inline">
        <button type="button" className="vac-btn primary" onClick={() => { open(SETTINGS_SECTION) }}>{t('openSettings')}</button>
        <button type="button" className="vac-btn" onClick={() => { open(GUARD_SECTION) }}>{t('openGuard')}</button>
      </div>
    </div>
  )
}

/** A short local date and time. */
function when(at: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at))
}
