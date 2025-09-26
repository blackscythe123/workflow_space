import React, { memo, useCallback, useMemo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import clsx from 'clsx'
import { NodeShape } from '../types'

const HEADER = '#475569'

// Minimal inline SVG icons (no external deps)
function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13 2 3 14h6l-2 8 10-12h-6l2-8z" />
    </svg>
  )
}

function WrenchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21 7a6 6 0 0 1-7.5 5.8L7.8 18.5a2 2 0 0 1-2.8 0 2 2 0 0 1 0-2.8l5.7-5.7A6 6 0 1 1 21 7zM6 18l.7-.7" />
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 9 5 12l3 3" />
      <path d="M16 9l3 3-3 3" />
      <path d="M13 5 11 19" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 3 2.5 15 0 18" />
      <path d="M12 3c-2.5 3-2.5 15 0 18" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10.5" r="1.5" />
      <path d="M21 17l-5.5-5.5L9 18" />
    </svg>
  )
}

const ICONS: Record<NodeShape, React.ReactNode> = {
  circle: <ImageIcon />,
  square: <BoltIcon />,
  rectangle: <WrenchIcon />,
  squareRightRound: <GlobeIcon />,
  rectRightRound: <CodeIcon />,
}

export type N8NNodeData = {
  label?: string
  shape: NodeShape
  imageUrl?: string
  orientation?: 0 | 90 | 180 | 270
  onDoubleClick?: () => void
}

export default memo(function N8NNode({ data, selected }: NodeProps<N8NNodeData>) {
  const icon = ICONS[data.shape]

  const onDouble = useCallback(() => {
    data.onDoubleClick?.()
  }, [data])

  const o = data.orientation ?? 0

  // Base (unrotated) container dimensions
  const baseDims = useMemo(() => {
    switch (data.shape) {
      case 'rectangle': return { w: 150, h: 60 }
      case 'rectRightRound': return { w: 150, h: 60 }
      case 'circle': return { w: 90, h: 90 }
      case 'squareRightRound': return { w: 90, h: 90 }
      case 'square': return { w: 90, h: 90 }
      default: return { w: 100, h: 60 }
    }
  }, [data.shape])

  // Swap width/height for 90/270 (pure layout rotation – avoids transform side‑effects)
  const rotated = (o === 90 || o === 270)
  const dims = rotated ? { w: baseDims.h, h: baseDims.w } : baseDims
  const midY = dims.h / 2
  const midX = dims.w / 2

  // Orientation-based sides for React Flow (edge routing). We purposely match visual orientation logic.
  const targetPos = rotated ? Position.Top : Position.Left
  const sourcePos = rotated ? Position.Bottom : Position.Right

  // Border radius logic for asymmetric right-rounded variants: rotate the "rounded side".
  function roundedSideStyle(): React.CSSProperties | undefined {
    if (data.shape !== 'squareRightRound' && data.shape !== 'rectRightRound') return undefined
    const large = 40
    const small = data.shape === 'squareRightRound' ? 8 : 10
    // Orientation mapping: 0=right, 90=bottom, 180=left, 270=top
    const r = { tl: small, tr: small, br: small, bl: small }
    if (o === 0) { r.tr = large; r.br = large }
    else if (o === 90) { r.bl = large; r.br = large }
    else if (o === 180) { r.tl = large; r.bl = large }
    else if (o === 270) { r.tl = large; r.tr = large }
    return {
      borderTopLeftRadius: r.tl,
      borderTopRightRadius: r.tr,
      borderBottomRightRadius: r.br,
      borderBottomLeftRadius: r.bl,
    }
  }

  const baseRadius: React.CSSProperties = (() => {
    switch (data.shape) {
      case 'circle': return { borderRadius: 999 } // circle unaffected by orientation
      case 'square': return { borderRadius: 8 }
      case 'rectangle': return { borderRadius: 10 }
      case 'rectRightRound':
      case 'squareRightRound': return roundedSideStyle() || {}
      default: return {}
    }
  })()

  const containerStyle: React.CSSProperties = {
    width: dims.w,
    height: dims.h,
    ...baseRadius,
  }

  // Handle placement (excluding caption area)
  const handleCommon: React.CSSProperties = { width: 10, height: 10 }
  let targetStyle: React.CSSProperties
  let sourceStyle: React.CSSProperties
  if (rotated) {
    targetStyle = { ...handleCommon, top: 0, left: midX, transform: 'translate(-50%, -50%)' }
    sourceStyle = { ...handleCommon, top: dims.h, left: midX, transform: 'translate(-50%, -50%)' }
  } else {
    targetStyle = { ...handleCommon, top: midY, left: 0, transform: 'translate(-50%, -50%)' }
    sourceStyle = { ...handleCommon, top: midY, left: dims.w, transform: 'translate(-50%, -50%)' }
  }

  return (
    <div className={clsx('n8n-node', 'n8n-shape', `n8n-shape--${data.shape}`, { selected })} onDoubleClick={onDouble}>
      <div className="n8n-shape__container" style={containerStyle}>
        {data.imageUrl ? (
          <img className="n8n-shape__image" src={data.imageUrl} alt={data.label ?? 'Node'} />
        ) : (
          <div className="n8n-shape__icon" aria-hidden>
            {icon}
          </div>
        )}
      </div>
  <div className="n8n-shape__caption" title={data.label}>{data.label ?? 'Untitled'}</div>
      <Handle className="n8n-node__handle" type="target" position={targetPos} style={targetStyle} />
      <Handle className="n8n-node__handle" type="source" position={sourcePos} style={sourceStyle} />
    </div>
  )
})

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
