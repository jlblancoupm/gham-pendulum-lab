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
    time: 0, playing: true,
    transport: { q: 0.0, view: 'operator' },
    geometry: { q: 1.0, M: 6, toleranceExp: 4, view: 'frontier' },
    refinement: { M: 0, view: 'trajectory' },
    control: { M: 8, hbar: -1.0, view: 'heatmap', bestHbar: null, bestError: null },
    playground: { amplitude: 2.0, q: 1.0, M: 8, hbar: -1.0, view: 'motion', result: null }
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const Model = {
    ready: true,
    cache: new Map(),
    qReferenceCache: new Map(),
    qmMetricCache: new Map(),
    generalMetricCache: new Map(),

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
      const cacheKey = `${Number(amplitude).toFixed(5)}|${Number(q).toFixed(6)}|${periods}|${samples}`;
      if (this.qReferenceCache.has(cacheKey)) return this.qReferenceCache.get(cacheKey);

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

      const result = { t, x, v, period, omega:2*Math.PI/period, duration };
      this.qReferenceCache.set(cacheKey, result);
      return result;
    },

    qmMetrics({ amplitude = 1.5, q = 0, M = 0, periods = 4 }) {
      const metricKey = `${Number(amplitude).toFixed(5)}|${Number(q).toFixed(6)}|${M}|${periods}`;
      if (this.qmMetricCache.has(metricKey)) return this.qmMetricCache.get(metricKey);

      const exact = this.exactIntermediate({ amplitude, q, periods, samples: 1200 });
      const approx = this.evaluateTransport({ amplitude, q, M, duration: exact.duration, samples:exact.x.length });

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

      const metric = {
        waveform: Math.sqrt(se/Math.max(sx,1e-30)),
        residual: Math.sqrt(sr/exact.x.length),
        frequency: Math.abs(approx.omega-exact.omega)/exact.omega,
        horizon
      };
      this.qmMetricCache.set(metricKey, metric);
      return metric;
    },


    _binomial(n,k){ if(k<0||k>n)return 0;if(k===0||k===n)return 1;k=Math.min(k,n-k);let o=1;for(let i=1;i<=k;i++)o=o*(n-k+i)/i;return o; },
    hbarWeight(M,n,hbar){
      if(n===0)return 1;
      let s=0;for(let k=0;k<=M-n;k++)s+=this._binomial(k+n-1,k)*Math.pow(1+hbar,k);
      return Math.pow(-hbar,n)*s;
    },
    evaluateControlled({amplitude=1.5,q=1,M=8,hbar=-1,duration=30,samples=1200}){
      const series=this.buildSeries({amplitude,maxOrder:M}),shape=new Float64Array(series.N),d2shape=new Float64Array(series.N);let omega2=0;
      for(let n=0;n<=M;n++){
        const wt=(n===0?1:this.hbarWeight(M,n,hbar))*Math.pow(q,n);
        omega2+=wt*series.W[n];
        for(let i=0;i<series.N;i++){shape[i]+=wt*series.X[n][i];d2shape[i]+=wt*series.Xdd[n][i];}
      }
      const omega=Math.sqrt(Math.max(omega2,1e-14)),t=new Float64Array(samples),x=new Float64Array(samples),residual=new Float64Array(samples);
      for(let i=0;i<samples;i++){const ti=duration*i/(samples-1),ph=omega*ti,xi=this._interpPeriodic(shape,ph),dd=this._interpPeriodic(d2shape,ph);
        t[i]=ti;x[i]=xi;residual[i]=omega*omega*dd+(1-q)*xi+q*Math.sin(xi);}
      return {t,x,residual,shape,d2shape,omega,series,duration};
    },
    generalMetrics({amplitude=1.5,q=1,M=8,hbar=-1,periods=4,samples=1000}){
      const key=`${amplitude.toFixed(4)}|${q.toFixed(5)}|${M}|${hbar.toFixed(4)}|${periods}|${samples}`;
      if(this.generalMetricCache.has(key))return this.generalMetricCache.get(key);
      const exact=this.exactIntermediate({amplitude,q,periods,samples}),approx=this.evaluateControlled({amplitude,q,M,hbar,duration:exact.duration,samples});
      let se=0,sx=0,sr=0,horizon=periods,hit=false;const thr=.01*amplitude;
      for(let i=0;i<samples;i++){const e=approx.x[i]-exact.x[i];se+=e*e;sx+=exact.x[i]*exact.x[i];sr+=approx.residual[i]*approx.residual[i];
        if(!hit&&Math.abs(e)>thr){horizon=exact.t[i]/exact.period;hit=true;}}
      const mt={waveform:Math.sqrt(se/Math.max(sx,1e-30)),residual:Math.sqrt(sr/samples),frequency:Math.abs(approx.omega-exact.omega)/exact.omega,horizon,exact,approx};
      this.generalMetricCache.set(key,mt);return mt;
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

    metrics({ amplitude=1.5,q=1,M=0,hbar=-1,periods=4 }){
      const mt=this.generalMetrics({amplitude,q,M,hbar,periods,samples:1400});
      return {waveform:mt.waveform,residual:mt.residual,frequency:mt.frequency,horizon:mt.horizon,
        waveformText:mt.waveform.toExponential(2),residualText:mt.residual.toExponential(2),
        frequencyText:mt.frequency.toExponential(2),horizonText:`${mt.horizon.toFixed(2)} T`};
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
    const view=state.transport.view, q=state.transport.q, A=GUIDED_AMPLITUDE, MT=10;
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



  const geometryCache={key:null,qSteps:40,maxM:12,rows:[],computing:false,token:0};
  const geometryEps=()=>Math.pow(10,-state.geometry.toleranceExp);
  function ensureGeometryData(){
    const A=GUIDED_AMPLITUDE,qSteps=window.innerWidth<700?24:40,maxM=12,key=`${A}|${qSteps}|${maxM}`;
    if(geometryCache.key===key&&(geometryCache.computing||geometryCache.rows.filter(Boolean).length===qSteps+1))return;
    geometryCache.key=key;geometryCache.qSteps=qSteps;geometryCache.maxM=maxM;geometryCache.rows=new Array(qSteps+1);geometryCache.computing=true;
    const token=++geometryCache.token;let iq=0;
    const batch=()=>{if(token!==geometryCache.token)return;let n=0,per=window.innerWidth<700?1:2;
      while(iq<=qSteps&&n<per){const q=iq/qSteps,row=[];for(let M=0;M<=maxM;M++)row[M]=Model.qmMetrics({amplitude:A,q,M,periods:3});geometryCache.rows[iq]=row;iq++;n++;}
      drawGeometryView();if(iq<=qSteps)requestAnimationFrame(batch);else{geometryCache.computing=false;drawGeometryView();}};
    requestAnimationFrame(batch);
  }
  function geometryResolved(mt,eps){return mt&&mt.waveform<eps&&mt.residual<eps&&mt.frequency<eps/10&&mt.horizon>=3-1e-9;}
  function geometryFrontiers(){
    const eps=geometryEps(),qs=geometryCache.qSteps,maxM=geometryCache.maxM,qmax=new Array(maxM+1).fill(0),mmin=new Array(qs+1).fill(null);
    for(let M=0;M<=maxM;M++){let last=0;for(let iq=0;iq<=qs;iq++){const row=geometryCache.rows[iq];if(row&&geometryResolved(row[M],eps))last=iq/qs;}qmax[M]=last;}
    for(let iq=0;iq<=qs;iq++){const row=geometryCache.rows[iq];if(!row)continue;for(let M=0;M<=maxM;M++){if(geometryResolved(row[M],eps)){mmin[iq]=M;break;}}}
    return {qmax,mmin};
  }
  function updateGeometryReadouts(){
    const {qmax,mmin}=geometryFrontiers(),M=Math.min(state.geometry.M,geometryCache.maxM),iq=Math.round(state.geometry.q*geometryCache.qSteps);
    $('geometryQmax').textContent=`q_max = ${(qmax[M]||0).toFixed(2)}`;$('geometryMmin').textContent=mmin[iq]==null?'M_min > range':`M_min = ${mmin[iq]}`;
    $('geometryStatus').textContent=geometryCache.computing?'computing':'ready';
  }
  function drawGeometryView(){
    const map={frontier:'geometryFrontierCanvas',budget:'geometryBudgetCanvas',reach:'geometryReachCanvas'},canvas=$(map[state.geometry.view]);
    if(!canvas||canvas.offsetParent===null)return;const {ctx,width,height}=prepareCanvas(canvas);clearCanvas(ctx,width,height,'rgba(244,202,92,.05)');
    if(!geometryCache.rows.filter(Boolean).length){drawPlaceholder(canvas,'q–M geometry',['computing validation checkpoints…'],COLORS.gold);return;}
    const {qmax,mmin}=geometryFrontiers(),eps=geometryEps(),l=76,r=30,t=54,b=58,w=width-l-r,h=height-t-b;drawGrid(ctx,l,t,w,h,8,5);
    if(state.geometry.view==='frontier'){
      const X=M=>l+M/geometryCache.maxM*w,Y=q=>t+(1-q)*h;
      ctx.strokeStyle=COLORS.red;ctx.lineWidth=3;ctx.beginPath();qmax.forEach((q,M)=>M?ctx.lineTo(X(M),Y(q)):ctx.moveTo(X(M),Y(q)));ctx.stroke();
      qmax.forEach((q,M)=>{ctx.fillStyle=COLORS.red;ctx.beginPath();ctx.arc(X(M),Y(q),3,0,2*Math.PI);ctx.fill();});
      ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.arc(X(state.geometry.M),Y(state.geometry.q),7,0,2*Math.PI);ctx.stroke();
      ctx.fillStyle=COLORS.gold;ctx.beginPath();ctx.arc(X(state.geometry.M),Y(state.geometry.q),3,0,2*Math.PI);ctx.fill();
      drawAxesLabel(ctx,'truncation order M',l+w,height-14,'right');drawAxesLabel(ctx,'continuous transport q',l+4,t+12);
    }else if(state.geometry.view==='budget'){
      const X=q=>l+q*w,Y=M=>t+(geometryCache.maxM-M)/geometryCache.maxM*h;ctx.strokeStyle=COLORS.blue;ctx.lineWidth=2.6;ctx.beginPath();let begun=false;
      mmin.forEach((M,iq)=>{if(M==null)return;const q=iq/geometryCache.qSteps;if(!begun){ctx.moveTo(X(q),Y(M));begun=true;}else ctx.lineTo(X(q),Y(M));});ctx.stroke();
      drawAxesLabel(ctx,'continuous transport q',l+w,height-14,'right');drawAxesLabel(ctx,'minimum required M',l+4,t+12);
    }else{
      const X=M=>l+M/geometryCache.maxM*w,Y=q=>t+(1-q)*h;ctx.strokeStyle=COLORS.red;ctx.lineWidth=2.6;ctx.beginPath();qmax.forEach((q,M)=>M?ctx.lineTo(X(M),Y(q)):ctx.moveTo(X(M),Y(q)));ctx.stroke();
      ctx.fillStyle=COLORS.gold;ctx.beginPath();ctx.arc(X(state.geometry.M),Y(qmax[state.geometry.M]||0),5,0,2*Math.PI);ctx.fill();
      drawAxesLabel(ctx,'truncation order M',l+w,height-14,'right');drawAxesLabel(ctx,'maximum reliable q',l+4,t+12);
    }
    ctx.fillStyle=COLORS.text;ctx.font='700 12px ui-sans-serif,system-ui';ctx.fillText(`ε=${eps.toExponential(0)} · ${state.geometry.view}`,l,t-18);
    ctx.fillStyle=COLORS.muted2;ctx.font='10px ui-sans-serif,system-ui';ctx.fillText(geometryCache.computing?'computing progressively…':'validation grid cached',l,t+h+34);updateGeometryReadouts();
  }
  function updateGeometry(){
    state.geometry.q=Number($('geometryQ').value);state.geometry.M=Number($('geometryM').value);state.geometry.toleranceExp=Number($('geometryTolerance').value);
    $('geometryQOut').textContent=`q = ${state.geometry.q.toFixed(2)}`;$('geometryMOut').textContent=`M = ${state.geometry.M}`;$('geometryToleranceOut').textContent=`ε = 1e−${state.geometry.toleranceExp}`;
    ensureGeometryData();drawGeometryView();
  }

  function drawRefinementView() {
    const M = state.refinement.M;
    const panel = state.refinement.view;
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
    }
    updateMetricPlaceholders();
  }

  function updateMetricPlaceholders(){
    const metrics = Model.metrics({ amplitude:GUIDED_AMPLITUDE, q:1, M:state.refinement.M, hbar:-1, periods:4 });
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

  function controlMetric(M,hbar){return Model.generalMetrics({amplitude:GUIDED_AMPLITUDE,q:1,M,hbar,periods:4,samples:700});}
  function drawControlView(){
    const M=state.control.M,hb=state.control.hbar,v=state.control.view,canvasMap={heatmap:'mhbarMapCanvas',curves:'hbarCurvesCanvas',temporal:'hbarTemporalCanvas',weights:'hbarWeightsCanvas'};
    const canvas=$(canvasMap[v]),{ctx,width,height}=prepareCanvas(canvas);clearCanvas(ctx,width,height,'rgba(179,124,255,.05)');const l=66,r=28,t=46,b=54,w=width-l-r,h=height-t-b;
    if(v==='heatmap'){const maxM=14,nh=25,cw=w/maxM,ch=h/nh;let Z=[],zmin=1e9,zmax=-1e9;
      for(let i=0;i<nh;i++){const hv=-1.6+1.2*i/(nh-1),row=[];for(let m=1;m<=maxM;m++){const z=Math.log10(Math.max(controlMetric(m,hv).waveform,1e-12));row.push(z);zmin=Math.min(zmin,z);zmax=Math.max(zmax,z);}Z.push(row);}
      for(let i=0;i<nh;i++)for(let m=0;m<maxM;m++){const u=1-(Z[i][m]-zmin)/Math.max(zmax-zmin,1e-9);ctx.fillStyle=`rgb(${Math.round(20+210*u)},${Math.round(35+125*u)},${Math.round(75+75*(1-u))})`;ctx.fillRect(l+m*cw,t+(nh-1-i)*ch,cw+1,ch+1);}
      const px=l+(Math.min(M,maxM)-.5)*cw,py=t+(1-((-hb-.4)/1.2))*h;ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.arc(px,py,7,0,2*Math.PI);ctx.stroke();drawAxesLabel(ctx,'M',l+w,height-14,'right');drawAxesLabel(ctx,'ħ',l+4,t+12);
    }else if(v==='curves'){drawGrid(ctx,l,t,w,h,8,6);const maxM=14,nh=37,all=[];let mn=1e9,mx=-1e9;
      for(let m=1;m<=maxM;m++){let a=[];for(let i=0;i<nh;i++){const hv=-1.6+1.2*i/(nh-1),z=Math.log10(Math.max(controlMetric(m,hv).waveform,1e-12));a.push([hv,z]);mn=Math.min(mn,z);mx=Math.max(mx,z);}all.push(a);}
      const X=x=>l+(x+1.6)/1.2*w,Y=z=>t+(mx-z)/Math.max(mx-mn,1e-9)*h;all.forEach((a,i)=>{const mm=i+1;ctx.strokeStyle=mm===M?COLORS.gold:`rgba(73,185,255,${.18+.04*mm})`;ctx.lineWidth=mm===M?3:1.1;ctx.beginPath();a.forEach(([x,z],j)=>j?ctx.lineTo(X(x),Y(z)):ctx.moveTo(X(x),Y(z)));ctx.stroke();});drawAxesLabel(ctx,'ħ',l+w,height-14,'right');drawAxesLabel(ctx,'log10 NRMSE',l+4,t+12);
    }else if(v==='temporal'){drawGrid(ctx,l,t,w,h,8,5);const cur=controlMetric(M,hb),bas=controlMetric(M,-1),ex=cur.exact;let me=1e-8;for(let i=0;i<ex.x.length;i++)me=Math.max(me,Math.abs(cur.approx.x[i]-ex.x[i]),Math.abs(bas.approx.x[i]-ex.x[i]));const X=x=>l+x/ex.duration*w,Y=e=>t+(me-e)/(2*me)*h;
      const plot=(mt,c,d=[])=>{ctx.save();ctx.strokeStyle=c;ctx.lineWidth=2;ctx.setLineDash(d);ctx.beginPath();for(let i=0;i<ex.x.length;i++){const e=mt.approx.x[i]-ex.x[i];i?ctx.lineTo(X(ex.t[i]),Y(e)):ctx.moveTo(X(ex.t[i]),Y(e));}ctx.stroke();ctx.restore();};plot(bas,COLORS.muted2,[5,4]);plot(cur,COLORS.purple);drawAxesLabel(ctx,'physical time',l+w,height-14,'right');drawAxesLabel(ctx,'error [rad]',l+4,t+12);
    }else{drawGrid(ctx,l,t,w,h,Math.max(4,M),5);let a=[],mn=0,mx=1;for(let n=0;n<=M;n++){const x=n?Model.hbarWeight(M,n,hb):1;a.push(x);mn=Math.min(mn,x);mx=Math.max(mx,x);}const pad=.1*Math.max(1,mx-mn);mn-=pad;mx+=pad;const X=n=>l+(M?n/M:0)*w,Y=x=>t+(mx-x)/(mx-mn)*h;ctx.strokeStyle=COLORS.purple;ctx.lineWidth=2.2;ctx.beginPath();a.forEach((x,n)=>n?ctx.lineTo(X(n),Y(x)):ctx.moveTo(X(n),Y(x)));ctx.stroke();a.forEach((x,n)=>{ctx.fillStyle=COLORS.purple;ctx.beginPath();ctx.arc(X(n),Y(x),4,0,2*Math.PI);ctx.fill();});drawAxesLabel(ctx,'term n',l+w,height-14,'right');drawAxesLabel(ctx,'μ_M,n(ħ)',l+4,t+12);}
    ctx.fillStyle=COLORS.text;ctx.font='700 12px ui-sans-serif,system-ui';ctx.fillText(`M=${M} · ħ=${fmtMinus(hb,2)}`,l,t-18);
  }
  function scanBestHbar(){let best=Infinity,bh=-1;for(let i=0;i<=64;i++){const hv=-1.6+1.2*i/64,e=controlMetric(state.control.M,hv).waveform;if(e<best){best=e;bh=hv;}}state.control.bestHbar=bh;state.control.bestError=best;$('scanReadout').textContent=`best ħ ${fmtMinus(bh,3)} · error ${best.toExponential(2)}`;$('applyBestHbar').disabled=false;}


  function updatePlaygroundResult(){const p=state.playground,ex=Model.exactIntermediate({amplitude:p.amplitude,q:p.q,periods:4,samples:1000}),ap=Model.evaluateControlled({amplitude:p.amplitude,q:p.q,M:p.M,hbar:p.hbar,duration:ex.duration,samples:1000});p.result={exact:ex,approx:ap};}
  function drawPlayground(){if(!state.playground.result)updatePlaygroundResult();drawHeroLikePlayPendulum();const p=state.playground,{exact:ex,approx:ap}=p.result,v=p.view,map={motion:'playMotionCanvas',error:'playErrorCanvas',operator:'playOperatorCanvas',frequency:'playFrequencyCanvas',spectrum:'playSpectrumCanvas',residual:'playResidualCanvas'},canvas=$(map[v]),{ctx,width,height}=prepareCanvas(canvas);clearCanvas(ctx,width,height,'rgba(115,217,135,.04)');const l=60,r=28,t=42,b=50,w=width-l-r,h=height-t-b;
    if(v==='motion'||v==='error'||v==='residual'){drawGrid(ctx,l,t,w,h,8,5);const X=x=>l+x/ex.duration*w;if(v==='motion'){const A=p.amplitude,Y=x=>t+(A*1.1-x)/(2.2*A)*h;const plot=(arr,c,d=[])=>{ctx.save();ctx.strokeStyle=c;ctx.lineWidth=2;ctx.setLineDash(d);ctx.beginPath();arr.forEach((x,i)=>i?ctx.lineTo(X(ex.t[i]),Y(x)):ctx.moveTo(X(ex.t[i]),Y(x)));ctx.stroke();ctx.restore();};plot(ex.x,COLORS.green,[4,4]);plot(ap.x,COLORS.blue);drawAxesLabel(ctx,'time',l+w,height-14,'right');drawAxesLabel(ctx,'x(t)',l+4,t+12);}
      else if(v==='error'){let me=1e-8;for(let i=0;i<ex.x.length;i++)me=Math.max(me,Math.abs(ap.x[i]-ex.x[i]));const Y=e=>t+(me-e)/(2*me)*h;ctx.strokeStyle=COLORS.orange;ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<ex.x.length;i++){const e=ap.x[i]-ex.x[i];i?ctx.lineTo(X(ex.t[i]),Y(e)):ctx.moveTo(X(ex.t[i]),Y(e));}ctx.stroke();drawAxesLabel(ctx,'time',l+w,height-14,'right');drawAxesLabel(ctx,'error',l+4,t+12);}
      else{let mr=1e-8;for(const e of ap.residual)mr=Math.max(mr,Math.abs(e));const Y=e=>t+(mr-e)/(2*mr)*h;ctx.strokeStyle=COLORS.red;ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<ap.residual.length;i++){const e=ap.residual[i];i?ctx.lineTo(X(ap.t[i]),Y(e)):ctx.moveTo(X(ap.t[i]),Y(e));}ctx.stroke();drawAxesLabel(ctx,'time',l+w,height-14,'right');drawAxesLabel(ctx,'residual',l+4,t+12);}}
    else if(v==='operator'){drawGrid(ctx,l,t,w,h,7,5);const A=Math.max(1.1,p.amplitude*1.12),X=x=>l+(x+A)/(2*A)*w,Y=y=>t+(A-y)/(2*A)*h;const plot=(fn,c,d=[],lw=2)=>{ctx.save();ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.setLineDash(d);ctx.beginPath();for(let i=0;i<=400;i++){const x=-A+2*A*i/400;i?ctx.lineTo(X(x),Y(fn(x))):ctx.moveTo(X(x),Y(fn(x)));}ctx.stroke();ctx.restore();};plot(x=>x,COLORS.muted2,[5,5],1.2);plot(x=>Math.sin(x),COLORS.green,[3,5],1.2);plot(x=>(1-p.q)*x+p.q*Math.sin(x),COLORS.gold,[],2.6);drawAxesLabel(ctx,'x',l+w,height-14,'right');drawAxesLabel(ctx,'g_q(x)',l+4,t+12);}
    else if(v==='frequency'){drawGrid(ctx,l,t,w,h,8,5);let vals=[],refs=[],mn=1e9,mx=-1e9;for(let i=0;i<=20;i++){const q=i/20,o=Model.evaluateControlled({amplitude:p.amplitude,q,M:p.M,hbar:p.hbar,duration:1,samples:2}).omega;vals.push(o);mn=Math.min(mn,o);mx=Math.max(mx,o);}for(let i=0;i<=8;i++){const q=i/8,o=Model.exactIntermediate({amplitude:p.amplitude,q,periods:2,samples:400}).omega;refs.push([q,o]);mn=Math.min(mn,o);mx=Math.max(mx,o);}const X=q=>l+q*w,Y=o=>t+(mx-o)/Math.max(mx-mn,1e-9)*h;ctx.strokeStyle=COLORS.blue;ctx.lineWidth=2.2;ctx.beginPath();vals.forEach((o,i)=>i?ctx.lineTo(X(i/20),Y(o)):ctx.moveTo(X(0),Y(o)));ctx.stroke();refs.forEach(([q,o])=>{ctx.fillStyle=COLORS.green;ctx.beginPath();ctx.arc(X(q),Y(o),3,0,2*Math.PI);ctx.fill();});drawAxesLabel(ctx,'q',l+w,height-14,'right');drawAxesLabel(ctx,'Ω',l+4,t+12);}
    else{drawGrid(ctx,l,t,w,h,8,5);const shape=ap.shape,N=shape.length,lines=[];let ma=0;for(let n=1;n<=15;n+=2){let c=0,s=0;for(let i=0;i<N;i++){const th=2*Math.PI*i/N;c+=shape[i]*Math.cos(n*th);s+=shape[i]*Math.sin(n*th);}const a=2*Math.hypot(c,s)/N;lines.push([n*ap.omega,a]);ma=Math.max(ma,a);}const mo=lines.at(-1)[0]*1.05,X=o=>l+o/mo*w,Y=a=>t+(ma-a)/Math.max(ma,1e-9)*h;lines.forEach(([o,a])=>{ctx.strokeStyle=COLORS.blue;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(X(o),Y(0));ctx.lineTo(X(o),Y(a));ctx.stroke();ctx.fillStyle=COLORS.blue;ctx.beginPath();ctx.arc(X(o),Y(a),3,0,2*Math.PI);ctx.fill();});drawAxesLabel(ctx,'ω',l+w,height-14,'right');drawAxesLabel(ctx,'amplitude',l+4,t+12);}
    ctx.fillStyle=COLORS.text;ctx.font='700 11px ui-sans-serif,system-ui';ctx.fillText(`A=${p.amplitude.toFixed(2)} · q=${p.q.toFixed(2)} · M=${p.M} · ħ=${fmtMinus(p.hbar,2)}`,l,t-16);
  }
  function drawHeroLikePlayPendulum(){const canvas=$('playPendulumCanvas');if(!canvas)return;const {ctx,width,height}=prepareCanvas(canvas);clearCanvas(ctx,width,height,'rgba(115,217,135,.06)');if(!state.playground.result)return;const p=state.playground,ap=p.result.approx,cx=width*.5,cy=height*.2,L=Math.min(width,height)*.35,ang=Model._interpPeriodic(ap.shape,ap.omega*state.time),x=cx+L*Math.sin(ang),y=cy+L*Math.cos(ang);ctx.strokeStyle=COLORS.green;ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();ctx.fillStyle=COLORS.green;ctx.beginPath();ctx.arc(x,y,9,0,2*Math.PI);ctx.fill();}


  function switchPanels(group, view){
    $$(`[data-${group}-view]`).forEach(btn=>btn.classList.toggle('active',btn.dataset[`${group}View`]===view));
    $$(`[data-${group}-panel]`).forEach(panel=>panel.classList.toggle('active',panel.dataset[`${group}Panel`]===view));
  }

  function updateTransport(){
    state.transport.q=Number($('transportQ').value);
    $('transportQOut').textContent=`q = ${state.transport.q.toFixed(3)}`;
    const done=state.transport.q>=.9995;
    $('transportStatus').textContent=done?'Nonlinear target reached':state.transport.q<=.0005?'Linear starting system':'Intermediate transported system';
    $('transportStatusSmall').textContent=done?'The operator is now sin(x).':`The system is ${Math.round(state.transport.q*100)}% along the continuous transport coordinate.`;
    drawTransportView();
  }

  function updateRefinement(){
    state.refinement.M=Number($('refinementM').value);
    $('refinementMOut').textContent=`M = ${state.refinement.M}`;
    drawRefinementView();
  }

  function updateControl(){
    state.control.M=Number($('controlM').value); state.control.hbar=Number($('controlHbar').value);
    $('controlMOut').textContent=`M = ${state.control.M}`;
    $('controlHbarOut').textContent=`ħ = ${fmtMinus(state.control.hbar,2)}`;
    drawControlView();
  }

  function updatePlayInputs(){
    state.playground.amplitude=Number($('playAmplitude').value);
    state.playground.q=Number($('playQ').value);
    state.playground.M=Number($('playM').value);
    state.playground.hbar=Number($('playHbar').value);
    $('playAmplitudeOut').textContent=`${state.playground.amplitude.toFixed(2)} rad`;
    $('playQOut').textContent=`q = ${state.playground.q.toFixed(3)}`;
    $('playMOut').textContent=`M = ${state.playground.M}`;
    $('playHbarOut').textContent=`ħ = ${fmtMinus(state.playground.hbar,2)}`;
    updatePlaygroundResult();
    drawPlayground();
  }

  function wireTabs(group, setter, drawFn){
    $$(`[data-${group}-view]`).forEach(button=>button.addEventListener('click',()=>{
      const view=button.dataset[`${group}View`];
      setter(view);
      switchPanels(group,view);
      drawFn();
    }));
  }

  function wireInteractions(){
    $('transportQ').addEventListener('input',updateTransport);
    $('transportReset').addEventListener('click',()=>{$('transportQ').value=0;updateTransport();});
    wireTabs('transport',v=>state.transport.view=v,drawTransportView);

    ['geometryQ','geometryM','geometryTolerance'].forEach(id=>$(id).addEventListener('input',updateGeometry));
    $('geometryReset').addEventListener('click',()=>{$('geometryQ').value=1;$('geometryM').value=6;$('geometryTolerance').value=4;updateGeometry();});
    wireTabs('geometry',v=>state.geometry.view=v,drawGeometryView);

    $('refinementM').addEventListener('input',updateRefinement);
    $('refinementMMinus').addEventListener('click',()=>{$('refinementM').value=clamp(Number($('refinementM').value)-1,0,20);updateRefinement();});
    $('refinementMPlus').addEventListener('click',()=>{$('refinementM').value=clamp(Number($('refinementM').value)+1,0,20);updateRefinement();});
    $('refinementReset').addEventListener('click',()=>{$('refinementM').value=0;updateRefinement();});
    wireTabs('refinement',v=>state.refinement.view=v,drawRefinementView);

    ['controlM','controlHbar'].forEach(id=>$(id).addEventListener('input',updateControl));
    $('controlReset').addEventListener('click',()=>{$('controlM').value=8;$('controlHbar').value=-1;updateControl();});
    wireTabs('control',v=>state.control.view=v,drawControlView);
    $('scanHbar').addEventListener('click',scanBestHbar);
    $('applyBestHbar').addEventListener('click',()=>{if(state.control.bestHbar==null)return;$('controlHbar').value=state.control.bestHbar;updateControl();});

    ['playAmplitude','playQ','playM','playHbar'].forEach(id=>$(id).addEventListener('input',updatePlayInputs));
    $('playgroundReset').addEventListener('click',()=>{
      $('playAmplitude').value=2;$('playQ').value=1;$('playM').value=8;$('playHbar').value=-1;updatePlayInputs();
    });
    $('playPause').addEventListener('click',()=>{
      state.playing=!state.playing;$('playPause').textContent=state.playing?'Pause':'Play';
    });
    $('playTimeReset').addEventListener('click',()=>{state.time=0;drawPlayground();});
    wireTabs('play',v=>state.playground.view=v,drawPlayground);
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
    drawOperatorComparison();drawBaselineMotion();drawTransportView();drawGeometryView();drawRefinementView();drawControlView();drawPlayground();drawHeroPendulum(state.time);
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
    updateTransport();updateGeometry();updateRefinement();updateControl();updatePlayInputs();
    drawOperatorComparison();drawBaselineMotion();drawHeroPendulum(0);
    let resizeTimer;
    window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(resizeVisible,120);});
    requestAnimationFrame(animationLoop);
  }

  init();
})();
