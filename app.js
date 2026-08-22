(() => {
  'use strict';

  // ============================================================
  // UI SHELL ONLY.
  // No previous GHAM/GOTHAM numerical engine is reused here.
  // The scientific engine will be connected behind the Model API below.
  // ============================================================

  const COLORS = {
    bg: '#06131f', grid: 'rgba(174,202,229,.14)', gridStrong: 'rgba(174,202,229,.28)',
    text: '#f4f7fb', muted: '#a8b8ca', muted2: '#758ba3',
    gold: '#f4ca5c', blue: '#49b9ff', green: '#73d987',
    purple: '#b37cff', orange: '#ff9f50', red: '#ff7474'
  };

  const GUIDED_AMPLITUDE = 1.5;

  const state = {
    amplitude: GUIDED_AMPLITUDE,
    q: 0.0,
    M: 0,
    hbar: -1.0,
    time: 0,
    playing: true,
    transportView: 'operator',
    refinementView: 'trajectory',
    controlView: 'heatmap',
    playView: 'motion'
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const Model = {
    ready: true,
    cache: new Map(),

    _key(amplitude, maxOrder) {
      return `${Number(amplitude).toFixed(6)}|${maxOrder}`;
    },

    buildSeries({ amplitude, maxOrder = 10, gridSize = 1024 }) {
      const key = this._key(amplitude, maxOrder);
      if (this.cache.has(key)) return this.cache.get(key);

      const N = gridSize;
      const theta = new Float64Array(N);
      const X = [];
      const Xdd = [];
      const S = [];
      const C = [];
      const W = [1.0];

      for (let i = 0; i < N; i += 1) theta[i] = 2 * Math.PI * i / N;

      const d2Periodic = (values) => {
        // Spectral derivative is expensive without FFT dependency.
        // For the browser engine we use a fourth-order periodic finite difference,
        // validated against the Python reference for the low-order smooth coefficients.
        const out = new Float64Array(N);
        const h = 2 * Math.PI / N;
        const h2 = h * h;
        for (let i = 0; i < N; i += 1) {
          const im2 = (i - 2 + N) % N;
          const im1 = (i - 1 + N) % N;
          const ip1 = (i + 1) % N;
          const ip2 = (i + 2) % N;
          out[i] = (-values[ip2] + 16 * values[ip1] - 30 * values[i] + 16 * values[im1] - values[im2]) / (12 * h2);
        }
        return out;
      };

      const cos1Coeff = (values) => {
        let s = 0;
        for (let i = 0; i < N; i += 1) s += values[i] * Math.cos(theta[i]);
        return 2 * s / N;
      };

      const solveL = (g) => {
        // Solve y'' + y = g for an even periodic solution with resonant cosine removed
        // and y(0)=0. A truncated cosine series is enough for the smooth pendulum terms.
        const K = 48;
        const coeff = new Float64Array(K + 1);
        for (let n = 0; n <= K; n += 1) {
          if (n === 1) continue;
          let s = 0;
          for (let i = 0; i < N; i += 1) s += g[i] * Math.cos(n * theta[i]);
          coeff[n] = (n === 0 ? s / N : 2 * s / N) / (1 - n * n);
        }
        const out = new Float64Array(N);
        let y0 = 0;
        for (let n = 0; n <= K; n += 1) {
          if (n === 1) continue;
          y0 += coeff[n];
        }
        for (let i = 0; i < N; i += 1) {
          let y = -y0 * Math.cos(theta[i]);
          for (let n = 0; n <= K; n += 1) {
            if (n === 1) continue;
            y += coeff[n] * Math.cos(n * theta[i]);
          }
          out[i] = y;
        }
        return out;
      };

      const x0 = new Float64Array(N);
      const s0 = new Float64Array(N);
      const c0 = new Float64Array(N);
      for (let i = 0; i < N; i += 1) {
        x0[i] = amplitude * Math.cos(theta[i]);
        s0[i] = Math.sin(x0[i]);
        c0[i] = Math.cos(x0[i]);
      }
      X.push(x0);
      Xdd.push(d2Periodic(x0));
      S.push(s0);
      C.push(c0);

      for (let n = 1; n <= maxOrder; n += 1) {
        const g = new Float64Array(N);
        for (let i = 0; i < N; i += 1) g[i] = -(S[n - 1][i] - X[n - 1][i]);

        for (let j = 1; j < n; j += 1) {
          const wj = W[j];
          const dd = Xdd[n - j];
          for (let i = 0; i < N; i += 1) g[i] -= wj * dd[i];
        }

        const wn = -cos1Coeff(g) / amplitude;
        W.push(wn);

        const rhs = new Float64Array(N);
        for (let i = 0; i < N; i += 1) rhs[i] = g[i] + wn * amplitude * Math.cos(theta[i]);

        const xn = solveL(rhs);
        X.push(xn);
        Xdd.push(d2Periodic(xn));

        const sn = new Float64Array(N);
        const cn = new Float64Array(N);
        for (let j = 1; j <= n; j += 1) {
          const xj = X[j];
          const cprev = C[n - j];
          const sprev = S[n - j];
          for (let i = 0; i < N; i += 1) {
            sn[i] += j * xj[i] * cprev[i];
            cn[i] -= j * xj[i] * sprev[i];
          }
        }
        for (let i = 0; i < N; i += 1) {
          sn[i] /= n;
          cn[i] /= n;
        }
        S.push(sn);
        C.push(cn);
      }

      const series = { amplitude, maxOrder, N, theta, X, Xdd, W };
      this.cache.set(key, series);
      return series;
    },

    _interpPeriodic(values, phase) {
      const N = values.length;
      const twoPi = 2 * Math.PI;
      let p = phase % twoPi;
      if (p < 0) p += twoPi;
      const u = p / twoPi * N;
      const i0 = Math.floor(u) % N;
      const i1 = (i0 + 1) % N;
      const f = u - Math.floor(u);
      return values[i0] * (1 - f) + values[i1] * f;
    },

    evaluateTransport({ amplitude = 1.5, q = 0, M = 10, duration = 30, samples = 1200 }) {
      const series = this.buildSeries({ amplitude, maxOrder: M });
      const N = series.N;
      const shape = new Float64Array(N);
      let omega2 = 0;

      for (let m = 0; m <= M; m += 1) {
        const qm = Math.pow(q, m);
        omega2 += qm * series.W[m];
        const xm = series.X[m];
        for (let i = 0; i < N; i += 1) shape[i] += qm * xm[i];
      }

      const omega = Math.sqrt(Math.max(omega2, 1e-12));
      const t = new Float64Array(samples);
      const x = new Float64Array(samples);
      for (let i = 0; i < samples; i += 1) {
        const ti = duration * i / (samples - 1);
        t[i] = ti;
        x[i] = this._interpPeriodic(shape, omega * ti);
      }

      return { t, x, shape, omega, series };
    },

    omega({ amplitude = 1.5, q = 0, M = 10 }) {
      const series = this.buildSeries({ amplitude, maxOrder: M });
      let omega2 = 0;
      for (let m = 0; m <= M; m += 1) omega2 += Math.pow(q, m) * series.W[m];
      return Math.sqrt(Math.max(omega2, 1e-12));
    },

    harmonics({ amplitude = 1.5, q = 0, M = 10 }) {
      const result = this.evaluateTransport({ amplitude, q, M, duration: 1, samples: 2 });
      const shape = result.shape;
      const N = shape.length;
      const hs = [1, 3, 5].map((n) => {
        let c = 0, s = 0;
        for (let i = 0; i < N; i += 1) {
          const th = 2 * Math.PI * i / N;
          c += shape[i] * Math.cos(n * th);
          s += shape[i] * Math.sin(n * th);
        }
        return 2 * Math.hypot(c, s) / N;
      });
      return { h1: hs[0], h3: hs[1], h5: hs[2] };
    },


    exactIntermediate({ amplitude = 1.5, q = 0, periods = 4, samples = 1800 }) {
      // Numerical reference for the intermediate transported system:
      // x'' + (1-q)x + q sin(x) = 0.
      // Used only as validation ground truth for sampled q values.
      const accel = (x) => -((1-q)*x + q*Math.sin(x));

      // Estimate one period by integrating until the first return to a positive maximum.
      // We use a small RK4 step and detect v crossing from + to - after t>0.
      let xx = amplitude, vv = 0, tt = 0;
      const h0 = 0.0025;
      let lastV = vv;
      let period = null;

      for (let k = 0; k < 200000; k += 1) {
        const h = h0;
        const k1x = vv, k1v = accel(xx);
        const k2x = vv + .5*h*k1v, k2v = accel(xx + .5*h*k1x);
        const k3x = vv + .5*h*k2v, k3v = accel(xx + .5*h*k2x);
        const k4x = vv + h*k3v, k4v = accel(xx + h*k3x);

        const newX = xx + h*(k1x + 2*k2x + 2*k3x + k4x)/6;
        const newV = vv + h*(k1v + 2*k2v + 2*k3v + k4v)/6;
        tt += h;

        if (tt > .2 && lastV > 0 && newV <= 0 && newX > 0) {
          period = tt;
          break;
        }
        xx = newX; vv = newV; lastV = newV;
      }

      if (!period) period = 2*Math.PI;

      const duration = periods * period;
      const dt = duration/(samples-1);
      const t = new Float64Array(samples);
      const x = new Float64Array(samples);
      const v = new Float64Array(samples);

      xx = amplitude; vv = 0; tt = 0;
      t[0]=0; x[0]=xx; v[0]=vv;
      for (let i=1;i<samples;i+=1) {
        const h=dt;
        const k1x=vv, k1v=accel(xx);
        const k2x=vv+.5*h*k1v, k2v=accel(xx+.5*h*k1x);
        const k3x=vv+.5*h*k2v, k3v=accel(xx+.5*h*k2x);
        const k4x=vv+h*k3v, k4v=accel(xx+h*k3x);

        xx += h*(k1x+2*k2x+2*k3x+k4x)/6;
        vv += h*(k1v+2*k2v+2*k3v+k4v)/6;
        tt += h;
        t[i]=tt; x[i]=xx; v[i]=vv;
      }

      return { t, x, v, period, omega:2*Math.PI/period, duration };
    },

    qmMetrics({ amplitude = 1.5, q = 0, M = 0, periods = 4 }) {
      const exact = this.exactIntermediate({ amplitude, q, periods, samples: 1600 });
      const approx = this.evaluateTransport({ amplitude, q, M, duration: exact.duration, samples:1600 });

      // Build residual from transported shape directly.
      const series = approx.series;
      const d2shape = new Float64Array(series.N);
      for (let m=0;m<=M;m+=1) {
        const qm = Math.pow(q,m);
        const dd = series.Xdd[m];
        for (let i=0;i<series.N;i+=1) d2shape[i] += qm*dd[i];
      }

      let se=0,sx=0,sr=0;
      let horizon=periods;
      let hit=false;
      const threshold=.01*amplitude;

      for (let i=0;i<exact.x.length;i+=1) {
        const e=approx.x[i]-exact.x[i];
        se += e*e;
        sx += exact.x[i]*exact.x[i];

        const ddTau=this._interpPeriodic(d2shape, approx.omega*approx.t[i]);
        const xi=approx.x[i];
        const R=approx.omega*approx.omega*ddTau + (1-q)*xi + q*Math.sin(xi);
        sr += R*R;

        if(!hit && Math.abs(e)>threshold){
          horizon=exact.t[i]/exact.period;
          hit=true;
        }
      }

      return {
        waveform: Math.sqrt(se/Math.max(sx,1e-30)),
        residual: Math.sqrt(sr/exact.x.length),
        frequency: Math.abs(approx.omega-exact.omega)/exact.omega,
        horizon
      };
    },

    exactPeriod(amplitude = 1.5) {
      // Complete elliptic integral K(m) via AGM: K(m)=pi/(2 AGM(1,sqrt(1-m))).
      const m = Math.pow(Math.sin(amplitude / 2), 2);
      let a = 1.0;
      let b = Math.sqrt(1 - m);
      for (let i = 0; i < 30; i += 1) {
        const an = (a + b) / 2;
        const bn = Math.sqrt(a * b);
        a = an; b = bn;
        if (Math.abs(a - b) < 1e-15) break;
      }
      const K = Math.PI / (2 * a);
      return 4 * K;
    },

    exactPendulum({ amplitude = 1.5, periods = 4, samples = 3200 }) {
      const T = this.exactPeriod(amplitude);
      const duration = periods * T;
      const dt = duration / (samples - 1);
      const t = new Float64Array(samples);
      const x = new Float64Array(samples);
      const v = new Float64Array(samples);

      let xx = amplitude, vv = 0, tt = 0;
      x[0] = xx; v[0] = vv; t[0] = 0;

      const acc = (q) => -Math.sin(q);

      for (let i = 1; i < samples; i += 1) {
        const h = dt;
        const k1x = vv;
        const k1v = acc(xx);

        const k2x = vv + .5*h*k1v;
        const k2v = acc(xx + .5*h*k1x);

        const k3x = vv + .5*h*k2v;
        const k3v = acc(xx + .5*h*k2x);

        const k4x = vv + h*k3v;
        const k4v = acc(xx + h*k3x);

        xx += h*(k1x + 2*k2x + 2*k3x + k4x)/6;
        vv += h*(k1v + 2*k2v + 2*k3v + k4v)/6;
        tt += h;
        t[i] = tt; x[i] = xx; v[i] = vv;
      }
      return { t, x, v, period: T, omega: 2*Math.PI/T, duration };
    },

    evaluateTarget({ amplitude = 1.5, M = 0, periods = 4, samples = 3200 }) {
      const T = this.exactPeriod(amplitude);
      const duration = periods * T;
      const series = this.buildSeries({ amplitude, maxOrder: M });
      const shape = new Float64Array(series.N);
      const d2shape = new Float64Array(series.N);
      let omega2 = 0;

      for (let m = 0; m <= M; m += 1) {
        omega2 += series.W[m];
        const xm = series.X[m];
        const dd = series.Xdd[m];
        for (let i = 0; i < series.N; i += 1) {
          shape[i] += xm[i];
          d2shape[i] += dd[i];
        }
      }

      const omega = Math.sqrt(Math.max(omega2, 1e-14));
      const t = new Float64Array(samples);
      const x = new Float64Array(samples);
      const residual = new Float64Array(samples);

      for (let i = 0; i < samples; i += 1) {
        const ti = duration * i/(samples-1);
        const phase = omega * ti;
        const xi = this._interpPeriodic(shape, phase);
        const ddTau = this._interpPeriodic(d2shape, phase);
        t[i] = ti;
        x[i] = xi;
        residual[i] = omega*omega*ddTau + Math.sin(xi);
      }

      return { t, x, residual, omega, period: 2*Math.PI/omega, duration, shape };
    },

    metrics({ amplitude = 1.5, q = 1, M = 0, hbar = -1, periods = 4 }) {
      // Refinement metrics currently defined only for q=1 and baseline hbar=-1.
      if (Math.abs(q-1) > 1e-12 || Math.abs(hbar+1) > 1e-12) return null;

      const exact = this.exactPendulum({ amplitude, periods, samples: 3200 });
      const approx = this.evaluateTarget({ amplitude, M, periods, samples: 3200 });

      let se = 0, sx = 0, sr = 0;
      let horizon = periods;
      const threshold = .01 * amplitude;
      let found = false;

      for (let i = 0; i < exact.x.length; i += 1) {
        const e = approx.x[i] - exact.x[i];
        se += e*e;
        sx += exact.x[i]*exact.x[i];
        sr += approx.residual[i]*approx.residual[i];
        if (!found && Math.abs(e) > threshold) {
          horizon = exact.t[i] / exact.period;
          found = true;
        }
      }

      const waveform = Math.sqrt(se/Math.max(sx,1e-30));
      const residual = Math.sqrt(sr/exact.x.length);
      const frequency = Math.abs(approx.omega - exact.omega)/exact.omega;

      return {
        waveform, residual, frequency, horizon,
        waveformText: waveform.toExponential(2),
        residualText: residual.toExponential(2),
        frequencyText: frequency.toExponential(2),
        horizonText: `${horizon.toFixed(2)} T`
      };
    }
  };

  function fmtMinus(value, digits = 2) {
    return Number(value).toFixed(digits).replace('-', '−');
  }

  function typeset(element) {
    if (!element || !window.MathJax?.typesetPromise) return;
    window.MathJax.typesetClear?.([element]);
    window.MathJax.typesetPromise([element]).catch(() => {});
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function clearCanvas(ctx, width, height, glow = 'rgba(73,185,255,.07)') {
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createRadialGradient(width * .68, height * .14, 0, width * .68, height * .14, Math.max(width, height) * .85);
    gradient.addColorStop(0, glow);
    gradient.addColorStop(1, 'rgba(2,12,22,.015)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawGrid(ctx, x, y, w, h, cols = 6, rows = 4) {
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= cols; i += 1) {
      const px = x + w * i / cols;
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
    }
    for (let i = 0; i <= rows; i += 1) {
      const py = y + h * i / rows;
      ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke();
    }
    ctx.restore();
  }

  function drawAxesLabel(ctx, text, x, y, align = 'left') {
    ctx.fillStyle = COLORS.muted2;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }

  function drawPlaceholder(canvas, title, lines = [], accent = COLORS.blue) {
    if (!canvas || canvas.offsetParent === null) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height, accent === COLORS.purple ? 'rgba(179,124,255,.07)' : 'rgba(73,185,255,.07)');
    drawGrid(ctx, 54, 38, Math.max(1, width - 86), Math.max(1, height - 86), 7, 5);
    ctx.fillStyle = COLORS.text;
    ctx.font = '700 14px ui-sans-serif, system-ui';
    ctx.fillText(title, 66, 70);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px ui-sans-serif, system-ui';
    lines.forEach((line, i) => ctx.fillText(line, 66, 96 + i * 19));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(66, height * .62);
    ctx.bezierCurveTo(width * .30, height * .42, width * .48, height * .76, width - 46, height * .48);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(width - 46, height * .48, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawOperatorComparison() {
    const canvas = $('operatorCompareCanvas');
    if (!canvas) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height);
    const left = 48, right = 24, top = 28, bottom = 42;
    const w = width - left - right, h = height - top - bottom;
    drawGrid(ctx, left, top, w, h, 6, 4);

    const xmin = -2.2, xmax = 2.2, ymin = -2.2, ymax = 2.2;
    const X = x => left + (x - xmin) / (xmax - xmin) * w;
    const Y = y => top + (ymax - y) / (ymax - ymin) * h;

    const drawFn = (fn, color, dash = []) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2.3; ctx.setLineDash(dash); ctx.beginPath();
      for (let i = 0; i <= 500; i += 1) {
        const x = xmin + (xmax - xmin) * i / 500;
        const px = X(x), py = Y(fn(x));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.restore();
    };
    drawFn(x => x, COLORS.gold, [6,5]);
    drawFn(x => Math.sin(x), COLORS.green);

    ctx.strokeStyle = COLORS.gridStrong; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(0), top); ctx.lineTo(X(0), top+h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left, Y(0)); ctx.lineTo(left+w, Y(0)); ctx.stroke();

    [-1.5, 1.5].forEach(x => {
      ctx.fillStyle = COLORS.red;
      ctx.beginPath(); ctx.arc(X(x), Y(Math.sin(x)), 4, 0, Math.PI*2); ctx.fill();
    });

    drawAxesLabel(ctx, 'state x [rad]', left+w, height-12, 'right');
    drawAxesLabel(ctx, 'restoring law', left+4, top+10);
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.fillStyle = COLORS.gold; ctx.fillText('x', left+14, top+24);
    ctx.fillStyle = COLORS.green; ctx.fillText('sin(x)', left+30, top+24);
  }

  function drawBaselineMotion() {
    const canvas = $('baselineMotionCanvas');
    if (!canvas) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height);
    const left=48,right=24,top=28,bottom=42,w=width-left-right,h=height-top-bottom;
    drawGrid(ctx,left,top,w,h,8,4);
    const duration = 26;
    const X = t => left + t/duration*w;
    const Y = x => top + (2.3-x)/4.6*h;

    // UI-only illustrative curves. The exact reference will be replaced by Model.exactPendulum.
    const linear = t => 1.5*Math.cos(t);
    const nonlinearIllustrative = t => 1.5*Math.cos(.860608*t) * (1 - .020*Math.cos(2*.860608*t));

    const plot = (fn,color,dash=[]) => {
      ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=2.2; ctx.setLineDash(dash); ctx.beginPath();
      for(let i=0;i<=800;i++){ const t=duration*i/800; const px=X(t),py=Y(fn(t)); if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py); }
      ctx.stroke(); ctx.restore();
    };
    plot(linear,COLORS.gold,[6,5]);
    plot(nonlinearIllustrative,COLORS.green);
    drawAxesLabel(ctx,'physical time',left+w,height-12,'right');
    drawAxesLabel(ctx,'angle x(t) [rad]',left+4,top+10);
    ctx.fillStyle=COLORS.gold;ctx.font='11px ui-sans-serif,system-ui';ctx.fillText('linear',left+14,top+24);
    ctx.fillStyle=COLORS.green;ctx.fillText('target (illustrative shell)',left+62,top+24);
  }

  function drawHeroPendulum(time) {
    const canvas = $('heroCanvas');
    if (!canvas) return;
    const {ctx,width,height}=prepareCanvas(canvas);
    clearCanvas(ctx,width,height);
    const cx=width*.5, cy=height*.18, L=Math.min(width,height)*.33;
    const aLin=1.5*Math.cos(time);
    const aNon=1.5*Math.cos(.860608*time)*(1-.020*Math.cos(1.721216*time));

    const pend=(a,color,alpha=1,dx=0)=>{
      const x=cx+dx+L*Math.sin(a), y=cy+L*Math.cos(a);
      ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=2.2;
      ctx.beginPath();ctx.moveTo(cx+dx,cy);ctx.lineTo(x,y);ctx.stroke();
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();ctx.restore();
    };
    ctx.fillStyle=COLORS.muted2;ctx.font='10px ui-monospace,monospace';ctx.textAlign='center';
    ctx.fillText('linear',cx-80,24);ctx.fillText('target',cx+80,24);
    pend(aLin,COLORS.gold,.65,-80);
    pend(aNon,COLORS.green,1,80);
    $('heroTimeOut').textContent=`t = ${time.toFixed(2)}`;
  }

  function drawTransportView() {
    const view=state.transportView, q=state.q, A=GUIDED_AMPLITUDE, MT=10;
    const current=Model.evaluateTransport({amplitude:A,q,M:MT,duration:28,samples:1100});
    const initial=Model.evaluateTransport({amplitude:A,q:0,M:MT,duration:28,samples:1100});
    const target=Model.evaluateTransport({amplitude:A,q:1,M:MT,duration:28,samples:1100});
    const hs=Model.harmonics({amplitude:A,q,M:MT});
    const h3pct=100*hs.h3/Math.max(hs.h1,1e-12), h5pct=100*hs.h5/Math.max(hs.h1,1e-12);

    const info=(ctx,x,y)=>{
      const lines=[`q = ${q.toFixed(3)}`,`Ω/Ω₀ = ${(current.omega/initial.omega).toFixed(3)}`,
                   `H3/H1 = ${h3pct.toFixed(2)} %`,`H5/H1 = ${h5pct.toFixed(3)} %`];
      ctx.save();ctx.font='10px ui-monospace,monospace';
      ctx.fillStyle='rgba(5,16,28,.86)';ctx.strokeStyle='rgba(174,202,229,.20)';
      ctx.beginPath();ctx.roundRect(x,y,142,66,8);ctx.fill();ctx.stroke();
      lines.forEach((s,i)=>{ctx.fillStyle=i?COLORS.muted2:COLORS.gold;ctx.fillText(s,x+10,y+16+14*i);});
      ctx.restore();
    };

    if(view==='operator'){
      const {ctx,width,height}=prepareCanvas($('transportOperatorCanvas'));clearCanvas(ctx,width,height);
      const l=55,r=28,t=35,b=48,w=width-l-r,h=height-t-b;drawGrid(ctx,l,t,w,h,7,5);
      const xmin=-1.75,xmax=1.75,ymin=-1.75,ymax=1.75;
      const X=x=>l+(x-xmin)/(xmax-xmin)*w,Y=y=>t+(ymax-y)/(ymax-ymin)*h;
      const plot=(fn,c,lw,d=[])=>{ctx.save();ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.setLineDash(d);ctx.beginPath();
        for(let i=0;i<=500;i++){const x=xmin+(xmax-xmin)*i/500;i?ctx.lineTo(X(x),Y(fn(x))):ctx.moveTo(X(x),Y(fn(x)));}ctx.stroke();ctx.restore();};
      plot(x=>x,COLORS.muted2,1.2,[5,5]);plot(x=>Math.sin(x),COLORS.green,1.2,[3,5]);plot(x=>(1-q)*x+q*Math.sin(x),COLORS.gold,2.8);
      drawAxesLabel(ctx,'x [rad]',l+w,height-14,'right');drawAxesLabel(ctx,'g_q(x)',l+6,t+14);
      ctx.font='10px ui-sans-serif,system-ui';
      [[COLORS.muted2,'start q=0'],[COLORS.green,'target q=1'],[COLORS.gold,`current q=${q.toFixed(2)}`]]
        .forEach(([c,s],i)=>{ctx.fillStyle=c;ctx.fillText(s,l+8+i*76,t+31);});
      return;
    }

    if(view==='motion'){
      const {ctx,width,height}=prepareCanvas($('transportMotionCanvas'));clearCanvas(ctx,width,height);
      const gap=18, topH=Math.round((height-gap)*.64), botY=topH+gap, botH=height-botY;
      const l=58,r=28,t=34,b=26,w=width-l-r;
      const plotTopH=topH-t-b, plotBotH=botH-28;
      const X=v=>l+v/current.t[current.t.length-1]*w;
      const Y=v=>t+(A*1.08-v)/(2*A*1.08)*plotTopH;
      const Ye=v=>botY+6+(0.72-v)/(1.44)*plotBotH;
      drawGrid(ctx,l,t,w,plotTopH,8,4);
      drawGrid(ctx,l,botY+6,w,plotBotH,8,3);

      const plot=(res,c,lw,d,a=1)=>{
        ctx.save();ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.setLineDash(d);ctx.globalAlpha=a;ctx.beginPath();
        for(let i=0;i<res.t.length;i++) i?ctx.lineTo(X(res.t[i]),Y(res.x[i])):ctx.moveTo(X(res.t[i]),Y(res.x[i]));
        ctx.stroke();ctx.restore();
      };
      plot(initial,COLORS.muted2,1.15,[6,5],.68);
      plot(target,COLORS.green,1.35,[3,5],.86);
      plot(current,COLORS.blue,2.6,[]);

      ctx.save();ctx.strokeStyle='rgba(244,202,92,.30)';ctx.setLineDash([4,5]);ctx.lineWidth=1;
      [A,-A].forEach(v=>{ctx.beginPath();ctx.moveTo(l,Y(v));ctx.lineTo(l+w,Y(v));ctx.stroke();});
      ctx.restore();

      ctx.save();ctx.strokeStyle=COLORS.orange;ctx.lineWidth=1.8;ctx.beginPath();
      for(let i=0;i<current.t.length;i++){
        const e=(current.x[i]-initial.x[i])/A;
        const ec=Math.max(-.72,Math.min(.72,e));
        i?ctx.lineTo(X(current.t[i]),Ye(ec)):ctx.moveTo(X(current.t[i]),Ye(ec));
      }
      ctx.stroke();ctx.restore();
      ctx.strokeStyle=COLORS.gridStrong;ctx.beginPath();ctx.moveTo(l,Ye(0));ctx.lineTo(l+w,Ye(0));ctx.stroke();

      drawAxesLabel(ctx,'x(t;q) [rad]',l+6,t+12);
      drawAxesLabel(ctx,'physical time',l+w,height-8,'right');
      drawAxesLabel(ctx,'(x_q − x_0)/A',l+6,botY+16);
      ctx.font='10px ui-sans-serif,system-ui';
      [[COLORS.muted2,'start q=0'],[COLORS.green,'target q=1'],[COLORS.blue,`current q=${q.toFixed(2)}`]]
        .forEach(([c,s],i)=>{ctx.fillStyle=c;ctx.fillText(s,l+8+i*72,t+29);});
      ctx.fillStyle=COLORS.orange;ctx.fillText('temporal deviation from q=0',l+8,botY+31);
      ctx.fillStyle=COLORS.gold;ctx.fillText('±A constant: conservative system',l+190,botY+31);
      info(ctx,Math.max(l+6,width-178),t+6);
      return;
    }

    if(view==='frequency'){
      const {ctx,width,height}=prepareCanvas($('transportFrequencyCanvas'));clearCanvas(ctx,width,height);
      const l=60,r=28,t=42,b=50,w=width-l-r,h=height-t-b,ymin=.82,ymax=1.01;
      drawGrid(ctx,l,t,w,h,8,5);const X=v=>l+v*w,Y=v=>t+(ymax-v)/(ymax-ymin)*h;
      ctx.strokeStyle=COLORS.blue;ctx.lineWidth=2.4;ctx.beginPath();
      for(let i=0;i<=240;i++){const qq=i/240,om=Model.omega({amplitude:A,q:qq,M:MT});i?ctx.lineTo(X(qq),Y(om)):ctx.moveTo(X(qq),Y(om));}ctx.stroke();
      [[initial.omega,COLORS.muted2,[5,5]],[target.omega,COLORS.green,[3,5]]].forEach(([v,c,d])=>{
        ctx.save();ctx.strokeStyle=c;ctx.setLineDash(d);ctx.beginPath();ctx.moveTo(l,Y(v));ctx.lineTo(l+w,Y(v));ctx.stroke();ctx.restore();});
      ctx.fillStyle=COLORS.gold;ctx.beginPath();ctx.arc(X(q),Y(current.omega),5,0,2*Math.PI);ctx.fill();
      drawAxesLabel(ctx,'q',l+w,height-14,'right');drawAxesLabel(ctx,`Ω^[${MT}](q)`,l+4,t+12);info(ctx,Math.max(l+6,width-178),t+8);
      return;
    }

    const {ctx,width,height}=prepareCanvas($('transportSpectrumCanvas'));clearCanvas(ctx,width,height,'rgba(179,124,255,.07)');
    const l=66,r=28,t=42,b=52,w=width-l-r,h=height-t-b;
    drawGrid(ctx,l,t,w,h,8,5);

    const spectrum=(qq)=>{
      const result=Model.evaluateTransport({amplitude:A,q:qq,M:MT,duration:1,samples:2});
      const shape=result.shape,N=shape.length,lines=[];
      for(let n=1;n<=15;n+=2){
        let c=0,s=0;
        for(let i=0;i<N;i++){
          const th=2*Math.PI*i/N;
          c+=shape[i]*Math.cos(n*th);s+=shape[i]*Math.sin(n*th);
        }
        const amp=2*Math.hypot(c,s)/N;
        lines.push({n,omega:n*result.omega,amp});
      }
      return {omega:result.omega,lines};
    };

    const sp0=spectrum(0),spq=spectrum(q),sp1=spectrum(1);
    const maxOmega=15*sp0.omega*1.03;
    const maxAmp=Math.max(...sp0.lines.map(d=>d.amp),...spq.lines.map(d=>d.amp),...sp1.lines.map(d=>d.amp))*1.08;
    const X=v=>l+v/maxOmega*w,Y=v=>t+(maxAmp-v)/maxAmp*h;

    const stems=(sp,c,lw,alpha,dash=[])=>{
      ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.setLineDash(dash);
      sp.lines.forEach(d=>{ctx.beginPath();ctx.moveTo(X(d.omega),Y(0));ctx.lineTo(X(d.omega),Y(d.amp));ctx.stroke();});
      ctx.restore();
    };
    stems(sp0,COLORS.muted2,1.0,.42,[3,4]);
    stems(sp1,COLORS.green,1.0,.48,[2,4]);
    stems(spq,COLORS.blue,2.2,1,[]);

    ctx.save();ctx.strokeStyle=COLORS.blue;ctx.globalAlpha=.55;ctx.lineWidth=1.2;ctx.beginPath();
    spq.lines.forEach((d,i)=>i?ctx.lineTo(X(d.omega),Y(d.amp)):ctx.moveTo(X(d.omega),Y(d.amp)));ctx.stroke();ctx.restore();
    spq.lines.forEach(d=>{ctx.fillStyle=COLORS.blue;ctx.beginPath();ctx.arc(X(d.omega),Y(d.amp),3.2,0,2*Math.PI);ctx.fill();});

    drawAxesLabel(ctx,'angular frequency ω',l+w,height-14,'right');
    drawAxesLabel(ctx,'line-spectrum amplitude [rad]',l+4,t+12);
    ctx.font='10px ui-sans-serif,system-ui';
    ctx.fillStyle=COLORS.muted2;ctx.fillText('start spectrum q=0',l+8,t+30);
    ctx.fillStyle=COLORS.green;ctx.fillText('target q=1',l+112,t+30);
    ctx.fillStyle=COLORS.blue;ctx.fillText(`current q=${q.toFixed(2)}`,l+182,t+30);
    ctx.fillStyle=COLORS.purple;ctx.fillText(`H3/H1 ${h3pct.toFixed(2)}%`,l+8,height-18);
    ctx.fillStyle=COLORS.orange;ctx.fillText(`H5/H1 ${h5pct.toFixed(3)}%`,l+92,height-18);
    info(ctx,Math.max(l+6,width-178),t+8);
  }

  function drawRefinementView() {
    const M = state.M;
    const panel = state.refinementView;
    const A = GUIDED_AMPLITUDE;
    const periods = 4;
    const exact = Model.exactPendulum({ amplitude:A, periods, samples:3200 });
    const approx = Model.evaluateTarget({ amplitude:A, M, periods, samples:3200 });

    if(panel==='trajectory'){
      const canvas=$('refinementTrajectoryCanvas');
      const {ctx,width,height}=prepareCanvas(canvas); clearCanvas(ctx,width,height);
      const gap=18, topH=Math.round((height-gap)*.62), botY=topH+gap, botH=height-botY;
      const l=60,r=28,t=36,b=24,w=width-l-r;
      const topPlotH=topH-t-b, botPlotH=botH-30;
      const X=v=>l+v/exact.duration*w;
      const Y=v=>t+(A*1.08-v)/(2*A*1.08)*topPlotH;

      let maxErr=0;
      for(let i=0;i<exact.x.length;i++) maxErr=Math.max(maxErr,Math.abs(approx.x[i]-exact.x[i]));
      maxErr=Math.max(maxErr,1e-6);
      const Ye=v=>botY+8+(maxErr-v)/(2*maxErr)*botPlotH;

      drawGrid(ctx,l,t,w,topPlotH,8,4);
      drawGrid(ctx,l,botY+8,w,botPlotH,8,3);

      const plot=(tarr,xarr,c,lw,d=[])=>{
        ctx.save();ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.setLineDash(d);ctx.beginPath();
        for(let i=0;i<tarr.length;i++) i?ctx.lineTo(X(tarr[i]),Y(xarr[i])):ctx.moveTo(X(tarr[i]),Y(xarr[i]));
        ctx.stroke();ctx.restore();
      };
      plot(exact.t,exact.x,COLORS.green,2.2,[4,4]);
      plot(approx.t,approx.x,COLORS.blue,2.5,[]);

      ctx.save();ctx.strokeStyle=COLORS.orange;ctx.lineWidth=1.9;ctx.beginPath();
      for(let i=0;i<exact.t.length;i++){
        const e=approx.x[i]-exact.x[i];
        i?ctx.lineTo(X(exact.t[i]),Ye(e)):ctx.moveTo(X(exact.t[i]),Ye(e));
      }
      ctx.stroke();ctx.restore();

      ctx.strokeStyle=COLORS.gridStrong;ctx.beginPath();ctx.moveTo(l,Ye(0));ctx.lineTo(l+w,Ye(0));ctx.stroke();

      drawAxesLabel(ctx,'x(t) [rad]',l+6,t+13);
      drawAxesLabel(ctx,'e_M(t) [rad]',l+6,botY+18);
      drawAxesLabel(ctx,'physical time',l+w,height-8,'right');

      ctx.font='10px ui-sans-serif,system-ui';
      ctx.fillStyle=COLORS.green;ctx.fillText('exact target',l+8,t+30);
      ctx.fillStyle=COLORS.blue;ctx.fillText(`GOTHAM M=${M}`,l+78,t+30);
      ctx.fillStyle=COLORS.orange;ctx.fillText('pointwise temporal error',l+8,botY+33);
    } else if(panel==='convergence'){
      const canvas=$('refinementConvergenceCanvas');
      const {ctx,width,height}=prepareCanvas(canvas); clearCanvas(ctx,width,height);
      const l=66,r=28,t=42,b=52,w=width-l-r,h=height-t-b;
      drawGrid(ctx,l,t,w,h,10,6);

      const maxM=20;
      const metrics=[];
      let ymin=Infinity,ymax=-Infinity;
      for(let m=0;m<=maxM;m++){
        const mt=Model.metrics({ amplitude:A,q:1,M:m,hbar:-1,periods });
        metrics.push(mt);
        [mt.waveform,mt.residual,mt.frequency].forEach(v=>{
          const z=Math.log10(Math.max(v,1e-14)); ymin=Math.min(ymin,z); ymax=Math.max(ymax,z);
        });
      }
      ymin=Math.floor(ymin)-.3; ymax=Math.ceil(ymax)+.2;
      const X=m=>l+m/maxM*w;
      const Y=z=>t+(ymax-z)/(ymax-ymin)*h;

      const plot=(key,c,d=[])=>{
        ctx.save();ctx.strokeStyle=c;ctx.lineWidth=2.1;ctx.setLineDash(d);ctx.beginPath();
        metrics.forEach((mt,m)=>{
          const z=Math.log10(Math.max(mt[key],1e-14));
          m?ctx.lineTo(X(m),Y(z)):ctx.moveTo(X(m),Y(z));
        });ctx.stroke();ctx.restore();
      };
      plot('waveform',COLORS.blue);
      plot('residual',COLORS.orange,[5,4]);
      plot('frequency',COLORS.purple,[2,4]);

      ctx.save();ctx.strokeStyle=COLORS.gold;ctx.lineWidth=1.4;ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.moveTo(X(M),t);ctx.lineTo(X(M),t+h);ctx.stroke();ctx.restore();

      drawAxesLabel(ctx,'truncation order M',l+w,height-14,'right');
      drawAxesLabel(ctx,'log10 error',l+4,t+12);
      ctx.font='10px ui-sans-serif,system-ui';
      ctx.fillStyle=COLORS.blue;ctx.fillText('waveform',l+8,t+30);
      ctx.fillStyle=COLORS.orange;ctx.fillText('residual',l+72,t+30);
      ctx.fillStyle=COLORS.purple;ctx.fillText('frequency',l+126,t+30);
      ctx.fillStyle=COLORS.gold;ctx.fillText(`current M=${M}`,l+196,t+30);
    } else {
      const canvas=$('qmMapCanvas');
      const {ctx,width,height}=prepareCanvas(canvas);
      clearCanvas(ctx,width,height,'rgba(244,202,92,.055)');

      const l=74,r=30,t=48,b=58,w=width-l-r,h=height-t-b;
      const qSteps=24;
      const maxM=12;

      // Compute sampled view of one continuous deformation.
      const Z=[];
      let zmin=Infinity,zmax=-Infinity;
      for(let iq=0;iq<=qSteps;iq+=1){
        const qq=iq/qSteps;
        const row=[];
        for(let m=0;m<=maxM;m+=1){
          const mt=Model.qmMetrics({ amplitude:A,q:qq,M:m,periods:3 });
          const z=Math.log10(Math.max(mt.waveform,1e-12));
          row.push(z);
          zmin=Math.min(zmin,z); zmax=Math.max(zmax,z);
        }
        Z.push(row);
      }

      const cmap=(u)=>{
        // dark blue -> cyan -> gold
        u=Math.max(0,Math.min(1,u));
        if(u<.5){
          const a=u/.5;
          const r0=9,g0=32,b0=53, r1=42,g1=126,b1=181;
          return `rgb(${Math.round(r0+(r1-r0)*a)},${Math.round(g0+(g1-g0)*a)},${Math.round(b0+(b1-b0)*a)})`;
        }
        const a=(u-.5)/.5;
        const r0=42,g0=126,b0=181, r1=244,g1=202,b1=92;
        return `rgb(${Math.round(r0+(r1-r0)*a)},${Math.round(g0+(g1-g0)*a)},${Math.round(b0+(b1-b0)*a)})`;
      };

      const cellW=w/(maxM+1);
      const cellH=h/(qSteps+1);

      for(let iq=0;iq<=qSteps;iq+=1){
        for(let m=0;m<=maxM;m+=1){
          // low error should be visually "better": invert scale
          const norm=(Z[iq][m]-zmin)/Math.max(zmax-zmin,1e-12);
          ctx.fillStyle=cmap(1-norm);
          ctx.fillRect(l+m*cellW,t+(qSteps-iq)*cellH,cellW+1,cellH+1);
        }
      }

      // grid
      ctx.save();
      ctx.strokeStyle='rgba(255,255,255,.13)';
      ctx.lineWidth=1;
      for(let m=0;m<=maxM+1;m+=1){
        const x=l+m*cellW;ctx.beginPath();ctx.moveTo(x,t);ctx.lineTo(x,t+h);ctx.stroke();
      }
      for(let iq=0;iq<=qSteps+1;iq+=1){
        const y=t+iq*cellH;ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(l+w,y);ctx.stroke();
      }
      ctx.restore();

      // Current point: q=1 and selected M in refinement section.
      const curM=Math.min(M,maxM);
      const px=l+(curM+.5)*cellW;
      const py=t+.5*cellH;
      ctx.strokeStyle='white';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(px,py,7,0,2*Math.PI);ctx.stroke();
      ctx.fillStyle=COLORS.gold;ctx.beginPath();ctx.arc(px,py,3,0,2*Math.PI);ctx.fill();

      // labels
      ctx.fillStyle=COLORS.muted2;
      ctx.font='10px ui-monospace,monospace';
      ctx.textAlign='center';
      for(let m=0;m<=maxM;m+=2) ctx.fillText(String(m),l+(m+.5)*cellW,t+h+20);
      ctx.textAlign='right';
      [0,.25,.5,.75,1].forEach(qq=>{
        const y=t+(1-qq)*(h-cellH)+cellH/2;
        ctx.fillText(qq.toFixed(2),l-10,y+3);
      });

      drawAxesLabel(ctx,'truncation order M',l+w,t+h+42,'right');
      drawAxesLabel(ctx,'continuous transport q',l-8,t+10,'right');

      ctx.textAlign='left';
      ctx.fillStyle=COLORS.text;
      ctx.font='700 12px ui-sans-serif,system-ui';
      ctx.fillText('Waveform error over the sampled continuous q–M deformation',l,t-20);
      ctx.fillStyle=COLORS.muted2;
      ctx.font='10px ui-sans-serif,system-ui';
      ctx.fillText(`color = log10 NRMSE · q sampled at ${qSteps+1} points · not independent runs`,l,t-5);

      // compact color legend
      const legendW=150,legendH=8,lx=width-r-legendW,ly=t-28;
      for(let i=0;i<legendW;i+=1){
        ctx.fillStyle=cmap(i/(legendW-1));
        ctx.fillRect(lx+i,ly,1,legendH);
      }
      ctx.fillStyle=COLORS.muted2;ctx.font='9px ui-monospace,monospace';
      ctx.textAlign='left';ctx.fillText('higher error',lx,ly-4);
      ctx.textAlign='right';ctx.fillText('lower error',lx+legendW,ly-4);
      ctx.textAlign='left';
    }
    updateMetricPlaceholders();
  }

  function updateMetricPlaceholders(){
    const metrics = Model.metrics({ amplitude:GUIDED_AMPLITUDE, q:1, M:state.M, hbar:-1, periods:4 });
    const set=(id,val)=>$(id).textContent=val;
    if(metrics){
      set('metricWave',metrics.waveformText);
      set('metricResidual',metrics.residualText);
      set('metricFrequency',metrics.frequencyText);
      set('metricHorizon',metrics.horizonText);
    } else {
      set('metricWave','—');set('metricResidual','—');set('metricFrequency','—');set('metricHorizon','—');
    }
  }

  function drawControlView(){
    const M=Number($('controlM').value), hb=Number($('controlHbar').value);
    state.M=M;state.hbar=hb;
    const info = `M = ${M} · ħ = ${fmtMinus(hb,2)}`;
    if(state.controlView==='heatmap'){
      drawPlaceholder($('mhbarMapCanvas'),'Convergence landscape in (M, ħ)',[
        info,'q = 1 and A = 1.5 rad remain fixed','baseline ħ = −1 will be marked explicitly'
      ],COLORS.purple);
    } else if(state.controlView==='curves'){
      drawPlaceholder($('hbarCurvesCanvas'),'Error versus ħ for every M',[
        info,'all integer M = 0…20 will be drawn','the active M curve will be emphasized'
      ],COLORS.purple);
    } else if(state.controlView==='temporal'){
      drawPlaceholder($('hbarTemporalCanvas'),'Temporal error under convergence control',[
        info,'compare baseline ħ = −1 against current / optimal ħ','physical time on the horizontal axis'
      ],COLORS.purple);
    } else {
      drawPlaceholder($('hbarWeightsCanvas'),'Effective finite-order term weights',[
        info,'μ_{M,n}(ħ) explains crossings between convergence curves','technical view · hidden from the main story by default'
      ],COLORS.purple);
    }
  }

  function drawPlayground(){
    drawHeroLikePlayPendulum();
    const canvasMap={
      motion:'playMotionCanvas',error:'playErrorCanvas',operator:'playOperatorCanvas',
      frequency:'playFrequencyCanvas',spectrum:'playSpectrumCanvas',residual:'playResidualCanvas'
    };
    const labels={
      motion:'Playground motion',error:'Playground temporal error',operator:'Playground operator',
      frequency:'Playground frequency',spectrum:'Playground spectrum',residual:'Playground residual'
    };
    drawPlaceholder($(canvasMap[state.playView]),labels[state.playView],[
      `A = ${state.amplitude.toFixed(2)} rad · q = ${state.q.toFixed(3)}`,
      `M = ${state.M} · ħ = ${fmtMinus(state.hbar,2)}`,
      'all scientific curves will come from the new engine'
    ],COLORS.green);
  }

  function drawHeroLikePlayPendulum(){
    const canvas=$('playPendulumCanvas'); if(!canvas)return;
    const {ctx,width,height}=prepareCanvas(canvas);clearCanvas(ctx,width,height,'rgba(115,217,135,.06)');
    const cx=width*.5,cy=height*.2,L=Math.min(width,height)*.35;
    const angle=state.amplitude*Math.cos((1-.2475*state.q)*state.time);
    const x=cx+L*Math.sin(angle),y=cy+L*Math.cos(angle);
    ctx.strokeStyle=COLORS.green;ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();
    ctx.fillStyle=COLORS.green;ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=COLORS.muted;ctx.font='10px ui-monospace,monospace';ctx.textAlign='center';
    ctx.fillText('visual shell',cx,height-18);
  }

  function switchPanels(group, view){
    $$(`[data-${group}-view]`).forEach(btn=>btn.classList.toggle('active',btn.dataset[`${group}View`]===view));
    $$(`[data-${group}-panel]`).forEach(panel=>panel.classList.toggle('active',panel.dataset[`${group}Panel`]===view));
  }

  function updateTransport(){
    state.q=Number($('transportQ').value);
    $('transportQOut').textContent=`q = ${state.q.toFixed(3)}`;
    const done=state.q>=.9995;
    $('transportStatus').textContent=done?'Nonlinear target reached':state.q<=.0005?'Linear starting system':'Intermediate transported system';
    $('transportStatusSmall').textContent=done?'The operator is now sin(x).':`The system is ${Math.round(state.q*100)}% along the continuous transport coordinate.`;
    drawTransportView();
  }

  function updateRefinement(){
    state.M=Number($('refinementM').value);
    $('refinementMOut').textContent=`M = ${state.M}`;
    drawRefinementView();
  }

  function updateControl(){
    state.M=Number($('controlM').value); state.hbar=Number($('controlHbar').value);
    $('controlMOut').textContent=`M = ${state.M}`;
    $('controlHbarOut').textContent=`ħ = ${fmtMinus(state.hbar,2)}`;
    drawControlView();
  }

  function updatePlayInputs(){
    state.amplitude=Number($('playAmplitude').value);
    state.q=Number($('playQ').value);
    state.M=Number($('playM').value);
    state.hbar=Number($('playHbar').value);
    $('playAmplitudeOut').textContent=`${state.amplitude.toFixed(2)} rad`;
    $('playQOut').textContent=`q = ${state.q.toFixed(3)}`;
    $('playMOut').textContent=`M = ${state.M}`;
    $('playHbarOut').textContent=`ħ = ${fmtMinus(state.hbar,2)}`;
    drawPlayground();
  }

  function wireTabs(group, stateKey, drawFn){
    $$(`[data-${group}-view]`).forEach(button=>button.addEventListener('click',()=>{
      const view=button.dataset[`${group}View`];
      state[stateKey]=view; switchPanels(group,view); drawFn();
    }));
  }

  function wireInteractions(){
    $('transportQ').addEventListener('input',updateTransport);
    $('transportReset').addEventListener('click',()=>{$('transportQ').value=0;updateTransport();});
    wireTabs('transport','transportView',drawTransportView);

    $('refinementM').addEventListener('input',updateRefinement);
    $('refinementMMinus').addEventListener('click',()=>{$('refinementM').value=clamp(Number($('refinementM').value)-1,0,20);updateRefinement();});
    $('refinementMPlus').addEventListener('click',()=>{$('refinementM').value=clamp(Number($('refinementM').value)+1,0,20);updateRefinement();});
    $('refinementReset').addEventListener('click',()=>{$('refinementM').value=0;updateRefinement();});
    wireTabs('refinement','refinementView',drawRefinementView);

    ['controlM','controlHbar'].forEach(id=>$(id).addEventListener('input',updateControl));
    $('controlReset').addEventListener('click',()=>{$('controlM').value=8;$('controlHbar').value=-1;updateControl();});
    wireTabs('control','controlView',drawControlView);
    $('scanHbar').addEventListener('click',()=>{
      $('scanReadout').textContent='Waiting for the validated browser GOTHAM engine';
      $('applyBestHbar').disabled=true;
    });

    ['playAmplitude','playQ','playM','playHbar'].forEach(id=>$(id).addEventListener('input',updatePlayInputs));
    $('playgroundReset').addEventListener('click',()=>{
      $('playAmplitude').value=2;$('playQ').value=1;$('playM').value=8;$('playHbar').value=-1;updatePlayInputs();
    });
    $('playPause').addEventListener('click',()=>{
      state.playing=!state.playing;$('playPause').textContent=state.playing?'Pause':'Play';
    });
    $('playTimeReset').addEventListener('click',()=>{state.time=0;drawPlayground();});
    wireTabs('play','playView',drawPlayground);
  }

  function setupScrollEffects(){
    const header=$('siteHeader'),progress=$('scrollProgress'),navLinks=$$('.site-header nav a'),sections=$$('[data-section]');
    const onScroll=()=>{
      header.classList.toggle('scrolled',window.scrollY>25);
      const scrollable=document.documentElement.scrollHeight-window.innerHeight;
      progress.style.width=`${scrollable>0?100*window.scrollY/scrollable:0}%`;
      let current=null;
      sections.forEach(section=>{const r=section.getBoundingClientRect();if(r.top<window.innerHeight*.38&&r.bottom>window.innerHeight*.38)current=section.id;});
      navLinks.forEach(link=>link.classList.toggle('active',link.getAttribute('href')===`#${current}`));
    };
    window.addEventListener('scroll',onScroll,{passive:true});onScroll();
  }

  function setupReveal(){
    const items=$$('.reveal');
    if(!('IntersectionObserver'in window)){items.forEach(x=>x.classList.add('visible'));return;}
    const obs=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');obs.unobserve(entry.target);}}),{threshold:.12});
    items.forEach(item=>obs.observe(item));
  }

  function resizeVisible(){
    drawOperatorComparison();drawBaselineMotion();drawTransportView();drawRefinementView();drawControlView();drawPlayground();drawHeroPendulum(state.time);
  }

  let last=performance.now();
  function animationLoop(now){
    const dt=Math.min(.04,(now-last)/1000);last=now;
    state.time += state.playing ? dt : 0;
    drawHeroPendulum(state.time);
    if(state.playing) drawHeroLikePlayPendulum();
    requestAnimationFrame(animationLoop);
  }

  function init(){
    wireInteractions();setupScrollEffects();setupReveal();
    updateTransport();updateRefinement();updateControl();updatePlayInputs();
    drawOperatorComparison();drawBaselineMotion();drawHeroPendulum(0);
    let resizeTimer;
    window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(resizeVisible,120);});
    requestAnimationFrame(animationLoop);
  }

  init();
})();
