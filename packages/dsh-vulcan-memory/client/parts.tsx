/** Small building blocks of the memory page: a section, a modal dialog and segmented buttons. */

import { useEffect, type ReactNode } from 'react'

export function Section({ title, lead, actions, flush, children }: {
  title: string
  lead?: string | undefined
  actions?: ReactNode
  flush?: boolean
  children: ReactNode
}) {
  return (
    <section className="vac-section">
      <div className="vac-section-head">
        <div>
          <h3 className="vac-section-title">{title}</h3>
          {lead === undefined ? null : <p className="vac-section-lead">{lead}</p>}
        </div>
        {actions === undefined ? null : <span className="vac-inline">{actions}</span>}
      </div>
      <div className={flush === true ? 'vac-section-body flush' : 'vac-section-body'}>{children}</div>
    </section>
  )
}

/** A modal dialog; Escape and the backdrop close it unless `busy`. */
export function Dialog({ title, lead, wide, busy, close, footer, children }: {
  title: string
  lead?: string | undefined
  wide?: boolean
  busy?: boolean
  close: () => void
  footer: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && busy !== true) close() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [close, busy])
  return (
    <div className="vac vmm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== true) close() }}>
      <div className={wide === true ? 'vmm-dialog wide' : 'vmm-dialog'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="vmm-dialog-head">
          <h3>{title}</h3>
          {lead === undefined ? null : <p>{lead}</p>}
        </div>
        <div className="vmm-dialog-body">{children}</div>
        <div className="vmm-dialog-foot">{footer}</div>
      </div>
    </div>
  )
}

export function Segments<T extends string>({ value, options, disabled, label, onChange }: {
  value: T
  options: readonly { readonly value: T; readonly label: string }[]
  disabled?: boolean
  label: string
  onChange: (value: T) => void
}) {
  return (
    <span className="vmm-segs" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'vmm-seg on' : 'vmm-seg'}
          disabled={disabled}
          onClick={() => { onChange(option.value) }}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}
