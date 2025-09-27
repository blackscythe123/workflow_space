import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  Connection,
  Edge,
  Node,
  Panel,
  OnConnect,
  useReactFlow,
  ReactFlowProvider,
  SelectionDragHandler,
  NodeMouseHandler,
  EdgeMouseHandler,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { toPng } from 'html-to-image'
import N8NNode from './components/N8NNode'
import { NodeShape, WorkflowEdge, WorkflowNode, PersistedEdge, PersistedNode, NodeData, EdgeArrowDirection, EdgeStyleKind } from './types'
import './styles.css'

const nodeTypes = { n8nNode: N8NNode }

let idCounter = 1
const genId = () => `node_${idCounter++}`

function Editor() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge['data']>([])
  const { project, getViewport } = useReactFlow()

  // Undo/Redo state management
  const [history, setHistory] = useState<Array<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] }>>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isUndoRedo, setIsUndoRedo] = useState(false)

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('theme') as 'light' | 'dark' | null
    if (stored) return stored
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDark ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
    // Re-style existing edges to adapt stroke color to theme
    setEdges((eds: any) => eds.map((e: any) => styleEdge(e)))
  }, [theme, setEdges])

  // -------- Persistence: load saved workflow once --------
  const STORAGE_KEY = 'workflow-persist-v1'
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { nodes: PersistedNode[]; edges: PersistedEdge[] }
        const { nodes: nn, edges: ee } = deserialize(parsed)
        setNodes(nn as any)
        setEdges(ee)
      }
    } catch (e) {
      console.warn('Failed to restore workflow', e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save changes (debounced via rAF)
  const saveFrame = useRef<number | null>(null)
  useEffect(() => {
    if (saveFrame.current) cancelAnimationFrame(saveFrame.current)
    saveFrame.current = requestAnimationFrame(() => {
      try {
        const payload = serialize(nodes as any, edges as any)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      } catch (e) {
        console.warn('Persist save failed', e)
      }
    })
  }, [nodes, edges])

  // Track history for undo/redo (skip during undo/redo operations)
  useEffect(() => {
    if (isUndoRedo) return
    if (nodes.length === 0 && edges.length === 0) return // Skip empty initial state
    
    const newState = { nodes: nodes as WorkflowNode[], edges: edges as WorkflowEdge[] }
    setHistory(prev => {
      // Remove any future history if we're in the middle
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(newState)
      // Keep last 50 states
      return newHistory.slice(-50)
    })
    setHistoryIndex(prev => {
      const newHistory = history.slice(0, prev + 1)
      newHistory.push(newState)
      return Math.min(newHistory.length - 1, 49)
    })
  }, [nodes, edges, isUndoRedo, historyIndex, history])

  const clearWorkflow = useCallback(() => {
    if (!window.confirm('Clear current workflow? This cannot be undone.')) return
    localStorage.removeItem(STORAGE_KEY)
    setNodes([] as any)
    setEdges([] as any)
  }, [setNodes, setEdges])

  const [paneContextMenu, setPaneContextMenu] = useState<{ x: number; y: number; flowPos: { x: number; y: number } } | null>(null)
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null)

  const [editModal, setEditModal] = useState<{
    open: boolean
    nodeId?: string
    shape?: NodeShape
    label?: string
    imageUrl?: string
  orientation?: 0 | 90 | 180 | 270
  }>({ open: false })
  const [edgeEdit, setEdgeEdit] = useState<{ open: boolean; edgeId?: string; styleKind?: EdgeStyleKind; arrow?: EdgeArrowDirection }>({ open: false })

  // Paste JSON modal state
  const [pasteModal, setPasteModal] = useState<{ open: boolean; text: string; error?: string }>({ open: false, text: '' })
  const [aiPromptModal, setAiPromptModal] = useState<{ open: boolean }>({ open: false })

  const [lastMouseFlowPos, setLastMouseFlowPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Cropping state for export
  const [cropping, setCropping] = useState(false)
  const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const cropStartRef = useRef<{ x: number; y: number } | null>(null)


  const onConnect: OnConnect = useCallback(
    (params) =>
      setEdges((eds) => {
        const edge = styleEdge({ ...params, id: `${params.source}-${params.target}-${cryptoRandom()}`, data: { styleKind: 'solid', arrow: 'end' } } as any)
        return addEdge(edge as any, eds as any) as any
      }),
    [setEdges]
  )

  const onPaneContextMenu = useCallback<React.MouseEventHandler>(
    (evt) => {
      evt.preventDefault()
      if (!reactFlowWrapper.current) return
      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      const pos = project({ x: evt.clientX - bounds.left, y: evt.clientY - bounds.top })
      setPaneContextMenu({ x: evt.clientX, y: evt.clientY, flowPos: pos })
      setNodeContextMenu(null)
      setEdgeContextMenu(null)
    },
    [project]
  )

  const onNodeContextMenu = useCallback<NodeMouseHandler>(
    (evt, node) => {
      evt.preventDefault()
      setNodeContextMenu({ x: evt.clientX, y: evt.clientY, nodeId: node.id })
      setPaneContextMenu(null)
      setEdgeContextMenu(null)
    },
    []
  )

  const onEdgeContextMenu = useCallback<EdgeMouseHandler>(
    (evt, edge) => {
      evt.preventDefault()
      setEdgeContextMenu({ x: evt.clientX, y: evt.clientY, edgeId: edge.id })
      setPaneContextMenu(null)
      setNodeContextMenu(null)
    },
    []
  )

  const onPaneClick = useCallback(() => {
    setPaneContextMenu(null)
    setNodeContextMenu(null)
    setEdgeContextMenu(null)
  }, [])

  const addNodeAt = useCallback(
    (shape: NodeShape, position: { x: number; y: number }, opts?: Partial<WorkflowNode>) => {
      const id = genId()
      setNodes((nds) => [
        ...nds,
        {
          id,
          type: 'n8nNode',
          position,
          data: { shape, label: capitalize(shape), orientation: 0, onDoubleClick: () => openEditFor(id) },
          ...opts,
        },
      ])
      return id
    },
    [setNodes]
  )

  const addKindFromToolbar = useCallback(
    (shape: NodeShape) => {
      const vp = getViewport()
      const wrapper = reactFlowWrapper.current
      if (wrapper) {
        const bounds = wrapper.getBoundingClientRect()
        // translate screen center to flow coords
        const screenCenter = { x: bounds.width / 2, y: bounds.height / 2 }
        const center = project(screenCenter)
        addNodeAt(shape, center)
      } else {
        addNodeAt(shape, { x: 0, y: 0 })
      }
    },
    [addNodeAt, getViewport, project]
  )

  const addImageFromToolbar = useCallback(async () => {
    const wrapper = reactFlowWrapper.current
    const center = (() => {
      if (!wrapper) return { x: 0, y: 0 }
      const b = wrapper.getBoundingClientRect()
      return project({ x: b.width / 2, y: b.height / 2 })
    })()
    const rawUrl = window.prompt('Enter image URL (or Cancel to upload a file):')?.trim()
    if (rawUrl) {
      const cleanedUrl = cleanUrl(rawUrl)
      if (looksLikeImageUrl(cleanedUrl)) {
        addNodeAt('circle', center, { data: { shape: 'circle', label: 'Image', imageUrl: cleanedUrl } })
        return
      }
    }
    // trigger file upload
    fileInputRef.current?.click()
  }, [addNodeAt, project])

  const openEditFor = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      const d = node.data as any
  setEditModal({ open: true, nodeId, shape: d.shape, label: d.label, imageUrl: d.imageUrl, orientation: d.orientation ?? 0 })
    },
    [nodes]
  )

  const updateNode = useCallback(
    (nodeId: string, updater: (n: WorkflowNode) => WorkflowNode) => {
      setNodes((nds) => nds.map((n) => (n.id === nodeId ? updater(n as WorkflowNode) : (n as WorkflowNode))))
    },
    [setNodes]
  )

  const deleteNode = useCallback(
    (nodeId: string) => {
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
      setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    },
    [setEdges, setNodes]
  )

  const onDrop: React.DragEventHandler = useCallback(
    (evt) => {
      evt.preventDefault()
      if (!reactFlowWrapper.current) return
      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      const flowPos = project({ x: evt.clientX - bounds.left, y: evt.clientY - bounds.top })

      const files = evt.dataTransfer?.files
      if (files && files.length > 0) {
        const file = files[0]
        if (file.type.startsWith('image/')) {
          const reader = new FileReader()
          reader.onload = () => {
            addNodeAt('circle', flowPos, { data: { shape: 'circle', label: file.name, imageUrl: String(reader.result) } })
          }
          reader.readAsDataURL(file)
        }
      } else {
        const rawUrl = evt.dataTransfer?.getData('text/uri-list') || evt.dataTransfer?.getData('text/plain')
        if (rawUrl) {
          const cleanedUrl = cleanUrl(rawUrl)
          if (looksLikeImageUrl(cleanedUrl)) {
            addNodeAt('circle', flowPos, { data: { shape: 'circle', label: 'Image', imageUrl: cleanedUrl } })
          }
        }
      }
    },
    [addNodeAt, project]
  )

  const onDragOver: React.DragEventHandler = useCallback((evt) => {
    evt.preventDefault()
    evt.dataTransfer.dropEffect = 'copy'
  }, [])

  // Track mouse position to place pasted images
  const onMouseMove: React.MouseEventHandler = useCallback(
    (evt) => {
      if (!reactFlowWrapper.current) return
      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      const flowPos = project({ x: evt.clientX - bounds.left, y: evt.clientY - bounds.top })
      setLastMouseFlowPos(flowPos)
    },
    [project]
  )

  // Paste handler for image URLs
  useEffect(() => {
    const onPaste = (evt: ClipboardEvent) => {
      const rawText = evt.clipboardData?.getData('text/plain')?.trim()
      if (rawText) {
        const cleanedUrl = cleanUrl(rawText)
        if (looksLikeImageUrl(cleanedUrl)) {
          addNodeAt('circle', lastMouseFlowPos, { data: { shape: 'circle', label: 'Pasted Image', imageUrl: cleanedUrl } })
          return
        }
      }
      
      if (evt.clipboardData) {
        const items = evt.clipboardData.items
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.kind === 'file') {
            const file = it.getAsFile()
            if (file && file.type.startsWith('image/')) {
              const reader = new FileReader()
              reader.onload = () => {
                addNodeAt('circle', lastMouseFlowPos, { data: { shape: 'circle', label: 'Pasted Image', imageUrl: String(reader.result) } })
              }
              reader.readAsDataURL(file)
            }
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addNodeAt, lastMouseFlowPos])

  // Undo/Redo functions
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setIsUndoRedo(true)
      const prevState = history[historyIndex - 1]
      setNodes(prevState.nodes as any)
      setEdges(prevState.edges as any)
      setHistoryIndex(historyIndex - 1)
      setTimeout(() => setIsUndoRedo(false), 0)
    }
  }, [history, historyIndex, setNodes, setEdges])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setIsUndoRedo(true)
      const nextState = history[historyIndex + 1]
      setNodes(nextState.nodes as any)
      setEdges(nextState.edges as any)
      setHistoryIndex(historyIndex + 1)
      setTimeout(() => setIsUndoRedo(false), 0)
    }
  }, [history, historyIndex, setNodes, setEdges])

  // Delete via keyboard + undo/redo shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null
      const inInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (inInput) return
        setNodes((nds) => nds.filter((n) => !n.selected))
        setEdges((eds) => eds.filter((e) => !e.selected))
      } else if (e.key.toLowerCase() === 'r') {
        if (inInput) return
        // rotate all selected nodes by +90
        setNodes((nds) => nds.map((n) => {
          if (!n.selected) return n
          const nextO = (((n.data as any).orientation ?? 0) + 90) % 360 as 0|90|180|270
          // Nudge position by +0.001 to force React Flow internal bbox + handle recompute without visible move
          return { ...n, position: { x: n.position.x + 0.001, y: n.position.y + 0.001 }, data: { ...(n.data as any), orientation: nextO, __ver: ((n.data as any).__ver || 0) + 1 } }
        }))
        // Clone edges (path recalculation) after next frame to ensure DOM updated
        requestAnimationFrame(() => setEdges(eds => eds.map(e => ({ ...e }))))
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setEdges, setNodes, undo, redo])

  const downloadJSON = useCallback(() => {
    const payload = serialize(nodes as WorkflowNode[], edges)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    downloadBlob(blob, 'workflow.json')
  }, [nodes, edges])

  const uploadJSON = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
    (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as { nodes: PersistedNode[]; edges: PersistedEdge[] }
          const { nodes: nn, edges: ee } = deserialize(parsed)
          setNodes(nn as any)
          setEdges(ee)
        } catch (err) {
          alert('Invalid workflow JSON')
        }
      }
      reader.readAsText(file)
      // Reset input to allow re-uploading same file
      e.currentTarget.value = ''
    },
    [setEdges, setNodes]
  )

  const downloadAsPng = useCallback(async () => {
    if (!reactFlowWrapper.current) return
    const root = document.documentElement
    const prevTheme = root.dataset.theme
    // Force light theme for export so nodes/edges are in bright theme
    root.dataset.theme = 'light'
    // Make background transparent temporarily
    const originalBg = root.style.backgroundColor
    const wrapperEl = reactFlowWrapper.current.querySelector('.react-flow__viewport') as HTMLElement | null
    const target = wrapperEl || reactFlowWrapper.current
    const prevWrapperBg = (target as HTMLElement).style.backgroundColor
    ;(target as HTMLElement).style.backgroundColor = 'transparent'
    try {
      const pixelRatio = 2
      const fullDataUrl = await toPng(target, {
        cacheBust: true,
        pixelRatio,
        backgroundColor: 'transparent'
      })
      if (cropRect) {
        // Create cropped image from full export
        const img = new Image()
        img.src = fullDataUrl
        await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = rej })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(cropRect.width * pixelRatio))
        canvas.height = Math.max(1, Math.round(cropRect.height * pixelRatio))
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(
          img,
          cropRect.x * pixelRatio,
          cropRect.y * pixelRatio,
          cropRect.width * pixelRatio,
          cropRect.height * pixelRatio,
          0,
          0,
          cropRect.width * pixelRatio,
          cropRect.height * pixelRatio
        )
        downloadDataUrl(canvas.toDataURL('image/png'), 'workflow-crop.png')
      } else {
        downloadDataUrl(fullDataUrl, 'workflow.png')
      }
    } catch (e) {
      console.error(e)
      alert('Failed to export PNG')
    } finally {
      // Restore styles
      root.dataset.theme = prevTheme || ''
      if (prevWrapperBg) (target as HTMLElement).style.backgroundColor = prevWrapperBg
      else (target as HTMLElement).style.removeProperty('background-color')
      if (originalBg) root.style.backgroundColor = originalBg
      // Reset crop mode after export
      setCropping(false)
      setCropRect(null)
    }
  }, [])

  // SVG export removed per requirements

  const nodeDoubleClick = useCallback<NodeMouseHandler>((evt, node) => {
    openEditFor(node.id)
  }, [openEditFor])

  // Close menus on scroll/zoom
  const onMove = useCallback(() => {
    setPaneContextMenu(null)
    setNodeContextMenu(null)
    setEdgeContextMenu(null)
  }, [])

  return (
    <div className="app-root">
      <div className="toolbar" onContextMenu={(e) => e.preventDefault()}>
  <button onClick={() => addKindFromToolbar('circle')}>Add Circle</button>
  <button onClick={() => addKindFromToolbar('square')}>Add Square</button>
  <button onClick={() => addKindFromToolbar('rectangle')}>Add Rectangle</button>
  <button onClick={() => addKindFromToolbar('squareRightRound')}>Add Sq Right Round</button>
  <button onClick={() => addKindFromToolbar('rectRightRound')}>Add Rect Right Round</button>
        <span className="spacer" />
        <button onClick={clearWorkflow} title="Clear workflow and forget saved state">Clear</button>
        <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title="Toggle theme">
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
        <span style={{ width: 8 }} />
        <button onClick={downloadJSON}>Export JSON</button>
        <label className="upload-btn">
          Import JSON
          <input type="file" accept="application/json" onChange={uploadJSON} />
        </label>
  <button onClick={() => setPasteModal({ open: true, text: '', error: undefined })}>Paste JSON</button>
  <button onClick={() => setAiPromptModal({ open: true })}>AI Prompt</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const wrapper = reactFlowWrapper.current
            const b = wrapper?.getBoundingClientRect()
            const center = wrapper && b ? project({ x: b.width / 2, y: b.height / 2 }) : { x: 0, y: 0 }
            const file = e.currentTarget.files?.[0]
            if (file && file.type.startsWith('image/')) {
              const reader = new FileReader()
              reader.onload = () => {
                addNodeAt('circle', center, { data: { shape: 'circle', label: file.name, imageUrl: String(reader.result) } })
              }
              reader.readAsDataURL(file)
            }
            e.currentTarget.value = ''
          }}
        />
        <span className="spacer" />
  {!cropping && <button onClick={() => { setCropping(true); setCropRect(null) }}>Start Crop</button>}
  {cropping && <button onClick={() => { setCropping(false); setCropRect(null) }}>Cancel Crop</button>}
  <button onClick={downloadAsPng}>{cropping ? 'Download Cropped PNG' : 'Download Workflow as Image (PNG)'}</button>
      </div>

      <div className="flow-wrapper" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneClick={onPaneClick}
          onNodeDoubleClick={nodeDoubleClick}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onMouseMove={onMouseMove}
          onMove={onMove}
          defaultEdgeOptions={{ style: { stroke: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#0f172a' } }}
          fitView
        >
          <Background variant={BackgroundVariant.Lines} gap={24} size={1} color={getComputedStyle(document.documentElement).getPropertyValue('--flow-grid').trim() || '#e5e7eb'} />
          <MiniMap pannable zoomable nodeColor={getMiniMapColor} />
          <Controls />
          <Panel position="bottom-left" className="hint">
            Tips: Right-click to add or edit. Paste an image URL or drop an image file to create an Image node.
          </Panel>
        </ReactFlow>

        {paneContextMenu && (
          <ContextMenu x={paneContextMenu.x} y={paneContextMenu.y} onClose={() => setPaneContextMenu(null)}>
            <h4>Add node</h4>
            {(['circle', 'square', 'rectangle', 'squareRightRound', 'rectRightRound'] as NodeShape[]).map((k) => (
              <MenuItem
                key={k}
                onClick={() => {
                  addNodeAt(k, paneContextMenu.flowPos)
                  setPaneContextMenu(null)
                }}
              >
                {capitalize(k)}
              </MenuItem>
            ))}
          </ContextMenu>
        )}

        {nodeContextMenu && (
          <ContextMenu x={nodeContextMenu.x} y={nodeContextMenu.y} onClose={() => setNodeContextMenu(null)}>
            <MenuItem onClick={() => openEditFor(nodeContextMenu.nodeId)}>Edit…</MenuItem>
            <MenuItem onClick={() => { updateNode(nodeContextMenu.nodeId, (n)=> { const cur = (n.data as any).orientation ?? 0; const next = ((cur + 90) % 360) as 0|90|180|270; requestAnimationFrame(()=> setEdges(eds=>eds.map(e=> ({ ...e })))); return { ...n, position: { x: n.position.x + 0.001, y: n.position.y + 0.001 }, data: { ...(n.data as any), orientation: next, __ver: ((n.data as any).__ver||0)+1 } } as any }); setNodeContextMenu(null) }}>Rotate 90°</MenuItem>
            <hr />
            <h4>Change shape</h4>
            {(['circle', 'square', 'rectangle', 'squareRightRound', 'rectRightRound'] as NodeShape[]).map((k) => (
              <MenuItem
                key={k}
                onClick={() => {
                  updateNode(nodeContextMenu.nodeId, (n) => ({ ...n, data: { ...(n.data as any), shape: k } }))
                  setNodeContextMenu(null)
                }}
              >
                {capitalize(k)}
              </MenuItem>
            ))}
            <hr />
            <MenuItem onClick={() => { deleteNode(nodeContextMenu.nodeId); setNodeContextMenu(null) }}>Delete</MenuItem>
          </ContextMenu>
        )}

        {edgeContextMenu && (
          <ContextMenu x={edgeContextMenu.x} y={edgeContextMenu.y} onClose={() => setEdgeContextMenu(null)}>
            <MenuItem onClick={() => { setEdgeEdit({ open: true, edgeId: edgeContextMenu.edgeId, styleKind: (edges.find(e=>e.id===edgeContextMenu.edgeId)?.data as any)?.styleKind ?? 'solid', arrow: (edges.find(e=>e.id===edgeContextMenu.edgeId)?.data as any)?.arrow ?? 'end' }); setEdgeContextMenu(null) }}>Edit…</MenuItem>
            <MenuItem onClick={() => { setEdges((eds) => eds.filter((e) => e.id !== edgeContextMenu.edgeId)); setEdgeContextMenu(null) }}>Delete Edge</MenuItem>
          </ContextMenu>
        )}

        {editModal.open && editModal.nodeId && (
          <EditModal
            initial={{ shape: editModal.shape ?? 'rectangle', label: editModal.label ?? '', imageUrl: editModal.imageUrl ?? '', orientation: 0 }}
            onClose={() => setEditModal({ open: false })}
            onSave={(values) => {
              updateNode(editModal.nodeId!, (n) => ({
                ...n,
                data: { ...(n.data as any), shape: values.shape, label: values.label || capitalize(values.shape), imageUrl: values.imageUrl || (n.data as any).imageUrl, orientation: values.orientation },
              }))
              setEditModal({ open: false })
            }}
          />
        )}

        {edgeEdit.open && edgeEdit.edgeId && (
          <EdgeEditModal
            initial={{ styleKind: edgeEdit.styleKind ?? 'solid', arrow: edgeEdit.arrow ?? 'end' }}
            onClose={() => setEdgeEdit({ open: false })}
            onSave={(v) => {
              setEdges((eds) => eds.map((e) => e.id === edgeEdit.edgeId ? styleEdge({ ...e, data: { ...(e.data as any), styleKind: v.styleKind, arrow: v.arrow } } as any) : e))
              setEdgeEdit({ open: false })
            }}
          />
        )}

        {pasteModal.open && (
          <PasteJsonModal
            initialText={pasteModal.text}
            error={pasteModal.error}
            onClose={() => setPasteModal({ open: false, text: '' })}
            onImport={(text) => {
              try {
                const parsed = JSON.parse(text) as { nodes: PersistedNode[]; edges: PersistedEdge[] }
                if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
                  throw new Error('Missing nodes/edges array')
                }
                const { nodes: nn, edges: ee } = deserialize(parsed)
                setNodes(nn as any)
                setEdges(ee)
                setPasteModal({ open: false, text: '' })
              } catch (err: any) {
                setPasteModal((pm) => ({ ...pm, error: err?.message || 'Invalid JSON' }))
              }
            }}
          />
        )}

        {aiPromptModal.open && (
          <AiPromptModal onClose={() => setAiPromptModal({ open: false })} />
        )}

        {cropping && (
          <div
            className="crop-overlay-active"
            onMouseDown={(e) => {
              if (!reactFlowWrapper.current) return
              const vp = reactFlowWrapper.current.querySelector('.react-flow__viewport') as HTMLElement | null
              const bounds = (vp || reactFlowWrapper.current).getBoundingClientRect()
              const x = e.clientX - bounds.left
              const y = e.clientY - bounds.top
              cropStartRef.current = { x, y }
              setCropRect({ x, y, width: 0, height: 0 })
            }}
            onMouseMove={(e) => {
              if (!cropStartRef.current || !reactFlowWrapper.current) return
              const vp = reactFlowWrapper.current.querySelector('.react-flow__viewport') as HTMLElement | null
              const bounds = (vp || reactFlowWrapper.current).getBoundingClientRect()
              const curX = e.clientX - bounds.left
              const curY = e.clientY - bounds.top
              const start = cropStartRef.current
              const x = Math.min(start.x, curX)
              const y = Math.min(start.y, curY)
              const width = Math.abs(curX - start.x)
              const height = Math.abs(curY - start.y)
              setCropRect({ x, y, width, height })
            }}
            onMouseUp={() => {
              cropStartRef.current = null
            }}
            onDoubleClick={() => { setCropping(false); }}
          >
            {cropRect && (
              <div
                className="crop-rect"
                style={{ left: cropRect.x, top: cropRect.y, width: cropRect.width, height: cropRect.height }}
              />
            )}
            <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 12, background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '4px 8px', borderRadius: 4, pointerEvents: 'none' }}>
              Drag to select area. Release then click Download. Esc cancels.
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  )
}

