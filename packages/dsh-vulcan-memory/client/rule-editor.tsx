import { useEffect, useState } from 'react'
import type { Translate } from './i18n'
import { callHost, messageOf } from './shared'

// Keep the text and revision captured together by the host.
// 保持宿主同时读取的文本与版本成对。
type RuleFile = { source: string; revision: string | null }

/** Edit one effective JSON resource with revision checks and explicit default restoration.
 *  编辑一份生效 JSON 资源，使用版本检查并支持显式恢复默认。 */
export function RuleEditor({ t, route, selector, onChanged }: {
  t: Translate; route: string; selector: string; onChanged: () => void
}) {
  const [file, setFile] = useState<RuleFile>()
  const [source, setSource] = useState('')
  const [editing, setEditing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [generation, setGeneration] = useState(0)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    void callHost<RuleFile>('GET', `${route}?selector=${encodeURIComponent(selector)}`).then(result => {
      if (active) { setFile(result); setSource(result.source) }
    }, (failure: unknown) => { if (active) setError(messageOf(failure)) })
    return () => { active = false }
  }, [route, selector, generation])

  /** Save an edited resource or restore the packaged version and refresh its status.
   *  保存编辑后的资源或恢复随包版本，并刷新状态。 */
  const apply = async (next: string | null) => {
    if (file === undefined) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const result = await callHost<RuleFile>('POST', route, { selector, source: next, expected: file.revision })
      setFile(result)
      setSource(result.source)
      setEditing(false)
      setConfirmReset(false)
      setSaved(true)
      onChanged()
    } catch (failure) { setError(messageOf(failure)) } finally { setBusy(false) }
  }

  return <div className="vmm-policy-editor">
    {file !== undefined ? <>
      <label className="vmm-field">{t('policy.ruleJson')} · {t(file.revision === null ? 'policy.builtin' : 'policy.override')}
        <textarea className="vmm-textarea file vmm-rule-source" value={source} readOnly={!editing || busy}
          rows={9} maxLength={32_768} spellCheck={false} onChange={event => { setSource(event.target.value); setSaved(false) }} />
      </label>
      <div className="vac-inline">
        {!editing ? <button type="button" className="vac-btn sm" disabled={busy || confirmReset}
          onClick={() => { setEditing(true); setSaved(false) }}>{t('policy.editRules')}</button> : <>
          <button type="button" className="vac-btn sm primary" disabled={busy || source === file.source || source.trim() === ''}
            onClick={() => { void apply(source) }}>{t('policy.saveRules')}</button>
          <button type="button" className="vac-btn sm" disabled={busy}
            onClick={() => { setEditing(false); setSource(file.source) }}>{t('cancel')}</button>
        </>}
        {!confirmReset && <button type="button" className="vac-btn sm" disabled={busy || editing || file.revision === null}
          onClick={() => { setConfirmReset(true); setSaved(false) }}>{t('policy.restore')}</button>}
        {confirmReset && <>
          <button type="button" className="vac-btn sm primary" disabled={busy}
            onClick={() => { void apply(null) }}>{t('policy.confirmRestore')}</button>
          <button type="button" className="vac-btn sm" disabled={busy} onClick={() => { setConfirmReset(false) }}>{t('cancel')}</button>
        </>}
        {saved && <span className="vac-hint" role="status">{t('policy.saved')}</span>}
      </div>
    </> : error === '' && <p className="vac-hint">{t('loading')}</p>}
    {error !== '' && <div className="vac-inline">
      <span className="vac-error" role="alert">{error}</span>
      <button type="button" className="vac-btn sm" disabled={busy} onClick={() => {
        setFile(undefined); setEditing(false); setConfirmReset(false); setError(''); setGeneration(value => value + 1)
      }}>{t('policy.reloadRules')}</button>
    </div>}
  </div>
}
