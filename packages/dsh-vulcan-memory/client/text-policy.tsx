import { useEffect, useMemo, useState } from 'react'
import type { Translate } from './i18n'
import { Section } from './parts'
import { callHost, messageOf } from './shared'
import { RuleEditor } from './rule-editor'

// Keep UI choices aligned with the bundled regional resources.
// 使界面选项与随包提供的地区规则一致。
type Policy = { region: string; noise: boolean; semanticNoise: boolean; noiseLanguage: 'common' | 'zh-CN'; noiseThreshold: number }
// Display counts for the rules that actually replaced text.
// 显示实际替换文本的规则次数。
type Preview = { text: string; redactions: { name: string; count: number }[] }

/** Display the PII rule set, local preview and automatic distillation noise controls.
 *  展示 PII 规则、本机预览和自动提炼的噪声过滤设置。 */
export function TextPolicyPanel({ t }: { t: Translate }) {
  const [saved, setSaved] = useState<Policy>()
  const [draft, setDraft] = useState<Policy>()
  const [regions, setRegions] = useState<string[]>([])
  const [file, setFile] = useState<'common' | 'region'>('region')
  const [sample, setSample] = useState('')
  const [preview, setPreview] = useState<Preview>()
  const [noiseSample, setNoiseSample] = useState('')
  const [noiseResult, setNoiseResult] = useState<string | null>()
  const [noiseFile, setNoiseFile] = useState<'common' | 'zh-CN'>('common')
  const [threshold, setThreshold] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Display localized region names with their stable selector codes.
  // 以本地化地区名称和稳定选择代码共同显示。
  const labels = useMemo(() => new Intl.DisplayNames([t('policy.locale')], { type: 'region' }), [t])

  useEffect(() => {
    let active = true
    void Promise.all([callHost<Policy>('GET', 'sqlite/text-policy'), callHost<string[]>('GET', 'sqlite/pii-regions')]).then(([policy, available]) => {
      if (active) { setSaved(policy); setDraft(policy); setRegions(available); setThreshold(String(policy.noiseThreshold)) }
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
  const numericThreshold = Number(threshold)
  const thresholdValid = numericThreshold > 0 && numericThreshold <= 1
  const changed = JSON.stringify(draft) !== JSON.stringify(saved)
  /** Commit the shared form from either section's save control.
   *  从任一分区的保存按钮提交共享表单。 */
  const save = () => {
    if (draft === undefined) return
    void perform(async () => {
      const policy = await callHost<Policy>('POST', 'sqlite/text-policy', draft)
      setSaved(policy)
      setDraft(policy)
      setThreshold(String(policy.noiseThreshold))
    })
  }

  return <>
    <Section title={t('policy.pii')} lead={t('policy.piiHint')} actions={
      <button type="button" className="vac-btn sm primary" disabled={busy || draft === undefined || !changed || !thresholdValid}
        onClick={save}>{t('save')}</button>
    }>
      {draft === undefined ? error === '' && <p className="vac-hint">{t('loading')}</p> : <>
        <label className="vmm-field">{t('policy.region')}
          <select className="vmm-select" value={draft.region} disabled={busy} onChange={event => {
            setDraft({ ...draft, region: event.target.value })
            setPreview(undefined)
            setNoiseResult(undefined)
          }}>
            {regions.map(region => <option key={region} value={region}>{labels.of(region.slice(-2))} · {region}</option>)}
          </select>
        </label>
        <label className="vmm-field">{t('policy.ruleFile')}
          <select className="vmm-select" value={file} disabled={busy} onChange={event => {
            setFile(event.target.value === 'common' ? 'common' : 'region')
          }}>
            <option value="region">{draft.region}</option>
            <option value="common">{t('policy.common')}</option>
          </select>
        </label>
        <RuleEditor key={file === 'common' ? file : draft.region} t={t} route="sqlite/pii-rules"
          selector={file === 'common' ? file : draft.region} onChanged={() => { setPreview(undefined); setNoiseResult(undefined) }} />
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
          <p className="vac-hint">{preview.redactions.length === 0 ? t('policy.noMatches')
            : preview.redactions.map(hit => `${hit.name} ×${hit.count}`).join(' · ')}</p>
        </div>}
      </>}
    </Section>
    {draft !== undefined && <Section title={t('policy.noise')} lead={t('policy.noiseHint')} actions={
      <button type="button" className="vac-btn sm primary" disabled={busy || !changed || !thresholdValid}
        onClick={save}>{t('save')}</button>
    }>
      <label className="vmm-check"><input type="checkbox" disabled={busy} checked={draft.noise}
        onChange={event => { setDraft({ ...draft, noise: event.target.checked }) }} />{t('policy.rules')}</label>
      <label className="vmm-check"><input type="checkbox" disabled={busy || !draft.noise} checked={draft.noise && draft.semanticNoise}
        onChange={event => { setDraft({ ...draft, semanticNoise: event.target.checked }) }} />{t('policy.semantic')}</label>
      <div className="vmm-grid">
        <label className="vmm-field">{t('policy.noiseSet')}
          <select className="vmm-select" value={draft.noiseLanguage} disabled={busy} onChange={event => {
            setDraft({ ...draft, noiseLanguage: event.target.value === 'common' ? 'common' : 'zh-CN' })
            setNoiseResult(undefined)
          }}>
            <option value="common">{t('policy.common')}</option>
            <option value="zh-CN">{t('policy.noiseChinese')}</option>
          </select>
        </label>
        <label className="vmm-field">{t('policy.noiseThreshold')}
          <input className="vmm-input" type="number" step="0.01" min="0.01" max="1" value={threshold}
            disabled={busy} aria-invalid={!thresholdValid} onChange={event => {
              setThreshold(event.target.value)
              setDraft({ ...draft, noiseThreshold: Number(event.target.value) })
              setNoiseResult(undefined)
            }} />
        </label>
      </div>
      {!thresholdValid && <p className="vac-error">{t('policy.noiseThresholdInvalid')}</p>}
      <label className="vmm-field">{t('policy.ruleFile')}
        <select className="vmm-select" value={noiseFile} disabled={busy} onChange={event => {
          setNoiseFile(event.target.value === 'common' ? 'common' : 'zh-CN')
        }}>
          <option value="common">{t('policy.common')}</option>
          <option value="zh-CN">zh-CN</option>
        </select>
      </label>
      <RuleEditor key={noiseFile} t={t} route="sqlite/noise-rules" selector={noiseFile}
        onChanged={() => { setNoiseResult(undefined) }} />
      <label className="vmm-field">{t('policy.sample')}
        <textarea className="vmm-textarea" rows={3} maxLength={4000} value={noiseSample} disabled={busy}
          onChange={event => { setNoiseSample(event.target.value); setNoiseResult(undefined) }} />
      </label>
      <div className="vac-inline"><button type="button" className="vac-btn sm" disabled={busy || noiseSample.trim() === '' || !thresholdValid}
        onClick={() => { void perform(async () => {
          const result = await callHost<{ category: string | null }>('POST', 'sqlite/noise-preview', {
            region: draft.region, text: noiseSample, noiseLanguage: draft.noiseLanguage, noiseThreshold: draft.noiseThreshold,
          })
          setNoiseResult(result.category)
        }) }}>{t('policy.testRegex')}</button></div>
      {noiseResult !== undefined && <p className="vac-hint" role="status">{noiseResult === null ? t('policy.noMatches')
        : `${t('policy.noiseMatch')} · ${noiseResult}`}</p>}
      {changed && <p className="vac-hint">{t('policy.pending')}</p>}
    </Section>}
    {error !== '' && <p className="vac-error" role="alert">{error}</p>}
  </>
}
