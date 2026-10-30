"use strict";

// NeuroMemory Morphology v0.4. Geometry is always local to the browser.
// The built-in exemplar is SYNTHETIC. A user-selected SWC is an unverified
// reconstruction until its specimen, species and publication are established.
(function (root) {
  function rng(seed) {
    let state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      let v = state;
      v = Math.imul(v ^ (v >>> 15), v | 1);
      v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
      return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
    };
  }

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
  function unit(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return scale(v, 1 / length);
  }

  function makeSynthetic(seed = 0xB16B00B5) {
    const random = rng(seed);
    const segments = [];
    const somas = [];

    function neurite(origin, direction, span, thickness, level, limit, type, cell) {
      let position = origin;
      let heading = unit(direction);
      const steps = 6;
      for (let step = 0; step < steps; step++) {
        const wobble = .11 + .025 * level;
        heading = unit(add(heading, [
          (random() - .5) * wobble,
          (random() - .5) * wobble,
          (random() - .5) * wobble
        ]));
        const next = add(position, scale(heading, span / steps));
        const t = (step + 1) / steps;
        segments.push({a: position, b: next, r0: thickness * (1 - (step / steps) * .33),
          r1: thickness * (1 - t * .33), type, cell});
        position = next;
      }
      if (level >= limit) return;
      const branches = level === 0 && type === 4 ? 3 : 2;
      for (let i = 0; i < branches; i++) {
        const side = i % 2 ? -1 : 1;
        const spread = type === 2 ? .25 : .42;
        const bend = [
          side * (spread + random() * .42),
          type === 4 ? .10 + random() * .25 : (random() - .5) * .35,
          (random() - .5) * .76
        ];
        const nextDirection = unit(add(scale(heading, .9), bend));
        neurite(position, nextDirection, span * (.67 + random() * .14),
          thickness * .72, level + 1, limit, type, cell);
      }
    }

    function cell(center, size, index, isMain) {
      somas.push({at: center, r: .064 * size, cell: index});
      neurite(add(center, [0, .045 * size, 0]), [0, 1, .06], .55 * size,
        .018 * size, 0, isMain ? 5 : 3, 4, index);
      for (let i = 0; i < (isMain ? 9 : 6); i++) {
        const angle = (i + random() * .35) * Math.PI * 2 / (isMain ? 9 : 6);
        neurite(center, [Math.cos(angle) * 1.2, -.36 - random() * .3, Math.sin(angle)],
          (.33 + random() * .12) * size, .013 * size, 0, isMain ? 4 : 3, 3, index);
      }
      neurite(add(center, [0, -.055 * size, 0]), [.15, -1, .08], .39 * size,
        .007 * size, 0, isMain ? 5 : 3, 2, index);
    }

    cell([0, -.04, 0], 1, 0, true);
    cell([-1.95, .6, -.45], .43, 1, false);
    cell([1.97, .68, -.9], .43, 2, false);
    cell([-1.5, -1.02, .65], .35, 3, false);
    cell([1.7, -1.05, .3], .40, 4, false);
    return {segments, somas, count: segments.length + somas.length,
      label: "程序化三维形态 · 合成模型", verified: false, unitLabel: "无物理长度标定"};
  }

  function parseSWC(source) {
    if (typeof source !== "string" || source.length > 5 * 1024 * 1024) {
      throw new Error("SWC 文件为空或超过 5 MiB 上限。");
    }
    const rows = source.split(/\r?\n/);
    const byId = new Map();
    for (const line of rows) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const cols = trimmed.split(/\s+/);
      if (cols.length !== 7) throw new Error("SWC 数据行须恰好有七列：id type x y z radius parent。");
      const vals = cols.map(Number);
      if (!vals.every(Number.isFinite) ||
          !Number.isSafeInteger(vals[0]) || !Number.isSafeInteger(vals[1]) ||
          !Number.isSafeInteger(vals[6]) || vals[0] <= 0 || vals[6] === vals[0] ||
          vals[4] < -10000000 || vals[4] > 10000000 ||
          vals[5] <= 0 || vals[5] > 1000000 ||
          vals.slice(2, 5).some(v => Math.abs(v) > 10000000)) {
        throw new Error("SWC 节点含不合法的编号、坐标、半径或自引用。");
      }
      if (byId.has(vals[0])) throw new Error("SWC 含重复节点编号。");
      byId.set(vals[0], {id: vals[0], type: vals[1], at: vals.slice(2, 5), r: vals[5], parent: vals[6]});
      if (byId.size > 75000) throw new Error("SWC 最多支持 75,000 个节点。");
    }
    if (!byId.size) throw new Error("SWC 文件不包含有效节点。");
    const segments = [];
    const somas = [];
    let roots = 0;
    for (const node of byId.values()) {
      if (node.parent === -1) roots++;
      else if (!byId.has(node.parent)) throw new Error(`节点 ${node.id} 指向不存在的父节点。`);
      if (node.type === 1) somas.push({at: node.at, r: node.r, cell: 0});
      if (node.parent !== -1) {
        const parent = byId.get(node.parent);
        segments.push({a: parent.at, b: node.at, r0: parent.r, r1: node.r,
          type: node.type, cell: 0});
      }
    }
    if (!roots) throw new Error("SWC 缺少 parent=-1 的根节点。");
    // Acyclic parent graph is required. A malformed file must never hang the viewer.
    const visited = new Set();
    for (const start of byId.values()) {
      if (visited.has(start.id)) continue;
      const visiting = new Set();
      let cursor = start;
      while (cursor && !visited.has(cursor.id)) {
        if (visiting.has(cursor.id)) throw new Error("SWC 中存在循环父节点链。");
        visiting.add(cursor.id);
        cursor = cursor.parent === -1 ? null : byId.get(cursor.parent);
      }
      for (const id of visiting) visited.add(id);
    }
    if (!somas.length) {
      // SWC files with no explicitly typed soma may still encode partial arbors.
      somas.push({at: byId.values().next().value.at, r: .01, cell: 0});
    }
    const lower = [Infinity, Infinity, Infinity];
    const upper = [-Infinity, -Infinity, -Infinity];
    for (const node of byId.values()) {
      for (let i = 0; i < 3; i++) {
        if (node.at[i] < lower[i]) lower[i] = node.at[i];
        if (node.at[i] > upper[i]) upper[i] = node.at[i];
      }
    }
    const center = lower.map((v, i) => (v + upper[i]) / 2);
    const extent = Math.max(...upper.map((v, i) => v - lower[i]), .000001);
    const factor = 3.5 / extent;
    const pos = p => scale([p[0] - center[0], p[1] - center[1], p[2] - center[2]], factor);
    const geometry = {
      segments: segments.map(v => ({...v, a: pos(v.a), b: pos(v.b),
        r0: v.r0 * factor, r1: v.r1 * factor})),
      somas: somas.map(v => ({...v, at: pos(v.at), r: v.r * factor})),
      count: byId.size, roots,
      // Retain original SWC values for reproducibility; these nodes are never
      // silently treated as ground-truth synaptic or electrophysiology data.
      originalNodes: [...byId.values()].map(n => ({id: n.id, type: n.type,
        x: n.at[0], y: n.at[1], z: n.at[2], radius: n.r, parent: n.parent})),
      normalization: {center, factor},
      label: "用户提供的 SWC 重建 · 来源未核验", verified: false,
      unitLabel: "坐标已标准化；原文件单位须查证"
    };
    return geometry;
  }

  function createViewer(canvas, options = {}) {
    const context = canvas.getContext("2d", {alpha: true});
    if (!context) throw new Error("浏览器未提供 Canvas 2D 支持。");
    let data = makeSynthetic();
    let yaw = -.26, pitch = -.17, zoom = 1;
    let width = 500, height = 500;
    let paused = !!options.reduceMotion;
    let frame = 0, lastTime = 0, lastDraw = 0;
    let dragging = null;
    let elapsed = 0;
    let trace = null;

    function project(v) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const x = v[0] * cy + v[2] * sy;
      const z = -v[0] * sy + v[2] * cy;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const y = v[1] * cp - z * sp;
      const depth = v[1] * sp + z * cp;
      const perspective = 5.6 / Math.max(3, 5.6 - depth);
      const density = Math.min(width * .27, height * .34) * zoom;
      return {x: width * .50 + x * density * perspective,
        y: height * .50 - y * density * perspective,
        depth, density: density * perspective};
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";
      const lines = data.segments.map(segment => {
        const a = project(segment.a), b = project(segment.b);
        return {a, b, r: (segment.r0 + segment.r1) / 2,
          type: segment.type, depth: (a.depth + b.depth) / 2};
      }).sort((a, b) => a.depth - b.depth);

      // SWC line widths follow stored radii. Depth changes opacity, not geometry.
      // The built-in example is not a reconstruction of any biological specimen.
      for (const line of lines) {
        const foreground = Math.max(0, Math.min(1, (line.depth + 2.1) / 4.2));
        const alpha = (line.type === 2 ? .14 : .20) + foreground * .31;
        const weight = Math.max(.38, Math.min(4.1, 2 * line.r * line.a.density));
        context.beginPath();
        context.moveTo(line.a.x, line.a.y);
        context.lineTo(line.b.x, line.b.y);
        context.lineWidth = weight;
        context.strokeStyle = `rgba(65,70,66,${alpha.toFixed(3)})`;
        context.stroke();
      }
      for (const soma of data.somas) {
        const p = project(soma.at);
        const radius = Math.max(2.2, Math.min(26, soma.r * p.density));
        context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2);
        const sample = root.NeuroMorphologyWebGL && root.NeuroMorphologyWebGL.sampleTrace(trace, elapsed * 90);
        const level = sample === null ? 0 : Math.max(0, Math.min(1, (sample + 65) / 18));
        const tone = Math.round(73 + level * 75);
        context.fillStyle = `rgb(${tone},${tone},${tone})`; context.fill();
        context.lineWidth = Math.max(.7, radius * .15);
        context.strokeStyle = "rgba(236,237,233,.85)"; context.stroke();
        if (soma.cell === 0) {
          context.beginPath(); context.arc(p.x, p.y, Math.max(1.1, radius * .25), 0, Math.PI * 2);
          context.fillStyle = "#e8e9e5"; context.fill();
        }
      }
      // No fabricated traveling pulses. Only the synthetic LIF somatic voltage
      // is visualized after the user explicitly runs the computational demo.
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(280, rect.width);
      height = Math.max(260, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    function tick(timestamp) {
      if (paused) { frame = 0; return; }
      const dt = lastTime ? Math.min(.05, (timestamp - lastTime) / 1000) : 0;
      lastTime = timestamp;
      if (!document.hidden) {
        elapsed += dt;
        if (!dragging) yaw += dt * .045;
        if (timestamp - lastDraw >= 33) {
          lastDraw = timestamp;
          draw();
        }
      }
      frame = requestAnimationFrame(tick);
    }

    function setPaused(next) {
      paused = !!next;
      cancelAnimationFrame(frame);
      frame = 0; lastTime = 0; lastDraw = 0;
      if (paused) draw();
      else frame = requestAnimationFrame(tick);
    }

    canvas.addEventListener("pointerdown", event => {
      dragging = {id: event.pointerId, x: event.clientX, y: event.clientY};
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", event => {
      if (!dragging || dragging.id !== event.pointerId) return;
      yaw += (event.clientX - dragging.x) * .007;
      pitch = Math.max(-1.1, Math.min(1.1, pitch + (event.clientY - dragging.y) * .007));
      dragging.x = event.clientX; dragging.y = event.clientY;
      draw();
    });
    const stopDrag = () => { dragging = null; canvas.classList.remove("is-dragging"); };
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);
    canvas.addEventListener("lostpointercapture", stopDrag);
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      zoom = Math.max(.55, Math.min(2.6, zoom * Math.exp(-event.deltaY * .001)));
      draw();
    }, {passive: false});
    canvas.addEventListener("keydown", event => {
      const step = .12;
      if (event.key === "ArrowLeft") yaw -= step;
      else if (event.key === "ArrowRight") yaw += step;
      else if (event.key === "ArrowUp") pitch = Math.max(-1.1, pitch - step);
      else if (event.key === "ArrowDown") pitch = Math.min(1.1, pitch + step);
      else if (event.key === "+" || event.key === "=") zoom = Math.min(2.6, zoom * 1.15);
      else if (event.key === "-" || event.key === "_") zoom = Math.max(.55, zoom / 1.15);
      else return;
      event.preventDefault(); draw();
    });
    window.addEventListener("resize", resize);
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(canvas);
    resize(); setPaused(paused);
    return {
      engine: "Canvas2D fallback",
      setPaused,
      isPaused: () => paused,
      geometry: () => data,
      setGeometry(next) {data = next; yaw = -.26; pitch = -.17; zoom = 1; draw();},
      setActivity(next) {trace = next; elapsed = 0; draw();},
      reset() {this.setGeometry(makeSynthetic());},
      resize
    };
  }

  const api = Object.freeze({makeSynthetic, parseSWC, createViewer});
  root.NeuroMorphology = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
