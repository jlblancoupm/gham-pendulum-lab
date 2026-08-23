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
\ddot x+\sin x=0,\qquad x(0)=1.5\ \mathrm{rad}\approx86^\circ,\qquad \dot x(0)=0,
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


## Guided amplitude choice

The guided experience uses `A = 1.5 rad` (~86°): visually familiar (just below horizontal), while still clearly outside the small-angle regime. The Playground keeps `A = 2 rad` available as a harder case.

## v6 — Transport engine

The continuous `q` transport is now computed in-browser from the new frequency-corrected GOTHAM series for the guided `A=1.5 rad` case.

Connected views:
- operator `g_q(x)`;
- physical-time response `x(t;q)`;
- transported angular frequency `Omega(q)`;
- harmonic amplitudes H1 / H3 / H5.

Refinement (`M`) and convergence control (`hbar`) still remain intentionally disconnected until transport is cross-validated against the Python reference.


## v7
Transport now overlays q=0/current/q=1, and Spectrum uses H3/H1 and H5/H1 percentages with synchronized q/frequency/harmonic readout.

## v8 — richer Transport views
- Motion explicitly shows the conservative ±A turning-point amplitude and adds a lower temporal-deviation trace relative to q=0.
- Spectrum now shows the actual odd-harmonic line spectrum in physical angular frequency, with q=0 and q=1 references behind the current spectrum.
- H3/H1 and H5/H1 remain as compact nonlinear-distortion readouts.

## v9 — target refinement connected
At q=1 and baseline hbar=-1:
- exact pendulum reference is integrated in-browser;
- target GOTHAM approximation is evaluated for integer M;
- waveform + temporal error are drawn together;
- waveform NRMSE, operator residual, frequency error, and reliable horizon are live;
- convergence curves versus M are connected.
The q–M colormap and hbar engine remain for subsequent versions.

## v10 — q–M landscape
The q–M tab now computes a sampled validation view of the same continuous GOTHAM deformation.
- vertical axis: continuous transport coordinate q;
- horizontal axis: integer truncation order M;
- color: log10 waveform NRMSE against an independently integrated reference for the sampled q checkpoint;
- current refinement point at q=1 is marked explicitly.
The q samples are visualization/validation checkpoints, not separate GOTHAM runs.

## v11 — q–M performance
No scientific definitions changed.

- exact intermediate references cached once per q;
- q–M metrics cached once per (q,M);
- map computed progressively in requestAnimationFrame batches;
- changing M reuses the cached map;
- mobile uses a coarser display grid for responsiveness.
