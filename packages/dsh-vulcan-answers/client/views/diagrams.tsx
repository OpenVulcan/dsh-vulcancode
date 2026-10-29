/** `ui-flow` and `ui-er` diagrams. Ported from VulcanCode `answer-diagrams.tsx`. */

import { useId, useMemo, type CSSProperties, type ReactNode } from 'react'

import type { AnswerComponent, AnswerErTable, AnswerFlowNode, AnswerMark } from '../../src/answer-model'
import type { Translate } from '../i18n'
import { diamondBoundary, layoutGraph, measureText, splinePath, wrapText, type GraphPoint } from './graph-layout'

type FlowComponent = Extract<AnswerComponent, { kind: 'flow' }>
type ErComponent = Extract<AnswerComponent, { kind: 'er' }>

// Diagram typography in CSS pixels; the stylesheet uses the same sizes.
const NODE_FONT_SIZE = 13
const LABEL_FONT_SIZE = 11.5
const LINE_HEIGHT = 17
const NODE_MAX_TEXT_WIDTH = 190
const LABEL_MAX_TEXT_WIDTH = 150

/** Font the diagrams inherit from the conversation; `mono` measures text drawn in the code face. */
function diagramFont(size: number, weight = 400, mono = false): string {
  const family = typeof document === 'undefined'
    ? (mono ? 'monospace' : 'sans-serif')
    : mono
      ? getComputedStyle(document.body).getPropertyValue('--dsw-font-markdown-code-font-family').trim() || 'monospace'
      : getComputedStyle(document.body).fontFamily || 'sans-serif'
  return `${weight} ${size}px ${family}`
}

/** A flow laid out as a layered graph: one node per label, one edge per hop. */
export function FlowDiagram({ flow, t }: { flow: FlowComponent; t: Translate }) {
  const id = useId().replace(/:/gu, '')
  const drawing = useMemo(() => flowDrawing(flow), [flow])
  const marks = new Set([...flow.nodes.map((node) => node.mark), ...flow.chains.map((chain) => chain.mark)].filter(Boolean) as AnswerMark[])
  return (
    <DiagramFrame marks={marks} t={t} width={drawing.width}>
      <svg className="vda-graph" height={drawing.height} role="img" viewBox={`0 0 ${drawing.width} ${drawing.height}`} width={drawing.width}>
        <ArrowMarkers id={id} />
        {drawing.edges.map((edge, index) => (
          <path className="vda-graph-edge" d={edge.path} data-dashed={edge.dashed || undefined} data-mark={edge.mark} key={index}
            markerEnd={`url(#${id}-${edge.mark ?? 'plain'})`} />
        ))}
        {drawing.edges.map((edge, index) => edge.label ? (
          <g className="vda-graph-label" data-mark={edge.mark} key={index} transform={`translate(${edge.label.at.x} ${edge.label.at.y})`}>
            <rect height={edge.label.height} width={edge.label.width} x={-edge.label.width / 2} y={-edge.label.height / 2} />
            <TextLines lines={edge.label.lines} />
          </g>
        ) : null)}
        {drawing.nodes.map((node, index) => (
          <g className="vda-graph-node" data-mark={node.mark} data-shape={node.shape} key={index} transform={`translate(${node.at.x} ${node.at.y})`}>
            <NodeShape height={node.height} shape={node.shape} width={node.width} />
            <TextLines lines={node.lines} />
          </g>
        ))}
      </svg>
    </DiagramFrame>
  )
}

/** Tables as cards, references drawn from the field row to the referenced table. */
export function ErDiagram({ er, t }: { er: ErComponent; t: Translate }) {
  const id = useId().replace(/:/gu, '')
  const drawing = useMemo(() => erDrawing(er), [er])
  const marks = new Set([...er.tables.map((table) => table.mark), ...er.tables.flatMap((table) => table.fields.map((field) => field.mark))]
    .filter(Boolean) as AnswerMark[])
  return (
    <DiagramFrame marks={marks} t={t} width={drawing.width}>
      <svg className="vda-graph vda-er" height={drawing.height} role="img" viewBox={`0 0 ${drawing.width} ${drawing.height}`} width={drawing.width}>
        <defs>
          <marker id={`${id}-many`} markerHeight={12} markerUnits="userSpaceOnUse" markerWidth={12} orient="auto-start-reverse" refX={12} refY={6} viewBox="0 0 12 12">
            <path className="vda-er-foot" d="M0,6 L12,0 M0,6 L12,6 M0,6 L12,12" />
          </marker>
          <marker id={`${id}-one`} markerHeight={12} markerUnits="userSpaceOnUse" markerWidth={12} orient="auto-start-reverse" refX={12} refY={6} viewBox="0 0 12 12">
            <path className="vda-er-foot" d="M6,0 L6,12 M0,6 L12,6" />
          </marker>
        </defs>
        {drawing.links.map((link, index) => (
          <path className="vda-graph-edge" d={link.path} data-mark={link.mark} key={index}
            markerEnd={`url(#${id}-one)`} markerStart={`url(#${id}-many)`} />
        ))}
        {drawing.tables.map((table, index) => <ErTable key={index} table={table} />)}
      </svg>
    </DiagramFrame>
  )
}

