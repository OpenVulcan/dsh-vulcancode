/**
 * The OpenVulcan account in the sidebar foot, above Settings: who is signed in and their plan, or
 * one-click sign-in at either site. The rail shows the mark alone and opens the account settings.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'

import { fill, type Key, type Translate } from './i18n'
import { callAccount, messageOf, SITES, type AccountProfile, type AccountView, type HostWatch, type Site } from './shared'

export interface FooterProps {
  readonly wide: boolean
  readonly t: Translate
  readonly view: HostWatch<AccountView | null>
  readonly profile: HostWatch<AccountProfile | null>
  readonly openSettings: () => void
}

export function AccountFooter({ wide, t, view, profile, openSettings }: FooterProps) {
  const live = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const who = useSyncExternalStore(profile.subscribe, profile.getSnapshot)
  const waiting = live != null && live.signIn !== null
  const signedIn = live?.account.signedIn === true
  const authorization = live?.account.authorizationId
  useEffect(() => {
    view.refresh()
    if (!waiting) return undefined
    const timer = setInterval(() => { view.refresh() }, 1000)
    return () => { clearInterval(timer) }
  }, [view, waiting])
  // The profile follows the device authorization; the Host reads it once per sign-in.
  useEffect(() => {
    if (signedIn) profile.refresh()
  }, [profile, signedIn, authorization])
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
  const signIn = (site: Site): void => {
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

  // Without the plugin routes there is nothing to show or do here.
  if (live === null) return null
  const name = signedIn ? (who?.nickname || who?.username) : undefined
  const siteLabel = live?.account.site === undefined ? '' : t(`account.site.${live.account.site}` as Key)

  if (!wide) {
    const label = signedIn ? fill(t('footer.signedInAs'), { name: name ?? siteLabel }) : t('footer.signedOut')
    return (
      <button type="button" className="vac-foot rail" title={label} aria-label={label} onClick={openSettings}>
        <VulcanMark />
        {signedIn ? <span className="vac-foot-dot" aria-hidden="true" /> : null}
      </button>
    )
  }

  if (live === undefined) {
    return <div className="vac-foot"><VulcanMark /><span className="vac-foot-sub">{t('loading')}</span></div>
  }

  if (signedIn) {
    const label = fill(t('footer.signedInAs'), { name: name ?? siteLabel })
    return (
      <button type="button" className="vac-foot" title={label} aria-label={label} onClick={openSettings}>
        <VulcanMark />
        <span className="vac-foot-text">
          <span className="vac-foot-name">{name ?? t('footer.brand')}</span>
          <span className="vac-foot-sub">{siteLabel}</span>
        </span>
        {who?.plan === undefined ? null : <span className="vac-foot-plan">{who.plan}</span>}
      </button>
    )
  }

  if (live.signIn !== null) {
    return (
      <div className="vac-foot">
        <VulcanMark />
        <span className="vac-foot-text">
          <span className="vac-foot-name">{t('footer.brand')}</span>
          <span className="vac-foot-sub">{t('footer.waiting')}</span>
        </span>
        <span className="vac-foot-actions">
          <a className="vac-foot-chip" href={live.signIn.approvalUrl} target="_blank" rel="noopener noreferrer">{t('footer.reopen')}</a>
          <button type="button" className="vac-foot-chip" disabled={busy} onClick={() => { act(() => callAccount('POST', 'signin/cancel')) }}>
            {t('footer.cancel')}
          </button>
        </span>
      </div>
    )
  }

  const failure = live.signInError ?? error
  const note = failure !== undefined ? t('footer.failed') : live.account.reauthRequired === true ? t('footer.reauth') : t('footer.signedOut')
  return (
    <div className="vac-foot">
      <button type="button" className="vac-foot-home" aria-label={t('footer.open')} title={failure ?? t('footer.open')} onClick={openSettings}>
        <VulcanMark />
        <span className="vac-foot-text">
          <span className="vac-foot-name">{t('footer.brand')}</span>
          <span className={failure === undefined && live.account.reauthRequired !== true ? 'vac-foot-sub' : 'vac-foot-sub warn'}>{note}</span>
        </span>
      </button>
      <span className="vac-foot-actions">
        {SITES.map(item => (
          <button
            key={item.site}
            type="button"
            className="vac-foot-chip"
            disabled={busy}
            title={fill(t('footer.signInAt'), { site: t(`account.site.${item.site}` as Key), domain: item.domain })}
            onClick={() => { signIn(item.site) }}
          >
            {t(`footer.chip.${item.site}` as Key)}
          </button>
        ))}
      </span>
    </div>
  )
}

/** The OpenVulcan mark: the chevron takes the text colour, the flame keeps its own. */
function VulcanMark() {
  return (
    <svg className="vac-foot-mark" viewBox="32 29 232 259" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="vac-foot-flame" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FF6527" />
          <stop offset="100%" stopColor="#F44E1C" />
        </linearGradient>
      </defs>
      <path
        d="M 2 0 L 84 0 C 88 0 91 1 95 5 L 153 76 C 159 83 159 95 153 102 L 95 173 C 91 177 88 178 84 178 L 2 178 L 78 89 Z"
        fill="currentColor"
        transform="translate(30 110)"
      />
      <path
        d="M 73 0 C 64 14 51 28 38 40 C 21 55 7 68 2 87 C -2 107 8 129 25 150 C 39 134 53 119 67 107 C 82 95 91 79 93 60 C 95 40 86 18 73 0 Z"
        fill="url(#vac-foot-flame)"
        transform="translate(169 29)"
      />
    </svg>
  )
}
