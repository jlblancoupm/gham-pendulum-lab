# GHAM Pendulum Lab

A polished static website introducing **Generalized Homotopy Analysis Methods (GHAM)** through the nonlinear pendulum.

The central idea is simple: a surrogate is not merely an approximate answer. It is a simpler **problem** whose solution and operator structure define a controlled path toward the nonlinear target.

## What is included

### 1. Interactive continuation in the hero

The top-level demo uses the infinite-order embedded family

\[
s_\infty(\theta;q)=
\begin{cases}
\theta, & q=0,\\[2mm]
\dfrac{\sin(\sqrt q\,\theta)}{\sqrt q}, & q>0,
\end{cases}
\]

so the effective nonlinear amplitude increases continuously from the small-angle oscillator to the target pendulum.

### 2. Surrogate-family laboratory

The finite Maclaurin family is

\[
s_d(\theta;q)=
\sum_{r=0}^{(d-1)/2}
(-1)^r q^r\frac{\theta^{2r+1}}{(2r+1)!},
\qquad d=1,3,5,\ldots
\]

with the surrogate problem

\[
\ddot\theta+\omega_0^2s_d(\theta;q)=0.
\]

The lab contains:

- live controls for `q`, initial amplitude, polynomial degree `d`, and observation horizon;
- presets for linear, cubic, near-target, and stress-test cases;
- animated pendulums;
- trajectory, phase-portrait, and restoring-nonlinearity views;
- trajectory RMSE, period error, target residual, and active-term diagnostics;
- a time scrubber and play/pause controls.

The “exact” comparison is deliberately labelled **nonlinear numerical reference**: it is a high-resolution RK4 solution, not a symbolic closed-form trajectory.

### 3. Correct function-space derivation

Fixed nonzero initial conditions define an affine space:

\[
X_0=\{v\in C^2([0,T]):v(0)=0,\ \dot v(0)=0\},
\qquad X_A=\theta_0+X_0.
\]

The target operator is

\[
\mathcal N:X_A\to C([0,T]),
\qquad
\mathcal N[\theta]=\ddot\theta+\omega_0^2\sin\theta.
\]

The derivation is organised into interactive stages:

1. function spaces;
2. zero-order deformation;
3. Maclaurin series in the embedding parameter;
4. Fréchet–Taylor residual expansion;
5. the linear GHAM recursion.

The site explicitly states that obtaining the target at `q = 1` requires both `ħ ≠ 0` and convergence of the homotopy series there.

### 4. Fréchet microscope

The operator derivatives are

\[
D\mathcal N[\theta](v)
=\ddot v+\omega_0^2\cos\theta\,v,
\]

and, for `n ≥ 2`,

\[
D^n\mathcal N[\theta](v_1,\ldots,v_n)
=\omega_0^2\sin\!\left(\theta+\frac{n\pi}{2}\right)
\prod_{j=1}^{n}v_j.
\]

An interactive local Taylor visualisation shows how these derivatives approximate the pointwise sine nonlinearity around a selectable expansion point and perturbation.

### 5. GHAM laboratory

The zero-order deformation is

\[
(1-q)\mathcal L[\Theta-\theta_0]
=q\hbar\mathcal N[\Theta],
\qquad
\mathcal L[v]=\ddot v+\omega_0^2v.
\]

With

\[
\Theta(t;q)=\theta_0(t)+\sum_{m\ge1}\theta_m(t)q^m,
\]

the correction equations are

\[
\mathcal L[\theta_m-\chi_m\theta_{m-1}]
=\hbar R_{m-1},
\qquad
\chi_1=0,\quad \chi_m=1\;(m\ge2).
\]

The browser implementation:

- computes the formal sine-series coefficients recursively rather than hard-coding every residual;
- supports truncation orders `M = 0,…,6`;
- displays trajectory, correction, phase, and logarithmic residual views;
- includes an `ħ` scan that searches the current interval for the lowest trajectory RMSE;
- reports trajectory error, period error, target residual, and final-correction ratio.

The explicit Fréchet expressions through `R₃` remain visible in the derivation explorer.

## Technology

- plain HTML, CSS, and vanilla JavaScript;
- no framework, package manager, or build step;
- Canvas-based simulation and visualisation;
- MathJax loaded from a CDN for equations;
- responsive desktop, tablet, and mobile layouts;
- GitHub Pages ready.

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

Opening `index.html` directly also works in most browsers, although serving the directory matches GitHub Pages more closely.

## Publish with GitHub Pages

1. Create a repository and copy the project files to its root.
2. Push the `main` branch.
3. Open **Settings → Pages**.
4. Deploy from `main` and `/ (root)`.

## Scientific scope

This is an explanatory research demo, not a validated general-purpose ODE or HAM package.

- The nonlinear reference uses fixed-step RK4.
- The one-shot GHAM series is computed through `M = 6`.
- Large amplitudes or long horizons may leave the convergence region of the selected starting solution and `ħ`.
- Restarted GHAM, alternative linear operators, and richer starting surrogates are natural extensions.
- The `ħ` scan optimises trajectory RMSE for the selected example; it is a diagnostic convenience, not a convergence proof.

## Suggested repository description

> Interactive GHAM and nonlinear-pendulum laboratory: surrogate design, Fréchet derivatives, homotopy corrections, and convergence diagnostics.

## Attribution

Adapted from the C4DM presentation **“Start Simple! Learning Sound-Producing Systems from Surrogate Problems”** by Dr. José Luis Blanco-Murillo, GAPS-UPM, July 2026.

Choose and add the software/content licence that best fits the intended public release.