function getMiniMapColor(node: Node): string {
  const shape = (node as any).data?.shape as NodeShape | undefined
  switch (shape) {
    case 'circle':
      return '#6B7280'
    case 'square':
      return '#3B82F6'
    case 'rectangle':
      return '#6366F1'
    case 'squareRightRound':
      return '#10B981'
    case 'rectRightRound':
      return '#F59E0B'
    default:
      return '#94a3b8'
  }
}

function serialize(nodes: WorkflowNode[], edges: WorkflowEdge[]): { nodes: PersistedNode[]; edges: PersistedEdge[] } {
  const outNodes: PersistedNode[] = nodes.map((n) => ({
    id: n.id,
    shape: (n.data as any).shape,
    position: n.position,
  data: { label: (n.data as any).label, imageUrl: (n.data as any).imageUrl, orientation: (n.data as any).orientation },
  }))
  const outEdges: PersistedEdge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data as any }))
  return { nodes: outNodes, edges: outEdges }
}

function deserialize(payload: { nodes: PersistedNode[]; edges: PersistedEdge[] }): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nn: WorkflowNode[] = payload.nodes.map((n) => ({ 
    id: n.id, 
    type: 'n8nNode', 
    position: n.position, 
    data: { 
      shape: n.shape, 
      label: n.data?.label, 
      imageUrl: cleanUrl(n.data?.imageUrl || ''), 
      orientation: n.data?.orientation ?? 0 
    } 
  }))
  const ee: WorkflowEdge[] = payload.edges.map((e) => styleEdge({ id: e.id, source: e.source, target: e.target, data: e.data as any } as any))
  // Reset id counter to avoid collisions
  const maxId = nn.reduce((m, n) => Math.max(m, parseInt(n.id.split('_')[1] || '0', 10) || 0), 0)
  idCounter = Math.max(idCounter, maxId + 1)
  return { nodes: nn, edges: ee }
}

