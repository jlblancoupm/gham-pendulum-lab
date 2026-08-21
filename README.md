# GOTHAM Pendulum Lab — UI shell

This folder is the **new static-web architecture** for the GOTHAM pendulum demo.

It deliberately reuses the product architecture and visual language of the previous pendulum site — static GitHub Pages deployment, vanilla HTML/CSS/JavaScript, Canvas visualizations, responsive lab layouts, tabs, scroll progress, and local UI state — but **none of the previous GHAM/GOTHAM numerical engine is reused**.

## Current status

This version implements:

- the complete narrative page structure;
- guided sections for `q`, `M`, and `ħ`;
- the dark visual system and responsive layout;
- Canvas scaffolding with device-pixel-ratio handling;
- continuous `q` slider UX;
- integer `M` refinement UX;
- `ħ` convergence-control UX;
- tabbed workspaces;
- the `Scan ħ / Apply best` interaction shell;
- a fully unlocked Playground shell;
- GitHub Pages-ready static deployment.

It does **not** yet implement the validated frequency-corrected GOTHAM engine. All scientifically relevant plots that depend on the new solver are clearly marked as placeholders.

## Scientific target

The guided demo is frozen around

\[
\ddot x+\sin x=0,\qquad x(0)=2\ \mathrm{rad},\qquad \dot x(0)=0,
\]

with continuous system transport

\[
\ddot x+(1-q)x+q\sin x=0,\qquad q\in[0,1].
\]

The new engine must preserve the conceptual separation:

- `q`: continuous system transport;
- `M`: integer truncation/refinement order;
- `ħ`: finite-order convergence control.

The frequency correction / time rescaling developed during validation must be part of the new engine.

## Expected browser engine API

`app.js` currently exposes an intentionally empty `Model` interface:

```js
Model.buildSeries({ amplitude, maxOrder })
Model.evaluate({ amplitude, q, M, hbar, duration })
Model.omega({ amplitude, q, M, hbar })
Model.exactPendulum({ amplitude, duration })
Model.metrics({ amplitude, q, M, hbar })
```

The next implementation step is to port the validated frequency-corrected GOTHAM formulation behind these functions.

## Run locally

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

No build step is required.

1. Copy the files to the repository root.
2. Push `main`.
3. In **Settings → Pages**, deploy from `main` / root.

MathJax is loaded from a CDN. Everything else is local static content.

## Files

```text
index.html
styles.css
app.js
README.md
```
