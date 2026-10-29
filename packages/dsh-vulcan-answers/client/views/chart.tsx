/** `ui-chart` drawings. Ported from VulcanCode `answer-chart.tsx`. */

import { ANSWER_CHART_MAX_SERIES } from '../../src/limits'
import type { AnswerChart } from '../../src/answer-model'
import { formatNumber } from './frame'

// Drawing size of category charts in SVG user units; the SVG scales to the reply width.
const WIDTH = 640
const HEIGHT = 220
const PAD = { top: 12, right: 10, bottom: 28, left: 46 }

/** Series fill for index `index`; the palette lives in the stylesheet. */
function seriesColor(index: number): string {
  return `var(--vda-series-${(index % ANSWER_CHART_MAX_SERIES) + 1})`
}

/** Evenly spaced axis ticks covering `low..high` with a 1/2/2.5/5 step. */
function ticks(low: number, high: number): number[] {
  const top = high === low ? low + 1 : high
  const raw = (top - low) / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw
  const values: number[] = []
  for (let value = Math.floor(low / step) * step; value < top + step * 0.999; value += step) {
    values.push(Number(value.toPrecision(12)))
  }
  return values
}

/** Native hover text for one value. */
function hint(category: string, series: string | undefined, value: number): string {
  return `${category} · ${series ?? ''}: ${formatNumber(value)}`
}

/** Draw a parsed chart: circular kinds as a ring or pie with a share legend, others on axes. */
export function ChartView({ chart }: { chart: AnswerChart }) {
  if (chart.kind === 'pie' || chart.kind === 'donut') return <CircularChart chart={chart} />
  return (
    <>
      {chart.series.length > 1 ? (
        <ul className="vda-chart-legend">
          {chart.series.map((name, index) => (
            <li key={name + index}><i style={{ background: seriesColor(index) }} />{name}</li>
          ))}
        </ul>
      ) : null}
      {chart.kind === 'hbar' ? <HorizontalBars chart={chart} /> : <CategoryChart chart={chart} />}
    </>
  )
}

/** Vertical bars, stacked bars, lines and areas over one category axis. */
function CategoryChart({ chart }: { chart: AnswerChart }) {
  const stacked = chart.kind === 'stack'
  const values = chart.rows.flatMap((row) => (stacked ? [row.values.reduce((sum, value) => sum + value, 0)] : row.values))
  const axis = ticks(Math.min(0, ...values), Math.max(0, ...values))
  const low = axis[0] ?? 0
  const high = axis[axis.length - 1] ?? 1
  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const y = (value: number) => PAD.top + ((high - value) / (high - low)) * plotHeight
  const band = plotWidth / chart.rows.length
  const center = (index: number) => PAD.left + band * (index + 0.5)
  const labelEvery = Math.ceil(chart.rows.length / 12)
  return (
    <svg className="vda-chart-svg" role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {axis.map((tick) => (
        <g key={tick}>
          <line className={tick === 0 ? 'vda-chart-axis' : 'vda-chart-grid'} x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
          <text textAnchor="end" x={PAD.left - 8} y={y(tick) + 4}>{formatNumber(tick)}</text>
        </g>
      ))}
      {chart.kind === 'bar' || stacked ? chart.rows.map((row, rowIndex) => {
        const group = band * 0.7
        const width = stacked ? group : group / chart.series.length
        let base = 0
        return row.values.map((value, series) => {
          const from = stacked ? base : 0
          const to = stacked ? (base += value) : value
          const x = PAD.left + band * rowIndex + band * 0.15 + (stacked ? 0 : series * width)
          return (
            <rect fill={seriesColor(series)} height={Math.max(Math.abs(y(from) - y(to)), 0.5)} key={`${rowIndex}-${series}`}
              width={Math.max(width - 2, 1)} x={x + 1} y={Math.min(y(from), y(to))}>
              <title>{hint(row.category, chart.series[series], value)}</title>
            </rect>
          )
        })
      }) : chart.series.map((name, series) => {
        const points = chart.rows.map((row, index) => `${center(index)},${y(row.values[series] ?? 0)}`)
        return (
          <g key={name + series}>
            {chart.kind === 'area' ? (
              <path d={`M${points.join(' L')} L${center(chart.rows.length - 1)},${y(0)} L${center(0)},${y(0)}Z`} fill={seriesColor(series)} opacity={0.14} />
            ) : null}
            <path d={`M${points.join(' L')}`} fill="none" stroke={seriesColor(series)} strokeLinejoin="round" strokeWidth={2.4} />
            {chart.rows.map((row, index) => (
              <circle className="vda-chart-point" cx={center(index)} cy={y(row.values[series] ?? 0)} fill={seriesColor(series)} key={index} r={3.5}>
                <title>{hint(row.category, name, row.values[series] ?? 0)}</title>
              </circle>
            ))}
          </g>
        )
      })}
      {chart.rows.map((row, index) => (index % labelEvery === 0 ? (
        <text key={index} textAnchor="middle" x={center(index)} y={HEIGHT - 8}>{row.category}</text>
      ) : null))}
    </svg>
  )
}