// -------- Image URL validation & semantic fallback helpers (updated to support Unsplash/photos) --------
// Cache to avoid re-validating same URL repeatedly
const imageUrlValidityCache = new Map<string, boolean>()

function validateImageUrl(url: string, timeoutMs = 6000): Promise<boolean> {
  if (!url) return Promise.resolve(false)
  if (imageUrlValidityCache.has(url)) return Promise.resolve(!!imageUrlValidityCache.get(url))
  // Only allow https SVGs per strict rules
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') {
      imageUrlValidityCache.set(url, false)
      return Promise.resolve(false)
    }
  } catch {
    imageUrlValidityCache.set(url, false)
    return Promise.resolve(false)
  }
  // Accept common raster or svg formats now (png/jpg/jpeg/webp/svg)
  if (!/\.(png|jpe?g|webp|svg)(\?|$)/i.test(url)) {
    // Some Unsplash endpoints omit extension (e.g. photos/random); allow those hosting domains
    if (!/unsplash\.com|images\.unsplash\.com/i.test(url)) {
      imageUrlValidityCache.set(url, false)
      return Promise.resolve(false)
    }
  }
  return new Promise<boolean>((resolve) => {
    const img = new Image()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      imageUrlValidityCache.set(url, ok)
      resolve(ok)
    }
    const to = window.setTimeout(() => finish(false), timeoutMs)
    img.onload = () => { window.clearTimeout(to); finish(true) }
    img.onerror = () => { window.clearTimeout(to); finish(false) }
    img.src = url
  })
}

