(() => {
  'use strict';

  const COLORS = {
    bg: '#06131f', panel: '#0e2944', grid: 'rgba(174,202,229,.14)', gridStrong: 'rgba(174,202,229,.26)',
    text: '#f4f7fb', muted: '#a8b8ca', muted2: '#758ba3', gold: '#f4ca5c', gold2: '#ffdd86',
    blue: '#49b9ff', blue2: '#8ad5ff', green: '#73d987', purple: '#b37cff', orange: '#ff9f50', red: '#ff7474'
  };
  const SERIES_COLORS = [COLORS.gold, COLORS.blue, COLORS.green, COLORS.purple, COLORS.orange, COLORS.red, COLORS.blue2];
  const G = 9.81;
  const LENGTH = 1;
  const OMEGA = Math.sqrt(G / LENGTH);
  const W2 = OMEGA * OMEGA;
  const DEG = 180 / Math.PI;
  const RAD = Math.PI / 180;
  const DT = 0.004;

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function factorial(n) {
    let value = 1;
    for (let i = 2; i <= n; i += 1) value *= i;
    return value;
  }

  let mathQueue = Promise.resolve();
  const mathJaxReady = new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (window.MathJax?.tex2chtmlPromise || window.MathJax?.typesetPromise) {
        resolve(window.MathJax);
      } else if (performance.now() - started < 12000) {
        window.setTimeout(check, 30);
      } else {
        resolve(null);
      }
    };
    check();
  });

  function setMath(element, latex, display = true) {
    if (!element) return;
    const source = display ? `\\[${latex}\\]` : `\\(${latex}\\)`;
    const version = String((Number(element.dataset.mathVersion) || 0) + 1);
    element.dataset.mathVersion = version;
    element.dataset.mathSource = latex;

    // Render from TeX directly instead of repeatedly asking MathJax to rescan
    // the live panel. Keeping the old equation until the new node is ready
    // prevents raw-LaTeX flicker while the slider is moving.
    mathQueue = mathQueue.then(async () => {
      const mathJax = await mathJaxReady;
      if (!mathJax) {
        if (element.dataset.mathVersion === version) element.textContent = source;
        return;
      }
      if (mathJax.startup?.promise) await mathJax.startup.promise;
      if (element.dataset.mathVersion !== version) return;

      if (mathJax.tex2chtmlPromise) {
        const rendered = await mathJax.tex2chtmlPromise(latex, { display });
        if (element.dataset.mathVersion !== version) return;
        mathJax.typesetClear?.([element]);
        element.replaceChildren(rendered);
      } else {
        mathJax.typesetClear?.([element]);
        element.textContent = source;
        if (mathJax.typesetPromise) await mathJax.typesetPromise([element]);
      }
    }).catch((error) => {
      if (element.dataset.mathVersion === version) element.textContent = source;
      console.warn('MathJax rendering failed; keeping the TeX fallback.', error);
    });
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

  function roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function clearCanvas(ctx, width, height, options = {}) {
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createRadialGradient(width * .68, height * .14, 0, width * .68, height * .14, Math.max(width, height) * .8);
    gradient.addColorStop(0, options.glow || 'rgba(73,185,255,.07)');
    gradient.addColorStop(1, 'rgba(2,12,22,.02)');
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

  function surrogateSin(theta, q, degree) {
    const p = Math.floor((degree - 1) / 2);
    let total = 0;
    for (let r = 0; r <= p; r += 1) {
      const sign = r % 2 === 0 ? 1 : -1;
      total += sign * (q ** r) * (theta ** (2 * r + 1)) / factorial(2 * r + 1);
    }
    return total;
  }

  function infiniteSurrogateSin(theta, q) {
    if (q < 1e-9) return theta;
    const root = Math.sqrt(q);
    return Math.sin(root * theta) / root;
  }

  function simulatePendulum(angle, duration, acceleration) {
    const count = Math.max(2, Math.floor(duration / DT) + 1);
    const t = new Float64Array(count);
    const theta = new Float64Array(count);
    const velocity = new Float64Array(count);
    const accel = new Float64Array(count);
    theta[0] = angle;
    accel[0] = acceleration(angle);

    for (let i = 0; i < count - 1; i += 1) {
      const y = theta[i];
      const v = velocity[i];
      const h = DT;
      const k1y = v;
      const k1v = acceleration(y);
      const k2y = v + .5 * h * k1v;
      const k2v = acceleration(y + .5 * h * k1y);
      const k3y = v + .5 * h * k2v;
      const k3v = acceleration(y + .5 * h * k2y);
      const k4y = v + h * k3v;
      const k4v = acceleration(y + h * k3y);

      theta[i + 1] = y + h * (k1y + 2 * k2y + 2 * k3y + k4y) / 6;
      velocity[i + 1] = v + h * (k1v + 2 * k2v + 2 * k3v + k4v) / 6;
      accel[i + 1] = acceleration(theta[i + 1]);
      t[i + 1] = t[i] + h;
    }
    return { t, theta, velocity, accel };
  }

  function simulateSmallAngle(angle, duration) {
    const count = Math.max(2, Math.floor(duration / DT) + 1);
    const t = new Float64Array(count);
    const theta = new Float64Array(count);
    const velocity = new Float64Array(count);
    const accel = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      t[i] = i * DT;
      theta[i] = angle * Math.cos(OMEGA * t[i]);
      velocity[i] = -angle * OMEGA * Math.sin(OMEGA * t[i]);
      accel[i] = -W2 * theta[i];
    }
    return { t, theta, velocity, accel };
  }

  function integrateForcedOscillator(t, forcing) {
    const n = t.length;
    const theta = new Float64Array(n);
    const velocity = new Float64Array(n);
    const accel = new Float64Array(n);
    for (let i = 0; i < n - 1; i += 1) {
      const h = t[i + 1] - t[i];
      const f0 = forcing[i];
      const f1 = forcing[i + 1];
      const fm = .5 * (f0 + f1);
      const y = theta[i];
      const v = velocity[i];

      const k1y = v;
      const k1v = f0 - W2 * y;
      const k2y = v + .5 * h * k1v;
      const k2v = fm - W2 * (y + .5 * h * k1y);
      const k3y = v + .5 * h * k2v;
      const k3v = fm - W2 * (y + .5 * h * k2y);
      const k4y = v + h * k3v;
      const k4v = f1 - W2 * (y + h * k3y);

      theta[i + 1] = y + h * (k1y + 2 * k2y + 2 * k3y + k4y) / 6;
      velocity[i + 1] = v + h * (k1v + 2 * k2v + 2 * k3v + k4v) / 6;
    }
    for (let i = 0; i < n; i += 1) accel[i] = forcing[i] - W2 * theta[i];
    return { theta, velocity, accel };
  }

  function addArrays(a, b) {
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i += 1) out[i] = a[i] + b[i];
    return out;
  }

  function cumulativeArrays(arrays) {
    const output = [];
    let running = new Float64Array(arrays[0].length);
    for (const source of arrays) {
      running = addArrays(running, source);
      output.push(running);
    }
    return output;
  }

  function computeGHAM(angle, duration, hbar, maxOrder) {
    const base = simulateSmallAngle(angle, duration);
    const t = base.t;
    const thetaTerms = [base.theta];
    const velocityTerms = [base.velocity];
    const accelTerms = [base.accel];
    const sinCoefficients = [Float64Array.from(base.theta, Math.sin)];
    const cosCoefficients = [Float64Array.from(base.theta, Math.cos)];
    const residualCoefficients = [];

    const r0 = new Float64Array(t.length);
    for (let i = 0; i < t.length; i += 1) r0[i] = base.accel[i] + W2 * sinCoefficients[0][i];
    residualCoefficients.push(r0);

    for (let m = 1; m <= maxOrder; m += 1) {
      const forcing = new Float64Array(t.length);
      for (let i = 0; i < t.length; i += 1) forcing[i] = hbar * residualCoefficients[m - 1][i];
      const delta = integrateForcedOscillator(t, forcing);

      if (m === 1) {
        thetaTerms.push(delta.theta);
        velocityTerms.push(delta.velocity);
        accelTerms.push(delta.accel);
      } else {
        thetaTerms.push(addArrays(thetaTerms[m - 1], delta.theta));
        velocityTerms.push(addArrays(velocityTerms[m - 1], delta.velocity));
        accelTerms.push(addArrays(accelTerms[m - 1], delta.accel));
      }

      const sM = new Float64Array(t.length);
      const cM = new Float64Array(t.length);
      for (let i = 0; i < t.length; i += 1) {
        let s = 0;
        let c = 0;
        for (let k = 1; k <= m; k += 1) {
          s += k * thetaTerms[k][i] * cosCoefficients[m - k][i];
          c -= k * thetaTerms[k][i] * sinCoefficients[m - k][i];
        }
        sM[i] = s / m;
        cM[i] = c / m;
      }
      sinCoefficients.push(sM);
      cosCoefficients.push(cM);

      const rM = new Float64Array(t.length);
      for (let i = 0; i < t.length; i += 1) rM[i] = accelTerms[m][i] + W2 * sM[i];
      residualCoefficients.push(rM);
    }

    const approximations = cumulativeArrays(thetaTerms);
    const approximationVelocities = cumulativeArrays(velocityTerms);
    const approximationAccels = cumulativeArrays(accelTerms);
    const targetResiduals = approximations.map((approx, m) => {
      const residual = new Float64Array(t.length);
      const accel = approximationAccels[m];
      for (let i = 0; i < t.length; i += 1) residual[i] = accel[i] + W2 * Math.sin(approx[i]);
      return residual;
    });

    return {
      t, thetaTerms, velocityTerms, accelTerms, sinCoefficients, cosCoefficients,
      residualCoefficients, approximations, approximationVelocities, approximationAccels, targetResiduals
    };
  }

  function sampleAtTime(data, time) {
    const maxT = data.t[data.t.length - 1];
    const wrapped = clamp(time, 0, maxT);
    const index = Math.min(data.t.length - 2, Math.floor(wrapped / DT));
    const dt = data.t[index + 1] - data.t[index];
    const fraction = dt > 0 ? (wrapped - data.t[index]) / dt : 0;
    return {
      theta: data.theta[index] * (1 - fraction) + data.theta[index + 1] * fraction,
      velocity: data.velocity ? data.velocity[index] * (1 - fraction) + data.velocity[index + 1] * fraction : 0
    };
  }

  function rmse(a, b) {
    const n = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const difference = a[i] - b[i];
      sum += difference * difference;
    }
    return Math.sqrt(sum / n);
  }

  function maxAbs(values) {
    let value = 0;
    for (let i = 0; i < values.length; i += 1) value = Math.max(value, Math.abs(values[i]));
    return value;
  }

  function periodFromDownCrossings(t, theta) {
    const crossings = [];
    for (let i = 1; i < theta.length; i += 1) {
      if (theta[i - 1] > 0 && theta[i] <= 0) {
        const fraction = theta[i - 1] / (theta[i - 1] - theta[i]);
        crossings.push(t[i - 1] + fraction * (t[i] - t[i - 1]));
      }
    }
    if (crossings.length < 2) return NaN;
    let total = 0;
    for (let i = 1; i < crossings.length; i += 1) total += crossings[i] - crossings[i - 1];
    return total / (crossings.length - 1);
  }

  function formatScientific(value) {
    if (!Number.isFinite(value)) return '–';
    if (Math.abs(value) >= .01 && Math.abs(value) < 1000) return value.toFixed(3);
    return value.toExponential(2).replace('e+', 'e');
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return '–';
    return `${(100 * value).toFixed(2)}%`;
  }

  function setMetricBar(id, value, scale) {
    const width = clamp(100 * value / scale, 2, 100);
    $(id).style.width = `${width}%`;
  }

  function drawTimePlot(canvas, t, series, options = {}) {
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height, options);
    const margin = { left: width < 520 ? 48 : 64, right: 20, top: 42, bottom: 48 };
    const plotW = Math.max(10, width - margin.left - margin.right);
    const plotH = Math.max(10, height - margin.top - margin.bottom);
    const maxT = t[t.length - 1] || 1;
    const transform = options.transform || ((value) => value * (options.scale ?? 1));
    let yMin = Number.isFinite(options.yMin) ? options.yMin : Infinity;
    let yMax = Number.isFinite(options.yMax) ? options.yMax : -Infinity;
    if (!Number.isFinite(options.yMin) || !Number.isFinite(options.yMax)) {
      for (const item of series) {
        for (let i = 0; i < item.values.length; i += 1) {
          const value = transform(item.values[i]);
          if (Number.isFinite(value)) { yMin = Math.min(yMin, value); yMax = Math.max(yMax, value); }
        }
      }
      if (options.symmetric !== false) {
        const maximum = Math.max(1e-6, Math.abs(yMin), Math.abs(yMax)) * 1.12;
        yMin = -maximum; yMax = maximum;
      } else {
        const span = Math.max(1e-6, yMax - yMin);
        yMin -= span * .08; yMax += span * .08;
      }
    }
    if (Math.abs(yMax - yMin) < 1e-12) { yMax += 1; yMin -= 1; }

    drawGrid(ctx, margin.left, margin.top, plotW, plotH, 6, 4);
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.fillStyle = COLORS.muted2;
    ctx.textAlign = 'center';
    for (let i = 0; i <= 6; i += 1) {
      const x = margin.left + i * plotW / 6;
      ctx.fillText((i * maxT / 6).toFixed(1), x, margin.top + plotH + 20);
    }
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i += 1) {
      const value = yMax - i * (yMax - yMin) / 4;
      const y = margin.top + i * plotH / 4;
      const label = Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 1 ? value.toFixed(1) : value.toFixed(2);
      ctx.fillText(label, margin.left - 9, y + 4);
    }
    ctx.textAlign = 'left';

    if (yMin < 0 && yMax > 0) {
      const zeroY = margin.top + (yMax / (yMax - yMin)) * plotH;
      ctx.strokeStyle = COLORS.gridStrong;
      ctx.beginPath(); ctx.moveTo(margin.left, zeroY); ctx.lineTo(margin.left + plotW, zeroY); ctx.stroke();
    }

    const maxPoints = Math.max(500, Math.floor(width * 1.7));
    const stride = Math.max(1, Math.floor(t.length / maxPoints));
    for (const item of series) {
      ctx.save();
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.width || 2;
      ctx.globalAlpha = item.alpha ?? 1;
      ctx.setLineDash(item.dash || []);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < t.length; i += stride) {
        const value = transform(item.values[i]);
        if (!Number.isFinite(value)) continue;
        const x = margin.left + (t[i] / maxT) * plotW;
        const y = margin.top + (yMax - value) / (yMax - yMin) * plotH;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.font = '10px ui-sans-serif, system-ui';
    let legendX = margin.left + 5;
    let legendY = 18;
    for (const item of series) {
      const labelWidth = ctx.measureText(item.label).width;
      if (legendX + labelWidth + 42 > width - 10) { legendX = margin.left + 5; legendY += 18; }
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(legendX, legendY); ctx.lineTo(legendX + 18, legendY); ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(item.label, legendX + 24, legendY + 3);
      legendX += labelWidth + 52;
    }

    ctx.fillStyle = COLORS.muted2;
    ctx.textAlign = 'center';
    ctx.fillText(options.xLabel || 'time [s]', margin.left + plotW / 2, height - 10);
    ctx.save();
    ctx.translate(15, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(options.yLabel || '', 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  function drawXYPlot(canvas, series, options = {}) {
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height, options);
    const margin = { left: width < 520 ? 52 : 66, right: 22, top: 42, bottom: 50 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const xScale = options.xScale ?? 1;
    const yScale = options.yScale ?? 1;
    let xMax = 1, yMax = 1;
    for (const item of series) {
      for (let i = 0; i < item.x.length; i += 1) {
        xMax = Math.max(xMax, Math.abs(item.x[i] * xScale));
        yMax = Math.max(yMax, Math.abs(item.y[i] * yScale));
      }
    }
    xMax *= 1.12; yMax *= 1.12;
    drawGrid(ctx, margin.left, margin.top, plotW, plotH, 6, 4);
    const x0 = margin.left + plotW / 2;
    const y0 = margin.top + plotH / 2;
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.beginPath(); ctx.moveTo(margin.left, y0); ctx.lineTo(margin.left + plotW, y0); ctx.moveTo(x0, margin.top); ctx.lineTo(x0, margin.top + plotH); ctx.stroke();

    const stride = Math.max(1, Math.floor(series[0].x.length / Math.max(500, width * 1.5)));
    for (const item of series) {
      ctx.save(); ctx.strokeStyle = item.color; ctx.lineWidth = item.width || 2; ctx.globalAlpha = item.alpha ?? 1; ctx.setLineDash(item.dash || []);
      ctx.beginPath();
      for (let i = 0; i < item.x.length; i += stride) {
        const x = x0 + item.x[i] * xScale / (2 * xMax) * plotW;
        const y = y0 - item.y[i] * yScale / (2 * yMax) * plotH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.restore();
    }

    ctx.font = '10px ui-sans-serif, system-ui';
    let lx = margin.left + 6;
    for (const item of series) {
      ctx.strokeStyle = item.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(lx, 18); ctx.lineTo(lx + 18, 18); ctx.stroke();
      ctx.fillStyle = COLORS.muted; ctx.fillText(item.label, lx + 24, 21);
      lx += ctx.measureText(item.label).width + 55;
    }
    ctx.fillStyle = COLORS.muted2; ctx.textAlign = 'center';
    ctx.fillText(options.xLabel || '', margin.left + plotW / 2, height - 10);
    ctx.save(); ctx.translate(15, margin.top + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(options.yLabel || '', 0, 0); ctx.restore();
    ctx.textAlign = 'left';
  }

  function drawPendulumOverlay(canvas, referenceAngle, modelAngle, options = {}) {
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height, { glow: 'rgba(244,202,92,.055)' });
    const pivotX = width * .5;
    const pivotY = options.compact ? height * .18 : height * .17;
    const rod = Math.min(height * (options.compact ? .52 : .57), width * .34);
    const angles = [referenceAngle, modelAngle];
    const colors = [COLORS.blue, COLORS.gold];
    const labels = options.labels || ['numerical reference', 'model'];

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(width * .1, pivotY); ctx.lineTo(width * .9, pivotY); ctx.stroke();
    for (let i = 1; i <= 4; i += 1) {
      ctx.strokeStyle = `rgba(174,202,229,${.05 + i * .012})`;
      ctx.beginPath(); ctx.arc(pivotX, pivotY, rod * i / 4, Math.PI * .12, Math.PI * .88); ctx.stroke();
    }

    const drawOne = (angle, color, widthLine, alpha, radius) => {
      const x = pivotX + rod * Math.sin(angle);
      const y = pivotY + rod * Math.cos(angle);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = color; ctx.lineWidth = widthLine; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(x, y); ctx.stroke();
      const glow = ctx.createRadialGradient(x, y, 1, x, y, radius * 2.1);
      glow.addColorStop(0, color); glow.addColorStop(.35, color); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return { x, y };
    };

    drawOne(angles[0], colors[0], options.compact ? 3 : 4.2, .82, options.compact ? 10 : 15);
    drawOne(angles[1], colors[1], options.compact ? 2.2 : 3, .95, options.compact ? 7 : 11);
    ctx.fillStyle = COLORS.text; ctx.beginPath(); ctx.arc(pivotX, pivotY, options.compact ? 4 : 6, 0, Math.PI * 2); ctx.fill();

    if (!options.compact) {
      ctx.font = '700 11px ui-sans-serif, system-ui';
      ctx.fillStyle = COLORS.blue2; ctx.fillText(labels[0], 22, 28);
      ctx.fillStyle = COLORS.gold2; ctx.fillText(labels[1], 22, 47);
      ctx.fillStyle = COLORS.muted2; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`Δθ = ${Math.abs((modelAngle - referenceAngle) * DEG).toFixed(2)}°`, 22, height - 22);
    }
  }

  function drawForcePlot(canvas, q, degree, maxAngle) {
    const count = 500;
    const x = new Float64Array(count);
    const exact = new Float64Array(count);
    const surrogate = new Float64Array(count);
    const linear = new Float64Array(count);
    const limit = Math.max(maxAngle * 1.25, 90 * RAD);
    for (let i = 0; i < count; i += 1) {
      const theta = -limit + 2 * limit * i / (count - 1);
      x[i] = theta;
      exact[i] = Math.sin(theta);
      surrogate[i] = surrogateSin(theta, q, degree);
      linear[i] = theta;
    }
    drawXYPlot(canvas, [
      { label: 'sin θ', x, y: exact, color: COLORS.blue, width: 2.8 },
      { label: `s${degree}(θ;q)`, x, y: surrogate, color: COLORS.gold, width: 2.4 },
      { label: 'θ', x, y: linear, color: COLORS.purple, width: 1.4, dash: [6,5], alpha: .75 }
    ], { xScale: DEG, yScale: 1, xLabel: 'angle θ [deg]', yLabel: 'restoring nonlinearity' });
  }

  function drawHeroCanvas(time = 0) {
    const canvas = $('heroCanvas');
    if (!canvas || !heroState.data || !heroState.linearData || !heroState.targetData) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height, { glow: 'rgba(73,185,255,.09)' });

    const q = heroState.q;
    const current = sampleAtTime(heroState.data, time % heroState.duration);
    const linear = sampleAtTime(heroState.linearData, time % heroState.duration);
    const target = sampleAtTime(heroState.targetData, time % heroState.duration);
    const compact = width < 580;
    const pivotX = width * (compact ? .66 : .68);
    const pivotY = height * .19;
    const rod = Math.min(height * .45, width * (compact ? .28 : .25));

    // Motion field: the two endpoint models remain visible while the gold model
    // moves continuously between them. This makes q visually meaningful at once.
    ctx.save();
    ctx.strokeStyle = 'rgba(73,185,255,.10)';
    for (let i = 1; i <= 5; i += 1) {
      ctx.beginPath();
      ctx.arc(pivotX, pivotY, rod * (.38 + i * .22), Math.PI * .12, Math.PI * .88);
      ctx.stroke();
    }
    ctx.restore();

    const drawPendulum = (angle, color, alpha, lineWidth, radius, label, labelOffset = 0) => {
      const bx = pivotX + rod * Math.sin(angle);
      const by = pivotY + rod * Math.cos(angle);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(bx, by); ctx.stroke();
      const glow = ctx.createRadialGradient(bx, by, 1, bx, by, radius * 2.2);
      glow.addColorStop(0, color);
      glow.addColorStop(.34, color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(bx, by, radius * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(bx, by, radius, 0, Math.PI * 2); ctx.fill();
      if (!compact && label) {
        ctx.globalAlpha = Math.max(alpha, .62);
        ctx.fillStyle = color;
        ctx.font = '750 10px ui-sans-serif, system-ui';
        ctx.fillText(label, bx + 12, by + labelOffset);
      }
      ctx.restore();
      return { x: bx, y: by };
    };

    drawPendulum(linear.theta, COLORS.purple, .34, 2, 7, 'q = 0  linear', -7);
    drawPendulum(target.theta, COLORS.blue, .42, 2.2, 8, 'q = 1  target', 13);
    drawPendulum(current.theta, COLORS.gold, 1, 4.2, 14, `q = ${q.toFixed(2)}`, -16);
    ctx.fillStyle = COLORS.text; ctx.beginPath(); ctx.arc(pivotX, pivotY, 6, 0, Math.PI * 2); ctx.fill();

    // Restoring-law microscope: linear and target remain as references; only the
    // gold curve changes with q.
    const panelX = width * .045;
    const panelY = height * .07;
    const panelW = compact ? width * .43 : Math.min(236, width * .36);
    const panelH = compact ? 130 : 150;
    roundedRect(ctx, panelX, panelY, panelW, panelH, 15);
    ctx.fillStyle = 'rgba(3,14,25,.66)'; ctx.fill();
    ctx.strokeStyle = COLORS.gridStrong; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = COLORS.muted2;
    ctx.font = '800 9px ui-sans-serif, system-ui';
    ctx.fillText('RESTORING LAW', panelX + 13, panelY + 19);

    const fx = panelX + 15, fy = panelY + 35, fw = panelW - 30, fh = panelH - 56;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(fx, fy + fh / 2); ctx.lineTo(fx + fw, fy + fh / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx + fw / 2, fy); ctx.lineTo(fx + fw / 2, fy + fh); ctx.stroke();

    const drawLaw = (fn, color, lineWidth, dash = [], alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i <= 140; i += 1) {
        const th = -1.5 + 3 * i / 140;
        const value = fn(th);
        const x = fx + fw * i / 140;
        const y = fy + fh / 2 - value / 1.55 * fh / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };
    drawLaw((theta) => theta, COLORS.purple, 1.2, [5, 5], .65);
    drawLaw(Math.sin, COLORS.blue, 1.5, [2, 4], .75);
    drawLaw((theta) => infiniteSurrogateSin(theta, q), COLORS.gold, 2.7);

    ctx.font = '700 8px ui-sans-serif, system-ui';
    ctx.fillStyle = COLORS.purple; ctx.fillText('linear', fx, panelY + panelH - 10);
    ctx.fillStyle = COLORS.gold; ctx.fillText('current', fx + fw * .38, panelY + panelH - 10);
    ctx.fillStyle = COLORS.blue; ctx.fillText('target', fx + fw * .76, panelY + panelH - 10);

    // Quantify the visual deformation. The bars deliberately use separate notions:
    // force-law nonlinearity and amplitude-dependent period shift.
    const metrics = heroState.metrics;
    if (metrics) {
      const metricX = panelX;
      const metricY = panelY + panelH + 14;
      const metricW = panelW;
      const drawMetric = (y, label, value, color, suffix) => {
        ctx.fillStyle = COLORS.muted2;
        ctx.font = '700 8px ui-sans-serif, system-ui';
        ctx.fillText(label.toUpperCase(), metricX, y);
        ctx.fillStyle = COLORS.text;
        ctx.font = '750 10px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(suffix, metricX + metricW, y);
        ctx.textAlign = 'left';
        roundedRect(ctx, metricX, y + 7, metricW, 5, 3);
        ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
        roundedRect(ctx, metricX, y + 7, Math.max(3, metricW * clamp(value, 0, 1)), 5, 3);
        ctx.fillStyle = color; ctx.fill();
      };
      drawMetric(metricY, 'nonlinearity restored', metrics.recoveredNonlinearity, COLORS.gold, `${Math.round(metrics.recoveredNonlinearity * 100)}%`);
      drawMetric(metricY + 31, 'period shift restored', metrics.recoveredPeriod, COLORS.blue, `${Math.round(metrics.recoveredPeriod * 100)}%`);
    }

    // Continuation rail.
    const railY = height * .88;
    const railX = width * .10;
    const railW = width * .80;
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(railX, railY); ctx.lineTo(railX + railW, railY); ctx.stroke();
    const railGradient = ctx.createLinearGradient(railX, railY, railX + railW, railY);
    railGradient.addColorStop(0, COLORS.purple);
    railGradient.addColorStop(.5, COLORS.gold);
    railGradient.addColorStop(1, COLORS.blue);
    ctx.strokeStyle = railGradient;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(railX, railY); ctx.lineTo(railX + q * railW, railY); ctx.stroke();

    const nodes = [0, .25, .5, .75, 1];
    for (const value of nodes) {
      const x = railX + value * railW;
      ctx.fillStyle = value <= q + .001 ? (value === 1 ? COLORS.blue : COLORS.gold) : COLORS.muted2;
      ctx.beginPath(); ctx.arc(x, railY, value === 0 || value === 1 ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    }
    const cursorX = railX + q * railW;
    ctx.fillStyle = COLORS.gold; ctx.beginPath(); ctx.arc(cursorX, railY, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(244,202,92,.38)'; ctx.beginPath(); ctx.arc(cursorX, railY, 14, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = COLORS.muted2;
    ctx.font = '700 8px ui-sans-serif, system-ui';
    ctx.fillText('SURROGATE', railX, railY + 18);
    ctx.textAlign = 'right';
    ctx.fillText('TARGET', railX + railW, railY + 18);
    ctx.textAlign = 'left';
  }

  function drawPathCanvas(activeStep) {
    const canvas = $('pathCanvas');
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height, { glow: 'rgba(179,124,255,.07)' });
    const margin = { left: 72, right: 42, top: 44, bottom: 58 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    drawGrid(ctx, margin.left, margin.top, w, h, 6, 5);

    const origin = { x: margin.left + 22, y: margin.top + h - 24 };
    const qEnd = { x: margin.left + w - 18, y: origin.y };
    const mEnd = { x: origin.x, y: margin.top + 18 };
    const kEnd = { x: origin.x + w * .27, y: origin.y - h * .22 };
    const axis = (end, color, label, lx, ly) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      ctx.fillStyle = color; ctx.font = '800 12px ui-monospace, monospace'; ctx.fillText(label, lx, ly);
    };
    axis(qEnd, COLORS.gold, 'q', qEnd.x + 8, qEnd.y + 4);
    axis(mEnd, COLORS.blue, 'M', mEnd.x - 5, mEnd.y - 8);
    axis(kEnd, COLORS.green, 'k', kEnd.x + 8, kEnd.y - 3);

    const points = [
      { x: origin.x, y: origin.y, color: COLORS.gold, label: 'known surrogate' },
      { x: origin.x + w * .32, y: origin.y - h * .12, color: COLORS.gold2, label: 'problem deformation' },
      { x: origin.x + w * .58, y: origin.y - h * .43, color: COLORS.blue, label: 'correction hierarchy' },
      { x: origin.x + w * .81, y: origin.y - h * .72, color: COLORS.green, label: 'diagnosed path' }
    ];
    ctx.lineWidth = 3;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i], b = points[i + 1];
      const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gradient.addColorStop(0, a.color); gradient.addColorStop(1, b.color);
      ctx.strokeStyle = gradient; ctx.globalAlpha = i < activeStep ? 1 : .25;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x + 70, a.y - 8, b.x - 70, b.y + 25, b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    points.forEach((point, index) => {
      const active = index <= activeStep;
      ctx.fillStyle = active ? point.color : COLORS.muted2;
      ctx.beginPath(); ctx.arc(point.x, point.y, index === activeStep ? 9 : 6, 0, Math.PI * 2); ctx.fill();
      if (index === activeStep) { ctx.strokeStyle = `${point.color}77`; ctx.beginPath(); ctx.arc(point.x, point.y, 17, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = active ? COLORS.text : COLORS.muted2;
      ctx.font = `${index === activeStep ? 700 : 600} 11px ui-sans-serif, system-ui`;
      ctx.fillText(point.label, point.x + 13, point.y - 10);
    });

    ctx.fillStyle = COLORS.muted2; ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillText('simple problem', origin.x - 5, origin.y + 28);
    ctx.fillText('target system', qEnd.x - 65, qEnd.y + 28);
  }

  function buildFamilyEquation(q, degree) {
    const pieces = [String.raw`\theta`];
    const p = Math.floor((degree - 1) / 2);
    for (let r = 1; r <= p; r += 1) {
      const sign = r % 2 === 1 ? '-' : '+';
      const coefficient = q ** r;
      if (coefficient < 1e-12) continue;
      const rounded = Number(coefficient.toFixed(3));
      const coefficientText = Math.abs(rounded - 1) < 1e-9 ? '' : String.raw`${rounded}\,`;
      pieces.push(String.raw`${sign}${coefficientText}\frac{\theta^{${2 * r + 1}}}{${2 * r + 1}!}`);
    }
    return String.raw`\begin{aligned}\ddot\theta+\omega_0^2\left(${pieces.join('')}\right)&=0,\\\theta(0)&=\theta_{\mathrm i},\quad\dot\theta(0)=0.\end{aligned}`;
  }

  const heroState = {
    q: 0,
    data: null,
    linearData: null,
    targetData: null,
    duration: 8,
    angle: 65 * RAD,
    startTime: performance.now(),
    metrics: null
  };
  const familyState = { exact: null, surrogate: null, small: null, duration: 8, paused: false, currentTime: 0, startTime: performance.now(), view: 'motion' };
  const ghamState = { exact: null, gham: null, selected: null, duration: 8, order: 4, paused: false, currentTime: 0, startTime: performance.now(), view: 'trajectory', scan: null, bestHbar: null };
  const frechetState = { order: 1 };
  let pathStep = 0;

  function updateHero({ resetTime = false } = {}) {
    const now = performance.now();
    const previousTime = heroState.data && !resetTime
      ? ((now - heroState.startTime) / 1000) % heroState.duration
      : 0;
    const q = Number($('heroQ').value);
    heroState.q = q;

    // Preserve the physical time while q changes. Restarting at t = 0 on every
    // slider event makes all models overlap and hides the deformation during drag.
    heroState.linearData ??= simulateSmallAngle(heroState.angle, heroState.duration);
    heroState.targetData ??= simulatePendulum(heroState.angle, heroState.duration, (theta) => -W2 * Math.sin(theta));
    heroState.data = simulatePendulum(heroState.angle, heroState.duration, (theta) => -W2 * infiniteSurrogateSin(theta, q));
    heroState.startTime = now - previousTime * 1000;

    const periodLinear = periodFromDownCrossings(heroState.linearData.t, heroState.linearData.theta);
    const periodCurrent = periodFromDownCrossings(heroState.data.t, heroState.data.theta);
    const periodTarget = periodFromDownCrossings(heroState.targetData.t, heroState.targetData.theta);
    const amplitude = heroState.angle;
    const denominator = Math.max(1e-9, amplitude - Math.sin(amplitude));
    const recoveredNonlinearity = clamp((amplitude - infiniteSurrogateSin(amplitude, q)) / denominator, 0, 1);
    const recoveredPeriod = clamp((periodCurrent - periodLinear) / Math.max(1e-9, periodTarget - periodLinear), 0, 1);
    heroState.metrics = { periodLinear, periodCurrent, periodTarget, recoveredNonlinearity, recoveredPeriod };

    $('heroQOut').value = `q = ${q.toFixed(2)}`;
    const releaseLabel = `θᵢ = ${(heroState.angle * DEG).toFixed(0)}°`;
    $('heroModelLabel').textContent = q < .01
      ? `Small-angle oscillator · ${releaseLabel}`
      : q > .99
        ? `Target nonlinear pendulum · ${releaseLabel}`
        : `Intermediate problem · effective release angle ${(Math.sqrt(q) * heroState.angle * DEG).toFixed(1)}° · ${releaseLabel}`;
    const equation = $('heroEquation');
    let heroLatex;
    if (q < .001) {
      heroLatex = String.raw`\begin{aligned}\ddot\theta+\omega_0^2\theta&=0,\\\theta(0)&=\theta_{\mathrm i},\quad\dot\theta(0)=0.\end{aligned}`;
    } else if (q > .999) {
      heroLatex = String.raw`\begin{aligned}\ddot\theta+\omega_0^2\sin\theta&=0,\\\theta(0)&=\theta_{\mathrm i},\quad\dot\theta(0)=0.\end{aligned}`;
    } else {
      heroLatex = String.raw`\begin{aligned}\ddot\theta+\omega_0^2\,\frac{\sin(\sqrt{${q.toFixed(2)}}\,\theta)}{\sqrt{${q.toFixed(2)}}}&=0,\\\theta(0)&=\theta_{\mathrm i},\quad\dot\theta(0)=0.\end{aligned}`;
    }
    setMath(equation, heroLatex);

    const stage = $('heroCanvas').closest('.hero-stage');
    stage?.style.setProperty('--hero-q', q.toFixed(3));
    drawHeroCanvas(previousTime);
  }

  function updateFamily() {
    const angleDeg = Number($('familyAngle').value);
    const q = Number($('familyQ').value);
    const degree = Number($('familyDegree').value);
    const duration = Number($('familyDuration').value);
    const angle = angleDeg * RAD;
    familyState.duration = duration;
    familyState.currentTime = 0;
    familyState.startTime = performance.now();

    $('familyAngleOut').value = `θᵢ = ${angleDeg}°`;
    $('familyQOut').value = `q = ${q.toFixed(2)}`;
    $('familyDegreeOut').value = `d = ${degree}`;
    $('familyDurationOut').value = `${duration} s`;
    $('familyTime').max = duration;
    $('familyTime').value = 0;
    $('familyTimeMax').textContent = `${duration} s`;

    familyState.exact = simulatePendulum(angle, duration, (theta) => -W2 * Math.sin(theta));
    familyState.surrogate = simulatePendulum(angle, duration, (theta) => -W2 * surrogateSin(theta, q, degree));
    familyState.small = simulateSmallAngle(angle, duration);

    drawTimePlot($('familyTrajectoryCanvas'), familyState.exact.t, [
      { label: 'nonlinear numerical reference', values: familyState.exact.theta, color: COLORS.blue, width: 2.8 },
      { label: `surrogate q=${q.toFixed(2)}`, values: familyState.surrogate.theta, color: COLORS.gold, width: 2.4 },
      { label: 'small-angle solution', values: familyState.small.theta, color: COLORS.purple, width: 1.4, dash: [6,5], alpha: .76 }
    ], { scale: DEG, yLabel: 'angle [deg]' });
    drawXYPlot($('familyPhaseCanvas'), [
      { label: 'nonlinear reference', x: familyState.exact.theta, y: familyState.exact.velocity, color: COLORS.blue, width: 2.7 },
      { label: 'surrogate', x: familyState.surrogate.theta, y: familyState.surrogate.velocity, color: COLORS.gold, width: 2.3 },
      { label: 'small angle', x: familyState.small.theta, y: familyState.small.velocity, color: COLORS.purple, width: 1.2, dash: [5,5], alpha: .7 }
    ], { xScale: DEG, yScale: DEG, xLabel: 'angle [deg]', yLabel: 'angular velocity [deg/s]' });
    drawForcePlot($('familyForceCanvas'), q, degree, angle);

    const error = rmse(familyState.surrogate.theta, familyState.exact.theta) * DEG;
    const pExact = periodFromDownCrossings(familyState.exact.t, familyState.exact.theta);
    const pSurrogate = periodFromDownCrossings(familyState.surrogate.t, familyState.surrogate.theta);
    const periodError = Math.abs(pSurrogate - pExact) / pExact;
    let residual = 0;
    for (let i = 0; i < familyState.surrogate.theta.length; i += 1) {
      const theta = familyState.surrogate.theta[i];
      residual = Math.max(residual, Math.abs(W2 * (Math.sin(theta) - surrogateSin(theta, q, degree))));
    }
    const activeTerms = q < 1e-12 ? 1 : (degree + 1) / 2;
    $('familyRmse').textContent = error.toFixed(3);
    $('familyPeriod').textContent = formatPercent(periodError);
    $('familyResidual').textContent = formatScientific(residual);
    $('familyTerms').textContent = String(activeTerms);
    $('familyDegreeMetric').textContent = String(degree);
    setMetricBar('familyRmseBar', error, 20);
    setMetricBar('familyPeriodBar', periodError, .2);
    setMetricBar('familyResidualBar', residual, 8);
    setMetricBar('familyTermsBar', activeTerms, 6);

    const equation = $('familyEquation');
    setMath(equation, buildFamilyEquation(q, degree));
    const chips = $('familyTermChips');
    chips.innerHTML = '';
    for (let r = 0; r <= (degree - 1) / 2; r += 1) {
      const chip = document.createElement('span');
      if (r === 0) {
        chip.textContent = 'θ';
      } else {
        const coefficient = q ** r;
        const sign = r % 2 ? '−' : '+';
        chip.textContent = `${sign} ${Number(coefficient.toFixed(3))} · θ^${2 * r + 1}/${2 * r + 1}!`;
        chip.classList.toggle('inactive', coefficient < 1e-12);
      }
      chips.appendChild(chip);
    }
    drawFamilyMotion();
  }

  function drawFamilyMotion() {
    if (!familyState.exact || !familyState.surrogate) return;
    const reference = sampleAtTime(familyState.exact, familyState.currentTime);
    const surrogate = sampleAtTime(familyState.surrogate, familyState.currentTime);
    drawPendulumOverlay($('familyMotionCanvas'), reference.theta, surrogate.theta, { labels: ['nonlinear numerical reference', 'surrogate family'] });
    $('familyTimeOut').value = `${familyState.currentTime.toFixed(2)} s`;
    $('familyTime').value = familyState.currentTime;
  }

  function updateGHAM(resetScan = true) {
    const angleDeg = Number($('ghamAngle').value);
    const order = Number($('ghamOrder').value);
    const hbar = Number($('ghamHbar').value);
    const duration = Number($('ghamDuration').value);
    const angle = angleDeg * RAD;
    ghamState.duration = duration;
    ghamState.order = order;
    ghamState.currentTime = 0;
    ghamState.startTime = performance.now();
    if (resetScan) {
      ghamState.scan = null;
      ghamState.bestHbar = null;
      $('applyBestHbar').disabled = true;
      $('scanReadout').value = 'Not scanned';
    }

    $('ghamAngleOut').value = `θᵢ = ${angleDeg}°`;
    $('ghamOrderOut').value = `M = ${order}`;
    $('ghamHbarOut').value = `ħ = ${hbar.toFixed(2).replace('-', '−')}`;
    $('ghamDurationOut').value = `${duration} s`;
    $('ghamTime').max = duration;
    $('ghamTime').value = 0;
    $('ghamTimeMax').textContent = `${duration} s`;

    ghamState.exact = simulatePendulum(angle, duration, (theta) => -W2 * Math.sin(theta));
    ghamState.gham = computeGHAM(angle, duration, hbar, 6);
    ghamState.selected = {
      t: ghamState.gham.t,
      theta: ghamState.gham.approximations[order],
      velocity: ghamState.gham.approximationVelocities[order],
      accel: ghamState.gham.approximationAccels[order]
    };

    const trajectorySeries = [
      { label: 'nonlinear numerical reference', values: ghamState.exact.theta, color: COLORS.blue, width: 2.9 },
      { label: `GHAM M=${order}`, values: ghamState.selected.theta, color: COLORS.gold, width: 2.5 }
    ];
    if (order > 0) trajectorySeries.splice(1, 0, { label: 'M=0 surrogate', values: ghamState.gham.approximations[0], color: COLORS.purple, width: 1.3, dash: [6,5], alpha: .68 });
    drawTimePlot($('ghamTrajectoryCanvas'), ghamState.exact.t, trajectorySeries, { scale: DEG, yLabel: 'angle [deg]' });

    const correctionSeries = [];
    for (let m = 0; m <= order; m += 1) {
      correctionSeries.push({ label: `θ${m}`, values: ghamState.gham.thetaTerms[m], color: SERIES_COLORS[m % SERIES_COLORS.length], width: m === order ? 2.4 : 1.3, alpha: m === order ? 1 : .72 });
    }
    drawTimePlot($('ghamCorrectionsCanvas'), ghamState.gham.t, correctionSeries, { scale: DEG, yLabel: 'correction [deg]' });
    drawXYPlot($('ghamPhaseCanvas'), [
      { label: 'nonlinear reference', x: ghamState.exact.theta, y: ghamState.exact.velocity, color: COLORS.blue, width: 2.8 },
      { label: `GHAM M=${order}`, x: ghamState.selected.theta, y: ghamState.selected.velocity, color: COLORS.gold, width: 2.4 }
    ], { xScale: DEG, yScale: DEG, xLabel: 'angle [deg]', yLabel: 'angular velocity [deg/s]' });

    const residualSeries = [];
    for (let m = 0; m <= order; m += 1) {
      const logValues = Float64Array.from(ghamState.gham.targetResiduals[m], (value) => Math.log10(Math.abs(value) + 1e-14));
      residualSeries.push({ label: `M=${m}`, values: logValues, color: SERIES_COLORS[m % SERIES_COLORS.length], width: m === order ? 2.4 : 1.1, alpha: m === order ? 1 : .55 });
    }
    drawTimePlot($('ghamResidualCanvas'), ghamState.gham.t, residualSeries, { scale: 1, symmetric: false, yLabel: 'log₁₀ |target residual|' });
    drawScanPlot();

    const error = rmse(ghamState.selected.theta, ghamState.exact.theta) * DEG;
    const pExact = periodFromDownCrossings(ghamState.exact.t, ghamState.exact.theta);
    const pApprox = periodFromDownCrossings(ghamState.selected.t, ghamState.selected.theta);
    const periodError = Math.abs(pApprox - pExact) / pExact;
    const residual = maxAbs(ghamState.gham.targetResiduals[order]);
    const approximationNorm = Math.max(1e-12, maxAbs(ghamState.selected.theta));
    const correction = order === 0 ? 0 : maxAbs(ghamState.gham.thetaTerms[order]) / approximationNorm;

    $('ghamRmse').textContent = error.toFixed(3);
    $('ghamPeriod').textContent = formatPercent(periodError);
    $('ghamResidual').textContent = formatScientific(residual);
    $('ghamCorrection').textContent = correction.toFixed(3);
    setMetricBar('ghamRmseBar', error, 20);
    setMetricBar('ghamPeriodBar', periodError, .2);
    setMetricBar('ghamResidualBar', Math.log10(residual + 1) + 1, 3);
    setMetricBar('ghamCorrectionBar', correction, .7);

    const message = $('convergenceMessage');
    message.className = 'convergence-message';
    if (order === 0) {
      message.classList.add('warn');
      message.textContent = 'M = 0 is the analytical small-angle starting solution. Increase M to add nonlinear corrections.';
    } else {
      const previousError = rmse(ghamState.gham.approximations[order - 1], ghamState.exact.theta);
      const currentError = rmse(ghamState.selected.theta, ghamState.exact.theta);
      const previousResidual = maxAbs(ghamState.gham.targetResiduals[order - 1]);
      if (currentError < previousError && residual < previousResidual && correction < .35) {
        message.classList.add('good');
        message.textContent = `Order ${order} improves both trajectory error and target residual, while the final correction remains relatively small.`;
      } else if (currentError < previousError || residual < previousResidual) {
        message.classList.add('warn');
        message.textContent = 'At least one diagnostic improves, but the evidence is mixed. Inspect the correction and residual views before trusting the truncation.';
      } else {
        message.classList.add('bad');
        message.textContent = 'Adding this order does not improve the local expansion. Change ħ, shorten the horizon, choose a richer surrogate, or restart.';
      }
    }
    drawGHAMMotion();
  }

  function drawGHAMMotion() {
    if (!ghamState.exact || !ghamState.selected) return;
    const reference = sampleAtTime(ghamState.exact, ghamState.currentTime);
    const approx = sampleAtTime(ghamState.selected, ghamState.currentTime);
    drawPendulumOverlay($('ghamMotionCanvas'), reference.theta, approx.theta, { labels: ['reference', `GHAM M=${ghamState.order}`], compact: true });
    $('ghamTimeOut').value = `${ghamState.currentTime.toFixed(2)} s`;
    $('ghamTime').value = ghamState.currentTime;
  }

  function drawScanPlot() {
    const canvas = $('ghamScanCanvas');
    if (!ghamState.scan) {
      const { ctx, width, height } = prepareCanvas(canvas);
      clearCanvas(ctx, width, height, { glow: 'rgba(179,124,255,.06)' });
      ctx.fillStyle = COLORS.muted2; ctx.textAlign = 'center';
      ctx.font = '700 12px ui-sans-serif, system-ui'; ctx.fillText('Run “Scan ħ” to map the local error landscape.', width / 2, height / 2 - 6);
      ctx.font = '10px ui-sans-serif, system-ui'; ctx.fillText('The scan minimizes trajectory RMSE for the current amplitude, horizon, and order.', width / 2, height / 2 + 18);
      ctx.textAlign = 'left';
      return;
    }
    drawXYPlot(canvas, [{
      label: 'trajectory RMSE', x: ghamState.scan.hbars, y: ghamState.scan.errors, color: COLORS.purple, width: 2.6
    }], { xScale: 1, yScale: 1, xLabel: 'ħ', yLabel: 'RMSE [deg]' });
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.fillStyle = COLORS.gold; ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillText(`best ħ = ${ghamState.bestHbar.toFixed(2)} · RMSE ${ghamState.scan.bestError.toFixed(3)}°`, 76, 35);
  }

  function scanHbar() {
    const order = Number($('ghamOrder').value);
    if (order === 0) {
      $('scanReadout').value = 'M = 0 does not depend on ħ';
      return;
    }
    $('scanReadout').value = 'Scanning…';
    $('scanHbar').disabled = true;
    setTimeout(() => {
      const angle = Number($('ghamAngle').value) * RAD;
      const duration = Number($('ghamDuration').value);
      const exact = simulatePendulum(angle, duration, (theta) => -W2 * Math.sin(theta));
      const hbars = [];
      const errors = [];
      let bestError = Infinity;
      let best = -1;
      for (let hbar = -1.8; hbar <= -.049; hbar += .05) {
        const value = Number(hbar.toFixed(2));
        const gham = computeGHAM(angle, duration, value, order);
        const error = rmse(gham.approximations[order], exact.theta) * DEG;
        hbars.push(value); errors.push(error);
        if (Number.isFinite(error) && error < bestError) { bestError = error; best = value; }
      }
      ghamState.scan = { hbars: Float64Array.from(hbars), errors: Float64Array.from(errors), bestError };
      ghamState.bestHbar = best;
      $('scanReadout').value = `Best ħ = ${best.toFixed(2)} · RMSE ${bestError.toFixed(3)}°`;
      $('applyBestHbar').disabled = false;
      $('scanHbar').disabled = false;
      drawScanPlot();
      switchView('gham', 'scan');
    }, 30);
  }

  const derivativeFormulas = {
    '1': String.raw`D\mathcal N[\theta](v)=\ddot v+\omega_0^2\cos(\theta)\,v.`,
    '2': String.raw`D^2\mathcal N[\theta](v_1,v_2)=-\omega_0^2\sin(\theta)\,v_1v_2.`,
    '3': String.raw`D^3\mathcal N[\theta](v_1,v_2,v_3)=-\omega_0^2\cos(\theta)\,v_1v_2v_3.`,
    '4': String.raw`D^4\mathcal N[\theta](v_1,v_2,v_3,v_4)=\omega_0^2\sin(\theta)\prod_{j=1}^{4}v_j.`,
    'n': String.raw`D^n\mathcal N[\theta](v_1,\ldots,v_n)=\omega_0^2\sin\!\left(\theta+\frac{n\pi}{2}\right)\prod_{j=1}^{n}v_j,\qquad n\ge2.`
  };

  function sineTaylor(base, x, order) {
    const delta = x - base;
    let value = 0;
    for (let n = 0; n <= order; n += 1) value += Math.sin(base + n * Math.PI / 2) * (delta ** n) / factorial(n);
    return value;
  }

  function updateFrechet() {
    const baseDeg = Number($('frechetBase').value);
    const deltaDeg = Number($('frechetDelta').value);
    const base = baseDeg * RAD;
    const delta = deltaDeg * RAD;
    const visualOrder = frechetState.order === 'n' ? 5 : Number(frechetState.order);
    $('frechetBaseOut').value = `θ* = ${baseDeg}°`;
    $('frechetDeltaOut').value = `Δ = ${deltaDeg}°`;
    const display = $('derivativeDisplay');
    setMath(display, derivativeFormulas[frechetState.order]);

    const canvas = $('frechetCanvas');
    const { ctx, width, height } = prepareCanvas(canvas);
    clearCanvas(ctx, width, height, { glow: 'rgba(179,124,255,.07)' });
    const margin = { left: 55, right: 18, top: 28, bottom: 42 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    drawGrid(ctx, margin.left, margin.top, w, h, 6, 4);
    const xMin = -Math.PI, xMax = Math.PI, yMin = -1.55, yMax = 1.55;
    const mapX = (x) => margin.left + (x - xMin) / (xMax - xMin) * w;
    const mapY = (y) => margin.top + (yMax - y) / (yMax - yMin) * h;
    ctx.strokeStyle = COLORS.gridStrong; ctx.beginPath(); ctx.moveTo(margin.left, mapY(0)); ctx.lineTo(margin.left + w, mapY(0)); ctx.stroke();

    const drawCurve = (fn, color, lineWidth, dash = []) => {
      ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.setLineDash(dash); ctx.beginPath();
      for (let i = 0; i <= 500; i += 1) {
        const x = xMin + (xMax - xMin) * i / 500;
        const y = fn(x);
        const px = mapX(x), py = mapY(y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    drawCurve(Math.sin, COLORS.blue, 2.8);
    drawCurve((x) => sineTaylor(base, x, visualOrder), COLORS.gold, 2.3, [7,4]);

    const target = base + delta;
    const exact = Math.sin(target);
    const approx = sineTaylor(base, target, visualOrder);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(mapX(base), margin.top); ctx.lineTo(mapX(base), margin.top + h); ctx.moveTo(mapX(target), margin.top); ctx.lineTo(mapX(target), margin.top + h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COLORS.purple; ctx.beginPath(); ctx.arc(mapX(base), mapY(Math.sin(base)), 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.blue; ctx.beginPath(); ctx.arc(mapX(target), mapY(exact), 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.gold; ctx.beginPath(); ctx.arc(mapX(target), mapY(approx), 4, 0, Math.PI * 2); ctx.fill();

    ctx.font = '10px ui-sans-serif, system-ui'; ctx.fillStyle = COLORS.muted;
    ctx.fillText('exact sin θ', margin.left + 8, 17); ctx.fillStyle = COLORS.blue; ctx.fillRect(margin.left - 8, 11, 10, 2);
    ctx.fillStyle = COLORS.muted; ctx.fillText(`Taylor order ${visualOrder}`, margin.left + 100, 17); ctx.fillStyle = COLORS.gold; ctx.fillRect(margin.left + 84, 11, 10, 2);
    ctx.fillStyle = COLORS.muted2; ctx.textAlign = 'center'; ctx.fillText('θ [rad]', margin.left + w / 2, height - 9); ctx.textAlign = 'left';

    $('frechetExact').textContent = exact.toFixed(5);
    $('frechetApprox').textContent = approx.toFixed(5);
    $('frechetError').textContent = Math.abs(exact - approx).toExponential(2);
  }

  const orderData = {
    1: {
      equation: String.raw`\mathcal L[\theta_1]=\hbar R_0,\qquad R_0=\mathcal N[\theta_0]=\omega_0^2(\sin\theta_0-\theta_0).`,
      text: 'The first correction is driven by the residual left by the small-angle solution in the nonlinear target equation.',
      inputs: ['N[θ₀]'], center: 'R₀', output: 'L[θ₁]'
    },
    2: {
      equation: String.raw`\mathcal L[\theta_2-\theta_1]=\hbar R_1,\qquad R_1=D\mathcal N[\theta_0](\theta_1)=\ddot\theta_1+\omega_0^2\cos(\theta_0)\theta_1.`,
      text: 'The first Fréchet derivative propagates θ₁ through the tangent operator around the starting trajectory.',
      inputs: ['DN[θ₀](θ₁)'], center: 'R₁', output: 'L[θ₂−θ₁]'
    },
    3: {
      equation: String.raw`\begin{aligned}\mathcal L[\theta_3-\theta_2]&=\hbar R_2,\\R_2&=D\mathcal N[\theta_0](\theta_2)+\tfrac12D^2\mathcal N[\theta_0](\theta_1,\theta_1)\\&=\ddot\theta_2+\omega_0^2\cos(\theta_0)\theta_2-\tfrac{\omega_0^2}{2}\sin(\theta_0)\theta_1^2.\end{aligned}`,
      text: 'The curvature of the nonlinear operator enters through the second Fréchet derivative.',
      inputs: ['DN(θ₂)', '½ D²N(θ₁,θ₁)'], center: 'R₂', output: 'L[θ₃−θ₂]'
    },
    4: {
      equation: String.raw`\begin{aligned}\mathcal L[\theta_4-\theta_3]&=\hbar R_3,\\R_3&=D\mathcal N[\theta_0](\theta_3)+D^2\mathcal N[\theta_0](\theta_1,\theta_2)+\tfrac16D^3\mathcal N[\theta_0](\theta_1,\theta_1,\theta_1)\\&=\ddot\theta_3+\omega_0^2\cos(\theta_0)\theta_3-\omega_0^2\sin(\theta_0)\theta_1\theta_2-\tfrac{\omega_0^2}{6}\cos(\theta_0)\theta_1^3.\end{aligned}`,
      text: 'Mixed products and the third operator derivative generate interactions among the previous corrections.',
      inputs: ['DN(θ₃)', 'D²N(θ₁,θ₂)', '⅙ D³N(θ₁,θ₁,θ₁)'], center: 'R₃', output: 'L[θ₄−θ₃]'
    }
  };

  function updateOrderExplorer(order) {
    const data = orderData[order];
    const equation = $('orderEquation');
    setMath(equation, data.equation);
    $('orderExplanation').textContent = data.text;
    $('residualMap').innerHTML = `
      <div class="residual-tree">
        <div class="tree-inputs">${data.inputs.map((item, index) => `<span style="--delay:${index * .08}s">${item}</span>`).join('')}</div>
        <i>→</i>
        <div class="tree-center">${data.center}<small>coefficient of q<sup>${order - 1}</sup></small></div>
        <i>→</i>
        <div class="tree-output">${data.output}<small>linear solve</small></div>
      </div>`;
  }

  function switchView(scope, view) {
    const buttonSelector = scope === 'family' ? '[data-family-view]' : '[data-gham-view]';
    const panelSelector = scope === 'family' ? '[data-family-panel]' : '[data-gham-panel]';
    $$(buttonSelector).forEach((button) => button.classList.toggle('active', button.dataset[`${scope}View`] === view));
    $$(panelSelector).forEach((panel) => panel.classList.toggle('active', panel.dataset[`${scope}Panel`] === view));
    if (scope === 'family') familyState.view = view; else ghamState.view = view;
  }

  function setFamilyPreset(name) {
    const presets = {
      linear: { angle: 30, q: 0, degree: 1, duration: 8 },
      cubic: { angle: 30, q: .55, degree: 3, duration: 8 },
      target: { angle: 50, q: 1, degree: 11, duration: 10 },
      stress: { angle: 80, q: .65, degree: 3, duration: 12 }
    };
    const preset = presets[name];
    $('familyAngle').value = preset.angle; $('familyQ').value = preset.q; $('familyDegree').value = preset.degree; $('familyDuration').value = preset.duration;
    $$('[data-degree]').forEach((button) => button.classList.toggle('active', Number(button.dataset.degree) === preset.degree));
    $$('[data-family-preset]').forEach((button) => button.classList.toggle('active', button.dataset.familyPreset === name));
    updateFamily();
  }

  function setGHAMPreset(name) {
    const presets = {
      gentle: { angle: 30, order: 4, hbar: -1, duration: 8 },
      long: { angle: 30, order: 5, hbar: -.8, duration: 13 },
      large: { angle: 70, order: 4, hbar: -.65, duration: 8 }
    };
    const preset = presets[name];
    $('ghamAngle').value = preset.angle; $('ghamOrder').value = preset.order; $('ghamHbar').value = preset.hbar; $('ghamDuration').value = preset.duration;
    $$('[data-gham-preset]').forEach((button) => button.classList.toggle('active', button.dataset.ghamPreset === name));
    updateGHAM();
  }

  function togglePlay(state, button) {
    if (state.paused) {
      state.paused = false;
      state.startTime = performance.now() - state.currentTime * 1000;
      button.textContent = 'Ⅱ';
    } else {
      state.paused = true;
      button.textContent = '▶';
    }
  }

  function wireInteractions() {
    $('heroQ').addEventListener('input', updateHero);

    $$('[data-path-step]').forEach((step) => {
      step.addEventListener('click', () => {
        pathStep = Number(step.dataset.pathStep);
        $$('[data-path-step]').forEach((item) => item.classList.toggle('active', item === step));
        drawPathCanvas(pathStep);
      });
    });

    ['familyAngle', 'familyQ', 'familyDuration'].forEach((id) => $(id).addEventListener('input', () => { $$('[data-family-preset]').forEach((b) => b.classList.remove('active')); updateFamily(); }));
    $$('[data-degree]').forEach((button) => button.addEventListener('click', () => {
      $('familyDegree').value = button.dataset.degree;
      $$('[data-degree]').forEach((item) => item.classList.toggle('active', item === button));
      $$('[data-family-preset]').forEach((item) => item.classList.remove('active'));
      updateFamily();
    }));
    $$('[data-family-preset]').forEach((button) => button.addEventListener('click', () => setFamilyPreset(button.dataset.familyPreset)));
    $('familyReset').addEventListener('click', () => setFamilyPreset('cubic'));
    $$('[data-family-view]').forEach((button) => button.addEventListener('click', () => switchView('family', button.dataset.familyView)));
    $('familyPause').addEventListener('click', () => togglePlay(familyState, $('familyPause')));
    $('familyTime').addEventListener('input', () => {
      familyState.paused = true; $('familyPause').textContent = '▶'; familyState.currentTime = Number($('familyTime').value); drawFamilyMotion();
    });

    ['ghamAngle', 'ghamOrder', 'ghamHbar', 'ghamDuration'].forEach((id) => $(id).addEventListener('input', () => { $$('[data-gham-preset]').forEach((b) => b.classList.remove('active')); updateGHAM(); }));
    $$('[data-gham-preset]').forEach((button) => button.addEventListener('click', () => setGHAMPreset(button.dataset.ghamPreset)));
    $('ghamReset').addEventListener('click', () => setGHAMPreset('gentle'));
    $$('[data-gham-view]').forEach((button) => button.addEventListener('click', () => switchView('gham', button.dataset.ghamView)));
    $('ghamPause').addEventListener('click', () => togglePlay(ghamState, $('ghamPause')));
    $('ghamTime').addEventListener('input', () => {
      ghamState.paused = true; $('ghamPause').textContent = '▶'; ghamState.currentTime = Number($('ghamTime').value); drawGHAMMotion();
    });
    $('scanHbar').addEventListener('click', scanHbar);
    $('applyBestHbar').addEventListener('click', () => {
      if (ghamState.bestHbar == null) return;
      $('ghamHbar').value = ghamState.bestHbar;
      updateGHAM(false);
      $('scanReadout').value = `Applied ħ = ${ghamState.bestHbar.toFixed(2)}`;
    });

    $$('[data-derivation-tab]').forEach((button) => button.addEventListener('click', () => {
      const target = button.dataset.derivationTab;
      $$('[data-derivation-tab]').forEach((item) => item.classList.toggle('active', item === button));
      $$('[data-derivation-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.derivationPanel === target));
    }));

    $$('[data-derivative]').forEach((button) => button.addEventListener('click', () => {
      frechetState.order = button.dataset.derivative;
      $$('[data-derivative]').forEach((item) => item.classList.toggle('active', item === button));
      updateFrechet();
    }));
    $('frechetBase').addEventListener('input', updateFrechet);
    $('frechetDelta').addEventListener('input', updateFrechet);

    $$('[data-order]').forEach((button) => button.addEventListener('click', () => {
      $$('[data-order]').forEach((item) => item.classList.toggle('active', item === button));
      updateOrderExplorer(Number(button.dataset.order));
    }));

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        drawPathCanvas(pathStep); updateFrechet(); updateFamily(); updateGHAM(false); drawScanPlot();
      }, 140);
    });
  }

  function setupScrollEffects() {
    const header = $('siteHeader');
    const progress = $('scrollProgress');
    const navLinks = $$('.site-header nav a');
    const sections = $$('[data-section]');
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 25);
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = `${scrollable > 0 ? 100 * window.scrollY / scrollable : 0}%`;
      let active = 'top';
      for (const section of sections) {
        if (section.getBoundingClientRect().top < window.innerHeight * .38) active = section.dataset.section;
      }
      navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${active}`));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
    }, { threshold: .12 });
    $$('.reveal').forEach((element) => observer.observe(element));
  }

  function animate(now) {
    if (heroState.data) drawHeroCanvas((now - heroState.startTime) / 1000);
    if (familyState.exact) {
      if (!familyState.paused) familyState.currentTime = ((now - familyState.startTime) / 1000) % familyState.duration;
      drawFamilyMotion();
    }
    if (ghamState.exact) {
      if (!ghamState.paused) ghamState.currentTime = ((now - ghamState.startTime) / 1000) % ghamState.duration;
      drawGHAMMotion();
    }
    requestAnimationFrame(animate);
  }

  function init() {
    setupScrollEffects();
    wireInteractions();
    updateHero();
    drawPathCanvas(pathStep);
    updateFamily();
    updateFrechet();
    updateOrderExplorer(1);
    updateGHAM();
    requestAnimationFrame(animate);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