/** Horizontal grouped bars with category labels on the left. */
function HorizontalBars({ chart }: { chart: AnswerChart }) {
  const values = chart.rows.flatMap((row) => row.values)
  const axis = ticks(Math.min(0, ...values), Math.max(0, ...values))
  const low = axis[0] ?? 0
  const high = axis[axis.length - 1] ?? 1
  const labelWidth = 128
  const barHeight = 14
  const rowHeight = barHeight * chart.series.length + 12
  const height = PAD.top + rowHeight * chart.rows.length + 22
  const plotWidth = WIDTH - labelWidth - PAD.right
  const x = (value: number) => labelWidth + ((value - low) / (high - low)) * plotWidth
  const bottom = height - 22
  return (
    <svg className="vda-chart-svg" role="img" viewBox={`0 0 ${WIDTH} ${height}`}>
      {axis.map((tick, index) => (
        <g key={tick}>
          <line className={tick === 0 ? 'vda-chart-axis' : 'vda-chart-grid'} x1={x(tick)} x2={x(tick)} y1={PAD.top} y2={bottom} />
          {/* The last tick sits on the right edge, so it ends there instead of centering. */}
          <text textAnchor={index === axis.length - 1 ? 'end' : 'middle'} x={x(tick)} y={height - 6}>{formatNumber(tick)}</text>
        </g>
      ))}
      {chart.rows.map((row, rowIndex) => {
        const top = PAD.top + rowHeight * rowIndex + 6
        const label = row.category.length > 18 ? `${row.category.slice(0, 17)}…` : row.category
        return (
          <g key={rowIndex}>
            <text textAnchor="end" x={labelWidth - 8} y={top + (barHeight * chart.series.length) / 2 + 4}>
              {label}<title>{row.category}</title>
            </text>
            {row.values.map((value, series) => (
              <rect fill={seriesColor(series)} height={barHeight - 2} key={series}
                width={Math.max(Math.abs(x(value) - x(0)), 0.5)} x={Math.min(x(0), x(value))} y={top + series * barHeight}>
                <title>{hint(row.category, chart.series[series], value)}</title>
              </rect>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

/** Pie or ring with one share per category; the ring shows the total in its center. */
function CircularChart({ chart }: { chart: AnswerChart }) {
  const share = (row: AnswerChart['rows'][number]) => row.values[0] ?? 0
  const total = chart.rows.reduce((sum, row) => sum + share(row), 0)
  const donut = chart.kind === 'donut'
  // A pie is a ring whose stroke covers the whole radius.
  const radius = donut ? 44 : 30
  const stroke = donut ? 24 : 60
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="vda-chart-circular">
      <svg role="img" viewBox="0 0 120 120">
        {chart.rows.map((row, index) => {
          const length = (share(row) / total) * circumference
          const segment = (
            <circle cx={60} cy={60} fill="none" key={index} r={radius} stroke={seriesColor(index)}
              strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} strokeWidth={stroke} transform="rotate(-90 60 60)">
              <title>{hint(row.category, chart.series[0], share(row))}</title>
            </circle>
          )
          offset += length
          return segment
        })}
        {donut ? <text className="vda-chart-total" textAnchor="middle" x={60} y={65}>{formatNumber(total)}</text> : null}
      </svg>
      <ul className="vda-chart-legend" data-layout="column">
        {chart.rows.map((row, index) => (
          <li key={index}>
            <i style={{ background: seriesColor(index) }} />{row.category}
            <b>{`${Math.round((share(row) / total) * 100)}%`}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