// Map label keywords to Unsplash search query terms (broad thematic backgrounds)
const keywordToSearch: Array<{ re: RegExp; q: string }> = [
  { re: /ingest|input|receive|source/i, q: 'data stream' },
  { re: /upload|send|emit|produce/i, q: 'cloud upload' },
  { re: /parse|clean|sanitize|extract/i, q: 'code clean' },
  { re: /valid|auth|check|verify|guard/i, q: 'security shield' },
  { re: /transform|normalize|convert|map/i, q: 'abstract transformation' },
  { re: /feature|enrich|augment/i, q: 'layers technology' },
  { re: /decision|branch|route|split/i, q: 'decision tree' },
  { re: /merge|join|converge/i, q: 'converging lines' },
  { re: /queue|buffer/i, q: 'queue stack' },
  { re: /task|work|job/i, q: 'checklist' },
  { re: /build|compile/i, q: 'construction tools' },
  { re: /test|qa|spec/i, q: 'laboratory flask' },
  { re: /package|bundle/i, q: 'package box' },
  { re: /deploy|release|ship|publish/i, q: 'rocket launch' },
  { re: /notify|alert|email|sms|message/i, q: 'notification bell' },
  { re: /error|fail|exception|panic/i, q: 'warning sign' },
  { re: /log|audit/i, q: 'clipboard document' },
  { re: /metric|stat|kpi|analytics|telemetry/i, q: 'analytics dashboard' },
  { re: /model|train|infer|predict|ml|ai/i, q: 'artificial intelligence' },
  { re: /database|db|store|persistence/i, q: 'database server' },
  { re: /cache|redis|mem/i, q: 'server rack' },
  { re: /api|service|endpoint/i, q: 'cloud api' },
  { re: /auth|login|token|oauth|sso/i, q: 'lock security' },
  { re: /schedule|cron|time|timer|delay/i, q: 'calendar schedule' },
  { re: /export|share|deliver|output/i, q: 'share network' },
]

