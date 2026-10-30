/* Punktwolke – dekorative 3D-Punktwolke. WebGL, ohne Abhängigkeiten.
   Gerendert wird nach Möglichkeit in einem Worker (OffscreenCanvas), damit der Hauptthread frei bleibt. */
(function () {
  'use strict';

  /* ===== Render-Engine: läuft im Worker oder – als Rückfall – im Hauptthread ===== */
  function engine(canvas, post, raf, caf) {
    var gl = null;
    try { gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' }); } catch (e) { gl = null; }
    if (!gl) { post({ t: 'fail' }); return null; }

    var st = { sy: 0, W: 1, H: 1, dpr: 1, sx: 0, sY: 0, sr: 0, heroH: 1, docMax: 1, px: 0, py: 0, hv: true, reduce: false, run: false };
    var N = 0, A, S, U = {}, ready = false;

    function rndGen(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function build(n) {
      N = n; var rnd = rndGen(7), g = function () { return (rnd() + rnd() + rnd() - 1.5) / 1.5; };
      A = [new Float32Array(N * 3), new Float32Array(N * 3), new Float32Array(N * 3), new Float32Array(N * 3)]; S = new Float32Array(N * 2);
      var TAU = Math.PI * 2, GA = Math.PI * (3 - Math.sqrt(5)), side = Math.ceil(Math.sqrt(N));
      for (var i = 0; i < N; i++) {
        var k = i * 3, a, r, y, u, t;
        // Kugel (Fibonacci-Schale mit leichter Tiefe)
        y = 1 - (i + 0.5) / N * 2; r = Math.sqrt(1 - y * y); a = i * GA; var sr = 1 - Math.pow(rnd(), 3) * 0.18;
        A[0][k] = Math.cos(a) * r * sr; A[0][k + 1] = y * sr; A[0][k + 2] = Math.sin(a) * r * sr;
        // Torusknoten (2,3)
        u = rnd() * TAU; r = 0.66 + 0.3 * Math.cos(3 * u);
        var tx = r * Math.cos(2 * u), ty = r * Math.sin(2 * u), tz = 0.3 * Math.sin(3 * u), tr = 0.11 * Math.sqrt(rnd());
        a = rnd() * TAU; t = rnd() * TAU;
        A[1][k] = (tx + tr * Math.cos(a) * Math.sin(t)) * 1.08; A[1][k + 1] = (ty + tr * Math.sin(a) * Math.sin(t)) * 1.08; A[1][k + 2] = (tz + tr * Math.cos(t)) * 1.08;
        // Wellenfeld
        var gx = (i % side) / (side - 1) * 2 - 1 + (rnd() - 0.5) * 0.012, gz = Math.floor(i / side) / (side - 1) * 2 - 1 + (rnd() - 0.5) * 0.012;
        A[2][k] = gx * 1.3; A[2][k + 2] = gz * 1.3;
        A[2][k + 1] = 0.2 * Math.sin(gx * 3.1 + 0.6) * Math.cos(gz * 2.6) + 0.07 * Math.sin((gx + gz) * 5.2);
        // Spiralscheibe
        r = Math.pow(rnd(), 0.75) * 1.2; a = (i % 3) * TAU / 3 + r * 3.1 + g() * 0.42 / (r + 0.45);
        A[3][k] = Math.cos(a) * r; A[3][k + 2] = Math.sin(a) * r; A[3][k + 1] = g() * 0.07 * (1.25 - r);
        S[i * 2] = rnd(); S[i * 2 + 1] = rnd();
      }
    }
    var VS = 'attribute vec3 a0,a1,a2,a3;attribute vec2 aS;' +
      'uniform float uM,uT,uR,uD,uPt;uniform vec2 uC,uV;uniform mat3 uRot;uniform vec3 uFront,uBack;' +
      'varying vec3 vCol;varying float vA;' +
      'vec3 pick(float n){return n<.5?a0:n<1.5?a1:n<2.5?a2:a3;}' +
      'void main(){float n=floor(uM),f=uM-n;f=clamp(f*1.45-aS.x*.45,0.,1.);f=f*f*(3.-2.*f);' +
      'vec3 p=mix(pick(n),pick(min(n+1.,3.)),f);float ph=aS.x*40.+aS.y*17.;' +
      'p*=1.+.055*sin(p.x*2.3+uT*.32)*sin(p.y*2.1-uT*.27)*cos(p.z*1.9+uT*.21);' +
      'p+=.012*vec3(sin(uT*.55+ph),sin(uT*.45+ph*1.3),cos(uT*.5+ph*.7));' +
      'p=uRot*p;float s=uD/(uD-p.z);vec2 px=uC+vec2(p.x,-p.y)*uR*s;' +
      'gl_Position=vec4(px.x/uV.x*2.-1.,1.-px.y/uV.y*2.,0.,1.);' +
      'float df=clamp((p.z+1.15)/2.3,0.,1.);gl_PointSize=uPt*s*(.7+.6*aS.y);' +
      'vCol=mix(uBack,uFront,.25+.75*df);vA=.22+.78*df;}';
    var FS = 'precision mediump float;varying vec3 vCol;varying float vA;' +
      'void main(){float r=length(gl_PointCoord-.5);float a=smoothstep(.5,.12,r)*vA;if(a<.004)discard;gl_FragColor=vec4(vCol*a,a);}';
    function setup(n) {
      build(n);
      var pr = gl.createProgram();
      [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]].forEach(function (x) { var s = gl.createShader(x[0]); gl.shaderSource(s, x[1]); gl.compileShader(s); gl.attachShader(pr, s); });
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { post({ t: 'fail' }); return false; }
      gl.useProgram(pr);
      [['a0', A[0], 3], ['a1', A[1], 3], ['a2', A[2], 3], ['a3', A[3], 3], ['aS', S, 2]].forEach(function (x) {
        var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, x[1], gl.STATIC_DRAW);
        var l = gl.getAttribLocation(pr, x[0]); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, x[2], gl.FLOAT, false, 0, 0);
      });
      ['uM', 'uT', 'uR', 'uD', 'uPt', 'uC', 'uV', 'uRot', 'uFront', 'uBack'].forEach(function (u) { U[u] = gl.getUniformLocation(pr, u); });
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(U.uD, 3.4);
      return true;
    }

    var cur = { m: 0, x: 0, y: 0, r: 0, tx: 0, ty: 0 }, first = true, last = 0, time = 0, spin = 0, handle = 0;
    function ease(a, b, v) { v = Math.min(1, Math.max(0, (v - a) / (b - a))); return v * v * (3 - 2 * v); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function targets() {
      var W = st.W, H = st.H, sy = st.sy, p = Math.min(1, sy / st.heroH);
      if (st.reduce) return { x: W / 2, y: H / 2, r: Math.min(W, H) * 0.44, m: 0 };
      var wide = W >= 1000, tiny = st.sr < 45;
      var ax = wide ? W * 0.78 : W * 0.5, ay = H * (wide ? 0.54 : 0.52), ar = wide ? Math.min(W * 0.3, H * 0.55) : Math.min(W * 0.55, H * 0.38);
      var mv = tiny ? 1 : ease(0.5, 1, p), h6 = st.heroH * 0.6;
      return {
        x: lerp(st.sx, ax, mv), y: lerp(st.sY - sy, ay, mv), r: lerp(tiny ? ar : st.sr, ar, mv),
        m: Math.min(1, sy / h6) + 2 * Math.min(1, Math.max(0, (sy - h6) / Math.max(1, st.docMax - h6 - 40)))
      };
    }
    function draw() {
      var dpr = st.dpr, ax = 0.42 + cur.ty * 0.18 + cur.m * 0.06, ay = spin + cur.m * 0.9 + cur.tx * 0.25;
      var cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
      gl.uniform1f(U.uM, cur.m); gl.uniform1f(U.uT, time);
      gl.uniform2f(U.uC, cur.x * dpr, cur.y * dpr); gl.uniform1f(U.uR, cur.r * dpr);
      gl.uniformMatrix3fv(U.uRot, false, [cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, N);
      if (first) { first = false; post({ t: 'ready' }); }
    }
    function frame(now) {
      handle = 0;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
      if (!st.hv && last && dt < 0.03) { schedule(); return; } // außerhalb des Hero genügen ~30 fps
      last = now;
      var g = targets();
      var k = 1 - Math.exp(-dt * 3.2), kp = 1 - Math.exp(-dt * 9), kt = 1 - Math.exp(-dt * 2);
      cur.m += (g.m - cur.m) * k; cur.x += (g.x - cur.x) * kp; cur.y += (g.y - cur.y) * kp; cur.r += (g.r - cur.r) * kp;
      cur.tx += (st.px - cur.tx) * kt; cur.ty += (st.py - cur.ty) * kt;
      time += dt; spin += dt * 0.07;
      draw(); schedule();
    }
    function schedule() { if (st.run && !st.reduce && !handle) handle = raf(frame); }
    function snap() { var g = targets(); cur.m = g.m; cur.x = g.x; cur.y = g.y; cur.r = g.r; if (st.reduce) { spin = 0.6; time = 0; } }

    return function (msg) {
      var wasRun = st.run;
      for (var key in msg) if (key !== 'n' && key !== 'front' && key !== 'back') st[key] = msg[key];
      if (!ready) { if (!setup(msg.n || 3000)) return; ready = true; }
      if (msg.W) {
        var bw = Math.max(1, Math.round(st.W * st.dpr)), bh = Math.max(1, Math.round(st.H * st.dpr));
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        gl.viewport(0, 0, bw, bh); gl.uniform2f(U.uV, bw, bh); gl.uniform1f(U.uPt, (st.W < 600 ? 2.7 : 3.1) * st.dpr);
      }
      if (msg.front) { gl.uniform3fv(U.uFront, msg.front); gl.uniform3fv(U.uBack, msg.back); }
      if (first) snap();
      if (st.reduce) { snap(); draw(); return; }
      if (!st.run) { if (handle) { caf(handle); handle = 0; } last = 0; return; }
      if (!wasRun) last = 0;
      schedule();
    };
  }

  /* ===== Worker-Kontext ===== */
  if (typeof document === 'undefined') return;

  /* ===== Hauptthread ===== */
  var d = document, w = window, root = d.documentElement;
  var slot = d.querySelector('.hero-art'), hero = d.querySelector('.hero');
  if (!slot || !hero) return;
  var mqReduce = w.matchMedia('(prefers-reduced-motion: reduce)'), mqDark = w.matchMedia('(prefers-color-scheme: dark)'), mqFine = w.matchMedia('(hover: hover) and (pointer: fine)');
  var reduce = mqReduce.matches, ambient = 0.17, send = null, cv = null, worker = null, opa = -1;

  function hex(v) { v = (v || '').trim().replace('#', ''); if (v.length === 3) v = v.replace(/./g, '$&$&'); var n = parseInt(v, 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function colors() {
    var cs = getComputedStyle(root);
    ambient = parseFloat(cs.getPropertyValue('--pc-ambient')) || 0.17;
    return { front: hex(cs.getPropertyValue('--pc-front')), back: hex(cs.getPropertyValue('--pc-back')) };
  }
  function geo() {
    var sy = w.scrollY || w.pageYOffset, r = slot.getBoundingClientRect(), W, H;
    if (reduce) { W = r.width; H = r.height; } else { W = cv.clientWidth || w.innerWidth; H = cv.clientHeight || w.innerHeight; }
    return {
      W: W, H: H, dpr: Math.min(w.devicePixelRatio || 1, 2), sy: sy,
      sx: r.left + r.width / 2, sY: r.top + sy + r.height / 2, sr: Math.min(r.width, r.height) * 0.44,
      heroH: hero.offsetHeight || 1, docMax: Math.max(1, root.scrollHeight - w.innerHeight)
    };
  }
  function ease(a, b, v) { v = Math.min(1, Math.max(0, (v - a) / (b - a))); return v * v * (3 - 2 * v); }
  // Deckkraft der Ebene: im Hero voll, danach gedämpft (sichert AA-Kontrast für Text über der Wolke)
  function opacity() {
    if (!root.classList.contains('pc-on')) return 0;
    if (reduce) return 1;
    var r = slot.getBoundingClientRect();
    if (Math.min(r.width, r.height) * 0.44 < 45) return ambient;
    var p = Math.min(1, (w.scrollY || w.pageYOffset) / (hero.offsetHeight || 1));
    return 1 + (ambient - 1) * ease(0.5, 0.95, p);
  }
  function setOpacity() { var o = Math.round(opacity() * 100) / 100; if (o !== opa) { cv.style.opacity = o; opa = o; } }

  function onMsg(m) {
    if (m.t === 'ready') { root.classList.add('pc-on'); setOpacity(); }
    else if (m.t === 'fail') { if (worker) { worker.terminate(); worker = null; cv.remove(); mainThread(); } else root.classList.add('pc-off'); }
  }
  function mkCanvas() {
    cv = d.createElement('canvas'); cv.className = 'pc'; cv.setAttribute('aria-hidden', 'true');
    if (reduce) slot.appendChild(cv); else d.body.insertBefore(cv, d.body.firstChild);
  }
  function first() {
    var c = colors(), g = geo(); g.n = Math.min(w.innerWidth, w.innerHeight) < 600 ? 2600 : 4200;
    g.front = c.front; g.back = c.back; g.reduce = reduce; g.run = !d.hidden; g.hv = true;
    send(g);
  }
  function mainThread() {
    mkCanvas();
    var h = engine(cv, onMsg, function (f) { return w.requestAnimationFrame(f); }, function (i) { w.cancelAnimationFrame(i); });
    if (!h) return;
    send = h; first();
  }
  function start() {
    mkCanvas();
    var useWorker = typeof cv.transferControlToOffscreen === 'function' && typeof Worker === 'function' && w.Blob && w.URL;
    if (useWorker) {
      try {
        var src = '"use strict";var engine=' + engine.toString() + ';var h=null;' +
          'self.onmessage=function(e){var m=e.data;if(m.canvas){var c=m.canvas;delete m.canvas;' +
          'h=engine(c,function(x){self.postMessage(x)},self.requestAnimationFrame?function(f){return self.requestAnimationFrame(f)}:function(f){return setTimeout(function(){f(performance.now())},16)},' +
          'self.cancelAnimationFrame?function(i){self.cancelAnimationFrame(i)}:clearTimeout);if(!h)return;}if(h)h(m);};';
        var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        worker = new Worker(url); URL.revokeObjectURL(url);
        var off = cv.transferControlToOffscreen();
        worker.onmessage = function (e) { onMsg(e.data); };
        worker.onerror = function () { onMsg({ t: 'fail' }); };
        send = function (m, tr) { worker.postMessage(m, tr || []); };
        var c = colors(), g = geo(); g.n = Math.min(w.innerWidth, w.innerHeight) < 600 ? 2600 : 4200;
        g.front = c.front; g.back = c.back; g.reduce = reduce; g.run = !d.hidden; g.hv = true; g.canvas = off;
        send(g, [off]);
      } catch (e) { if (worker) worker.terminate(); worker = null; if (cv) cv.remove(); mainThread(); }
    } else { cv.remove(); mainThread(); }
    bind();
  }

  function bind() {
    var pend = 0, rs = 0;
    function onScroll() {
      if (pend) return;
      pend = w.requestAnimationFrame(function () { pend = 0; if (!send) return; if (!reduce) send({ sy: w.scrollY || w.pageYOffset }); setOpacity(); });
    }
    function onResize() {
      if (rs) return;
      rs = w.requestAnimationFrame(function () { rs = 0; if (send) { send(geo()); setOpacity(); } });
    }
    w.addEventListener('resize', onResize, { passive: true });
    if ('ResizeObserver' in w) new ResizeObserver(onResize).observe(reduce ? slot : d.body);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(onResize);
    var onTheme = function () { if (send) { send(colors()); setOpacity(); } };
    if (mqDark.addEventListener) mqDark.addEventListener('change', onTheme); else if (mqDark.addListener) mqDark.addListener(onTheme);
    if (reduce) return;
    w.addEventListener('scroll', onScroll, { passive: true });
    d.addEventListener('visibilitychange', function () { if (send) send({ run: !d.hidden }); });
    if ('IntersectionObserver' in w) new IntersectionObserver(function (es) { if (send) send({ hv: es[0].isIntersecting }); }).observe(hero);
    if (mqFine.matches) {
      var pp = 0, px = 0, py = 0;
      w.addEventListener('pointermove', function (e) {
        px = (e.clientX / w.innerWidth - 0.5) * 2; py = (e.clientY / w.innerHeight - 0.5) * 2;
        if (!pp) pp = w.requestAnimationFrame(function () { pp = 0; if (send) send({ px: px, py: py }); });
      }, { passive: true });
    }
    var onReduce = function () { if (send) send({ run: !mqReduce.matches && !d.hidden }); };
    if (mqReduce.addEventListener) mqReduce.addEventListener('change', onReduce);
  }

  if (d.readyState === 'complete') start(); else w.addEventListener('load', start, { once: true });
})();
