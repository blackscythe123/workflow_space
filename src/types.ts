import type { Edge, Node } from 'reactflow'

// Supported shapes (user-requested)
// squareRightRound: square with right side rounded
// rectRightRound: rectangle with right side rounded
export type NodeShape = 'circle' | 'square' | 'rectangle' | 'squareRightRound' | 'rectRightRound'

export type NodeData = {
  label?: string
  imageUrl?: string
  shape: NodeShape
  orientation?: 0 | 90 | 180 | 270 // rotation in degrees
  onDoubleClick?: () => void
}

// Alias to React Flow's Node with our data shape
export type WorkflowNode = Node<NodeData>

export type EdgeStyleKind = 'solid' | 'dashed' | 'dotted'
export type EdgeArrowDirection = 'none' | 'start' | 'end' | 'both'

export type WorkflowEdge = Edge<{
  styleKind?: EdgeStyleKind
  arrow?: EdgeArrowDirection
}>

export type PersistedNode = {
  id: string
  shape: NodeShape
  position: { x: number; y: number }
  data: {
    label?: string
    imageUrl?: string
  orientation?: 0 | 90 | 180 | 270
  }
}

export type PersistedEdge = {
  id: string
  source: string
  target: string
  data?: {
    styleKind?: EdgeStyleKind
    arrow?: EdgeArrowDirection
  }
}