function guessSearchTerm(label?: string): string {
  if (!label) return 'abstract technology'
  for (const { re, q } of keywordToSearch) {
    if (re.test(label)) return q
  }
  return 'abstract technology'
}

// Unsplash source endpoint (random representative image by search). We constrain size for performance.
function buildImageUrl(term: string): string {
  const encoded = encodeURIComponent(term)
  // Using older source endpoint pattern
  return `https://source.unsplash.com/featured/160x160?${encoded}`
}

async function ensureValidImageUrls(nodes: WorkflowNode[]): Promise<{ nodes: WorkflowNode[]; replaced: Array<{ id: string; from?: string; to: string }> }> {
  // No longer remove or replace invalid image URLs; always return original nodes unchanged
  return { nodes, replaced: [] }
}

function styleEdge(e: WorkflowEdge): WorkflowEdge {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#0f172a'
  const styleKind = (e.data as any)?.styleKind as EdgeStyleKind | undefined
  const arrow = (e.data as any)?.arrow as EdgeArrowDirection | undefined
  const dash = styleKind === 'dashed' ? '6 4' : styleKind === 'dotted' ? '2 4' : undefined
  const markerStart = arrow === 'start' || arrow === 'both' ? { type: MarkerType.ArrowClosed, color } : undefined
  const markerEnd = arrow === 'end' || arrow === 'both' ? { type: MarkerType.ArrowClosed, color } : undefined
  return { ...e, style: { ...(e.style || {}), stroke: color, strokeDasharray: dash }, markerStart, markerEnd }
}

