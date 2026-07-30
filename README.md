# GHAM Pendulum Lab

A static, interactive website introducing **Generalized Homotopy Analysis Methods (GHAM)** through the nonlinear pendulum.

The site develops two complementary views:

1. **A designed surrogate family**

   \[
   s_d(\theta;q)=\sum_{r=0}^{(d-1)/2}(-1)^r q^r\frac{\theta^{2r+1}}{(2r+1)!},
   \qquad
   \ddot\theta+\omega_0^2s_d(\theta;q)=0,
   \]

   with release conditions \(\theta(0)=\theta_{\mathrm i}\) and \(\dot\theta(0)=0\).

   At `q = 0`, the model is the small-angle oscillator. At `q = 1`, increasing the highest odd degree `d` approaches the nonlinear sine term.

2. **The GHAM deformation series**

   \[
   (1-q)\mathcal L[\Theta-\theta_0]
   =q\hbar\mathcal N[\Theta],
   \qquad
   \Theta=\theta_0+\sum_{m\ge1}\theta_mq^m.
   \]

   The site derives the correction equations using Fréchet derivatives and computes the truncated series up to order `M = 6` in the browser.

## Features

- No framework and no build step.
- Responsive HTML/CSS/JavaScript.
- Animated nonlinear numerical reference, surrogate, and GHAM pendulums.
- Canvas trajectory plots and live numerical diagnostics.
- Interactive controls for `q`, polynomial degree, release angle `θᵢ`, `M`, and `ħ`.
- Fréchet derivative explorer and explicit residual terms through fourth GHAM order.
- Source C4DM presentation included under `assets/`.

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Opening `index.html` directly also works in most browsers, although serving the folder is more representative of GitHub Pages.

## Publish with GitHub Pages

1. Create a GitHub repository and copy these files to its root.
2. Push the `main` branch.
3. In the repository settings, open **Pages**.
4. Choose deployment from a branch, selecting `main` and `/ (root)`.

The site is intentionally plain static content, so no action or package installation is required.

## Scientific notation used by the site

- `q`: embedding or continuation parameter.
- `M`: truncation order of the GHAM series.
- `k`: restart/iteration index; discussed conceptually but not implemented in this first site.
- `ħ`: auxiliary convergence-control parameter.
- `θᵢ`: release angle, defined by `θ(0)=θᵢ`.
- `θ₀(t)=θᵢ cos(ω₀t)`: analytical solution of the small-angle surrogate.

The browser GHAM implementation uses

\[
\mathcal L[v]=\ddot v+\omega_0^2v,
\qquad
\mathcal N[\theta]=\ddot\theta+\omega_0^2\sin\theta,
\]

for the initial-value problem

\[
\theta(0)=\theta_{\mathrm i},\qquad \dot\theta(0)=0,
\]

with zero initial conditions for every correction `θ_m`, `m ≥ 1`.

## Scope and limitations

This is an explanatory research demo, not a general-purpose validated ODE package. In particular:

- Explicit derivations are shown through `M = 4`; the browser assembles the residual coefficients recursively through `M = 6`.
- Large release angles can leave the convergence region of the selected starting solution and `ħ`.
- Restarted GHAM, alternative linear operators, and richer surrogate design are natural next steps.
- MathJax is loaded from a CDN; the simulations themselves have no external dependency.

## Suggested repository description

> Interactive GHAM and nonlinear-pendulum demo: surrogate problem design, Fréchet derivatives, homotopy corrections, and convergence diagnostics.

## Attribution

Adapted from the C4DM presentation **“Start Simple! Learning Sound-Producing Systems from Surrogate Problems”** by Dr. José Luis Blanco-Murillo, GAPS-UPM, July 2026.

Before public release, choose and add the software/content license that best fits the project.
