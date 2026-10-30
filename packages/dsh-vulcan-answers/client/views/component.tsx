/**
 * Render one parsed `ui-*` component: framed blocks carry reusable data, embedded blocks read as prose.
 * Ported from VulcanCode `answer-component-view.tsx`. File paths show as text: dsh offers plugins no
 * file opener, and `ui-code` and `ui-gallery` are not offered at all.
 */

import { Check, CircleAlert, CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react'
import { Fragment, useId, useState } from 'react'

import type { AnswerChart, AnswerComponent, AnswerSeverity, AnswerTonedText, AnswerTreeNode } from '../../src/answer-model'
import { fill, type Translate } from '../i18n'
import type { ReplyHub } from '../reply'
import { ChartView } from './chart'
import { DecisionView } from './decision'
import { ErDiagram, FlowDiagram } from './diagrams'
import { CopyAction, Frame, formatNumber, markdownTable, type ViewHost } from './frame'
import { MathView } from './math'
import { SequenceView } from './sequence'

/** One fence as the overlay hands it over. */
export interface FenceProps {
  readonly host: ViewHost
  readonly hub: ReplyHub
  readonly anchor: Element
  readonly language: string
  readonly meta: string
  readonly body: string
  readonly component: AnswerComponent
}

/** A component with its heading. */
export function FenceView(props: FenceProps) {
  const rendered = <ComponentView {...props} />
  return (
    <div className="vda">
      {props.component.heading
        ? <div className="vda-titled"><strong className="vda-heading">{props.component.heading}</strong>{rendered}</div>
        : rendered}
    </div>
  )
}

const SEVERITY_KEYS = { high: 'severity.high', medium: 'severity.medium', low: 'severity.low', info: 'severity.info' } as const
const STATUS_SYMBOLS = { ok: '✓', no: '✗', warn: '!', todo: '' } as const
const CALLOUT_ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleX } as const
const TONE_ICONS = { ok: CircleCheck, warn: CircleAlert, no: CircleX } as const