/** Catalog keys of plan markers. */
const MARK_KEYS = { add: 'mark.added', chg: 'mark.changed', del: 'mark.removed' } as const

/** Diagram frame: an optional change legend and a horizontally scrollable drawing. */
function DiagramFrame({ children, marks, t, width }: { children: ReactNode; marks: Set<AnswerMark>; t: Translate; width: number }) {
  return (
    <figure className="vda-figure vda-diagram">
      {marks.size > 0 ? (
        <figcaption className="vda-diagram-legend">
          {(['add', 'chg', 'del'] as const).filter((mark) => marks.has(mark)).map((mark) => (
            <span data-mark={mark} key={mark}><i aria-hidden="true" />{t(MARK_KEYS[mark])}</span>
          ))}
        </figcaption>
      ) : null}
      <div className="vda-diagram-scroll" style={{ '--vda-diagram-width': `${width}px` } as CSSProperties}>{children}</div>
    </figure>
  )
}

/** Arrowheads per change tone; each instance owns its ids. */
function ArrowMarkers({ id }: { id: string }) {
  return (
    <defs>
      {(['plain', 'add', 'chg', 'del'] as const).map((mark) => (
        <marker data-mark={mark === 'plain' ? undefined : mark} id={`${id}-${mark}`} key={mark} markerHeight={8} markerUnits="userSpaceOnUse" markerWidth={10}
          orient="auto-start-reverse" refX={10} refY={4} viewBox="0 0 10 8">
          <path className="vda-graph-arrow" d="M0,0 L10,4 L0,8 z" />
        </marker>
      ))}
    </defs>
  )
}

/** Centered text lines around the group origin. */
function TextLines({ lines }: { lines: string[] }) {
  return (
    <text textAnchor="middle">
      {lines.map((line, index) => (
        <tspan dominantBaseline="central" key={index} x={0} y={(index - (lines.length - 1) / 2) * LINE_HEIGHT}>{line}</tspan>
      ))}
    </text>
  )
}

/** Outline of a flow node centered on the group origin. */
function NodeShape({ height, shape, width }: { height: number; shape: AnswerFlowNode['shape']; width: number }) {
  const [x, y] = [-width / 2, -height / 2]
  switch (shape) {
    case 'decision':
      return <polygon points={`0,${y} ${-x},0 0,${-y} ${x},0`} />
    case 'store': {
      const cap = 5
      return (
        <>
          <path d={`M${x},${y + cap} V${-y - cap} A${-x},${cap} 0 0 0 ${-x},${-y - cap} V${y + cap}`} />
          <ellipse cx={0} cy={y + cap} rx={-x} ry={cap} />
        </>
      )
    }
    default:
      return <rect height={height} width={width} x={x} y={y} />
  }
}

interface PlacedNode {
  shape: AnswerFlowNode['shape']
  mark?: AnswerMark | undefined
  lines: string[]
  width: number
  height: number
  at: GraphPoint
}

interface RoutedEdge {
  path: string
  dashed: boolean
  mark?: AnswerMark | undefined
  label?: { lines: string[]; width: number; height: number; at: GraphPoint } | undefined
}

