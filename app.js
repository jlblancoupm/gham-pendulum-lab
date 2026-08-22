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

    exactPendulum() { throw new Error('Exact reference engine will be connected in Refinement'); },
    metrics() { return null; }
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
      ctx.save(); ctx.font='10px ui-monospace,monospace';
      ctx.fillStyle='rgba(5,16,28,.84)'; ctx.strokeStyle='rgba(174,202,229,.20)';
      ctx.beginPath(); ctx.roundRect(x,y,142,66,8); ctx.fill(); ctx.stroke();
      lines.forEach((s,i)=>{ctx.fillStyle=i?COLORS.muted2:COLORS.gold;ctx.fillText(s,x+10,y+16+14*i);});
      ctx.restore();
    };

    if(view==='operator'){
      const {ctx,width,height}=prepareCanvas($('transportOperatorCanvas')); clearCanvas(ctx,width,height);
      const l=55,r=28,t=35,b=48,w=width-l-r,h=height-t-b; drawGrid(ctx,l,t,w,h,7,5);
      const xmin=-1.75,xmax=1.75,ymin=-1.75,ymax=1.75;
      const X=x=>l+(x-xmin)/(xmax-xmin)*w,Y=y=>t+(ymax-y)/(ymax-ymin)*h;
      const plot=(fn,c,lw,d=[])=>{ctx.save();ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.setLineDash(d);ctx.beginPath();
        for(let i=0;i<=500;i++){let x=xmin+(xmax-xmin)*i/500; i?ctx.lineTo(X(x),Y(fn(x))):ctx.moveTo(X(x),Y(fn(x)));}ctx.stroke();ctx.restore();};
      plot(x=>x,COLORS.muted2,1.2,[5,5]); plot(x=>Math.sin(x),COLORS.green,1.2,[3,5]);
      plot(x=>(1-q)*x+q*Math.sin(x),COLORS.gold,2.8);
      drawAxesLabel(ctx,'x [rad]',l+w,height-14,'right'); drawAxesLabel(ctx,'g_q(x)',l+6,t+14);
      ctx.font='10px ui-sans-serif,system-ui';
      [[COLORS.muted2,'start q=0'],[COLORS.green,'target q=1'],[COLORS.gold,`current q=${q.toFixed(2)}`]]
        .forEach(([c,s],i)=>{ctx.fillStyle=c;ctx.fillText(s,l+8+i*76,t+31);});
    } else if(view==='motion'){
      const {ctx,width,height}=prepareCanvas($('transportMotionCanvas')); clearCanvas(ctx,width,height);
      const l=58,r=28,t=38,b=48,w=width-l-r,h=height-t-b; drawGrid(ctx,l,t,w,h,8,5);
      const X=v=>l+v/current.t[current.t.length-1]*w,Y=v=>t+(A*1.08-v)/(2*A*1.08)*h;
      const plot=(res,c,lw,d,a=1)=>{ctx.save();ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.setLineDash(d);ctx.globalAlpha=a;ctx.beginPath();
        for(let i=0;i<res.t.length;i++) i?ctx.lineTo(X(res.t[i]),Y(res.x[i])):ctx.moveTo(X(res.t[i]),Y(res.x[i]));ctx.stroke();ctx.restore();};
      plot(initial,COLORS.muted2,1.2,[6,5],.72); plot(target,COLORS.green,1.4,[3,5],.88); plot(current,COLORS.blue,2.6,[]);
      drawAxesLabel(ctx,'physical time',l+w,height-14,'right'); drawAxesLabel(ctx,'x(t;q) [rad]',l+6,t+14);
      ctx.font='10px ui-sans-serif,system-ui';
      [[COLORS.muted2,'start q=0'],[COLORS.green,'target q=1'],[COLORS.blue,`current q=${q.toFixed(2)}`]]
        .forEach(([c,s],i)=>{ctx.fillStyle=c;ctx.fillText(s,l+8+i*72,t+31);});
      info(ctx,Math.max(l+6,width-178),t+8);
    } else if(view==='frequency'){
      const {ctx,width,height}=prepareCanvas($('transportFrequencyCanvas')); clearCanvas(ctx,width,height);
      const l=60,r=28,t=42,b=50,w=width-l-r,h=height-t-b,ymin=.82,ymax=1.01;
      drawGrid(ctx,l,t,w,h,8,5); const X=v=>l+v*w,Y=v=>t+(ymax-v)/(ymax-ymin)*h;
      ctx.strokeStyle=COLORS.blue;ctx.lineWidth=2.4;ctx.beginPath();
      for(let i=0;i<=240;i++){let qq=i/240,om=Model.omega({amplitude:A,q:qq,M:MT});i?ctx.lineTo(X(qq),Y(om)):ctx.moveTo(X(qq),Y(om));}ctx.stroke();
      [[initial.omega,COLORS.muted2,[5,5]],[target.omega,COLORS.green,[3,5]]].forEach(([v,c,d])=>{
        ctx.save();ctx.strokeStyle=c;ctx.setLineDash(d);ctx.beginPath();ctx.moveTo(l,Y(v));ctx.lineTo(l+w,Y(v));ctx.stroke();ctx.restore();});
      ctx.fillStyle=COLORS.gold;ctx.beginPath();ctx.arc(X(q),Y(current.omega),5,0,2*Math.PI);ctx.fill();
      drawAxesLabel(ctx,'q',l+w,height-14,'right');drawAxesLabel(ctx,`Ω^[${MT}](q)`,l+4,t+12);info(ctx,Math.max(l+6,width-178),t+8);
    } else {
      const {ctx,width,height}=prepareCanvas($('transportSpectrumCanvas')); clearCanvas(ctx,width,height,'rgba(179,124,255,.07)');
      const l=64,r=28,t=42,b=50,w=width-l-r,h=height-t-b; drawGrid(ctx,l,t,w,h,8,5);
      let h3=[],h5=[],ym=0;
      for(let i=0;i<=160;i++){let qq=i/160,hh=Model.harmonics({amplitude:A,q:qq,M:MT});
        let p3=100*hh.h3/Math.max(hh.h1,1e-12),p5=100*hh.h5/Math.max(hh.h1,1e-12);h3.push(p3);h5.push(p5);ym=Math.max(ym,p3,p5);}
      ym=Math.max(.1,ym*1.18); const X=v=>l+v*w,Y=v=>t+(ym-v)/ym*h;
      const plot=(arr,c,d=[])=>{ctx.save();ctx.strokeStyle=c;ctx.lineWidth=2.3;ctx.setLineDash(d);ctx.beginPath();
        arr.forEach((v,i)=>i?ctx.lineTo(X(i/160),Y(v)):ctx.moveTo(X(0),Y(v)));ctx.stroke();ctx.restore();};
      plot(h3,COLORS.purple);plot(h5,COLORS.orange,[5,4]);
      [[h3pct,COLORS.purple],[h5pct,COLORS.orange]].forEach(([v,c])=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(X(q),Y(v),5,0,2*Math.PI);ctx.fill();});
      drawAxesLabel(ctx,'q',l+w,height-14,'right');drawAxesLabel(ctx,'relative harmonic content [%]',l+4,t+12);
      ctx.font='10px ui-sans-serif,system-ui';ctx.fillStyle=COLORS.purple;ctx.fillText('H3 / H1',l+8,t+31);ctx.fillStyle=COLORS.orange;ctx.fillText('H5 / H1',l+70,t+31);
      info(ctx,Math.max(l+6,width-178),t+8);
    }
  }

  function drawRefinementView() {
    const M=state.M;
    const panel = state.refinementView;
    if(panel==='trajectory'){
      drawPlaceholder($('refinementTrajectoryCanvas'),'Target waveform + temporal error',[
        'q = 1 is locked',
        `current truncation order M = ${M}`,
        'upper panel: exact vs GOTHAM · lower panel: e_M(t)'
      ],COLORS.blue);
    } else if(panel==='convergence'){
      drawPlaceholder($('refinementConvergenceCanvas'),'Convergence at q = 1',[
        `current order M = ${M}`,
        'log waveform error · operator residual · frequency error',
        'vertical marker follows the selected integer M'
      ],COLORS.blue);
    } else {
      drawPlaceholder($('qmMapCanvas'),'Sampled view of one continuous q deformation',[
        'vertical: continuous transport coordinate q',
        'horizontal: integer truncation order M',
        'color: selected accuracy metric'
      ],COLORS.gold);
    }
    updateMetricPlaceholders();
  }

  function updateMetricPlaceholders(){
    const metrics = Model.metrics({ amplitude:GUIDED_AMPLITUDE, q:1, M:state.M, hbar:-1 });
    const set=(id,val)=>$(id).textContent=val;
    if(metrics){
      set('metricWave',metrics.waveform);set('metricResidual',metrics.residual);
      set('metricFrequency',metrics.frequency);set('metricHorizon',metrics.horizon);
    } else {
      const m=state.M;
      set('metricWave',m===0?'engine pending':'—');
      set('metricResidual','—');set('metricFrequency','—');set('metricHorizon','—');
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