function ComponentView({ host, hub, anchor, language, meta, body, component }: FenceProps) {
  const t = host.t
  switch (component.kind) {
    case 'kv':
      return (
        <dl className="vda-kv">
          {component.rows.map((row, index) => (
            <Fragment key={index}><dt>{row.label}</dt><dd>{row.value}</dd></Fragment>
          ))}
        </dl>
      )
    case 'metrics':
      return (
        <div className="vda-metrics">
          {component.rows.map((metric, index) => (
            <div className="vda-metric" data-over={metric.over || undefined} data-tone={metric.tone} key={index}>
              <b>
                {metric.value}
                {metric.maximum !== undefined ? <small>/ {formatNumber(metric.maximum)}</small> : null}
                {metric.unit ? <small>{metric.unit}</small> : null}
              </b>
              <span>{metric.label}</span>
              {metric.maximum !== undefined ? <MetricMeter maximum={metric.maximum} t={t} value={metric.numeric ?? 0} /> : null}
            </div>
          ))}
        </div>
      )
    case 'findings': {
      const header = ['#', t('column.severity'), t('column.finding'), t('column.location')]
      const severity = (value: AnswerSeverity) => t(SEVERITY_KEYS[value])
      const copy = markdownTable(header, component.rows.map((row, index) => [String(index + 1), severity(row.severity), row.text, row.location ?? '']))
      const located = component.rows.some((row) => row.location)
      return (
        <Frame copy={copy} host={host}>
          <div className="vda-table-wrap">
            <table className="vda-table">
              <thead><tr>{header.slice(0, located ? 4 : 3).map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
              <tbody>
                {component.rows.map((row, index) => (
                  <tr key={index}>
                    <td className="vda-table-index">{index + 1}</td>
                    <td><span className="vda-badge" data-tone={row.severity}>{severity(row.severity)}</span></td>
                    <td>{row.text}</td>
                    {located ? <td>{row.location ? <code className="vda-path">{row.location}</code> : null}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Frame>
      )
    }
    case 'compare': {
      const copy = markdownTable(component.header, component.rows.map((row) => [row.criterion, ...row.cells.map(tonedMarkdown)]))
      return (
        <Frame copy={copy} host={host}>
          <div className="vda-table-wrap">
            <table className="vda-table vda-compare">
              <thead><tr>{component.header.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead>
              <tbody>
                {component.rows.map((row, index) => (
                  <tr key={index}>
                    <td>{row.criterion}</td>
                    {row.cells.map((cell, column) => <td data-tone={cell.tone} key={column}><Toned value={cell} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Frame>
      )
    }
    case 'checklist':
      return (
        <ul className="vda-checklist">
          {component.items.map((item, index) => (
            <li data-status={item.status} key={index}>
              <span aria-hidden="true" className="vda-status" data-status={item.status}>{STATUS_SYMBOLS[item.status]}</span>
              <span>{item.item}</span>
              {item.note || item.location
                ? <small>{item.note}{item.location ? <> <code className="vda-path">{item.location}</code></> : null}</small>
                : null}
            </li>
          ))}
        </ul>
      )
    case 'steps':
      return (
        <ol className="vda-steps">
          {component.steps.map((step, index) => (
            <li data-status={step.status} key={index}>
              <span aria-hidden="true" className="vda-step-number">{step.status === 'done' ? <Check size={13} strokeWidth={3} /> : index + 1}</span>
              <div><b>{step.title}</b>{step.text ? <p>{step.text}</p> : null}</div>
            </li>
          ))}
        </ol>
      )
    case 'timeline':
      return (
        <ul className="vda-timeline">
          {component.rows.map((row, index) => (
            <li key={index}>
              <time>{row.time}</time><span aria-hidden="true" className="vda-timeline-dot" />
              <div><b>{row.title}</b>{row.text ? <p>{row.text}</p> : null}</div>
            </li>
          ))}
        </ul>
      )
    case 'cards':
      return (
        <div className="vda-cards">
          {component.cards.map((card, index) => (
            <article className="vda-card" key={index}>
              <header>
                <strong>{card.title}</strong>
                {card.tag ? <span className="vda-badge" data-tone={card.tag.tone}><Toned value={card.tag} /></span> : null}
              </header>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      )
    case 'files':
      return (
        <section className="vda-figure vda-files">
          <header className="vda-figure-head">
            <span className="vda-figure-label">
              <strong>{fill(t('fileCount'), { count: component.files.length })}</strong>
              <LineDelta added={component.added} removed={component.removed} />
            </span>
          </header>
          <ul>
            {component.files.map((file, index) => (
              <li key={index}>
                <span className="vda-files-path"><code className="vda-path">{file.path}</code>{file.note ? <small>{file.note}</small> : null}</span>
                {file.added !== undefined || file.removed !== undefined
                  ? <LineDelta added={file.added} removed={file.removed} />
                  : file.status ? <span className="vda-badge">{file.status}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )
    case 'tree':
      return <div className="vda-figure"><ul className="vda-tree"><TreeNodes nodes={component.nodes} /></ul></div>
    case 'chart':
      return <ChartFrame chart={component.chart} host={host} />
    case 'flow':
      return <FlowDiagram flow={component} t={t} />
    case 'er':
      return <ErDiagram er={component} t={t} />
    case 'math':
      return <MathView math={component} />
    case 'sequence':
      return <SequenceView sequence={component} />
    case 'decision':
      return <DecisionView anchor={anchor} decision={component} hub={hub} replyKey={`${language} ${meta}\n${body}`} t={t} />
    case 'callout': {
      const Icon = CALLOUT_ICONS[component.tone]
      return (
        <aside className="vda-callout" data-tone={component.tone}>
          <Icon aria-hidden="true" className="vda-callout-icon" size={16} />
          <div>
            {component.title ? <strong>{component.title}</strong> : null}
            {host.renderMarkdown(component.body)}
          </div>
        </aside>
      )
    }
    case 'details':
      return (
        <details className="vda-details">
          <summary>{component.title}</summary>
          <div className="vda-details-body">{host.renderMarkdown(component.body)}</div>
        </details>
      )
    case 'tabs':
      return <Tabs host={host} sections={component.sections} />
    case 'columns':
      return (
        <div className="vda-columns">
          {component.sections.map((section, index) => (
            <section key={index}><h4>{section.title}</h4>{host.renderMarkdown(section.body)}</section>
          ))}
        </div>
      )
  }
}

/** Meter of a value against its maximum; an overrun fills the bar and says how far past it went. */
function MetricMeter({ maximum, t, value }: { maximum: number; t: Translate; value: number }) {
  const over = value > maximum
  return (
    <div className="vda-meter-row">
      <div aria-hidden="true" className="vda-meter"><i style={{ width: `${Math.min(value / maximum, 1) * 100}%` }} /></div>
      {over ? <small className="vda-meter-over">{fill(t('overBy'), { percent: Math.round((value / maximum - 1) * 100) })}</small> : null}
    </div>
  )
}

/** A toned cell: its tone icon followed by the remaining text. */
function Toned({ value }: { value: AnswerTonedText }) {
  const Icon = value.tone ? TONE_ICONS[value.tone] : null
  return <>{Icon ? <Icon aria-label={value.tone} className="vda-tone-icon" size={14} /> : null}{value.text}</>
}

/** Markdown text of a toned cell for copying. */
function tonedMarkdown(value: AnswerTonedText): string {
  const symbol = value.tone ? STATUS_SYMBOLS[value.tone] : ''
  return [symbol, value.text].filter(Boolean).join(' ')
}

/** Added and removed line counts; a side a file row did not state is left out. */
function LineDelta({ added, removed }: { added?: number | undefined; removed?: number | undefined }) {
  return (
    <span className="vda-delta">
      {added !== undefined ? <span className="vda-add">+{formatNumber(added)}</span> : null}
      {removed !== undefined ? <span className="vda-del">−{formatNumber(removed)}</span> : null}
    </span>
  )
}

/** Recursive tree rows with plan markers. */
function TreeNodes({ nodes }: { nodes: AnswerTreeNode[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <li data-mark={node.mark} key={index}>
          <span className="vda-tree-label">{node.label}</span>
          {node.note ? <small>{node.note}</small> : null}
          {node.children.length > 0 ? <ul><TreeNodes nodes={node.children} /></ul> : null}
        </li>
      ))}
    </>
  )
}

/** Tabbed Markdown sections; the first tab starts selected. */
function Tabs({ host, sections }: { host: ViewHost; sections: { title: string; body: string }[] }) {
  const [selected, setSelected] = useState(0)
  const id = useId()
  return (
    <div className="vda-tabs">
      <div className="vda-tablist" role="tablist">
        {sections.map((section, index) => (
          <button aria-controls={`${id}-panel`} aria-selected={index === selected} id={`${id}-tab-${index}`} key={index}
            onClick={() => { setSelected(index) }} role="tab" type="button">{section.title}</button>
        ))}
      </div>
      <div aria-labelledby={`${id}-tab-${selected}`} className="vda-tabpanel" id={`${id}-panel`} role="tabpanel">
        {host.renderMarkdown(sections[selected]?.body ?? '')}
      </div>
    </div>
  )
}

/** Chart frame: title strip, chart/data toggle and copy-data action. */
function ChartFrame({ chart, host }: { chart: AnswerChart; host: ViewHost }) {
  const t = host.t
  const [data, setData] = useState(false)
  const header = [chart.categoryLabel, ...chart.series]
  const rows = chart.rows.map((row) => [row.category, ...row.values.map(formatNumber)])
  return (
    <section className="vda-figure vda-chart">
      <header className="vda-figure-head">
        <span className="vda-figure-label">{chart.title ? <strong>{chart.title}</strong> : null}</span>
        <span className="vda-figure-actions">
          <span className="vda-seg">
            <button aria-pressed={!data} onClick={() => { setData(false) }} type="button">{t('chartView')}</button>
            <button aria-pressed={data} onClick={() => { setData(true) }} type="button">{t('dataView')}</button>
          </span>
          <CopyAction host={host} label="copyData" text={markdownTable(header, rows)} />
        </span>
      </header>
      <div className="vda-chart-body">
        {data ? (
          <div className="vda-table-wrap">
            <table className="vda-table">
              <thead><tr>{header.map((cell, index) => <th data-numeric={index > 0 || undefined} key={index}>{cell}</th>)}</tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>{row.map((cell, column) => <td data-numeric={column > 0 || undefined} key={column}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <ChartView chart={chart} />}
      </div>
    </section>
  )
}