// Clean up URLs that might be in markdown format [text](url) or just have extra formatting
function cleanUrl(text: string): string {
  if (!text) return text
  
  // Remove markdown link format: [text](url) -> url
  const markdownMatch = text.match(/\[.*?\]\((https?:\/\/[^)]+)\)/)
  if (markdownMatch) {
    return markdownMatch[1]
  }
  
  // Also handle just the URL part if someone pastes [url](url) format
  const duplicateUrlMatch = text.match(/\[(https?:\/\/[^\]]+)\]\(\1\)/)
  if (duplicateUrlMatch) {
    return duplicateUrlMatch[1]
  }
  
  // Remove extra whitespace and common wrapper characters
  return text.trim().replace(/^[\[\("'`]+|[\]\)"'`]+$/g, '')
}

// Heuristic to detect if a pasted/dropped URL is likely an image.
// Extends simple extension check to support dynamic image CDNs (unsplash, picsum, placeholder services, etc.).
function looksLikeImageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const pathOk = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i.test(u.pathname)
    if (pathOk) return true
    const hostHint = /(unsplash|picsum|placekitten|placehold|loremflickr|dummyimage|placeimg|placebear)/i.test(u.hostname)
    if (hostHint) return true
    const queryHint = /(image|format=|width=|height=|w=|h=|img)/i.test(u.search)
    return queryHint
  } catch {
    return false
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

function cryptoRandom() {
  if ('crypto' in window && 'getRandomValues' in crypto) {
    const arr = new Uint32Array(1)
    crypto.getRandomValues(arr)
    return String(arr[0])
  }
  return String(Math.floor(Math.random() * 1e9))
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ================ UI Bits ================
function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let ignoreFirstContext = true
    const handleClick = (e: MouseEvent) => {
      if (!ref.current) return
      const target = e.target as HTMLElement | null
      if (target && !ref.current.contains(target)) onClose()
    }
    const handleContext = (e: MouseEvent) => {
      if (ignoreFirstContext) { ignoreFirstContext = false; return }
      if (!ref.current) return
      const target = e.target as HTMLElement | null
      if (target && !ref.current.contains(target)) onClose()
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu', handleContext)
    window.addEventListener('scroll', onClose, { once: true })
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu', handleContext)
      window.removeEventListener('scroll', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="context-menu" style={{ top: y, left: x }} onContextMenu={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="menu-item" onClick={onClick}>
      {children}
    </button>
  )
}

function EditModal({ initial, onSave, onClose }: { initial: { shape: NodeShape; label: string; imageUrl: string; orientation: 0 | 90 | 180 | 270 }; onSave: (v: { shape: NodeShape; label: string; imageUrl: string; orientation: 0 | 90 | 180 | 270 }) => void; onClose: () => void }) {
  const [shape, setShape] = useState<NodeShape>(initial.shape)
  const [label, setLabel] = useState(initial.label)
  const [imageUrl, setImageUrl] = useState(initial.imageUrl)
  const [orientation, setOrientation] = useState<0 | 90 | 180 | 270>(initial.orientation)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Node</h3>
        <label>
          Shape
          <select value={shape} onChange={(e) => setShape(e.target.value as NodeShape)}>
            <option value="circle">Circle</option>
            <option value="square">Square</option>
            <option value="rectangle">Rectangle</option>
            <option value="squareRightRound">Square Right Round</option>
            <option value="rectRightRound">Rect Right Round</option>
          </select>
        </label>

        <label>
          Title/Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        </label>

        <label>
          Image URL (optional)
          <input 
            value={imageUrl} 
            onChange={(e) => setImageUrl(cleanUrl(e.target.value))} 
            placeholder="https://..." 
            onBlur={(e) => setImageUrl(cleanUrl(e.target.value))}
          />
        </label>

        <label>
          Orientation
          <select value={orientation} onChange={(e) => setOrientation(Number(e.target.value) as 0 | 90 | 180 | 270)}>
            <option value={0}>0°</option>
            <option value={90}>90°</option>
            <option value={180}>180°</option>
            <option value={270}>270°</option>
          </select>
        </label>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => onSave({ shape, label, imageUrl, orientation })}>Save</button>
        </div>
      </div>
    </div>
  )
}

function EdgeEditModal({ initial, onSave, onClose }: { initial: { styleKind: EdgeStyleKind; arrow: EdgeArrowDirection }; onSave: (v: { styleKind: EdgeStyleKind; arrow: EdgeArrowDirection }) => void; onClose: () => void }) {
  const [styleKind, setStyleKind] = useState<EdgeStyleKind>(initial.styleKind)
  const [arrow, setArrow] = useState<EdgeArrowDirection>(initial.arrow)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Edge</h3>
        <label>
          Line style
          <select value={styleKind} onChange={(e) => setStyleKind(e.target.value as EdgeStyleKind)}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
        <label>
          Arrow
          <select value={arrow} onChange={(e) => setArrow(e.target.value as EdgeArrowDirection)}>
            <option value="none">None</option>
            <option value="start">Start</option>
            <option value="end">End</option>
            <option value="both">Both</option>
          </select>
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => onSave({ styleKind, arrow })}>Save</button>
        </div>
      </div>
    </div>
  )
}

function PasteJsonModal({ initialText, error, onImport, onClose }: { initialText: string; error?: string; onImport: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initialText)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 520, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <h3>Paste Workflow JSON</h3>
        <p style={{ fontSize: 12, marginTop: -4, opacity: 0.8 }}>Paste the JSON previously exported. This will replace the current workflow.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"nodes":[],"edges":[]}'
          style={{ width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 12 }}
        />
        {error && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 12, marginTop: 4 }}>{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => onImport(text)}>Import</button>
        </div>
      </div>
    </div>
  )
}

