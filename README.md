# Shape-based Workflow Editor (React + React Flow)

A single-page web app for building workflows with a focused set of shapes. Supported shapes: circle, square, rectangle, square with right side rounded, rectangle with right side rounded. Each node shows a label below and an optional centered image. Orientation (0° / 90° / 180° / 270°) can be applied (rotating in 90° increments). Includes context menus, edit modals, single output handle, and light/dark mode.

## Features

- Full React Flow canvas with Background grid, MiniMap, Controls, fit-view
- Shapes: `circle`, `square`, `rectangle`, `squareRightRound`, `rectRightRound`
  - Label shown below the shape
  - Optional image centered inside the shape with padding
  - Single output handle (right side)
  - Orientation toggle (0° / 90° / 180° / 270°) via edit dialog or right‑click "Rotate 90°" (cycles through all four). Handles reposition for 90°/270°: left/right become top/bottom.
- Toolbar + right-click context menus for pane, nodes, and edges
- Edit nodes by double-click or context menu
- Paste image URL or drop image file to create Image node
- Import/Export JSON schema and download image (PNG – exported with transparent background in light theme styling)
- Light/Dark mode with system detection and a toggle

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:5173/`.

## JSON Schema

Nodes:
```jsonc
{
  "id": "string",
  "shape": "circle" | "square" | "rectangle" | "squareRightRound" | "rectRightRound",
  "position": { "x": number, "y": number },
  "data": { "label"?: string, "imageUrl"?: string, "orientation"?: 0 | 90 | 180 | 270 }
}
```
Edges:
```jsonc
{
  "id": "string",
  "source": "string",
  "target": "string",
  "data": {
    "styleKind"?: "solid" | "dashed" | "dotted",
    "arrow"?: "none" | "start" | "end" | "both"
  }
}
```

## Notes

- Dark mode is saved in `localStorage` (`theme` = `light` | `dark`) and initialized on page load. The canvas grid and edges adapt to the theme via CSS variables.
- PNG export uses `html-to-image`. The exported image has a transparent background and forces light theme so nodes / edges are always high-contrast.
- Right-click a pane to add nodes; right-click a node/edge to edit.
- Pasting or dropping an image/URL creates a circular image node with the image centered.

## License

MIT