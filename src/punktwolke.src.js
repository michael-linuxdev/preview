/* Punktwolke – erzählt den Weg vom gewachsenen Ist-Zustand zur geordneten, wachsenden IT.
   Zustände: 0 verstreutes Punktfeld · 1 sauberes Raster (Fundament) · 2 erste Säulen · 3 ansteigende Säulen + Wachstumskurve.
   Scroll: Morph mit kurzen Plateaus innerhalb der Hero-Höhe – Wolke folgt dem Hero-Slot (kein künstliches Festhalten).
   WebGL 1 ohne Abhängigkeiten. Alle Übergänge laufen im Vertex-Shader; pro Frame werden nur Uniforms gesetzt.
   Gerendert wird nach Möglichkeit in einem Worker (OffscreenCanvas), damit der Hauptthread frei bleibt. */
(function () {
  'use strict';

  /* ===== Render-Engine: läuft im Worker oder – als Rückfall – im Hauptthread ===== */
  function engine(canvas, post, raf, caf) {
    var gl = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: true, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: true, preserveDrawingBuffer: false,
        powerPreference: 'low-power', desynchronized: true
      });
    } catch (e) { gl = null; }
    if (!gl) {
      try {
        gl = canvas.getContext('webgl', {
          alpha: true, antialias: false, depth: false, stencil: false,
          premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power'
        });
      } catch (e2) { gl = null; }
    }
    if (!gl) { post({ t: 'fail' }); return null; }

    var st = { amb: 0.17, sy: 0, W: 1, H: 1, dpr: 1, sx: 0, sY: 0, sr: 0, heroH: 1, docMax: 1, px: 0, py: 0, hv: true, reduce: false, run: false };
    var N = 0, nDraw = 0, U = {}, ready = false, BASE = -0.85;

    function rndGen(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function colH(ix) { return 0.2 + 1.32 * Math.pow((ix + 1) / 7, 1.5); }

    function build(n) {
      N = nDraw = n;
      var rnd = rndGen(11), A0 = new Float32Array(N * 3), A1 = new Float32Array(N * 3), A2 = new Float32Array(N * 3), A3 = new Float32Array(N * 4), S = new Float32Array(N * 2);
      // zufällige Reihenfolge: jedes Präfix ist eine gleichmäßige Stichprobe -> Punktzahl lässt sich per drawArrays-Anzahl senken
      var perm = new Uint32Array(N), i, k, t;
      for (i = 0; i < N; i++) perm[i] = i;
      for (i = N - 1; i > 0; i--) { k = Math.floor(rnd() * (i + 1)); t = perm[i]; perm[i] = perm[k]; perm[k] = t; }
      // Raster: 7 Linien längs x, 11 Linien längs z
      var GX = 1.2, GZ = 0.75, LZ = 7, LX = 11, lenA = 2 * GX, lenB = 2 * GZ, total = LZ * lenA + LX * lenB;
      function grid(u, out, o, y) {
        var d = u * total, x, z;
        if (d < LZ * lenA) { var li = Math.floor(d / lenA); x = -GX + (d - li * lenA); z = -GZ + li * (2 * GZ / (LZ - 1)); }
        else { d -= LZ * lenA; var lj = Math.min(LX - 1, Math.floor(d / lenB)); z = -GZ + (d - lj * lenB); x = -GX + lj * (2 * GX / (LX - 1)); }
        out[o] = x; out[o + 1] = y; out[o + 2] = z;
      }
      // 7 Säulen, Höhe steigt nach rechts; Punktdichte nach Höhe gewichtet
      var cols = [], cum = 0;
      for (var ix = 0; ix < 7; ix++) { cum += colH(ix) + 0.5; cols.push({ x: -1 + ix * 0.333, z: 0, h: colH(ix), c: cum }); }
      var CL = [[-1.15, 0.38], [-0.4, -0.3], [0.45, 0.42], [0.95, -0.25], [-0.75, -0.45], [0.2, 0.05]];
      for (k = 0; k < N; k++) {
        var j = perm[k], q = (j + 0.5) / N, o = k * 3, o4 = k * 4;
        // 0: verstreut – teils gleichmäßig, teils in „gewachsenen Inseln“
        if (rnd() < 0.42) { var cl = CL[Math.floor(rnd() * CL.length)], g = function () { return (rnd() + rnd() + rnd() - 1.5) * 0.24; };
          A0[o] = cl[0] + g(); A0[o + 1] = cl[1] + g(); A0[o + 2] = g() * 1.6; }
        else { A0[o] = (rnd() * 2 - 1) * 1.2; A0[o + 1] = (rnd() * 2 - 1) * 0.78; A0[o + 2] = (rnd() * 2 - 1) * 0.7; }
        // 1: Raster als Fundament
        grid(q, A1, o, -0.25);
        // 2/3: Säulen (2 = Ansatz, 3 = voll gewachsen) + Bodenraster + Wachstumskurve
        if (q < 0.16) { grid(q / 0.16, A2, o, BASE); grid(q / 0.16, A3, o4, BASE); A3[o4 + 3] = 0; }
        else if (q < 0.9) {
          var r = rnd() * cum, c = cols[0];
          for (var m = 0; m < cols.length; m++) if (cols[m].c >= r) { c = cols[m]; break; }
          var hw = 0.1, u = rnd(), x, y, z, flow = 0;
          if (u < 0.62) { var cn = Math.floor(rnd() * 4); x = c.x + (cn & 1 ? hw : -hw); z = c.z + (cn & 2 ? hw : -hw); y = rnd() * c.h; if (rnd() < 0.45) flow = c.h; }
          else if (u < 0.93) { var pp = rnd() * 4, sd = Math.floor(pp), f = (pp - sd) * 2 - 1; y = c.h;
            x = c.x + (sd === 0 ? f * hw : sd === 1 ? hw : sd === 2 ? -f * hw : -hw); z = c.z + (sd === 0 ? -hw : sd === 1 ? f * hw : sd === 2 ? hw : -f * hw); }
          else { var s2 = Math.floor(rnd() * 4), f2 = (rnd() * 2 - 1) * hw; y = rnd() * c.h;
            x = c.x + (s2 < 2 ? f2 : (s2 === 2 ? hw : -hw)); z = c.z + (s2 < 2 ? (s2 ? hw : -hw) : f2); }
          A2[o] = x; A2[o + 1] = BASE + y * 0.36; A2[o + 2] = z;
          A3[o4] = x; A3[o4 + 1] = BASE + y; A3[o4 + 2] = z; A3[o4 + 3] = flow;
        } else {
          // Wachstumskurve über den Säulen, endet in einer Pfeilspitze
          var tt = (q - 0.9) / 0.1, cx, cy, top = function (x) { var fi = (x + 1) / 0.333; return BASE + 0.2 + 1.32 * Math.pow(Math.max(0, fi + 1) / 7, 1.5) + 0.22; };
          if (tt < 0.88) { cx = -1.12 + tt / 0.88 * 2.2; cy = top(cx); }
          else { var b = (tt - 0.88) / 0.12, ex = 1.08, ey = top(1.08), wing = b < 0.5 ? b * 2 : (b - 0.5) * 2;
            cx = ex - wing * 0.13 * (b < 0.5 ? 1 : 0.35); cy = ey - wing * 0.13 * (b < 0.5 ? 0.35 : 1); }
          A2[o] = cx; A2[o + 1] = BASE + 0.01; A2[o + 2] = 0.12;
          A3[o4] = cx; A3[o4 + 1] = cy; A3[o4 + 2] = 0.12; A3[o4 + 3] = 0;
        }
        S[k * 2] = rnd(); S[k * 2 + 1] = rnd();
      }
      return [A0, A1, A2, A3, S];
    }

    var VS = 'attribute vec3 a0,a1,a2;attribute vec4 a3;attribute vec2 aS;' +
      'uniform float uM,uT,uR,uD,uPt,uA;uniform vec2 uC,uV;uniform mat3 uRot;uniform vec3 uFront,uBack;' +
      'varying vec3 vCol;varying float vA;' +
      'void main(){float n=floor(min(uM,2.999)),f=uM-n;f=clamp(f*1.5-aS.x*.5,0.,1.);f=f*f*(3.-2.*f);' +
      'vec3 q=a3.xyz;float fa=1.;' +
      'if(a3.w>0.){float e=fract((q.y+.85)/a3.w+uT*.05/a3.w);q.y=-.85+e*a3.w;fa=smoothstep(0.,.12,e)*smoothstep(1.,.75,e);}' +
      'vec3 p=n<.5?mix(a0,a1,f):n<1.5?mix(a1,a2,f):mix(a2,q,f);' +
      'float dis=clamp(1.-uM,0.,1.),ph=aS.x*40.+aS.y*17.;' +
      'p+=(.006+.07*dis)*vec3(sin(uT*.21+ph),sin(uT*.17+ph*1.3),cos(uT*.19+ph*.7));' +
      'p=uRot*p;float s=uD/(uD-p.z);vec2 px=uC+vec2(p.x,-p.y)*uR*s;' +
      'gl_Position=vec4(px.x/uV.x*2.-1.,1.-px.y/uV.y*2.,0.,1.);' +
      'float df=clamp((p.z+1.2)/2.4,0.,1.);gl_PointSize=uPt*s*(.75+.5*aS.y);' +
      'vCol=mix(uBack,uFront,.3+.7*df);vA=(.25+.75*df)*uA*(n>1.5?mix(1.,fa,f):1.);}';
    // minimaler Fragment-Shader: weicher runder Punkt ohne Wurzel und ohne discard
    var FS = 'precision mediump float;varying vec3 vCol;varying float vA;' +
      'void main(){vec2 c=gl_PointCoord-.5;float a=clamp(1.-4.*dot(c,c),0.,1.);a*=a*vA;gl_FragColor=vec4(vCol*a,a);}';

    function setup(n) {
      var B = build(n), pr = gl.createProgram();
      [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]].forEach(function (x) { var s = gl.createShader(x[0]); gl.shaderSource(s, x[1]); gl.compileShader(s); gl.attachShader(pr, s); });
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { post({ t: 'fail' }); return false; }
      gl.useProgram(pr);
      [['a0', 3], ['a1', 3], ['a2', 3], ['a3', 4], ['aS', 2]].forEach(function (x, i) {
        var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, B[i], gl.STATIC_DRAW);
        var l = gl.getAttribLocation(pr, x[0]); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, x[1], gl.FLOAT, false, 0, 0);
      });
      ['uM', 'uT', 'uR', 'uD', 'uPt', 'uA', 'uC', 'uV', 'uRot', 'uFront', 'uBack'].forEach(function (u) { U[u] = gl.getUniformLocation(pr, u); });
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(U.uD, 5.0);
      return true;
    }

    var cur = { sy: 0, m: 0, x: 0, y: 0, r: 0, tx: 0, ty: 0, o: 1 }, first = true, last = 0, time = 0, handle = 0, acc = 0, still = 0;
    var lvl = 0, warm = 0, fs = 0, fn = 0;
    function ease(a, b, v) { v = Math.min(1, Math.max(0, (v - a) / (b - a))); return v * v * (3 - 2 * v); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    /* Morph 0..3: Wachstum inkl. Pfeilspitze früh fertig – schon wenn die Angebotskarte hochkommt. */
    function morphAt(t) {
      if (t < 0.03) return 0;
      if (t < 0.12) return ease(0.03, 0.12, t);
      if (t < 0.18) return 1;
      if (t < 0.28) return 1 + ease(0.18, 0.28, t);
      if (t < 0.32) return 2;
      if (t < 0.42) return 2 + ease(0.32, 0.42, t);
      return 3;
    }
    function sizeCanvas() {
      var bw = Math.max(1, Math.round(st.W * st.dpr)), bh = Math.max(1, Math.round(st.H * st.dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      gl.viewport(0, 0, bw, bh); gl.uniform2f(U.uV, bw, bh); gl.uniform1f(U.uPt, (st.W < 600 ? 3.4 : 3.6) * st.dpr);
    }
    // Ziele hängen am geglätteten Scrollwert (cur.sy): stetige Bewegung, egal wie unregelmäßig Scroll-Events kommen
    function targets(sy) {
      var W = st.W, H = st.H, p = Math.min(1, sy / Math.max(1, st.heroH));
      if (st.reduce) return { x: W / 2, y: H / 2, r: Math.min(W, H) * 0.42, m: 3 };
      var wide = W >= 1000, tiny = st.sr < 45;
      // Mobil leicht links der Mitte: Wachstumspfeil rechts braucht Rand
      var ax = wide ? W * 0.7 : W * 0.48, ay = H * 0.5;
      // Mobil: kleinerer Radius – gesamte Morph inkl. Pfeilspitze im Viewport
      var ar = wide ? Math.min(W * 0.2, H * 0.36) : Math.min(W * 0.32, H * 0.3);
      // Wolke folgt dem Hero-Art-Slot; Ambient erst wenn Hero weg ist
      var mv = tiny ? 1 : ease(0.55, 1.05, p);
      // Kurze Erzählspanne: Wachstum inkl. Pfeil schon bei ~0,25–0,35× Hero
      var story = st.heroH * (wide ? 0.7 : 0.55);
      var t = Math.min(1, Math.max(0, sy / Math.max(1, story)));
      var slotY = st.sY - sy * (wide ? 0.5 : 1);
      var y = lerp(slotY, ay, mv);
      var r = lerp(tiny ? ar : st.sr, ar, mv);
      if (!wide) {
        // Leichter Slot-Nudge nach unten für die höhere Wachstumsform – kein Viewport-Pin (der Weißraum erzeugt)
        var drop = ease(0.28, 0.48, t);
        y += drop * Math.min(st.sr * 0.22, H * 0.05);
      }
      return {
        x: lerp(st.sx, ax, mv),
        y: y,
        r: r,
        m: morphAt(t)
      };
    }
    // Deckkraft: voll bis Wachstum inkl. Pfeil gelandet ist
    function alpha() {
      if (st.reduce) return 1;
      if (st.sr < 45) return st.amb;
      var wide = st.W >= 1000;
      return 1 + (st.amb - 1) * ease(wide ? 0.7 : 0.55, wide ? 1.15 : 1.0, Math.max(st.sy, cur.sy) / Math.max(1, st.heroH));
    }
    function draw() {
      var ax = 0.34 + cur.ty * 0.1, ay = -0.36 + 0.12 * Math.sin(time * 0.09) + cur.tx * 0.2;
      var cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), dpr = st.dpr;
      gl.uniform1f(U.uM, cur.m); gl.uniform1f(U.uT, time); gl.uniform1f(U.uA, cur.o);
      gl.uniform2f(U.uC, cur.x * dpr, cur.y * dpr); gl.uniform1f(U.uR, cur.r * dpr);
      gl.uniformMatrix3fv(U.uRot, false, [cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (cur.o > 0.003) gl.drawArrays(gl.POINTS, 0, nDraw);
      if (first) { first = false; post({ t: 'ready' }); }
    }
    // adaptive Qualität: erst leichte Punktereduktion, dann DPR – nie unter ~68 % der Punkte
    function quality(dt) {
      if (++warm < 45) return;
      fs += dt; fn++;
      if (fn < 50) return;
      var avg = fs / fn; fs = fn = 0;
      if (avg > 0.019 && lvl < 3) {
        lvl++;
        if (lvl === 1) nDraw = Math.round(N * 0.85);
        else if (lvl === 2) nDraw = Math.round(N * 0.68);
        else if (st.dpr > 1.25) { st.dpr = Math.max(1.25, st.dpr * 0.8); sizeCanvas(); }
        warm = 24; post({ t: 'q', l: lvl, n: nDraw, dpr: st.dpr });
      }
    }
    function frame(now) {
      handle = 0;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
      last = now;
      // Ruhe: nichts ändert sich sichtbar -> im Hero ~30 fps, als Hintergrund 15 fps, nach 6 s Pause
      var idle = still > 0.25;
      if (idle) {
        if (!st.hv && still > 6) { draw(); return; }
        acc += dt; if (acc < (st.hv ? 0.032 : 0.066)) { schedule(); return; }
        dt = acc;
      } else quality(dt);
      acc = 0;
      var ks = 1 - Math.exp(-dt * 7.5), k = 1 - Math.exp(-dt * 5.2), kt = 1 - Math.exp(-dt * 2);
      var dsy = st.sy - cur.sy;
      cur.sy = Math.abs(dsy) < 0.05 ? st.sy : cur.sy + dsy * ks;
      var g = targets(cur.sy);
      // sichtbare Änderung? Hinter dem Hero ändert Scrollen am fertigen Bild nichts mehr -> Ruhetakt statt 60 fps
      var dv = Math.abs(g.x - cur.x) + Math.abs(g.y - cur.y) + Math.abs(g.r - cur.r) + Math.abs(g.m - cur.m) * 400;
      cur.m += (g.m - cur.m) * k; cur.x = g.x; cur.y = g.y; cur.r = g.r;
      var dp = Math.abs(st.px - cur.tx) + Math.abs(st.py - cur.ty);
      cur.tx += (st.px - cur.tx) * kt; cur.ty += (st.py - cur.ty) * kt;
      var o = alpha(); dv += Math.abs(o - cur.o) * 400; cur.o = o;
      // Erzählbereich = Hero – jede Scrollbewegung zählt
      var act = Math.min(cur.sy, st.sy) < st.heroH * 1.05 && Math.abs(dsy) > 0.02;
      still = (act || dv > 0.3 || dp > 0.01) ? 0 : still + dt;
      time += dt;
      draw(); schedule();
    }
    function schedule() { if (st.run && !st.reduce && !handle) handle = raf(frame); }
    function snap() { cur.sy = st.sy; var g = targets(cur.sy); cur.o = alpha(); cur.m = g.m; cur.x = g.x; cur.y = g.y; cur.r = g.r; if (st.reduce) time = 0; }

    return function (msg) {
      var wasRun = st.run;
      for (var key in msg) if (key !== 'n' && key !== 'front' && key !== 'back') st[key] = msg[key];
      if (!ready) { if (!setup(msg.n || 2000)) return; ready = true; }
      if (msg.W) sizeCanvas();
      if (msg.front) { gl.uniform3fv(U.uFront, msg.front); gl.uniform3fv(U.uBack, msg.back); }
      if (first) snap();
      if (st.reduce) { snap(); draw(); return; }
      if (!st.run) { if (handle) { caf(handle); handle = 0; } last = 0; return; }
      if (!wasRun || !handle) last = 0;
      if ('sy' in msg || 'px' in msg || msg.W || msg.front) still = 0;
      schedule();
    };
  }

  /* ===== Worker-Kontext ===== */
  if (typeof document === 'undefined') return;

  /* ===== Hauptthread ===== */
  var d = document, w = window, root = d.documentElement, nav = navigator;
  var slot = d.querySelector('.hero-art'), hero = d.querySelector('.hero');
  if (!slot || !hero) return;
  var mqReduce = w.matchMedia('(prefers-reduced-motion: reduce)'), mqDark = w.matchMedia('(prefers-color-scheme: dark)'), mqFine = w.matchMedia('(hover: hover) and (pointer: fine)');
  var reduce = mqReduce.matches, send = null, cv = null, worker = null, lastW = -1, lastH = -1;
  // Geräteklasse: genug Punkte für eine lesbare Wolke; Perf eher über Worker/LOD/Idle als über Unsichtbarkeit
  var small = Math.min(w.screen.width || w.innerWidth, w.screen.height || w.innerHeight) < 600;
  var cores = nav.hardwareConcurrency || 4, mem = nav.deviceMemory;
  var low = mem !== undefined && (mem <= 2 || (mem <= 4 && cores <= 4));
  var NPTS = low ? 1800 : small ? 2600 : 4000, DPR = low ? 1.25 : small ? 1.75 : 2;

  function hex(v) { v = (v || '').trim().replace('#', ''); if (v.length === 3) v = v.replace(/./g, '$&$&'); var n = parseInt(v, 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function colors() {
    var cs = getComputedStyle(root);
    return { front: hex(cs.getPropertyValue('--pc-front')), back: hex(cs.getPropertyValue('--pc-back')), amb: parseFloat(cs.getPropertyValue('--pc-ambient')) || 0.17 };
  }
  function geo() {
    var sy = w.scrollY || w.pageYOffset, r = slot.getBoundingClientRect(), W, H;
    if (reduce) { W = r.width; H = r.height; } else { W = cv.clientWidth || w.innerWidth; H = cv.clientHeight || w.innerHeight; }
    return {
      W: W, H: H, dpr: Math.min(w.devicePixelRatio || 1, DPR), sy: sy,
      sx: r.left + r.width / 2, sY: r.top + sy + r.height / 2, sr: Math.min(r.width, r.height) * (small ? 0.4 : 0.44),
      heroH: hero.offsetHeight || 1, docMax: Math.max(1, root.scrollHeight - (reduce ? w.innerHeight : H))
    };
  }
  function onMsg(m) {
    if (m.t === 'ready') root.classList.add('pc-on');
    else if (m.t === 'q') root.setAttribute('data-pcq', m.l);
    else if (m.t === 'fail') { if (worker) { worker.terminate(); worker = null; cv.remove(); mainThread(); } else root.classList.add('pc-off'); }
  }
  function mkCanvas() {
    cv = d.createElement('canvas'); cv.className = 'pc'; cv.setAttribute('aria-hidden', 'true');
    if (reduce) slot.appendChild(cv); else d.body.insertBefore(cv, d.body.firstChild);
  }
  function initMsg() { var c = colors(), g = geo(); g.n = NPTS; g.front = c.front; g.back = c.back; g.amb = c.amb; g.reduce = reduce; g.run = !d.hidden; g.hv = true; return g; }
  function mainThread() {
    mkCanvas();
    var h = engine(cv, onMsg, function (f) { return w.requestAnimationFrame(f); }, function (i) { w.cancelAnimationFrame(i); });
    if (!h) return;
    send = h; send(initMsg());
  }
  function start() {
    mkCanvas();
    if (typeof cv.transferControlToOffscreen === 'function' && typeof Worker === 'function' && w.Blob && w.URL) {
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
        var g = initMsg(); g.canvas = off; send(g, [off]);
      } catch (e) { if (worker) worker.terminate(); worker = null; if (cv) cv.remove(); mainThread(); }
    } else { cv.remove(); mainThread(); }
    bind();
  }

  function bind() {
    var rs = 0;
    // Scroll: nur den Wert weiterreichen – keine Layout-Abfragen, keine Style-Änderungen
    function onScroll() { if (send) send({ sy: w.scrollY || w.pageYOffset }); }
    // Resize: die Ebene ist 100lvh hoch, die iOS-Adressleiste ändert ihre Größe also nicht
    function onResize() {
      if (rs) return;
      rs = w.requestAnimationFrame(function () {
        rs = 0; if (!send) return;
        var g = geo();
        if (g.W === lastW && g.H === lastH) { delete g.W; delete g.H; delete g.dpr; } else { lastW = g.W; lastH = g.H; }
        send(g);
      });
    }
    w.addEventListener('resize', onResize, { passive: true });
    if ('ResizeObserver' in w) new ResizeObserver(onResize).observe(reduce ? slot : d.body);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(onResize);
    var onTheme = function () { if (send) send(colors()); };
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

  // Start erst nach dem ersten Rendern, wenn der Browser Luft hat
  function boot() { if (w.requestIdleCallback) w.requestIdleCallback(start, { timeout: 1200 }); else setTimeout(start, 150); }
  if (d.readyState === 'complete') boot(); else w.addEventListener('load', boot, { once: true });
})();
