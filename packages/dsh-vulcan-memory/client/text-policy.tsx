import { useEffect, useState } from 'react'
import type { Translate } from './i18n'
import { Section } from './parts'
import { callHost, messageOf } from './shared'

// Keep UI choices aligned with the bundled regional resources.
// 使界面选项与随包提供的地区规则一致。
const REGIONS = ['zh-CN', 'zh-TW', 'zh-HK', 'en-US'] as const
type Policy = { region: typeof REGIONS[number]; noise: boolean; semanticNoise: boolean }
type Preview = { text: string; matches: string[]; noise: string | null }

/** Display the PII rule set, local preview and automatic distillation noise controls.
 *  展示 PII 规则、本机预览和自动提炼的噪声过滤设置。 */
export function TextPolicyPanel({ t }: { t: Translate }) {
  const [saved, setSaved] = useState<Policy>()
  const [draft, setDraft] = useState<Policy>()
  const [sample, setSample] = useState('')
  const [preview, setPreview] = useState<Preview>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void callHost<Policy>('GET', 'sqlite/text-policy').then(policy => {
      if (active) { setSaved(policy); setDraft(policy) }
    }, (failure: unknown) => { if (active) setError(messageOf(failure)) })
    return () => { active = false }
  }, [])

  /** Run a local action and surface validation errors in the policy panel.
   *  执行本机操作，并在策略面板中显示校验错误。 */
  const perform = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await action() } catch (failure) { setError(messageOf(failure)) } finally { setBusy(false) }
  }

  return <>
    <Section title={t('policy.pii')} lead={t('policy.piiHint')} actions={
      <button type="button" className="vac-btn sm primary" disabled={busy || draft === undefined || JSON.stringify(draft) === JSON.stringify(saved)}
        onClick={() => { if (draft !== undefined) void perform(async () => {
          const policy = await callHost<Policy>('POST', 'sqlite/text-policy', draft)
          setSaved(policy)
          setDraft(policy)
        }) }}>{t('save')}</button>
    }>
      {draft === undefined ? error === '' && <p className="vac-hint">{t('loading')}</p> : <>
        <label className="vmm-field">{t('policy.region')}
          <select className="vmm-select" value={draft.region} disabled={busy} onChange={event => {
            setDraft({ ...draft, region: event.target.value as Policy['region'] })
            setPreview(undefined)
          }}>
            {REGIONS.map(region => <option key={region} value={region}>{t(`policy.region.${region}`)}</option>)}
          </select>
        </label>
        <label className="vmm-field">{t('policy.sample')}
          <textarea className="vmm-textarea" rows={3} maxLength={4000} value={sample} disabled={busy}
            onChange={event => { setSample(event.target.value); setPreview(undefined) }} />
        </label>
        <div className="vac-inline"><button type="button" className="vac-btn sm" disabled={busy || sample.trim() === ''}
          onClick={() => { void perform(async () => {
            setPreview(await callHost<Preview>('POST', 'sqlite/pii-preview', { region: draft.region, text: sample }))
          }) }}>{t('policy.preview')}</button></div>
        {preview !== undefined && <div className="vac-alert info">
          <p className="vmm-node-body">{preview.text}</p>
          <p className="vac-hint">{preview.matches.length === 0 ? t('policy.noMatches') : preview.matches.join(' · ')}</p>
          {draft.noise && preview.noise !== null && <p className="vac-hint">{t('policy.noiseMatch')} · {preview.noise}</p>}
        </div>}
      </>}
      {error !== '' && <p className="vac-error" role="alert">{error}</p>}
    </Section>
    {draft !== undefined && <Section title={t('policy.noise')} lead={t('policy.noiseHint')}>
      <label className="vmm-check"><input type="checkbox" disabled={busy} checked={draft.noise}
        onChange={event => { setDraft({ ...draft, noise: event.target.checked }) }} />{t('policy.rules')}</label>
      <label className="vmm-check"><input type="checkbox" disabled={busy || !draft.noise} checked={draft.noise && draft.semanticNoise}
        onChange={event => { setDraft({ ...draft, semanticNoise: event.target.checked }) }} />{t('policy.semantic')}</label>
      {JSON.stringify(draft) !== JSON.stringify(saved) && <p className="vac-hint">{t('policy.pending')}</p>}
    </Section>}
  </>
}