/** Measure, lay out and route a flow. */
function flowDrawing(flow: FlowComponent): { width: number; height: number; nodes: PlacedNode[]; edges: RoutedEdge[] } {
  const nodeFont = diagramFont(NODE_FONT_SIZE, 500)
  const labelFont = diagramFont(LABEL_FONT_SIZE)
  const measureNode = (text: string) => measureText(text, nodeFont, NODE_FONT_SIZE)
  const measureLabel = (text: string) => measureText(text, labelFont, LABEL_FONT_SIZE)
  const sized = flow.nodes.map((node) => {
    const lines = wrapText(node.label, NODE_MAX_TEXT_WIDTH, measureNode)
    const textWidth = Math.max(...lines.map(measureNode))
    const textHeight = lines.length * LINE_HEIGHT
    let width = Math.max(textWidth + 28, 56)
    let height = textHeight + 16
    if (node.shape === 'terminal') width += height / 2
    if (node.shape === 'store') height += 10
    if (node.shape === 'decision') {
      // The diamond is the smallest one whose sides clear the text box.
      const halfHeight = textHeight / 2 + 16
      const halfWidth = (textWidth / 2 + 8) / (1 - (textHeight / 2 + 2) / halfHeight)
      width = halfWidth * 2
      height = halfHeight * 2
    }
    return { ...node, lines, width: Math.ceil(width), height: Math.ceil(height) }
  })
  // One edge per hop and node pair; a repeated hop keeps its first label.
  const hops = new Map<string, { from: number; to: number; dashed: boolean; mark?: AnswerMark | undefined; label?: string | undefined }>()
  for (const chain of flow.chains) {
    chain.groups.slice(1).forEach((group, index) => {
      const label = index === chain.groups.length - 2 ? chain.label : undefined
      for (const from of chain.groups[index] ?? []) {
        for (const to of group) {
          const key = `${from}>${to}`
          const known = hops.get(key)
          if (!known) hops.set(key, { from, to, dashed: chain.dashed[index] ?? false, mark: chain.mark, label })
          else if (!known.label && label) known.label = label
        }
      }
    })
  }
  const edges = [...hops.values()].map((edge) => {
    if (!edge.label) return { ...edge, lines: [] as string[], labelWidth: 0, labelHeight: 0 }
    const lines = wrapText(edge.label, LABEL_MAX_TEXT_WIDTH, measureLabel)
    return { ...edge, lines, labelWidth: Math.ceil(Math.max(...lines.map(measureLabel)) + 10), labelHeight: lines.length * 15 + 4 }
  })
  const horizontal = flow.horizontal
  const placed = layoutGraph(
    sized.map((node, index) => ({ id: String(index), width: node.width, height: node.height })),
    edges.map((edge) => ({ from: String(edge.from), to: String(edge.to), labelWidth: edge.labelWidth, labelHeight: edge.labelHeight })),
    { horizontal, nodeGap: horizontal ? 22 : 30, rankGap: horizontal ? 46 : 34 },
  )
  const nodes: PlacedNode[] = sized.map((node, index) => ({
    shape: node.shape, mark: node.mark, lines: node.lines, width: node.width, height: node.height, at: placed.nodes.get(String(index)) ?? { x: 0, y: 0 },
  }))
  const routed = edges.map((edge, index): RoutedEdge => {
    const route = placed.edges[index]
    const points = route?.points ?? []
    // dagre clips edges at the bounding box; diamonds clip at their sides instead.
    const source = nodes[edge.from]
    const target = nodes[edge.to]
    const second = points[1]
    const beforeLast = points[points.length - 2]
    if (source?.shape === 'decision' && second) points[0] = diamondBoundary(source.at, source.width / 2, source.height / 2, second)
    if (target?.shape === 'decision' && beforeLast) points[points.length - 1] = diamondBoundary(target.at, target.width / 2, target.height / 2, beforeLast)
    const label = edge.labelWidth && route?.label ? { lines: edge.lines, width: edge.labelWidth, height: edge.labelHeight, at: route.label } : undefined
    return { path: splinePath(points), dashed: edge.dashed, mark: edge.mark, label }
  })
  return { width: placed.width, height: placed.height, nodes, edges: routed }
}

// Entity card geometry in CSS pixels.
const ER_HEADER_HEIGHT = 30
const ER_ROW_HEIGHT = 24
const ER_PADDING = 10

interface PlacedTable {
  table: AnswerErTable
  width: number
  height: number
  at: GraphPoint
}

