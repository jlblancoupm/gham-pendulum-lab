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
    ready: false,

    // ---- NEW ENGINE CONTRACT ---------------------------------
    // buildSeries({ amplitude, maxOrder })
    // evaluate({ amplitude, q, M, hbar, duration })
    // omega({ amplitude, q, M, hbar })
    // exactPendulum({ amplitude, duration })
    // metrics({ amplitude, q, M, hbar })
    //
    // These deliberately throw until the validated frequency-corrected
    // GOTHAM implementation is ported into the browser.
    buildSeries() { throw new Error('New GOTHAM engine not connected'); },
    evaluate() { throw new Error('New GOTHAM engine not connected'); },
    omega() { throw new Error('New GOTHAM engine not connected'); },
    exactPendulum() { throw new Error('New GOTHAM engine not connected'); },
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
    const view = state.transportView;
    const q = state.q;
    if (view === 'operator') {
      const canvas=$('transportOperatorCanvas');
      const {ctx,width,height}=prepareCanvas(canvas);clearCanvas(ctx,width,height);
      const left=55,right=28,top=35,bottom=48,w=width-left-right,h=height-top-bottom;
      drawGrid(ctx,left,top,w,h,7,5);
      const xmin=-2.2,xmax=2.2,ymin=-2.2,ymax=2.2;
      const Xp=x=>left+(x-xmin)/(xmax-xmin)*w; const Yp=y=>top+(ymax-y)/(ymax-ymin)*h;
      const plot=(fn,color,widthLine=2,dash=[])=>{ctx.save();ctx.strokeStyle=color;ctx.lineWidth=widthLine;ctx.setLineDash(dash);ctx.beginPath();for(let i=0;i<=500;i++){const x=xmin+(xmax-xmin)*i/500;const px=Xp(x),py=Yp(fn(x));if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.stroke();ctx.restore();};
      plot(x=>x,COLORS.muted2,1.2,[5,5]); plot(x=>Math.sin(x),COLORS.green,1.2,[5,5]); plot(x=>(1-q)*x+q*Math.sin(x),COLORS.gold,2.8);
      drawAxesLabel(ctx,`current q = ${q.toFixed(3)}`,left+8,top+14);
      drawAxesLabel(ctx,'x [rad]',left+w,height-14,'right');
    } else if (view === 'motion') {
      drawPlaceholder($('transportMotionCanvas'),'Physical-time GOTHAM response',[
        `continuous q = ${q.toFixed(3)}`,
        'new frequency-corrected engine will draw x(t;q)',
        'time axis remains physical so the period change stays visible'
      ],COLORS.gold);
    } else if (view === 'frequency') {
      const canvas=$('transportFrequencyCanvas'); const {ctx,width,height}=prepareCanvas(canvas);clearCanvas(ctx,width,height);
      const left=60,right=28,top=42,bottom=50,w=width-left-right,h=height-top-bottom;drawGrid(ctx,left,top,w,h,8,5);
      const om = qq => 1 - (1-.860608)*Math.pow(qq,.9); // UI shell only
      const ymin=.72,ymax=1.02; const Xp=x=>left+x*w; const Yp=y=>top+(ymax-y)/(ymax-ymin)*h;
      ctx.strokeStyle=COLORS.blue;ctx.lineWidth=2.4;ctx.beginPath();
      for(let i=0;i<=300;i++){const qq=i/300,px=Xp(qq),py=Yp(om(qq));if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.stroke();
      ctx.fillStyle=COLORS.gold;ctx.beginPath();ctx.arc(Xp(q),Yp(om(q)),5,0,Math.PI*2);ctx.fill();
      drawAxesLabel(ctx,'q',left+w,height-14,'right');drawAxesLabel(ctx,'Ω(q) · shell preview',left+4,top+12);
    } else {
      drawPlaceholder($('transportSpectrumCanvas'),'Harmonic content along q',[
        `current q = ${q.toFixed(3)}`,
        'fundamental / 3rd / 5th harmonic',
        'the validated engine will supply the actual amplitudes'
      ],COLORS.purple);
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