function AiPromptModal({ onClose }: { onClose: () => void }) {
  const prompt = `You are a workflow graph generator. Convert the user’s natural language description into a JSON object representing a directed flow of nodes and edges for a React Flow based editor.\n\nOUTPUT RULES (strict):\n- Output ONLY raw JSON (no markdown, commentary, fencing).\n- Do NOT wrap JSON in backticks.\n- Top-level object only: { "nodes": [...], "edges": [...] }.\n- Unique ids for every node & edge.\n- Each edge.source/edge.target must exist as a node id.\n- Prefer acyclic unless explicit loops described.\n- Property order: nodes[id, shape, position, data], edges[id, source, target, data].\n- No extra keys. No null; omit instead. Numbers finite.\n- EVERY node MUST include data.imageUrl pointing to a meaningful, stable, openly-licensed HTTPS image (public domain / CC0 / freely reusable).\n\nSHAPES: circle | square | rectangle | squareRightRound | rectRightRound\nORIENTATION: 0 | 90 | 180 | 270 (omit if 0).\nEDGE defaults: styleKind=\"solid\", arrow=\"end\" (omit if default).\n\nIMAGE URL POLICY (MANDATORY):\n- Use stable direct image URLs (PNG/JPG/SVG/WebP) hosted on reputable open-license sources.\n- CRITICAL: Output ONLY clean URLs - NO markdown formatting like [text](url).\n- Each URL must be HTTPS and point directly to the image file.\n- Examples of good URLs: https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Icon.png/64px-Icon.png\n- Do NOT use: [description](url) or any bracketed formats.\n- No placeholders (no lorem/example/dummy services).\n- Avoid repeating the exact same imageUrl for different semantic roles unless justified.\n\nNODE LABELING (MANDATORY):\n- Each node must have a clear, descriptive data.label (2-4 words max).\n- Labels should describe the ACTION or PURPOSE, not just generic terms.\n- Good examples: \"Validate Input\", \"Transform Data\", \"Send Email\", \"Check Status\".\n- Bad examples: \"Node 1\", \"Process\", \"Step\", \"Item\".\n- Use active verbs when possible: \"Parse\", \"Filter\", \"Generate\", \"Deploy\".\n- For decision nodes: \"Route by Type\", \"Check Condition\", \"Validate Rules\".\n- For input/output: \"Receive Data\", \"Export Results\", \"Load Config\".\n\nSEMANTIC GUIDANCE:\n- ingest/input: data pipeline, upload arrow, input funnel\n- validate/check: shield, checkmark, security badge  \n- transform/process: gears, conversion arrows, data transformation\n- decision/branch: diamond, fork in road, decision tree\n- merge/join: converging arrows, merge symbol\n- deploy/output: rocket launch, deployment, export\n- error/alert: warning triangle, error symbol, alert icon\n- database/store: database cylinders, storage, archive\n- api/service: cloud, network, api symbol\n- schedule/time: calendar, clock, timer\n\nLAYOUT: Left→Right. First node {x:0,y:0}. Increment x ≈230 per stage. Branch siblings share same x; vertical spacing ≈140. Keep coordinates integer ≥0. Center decision node above its branches. Merge only if user describes reconvergence.\n\nSHAPE GUIDANCE:\ncircle=external trigger/input; square=atomic task; rectangle=processing/aggregation; squareRightRound=decision/gateway; rectRightRound=integration/output/deployment.\n\nORIENTATION: use sparingly (≤25% nodes) for emphasis.\n\nID RULES: node_1..node_N dense; edge_1..edge_M dense.\n\nVALIDATION BEFORE OUTPUT:\n1. All edges reference existing nodes.\n2. Every node has data.imageUrl (HTTPS, direct image, open-license, NO markdown formatting).\n3. Every node has meaningful data.label (descriptive action/purpose).\n4. At least one node.\n5. No duplicate ids.\n6. JSON parses (no comments/trailing commas).\n7. Coordinates numeric.\n8. No extraneous properties.\n\nUSER DESCRIPTION TO TRANSFORM:\n<<USER_WORKFLOW_DESCRIPTION>>\n\nDELIVERABLE: Return ONLY the JSON object.`
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(prompt).then(()=> { setCopied(true); setTimeout(()=> setCopied(false), 1600) }) }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 780, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 8 }}>AI Master Prompt</h3>
        <p style={{ fontSize: 12, marginTop: 0, opacity: 0.8 }}>Copy this prompt and insert a description to generate workflow JSON (each node gets a stable open-license image URL).</p>
        <textarea readOnly value={prompt} style={{ flex: 1, width: '100%', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre', overflow: 'auto', minHeight: 320 }} />
        <div className="modal-actions" style={{ marginTop: 8 }}>
          <button onClick={onClose}>Close</button>
          <button onClick={copy}>{copied ? 'Copied!' : 'Copy Prompt'}</button>
        </div>
      </div>
    </div>
  )
}