/** Measure, lay out and connect the entity cards. */
function erDrawing(er: ErComponent) {
  const titleFont = diagramFont(NODE_FONT_SIZE, 600)
  const rowFont = diagramFont(12.5, 400, true)
  const smallFont = diagramFont(LABEL_FONT_SIZE)
  const sized = er.tables.map((table) => {
    const noteWidth = (note?: string) => note ? measureText(note, smallFont, LABEL_FONT_SIZE) + 8 : 0
    const rowWidth = Math.max(0, ...table.fields.map((field) => (
      measureText(field.name, rowFont, 12.5) + field.keys.length * 26 + noteWidth(field.note)
      + (field.type ? measureText(field.type, smallFont, LABEL_FONT_SIZE) + 18 : 0)
    )))
    const titleWidth = measureText(table.name, titleFont, NODE_FONT_SIZE) + noteWidth(table.note)
    const width = Math.ceil(Math.max(titleWidth, rowWidth, 100) + ER_PADDING * 2)
    const height = ER_HEADER_HEIGHT + Math.max(table.fields.length, 1) * ER_ROW_HEIGHT
    return { table, width, height }
  })
  // Layout edges run from the referenced table to the referencing one, so parents come first.
  const references = er.tables.flatMap((table, index) => table.fields.flatMap((field, row) => (
    field.target === undefined ? [] : [{ from: index, row, to: field.target, mark: field.mark ?? table.mark }]
  )))
  const placed = layoutGraph(
    sized.map((table, index) => ({ id: String(index), width: table.width, height: table.height })),
    references.map((reference) => ({ from: String(reference.to), to: String(reference.from) })),
    { horizontal: er.horizontal, nodeGap: 26, rankGap: er.horizontal ? 70 : 46 },
  )
  const tables: PlacedTable[] = sized.map((table, index) => ({ ...table, at: placed.nodes.get(String(index)) ?? { x: 0, y: 0 } }))
  const links = references.flatMap((reference) => {
    const source = tables[reference.from]
    const target = tables[reference.to]
    if (!source || !target) return []
    const rowY = source.at.y - source.height / 2 + ER_HEADER_HEIGHT + (reference.row + 0.5) * ER_ROW_HEIGHT
    const targetY = target.at.y - target.height / 2 + ER_HEADER_HEIGHT / 2
    if (reference.from === reference.to) {
      // A self reference loops out of the right side back into the header.
      const right = source.at.x + source.width / 2
      return [{ mark: reference.mark, path: `M${right},${rowY} C${right + 36},${rowY} ${right + 36},${targetY} ${right},${targetY}` }]
    }
    const rightward = target.at.x >= source.at.x
    const startX = source.at.x + (rightward ? source.width / 2 : -source.width / 2)
    const endX = target.at.x + (rightward ? -target.width / 2 : target.width / 2)
    const bend = Math.max(Math.abs(endX - startX) / 2, 28) * (rightward ? 1 : -1)
    return [{ mark: reference.mark, path: `M${startX},${rowY} C${startX + bend},${rowY} ${endX - bend},${targetY} ${endX},${targetY}` }]
  })
  return { width: placed.width + 40, height: placed.height, tables, links }
}

/** One entity card: name header, then one row per field with keys, name and type. */
function ErTable({ table }: { table: PlacedTable }) {
  const x = table.at.x - table.width / 2
  const y = table.at.y - table.height / 2
  return (
    <g className="vda-er-table" data-mark={table.table.mark} transform={`translate(${x} ${y})`}>
      <rect className="vda-er-card" height={table.height} width={table.width} />
      <path className="vda-er-head" d={`M0,0 h${table.width} v${ER_HEADER_HEIGHT} h${-table.width} z`} />
      <text dominantBaseline="central" x={ER_PADDING} y={ER_HEADER_HEIGHT / 2}>
        <tspan className="vda-er-title">{table.table.name}</tspan>
        {table.table.note ? <tspan className="vda-er-note" dx={8}>{table.table.note}</tspan> : null}
      </text>
      {table.table.fields.map((field, row) => {
        const rowY = ER_HEADER_HEIGHT + row * ER_ROW_HEIGHT
        let keyX = ER_PADDING
        return (
          <g className="vda-er-row" data-mark={field.mark} key={row}>
            {row > 0 ? <line className="vda-er-rule" x1={0} x2={table.width} y1={rowY} y2={rowY} /> : null}
            {field.keys.map((key) => {
              const at = keyX
              keyX += 26
              return (
                <g className="vda-er-key" data-key={key} key={key} transform={`translate(${at} ${rowY + ER_ROW_HEIGHT / 2})`}>
                  <rect height={15} width={22} y={-7.5} />
                  <text dominantBaseline="central" textAnchor="middle" x={11}>{key}</text>
                </g>
              )
            })}
            <text dominantBaseline="central" x={keyX} y={rowY + ER_ROW_HEIGHT / 2}>
              <tspan className="vda-er-field">{field.name}</tspan>
              {field.note ? <tspan className="vda-er-note" dx={8}>{field.note}</tspan> : null}
            </text>
            {field.type ? <text className="vda-er-type" dominantBaseline="central" textAnchor="end" x={table.width - ER_PADDING} y={rowY + ER_ROW_HEIGHT / 2}>{field.type}</text> : null}
          </g>
        )
      })}
    </g>
  )
}
