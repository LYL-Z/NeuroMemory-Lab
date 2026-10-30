"use strict";

// GPU morphology renderer. The mesh is an approximation of SWC centre-lines
// and sample radii, NOT a photomicrograph or a compartmental cable model.
(function (root) {
  function makeTubeMesh(sides = 10) {
    if (!Number.isInteger(sides) || sides < 3 || sides > 64) throw new Error("Invalid tube tessellation");
    const result = [];
    for (let i = 0; i < sides; i++) {
      const a = i * Math.PI * 2 / sides;
      const b = (i + 1) * Math.PI * 2 / sides;
      const p = (angle, t) => [Math.cos(angle), Math.sin(angle), t,
        Math.cos(angle), Math.sin(angle), 0];
      result.push(...p(a, 0), ...p(b, 0), ...p(b, 1),
        ...p(a, 0), ...p(b, 1), ...p(a, 1));
    }
    return new Float32Array(result);
  }

  function makeSphereMesh(latitudes = 10, longitudes = 16) {
    const result = [];
    const vertex = (theta, phi) => {
      const v = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      return [...v, ...v];
    };
    for (let j = 0; j < latitudes; j++) {
      const t0 = Math.PI * j / latitudes, t1 = Math.PI * (j + 1) / latitudes;
      for (let i = 0; i < longitudes; i++) {
        const p0 = 2 * Math.PI * i / longitudes, p1 = 2 * Math.PI * (i + 1) / longitudes;
        result.push(...vertex(t0, p0), ...vertex(t1, p0), ...vertex(t1, p1),
          ...vertex(t0, p0), ...vertex(t1, p1), ...vertex(t0, p1));
      }
    }
    return new Float32Array(result);
  }

  function buildInstances(geometry) {
    if (!geometry || !Array.isArray(geometry.segments) || !Array.isArray(geometry.somas)) {
      throw new Error("Missing neuronal geometry");
    }
    const segments = [];
    const somas = [];
    for (const s of geometry.segments) {
      if (![...s.a, ...s.b, s.r0, s.r1].every(Number.isFinite) ||
          s.r0 <= 0 || s.r1 <= 0) throw new Error("Invalid SWC segment geometry");
      // Zero-length segments cannot form a stable local tube basis.
      if (Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]) <= 1e-9) continue;
      segments.push(...s.a, ...s.b, s.r0, s.r1, s.type || 3);
    }
    for (const s of geometry.somas) {
      if (![...s.at, s.r].every(Number.isFinite) || s.r <= 0) throw new Error("Invalid SWC soma geometry");
      somas.push(...s.at, ...s.at, s.r, s.r, 1);
    }
    return {segments: new Float32Array(segments), somas: new Float32Array(somas),
      segmentCount: segments.length / 9, somaCount: somas.length / 9};
  }

  // Standalone function, also useful for unit tests and Canvas 2D fallback.
  function sampleTrace(trace, milliseconds) {
    if (!trace || !Array.isArray(trace.times_ms) || !Array.isArray(trace.voltage_mv) ||
        trace.times_ms.length !== trace.voltage_mv.length || !trace.times_ms.length) return null;
    const times = trace.times_ms, volts = trace.voltage_mv;
    if (!Number.isFinite(milliseconds)) return null;
    const length = times[times.length - 1];
    if (!Number.isFinite(length) || length <= 0) return null;
    const t = ((milliseconds % length) + length) % length;
    let lo = 0, hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const next = Math.min(lo + 1, times.length - 1);
    const span = times[next] - times[lo];
    const fraction = span > 0 ? (t - times[lo]) / span : 0;
    return volts[lo] + (volts[next] - volts[lo]) * fraction;
  }

  const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aStart;
layout(location=3) in vec3 aEnd;
layout(location=4) in vec2 aRadii;
layout(location=5) in float aType;
uniform vec2 uViewport;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;
uniform float uSphere;
out vec3 vNormal;
out float vDepth;
out float vType;
void main() {
  vec3 direction = aEnd - aStart;
  float segmentLength = length(direction);
  vec3 axis = segmentLength > 0.000001 ? direction / segmentLength : vec3(0.0,1.0,0.0);
  vec3 guide = abs(axis.y) < 0.9 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 bx = normalize(cross(axis,guide));
  vec3 by = normalize(cross(axis,bx));
  vec3 p;
  vec3 n;
  if (uSphere > 0.5) {
    p = aStart + aPosition * aRadii.x;
    n = aNormal;
  } else {
    vec3 radial = bx*aPosition.x + by*aPosition.y;
    p = mix(aStart,aEnd,aPosition.z) + radial * mix(aRadii.x,aRadii.y,aPosition.z);
    n = normalize(bx*aNormal.x + by*aNormal.y);
  }
  float cy=cos(uYaw), sy=sin(uYaw), cp=cos(uPitch), sp=sin(uPitch);
  vec3 rotated = vec3(p.x*cy+p.z*sy, p.y, -p.x*sy+p.z*cy);
  vec3 view = vec3(rotated.x,rotated.y*cp-rotated.z*sp,rotated.y*sp+rotated.z*cp);
  vec3 nr = vec3(n.x*cy+n.z*sy,n.y,-n.x*sy+n.z*cy);
  vNormal = normalize(vec3(nr.x,nr.y*cp-nr.z*sp,nr.y*sp+nr.z*cp));
  float lens=5.6/max(2.8,5.6-view.z);
  float pixels=min(uViewport.x*0.27,uViewport.y*0.34)*uZoom;
  gl_Position = vec4(view.x*pixels*lens*2.0/uViewport.x,
                     view.y*pixels*lens*2.0/uViewport.y, -view.z/10.0, 1.0);
  vDepth = view.z;
  vType = aType;
}`;

  const fragmentSource = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vDepth;
in float vType;
uniform float uActivity;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(-0.42,0.67,0.62));
  float diffuse = max(dot(n,light),0.0);
  float rim = pow(1.0-max(dot(n,vec3(0.0,0.0,1.0)),0.0),2.7);
  float spec = pow(max(dot(reflect(-light,n),vec3(0.0,0.0,1.0)),0.0),22.0);
  float soma = step(0.5,1.5-vType);
  float activity = soma*uActivity;
  float shade = clamp(0.18+0.39*diffuse+0.11*rim+0.28*spec+activity*0.35,0.0,0.95);
  // One achromatic palette: grayscale graphite with true 3D surface shading.
  vec3 pigment = vec3(shade);
  float fog = clamp((-vDepth-1.1)/5.5,0.0,0.6);
  outColor = vec4(mix(pigment,vec3(0.96),fog),1.0);
}`;

  function compile(gl, kind, source) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`WebGL shader failed: ${reason}`);
    }
    return shader;
  }

  function createViewer(canvas, initialGeometry, options = {}) {
    const gl = canvas.getContext("webgl2", {alpha: false, antialias: true, powerPreference: "high-performance"});
    if (!gl) return null;
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const uniforms = Object.fromEntries(["uViewport", "uYaw", "uPitch", "uZoom", "uSphere", "uActivity"]
      .map(key => [key, gl.getUniformLocation(program, key)]));
    function mesh(vertices, instances) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      for (const [index, offset] of [[0, 0], [1, 12]]) {
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index, 3, gl.FLOAT, false, 24, offset);
      }
      const instanceBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      for (const [index, size, offset] of [[2,3,0],[3,3,12],[4,2,24],[5,1,32]]) {
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index, size, gl.FLOAT, false, 36, offset);
        gl.vertexAttribDivisor(index, 1);
      }
      gl.bindVertexArray(null);
      return {vao, instanceBuffer, vertexCount: vertices.length / 6, count: 0};
    }
    const tubes = mesh(makeTubeMesh(), null);
    const spheres = mesh(makeSphereMesh(), null);
    let data = initialGeometry;
    let yaw = -.26, pitch = -.17, zoom = 1;
    let width = 500, height = 500, paused = !!options.reduceMotion;
    let frame = 0, lastTime = 0, elapsed = 0, trace = null;
    let dragging = null;
    function upload(target, values, count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, target.instanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
      target.count = count;
    }
    function setGeometry(next) {
      const instances = buildInstances(next);
      upload(tubes, instances.segments, instances.segmentCount);
      upload(spheres, instances.somas, instances.somaCount);
      data = next;
      yaw = -.26; pitch = -.17; zoom = 1;
      draw();
    }
    function draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(.971, .976, .968, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      gl.useProgram(program);
      gl.uniform2f(uniforms.uViewport, width, height);
      gl.uniform1f(uniforms.uYaw, yaw);
      gl.uniform1f(uniforms.uPitch, pitch);
      gl.uniform1f(uniforms.uZoom, zoom);
      const voltage = sampleTrace(trace, elapsed * 90);
      // 0..1 is a display encoding of simulated voltage, not measured activity.
      gl.uniform1f(uniforms.uActivity, voltage == null ? 0 : Math.max(0, Math.min(1, (voltage + 65) / 18)));
      for (const [target, sphere] of [[tubes, 0], [spheres, 1]]) {
        if (!target.count) continue;
        gl.uniform1f(uniforms.uSphere, sphere);
        gl.bindVertexArray(target.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, target.vertexCount, target.count);
      }
      gl.bindVertexArray(null);
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(280, rect.width);
      height = Math.max(260, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw();
    }
    function tick(timestamp) {
      if (paused) {frame=0; return;}
      const dt = lastTime ? Math.min(.05,(timestamp-lastTime)/1000) : 0;
      lastTime=timestamp;
      if (!document.hidden) {
        elapsed+=dt;
        if (!dragging) yaw+=dt*.043;
        draw();
      }
      frame=requestAnimationFrame(tick);
    }
    function setPaused(next) {
      paused=!!next;
      cancelAnimationFrame(frame);
      frame=0;lastTime=0;
      if (paused) draw();
      else frame=requestAnimationFrame(tick);
    }
    canvas.addEventListener("pointerdown", event => {
      dragging={id:event.pointerId,x:event.clientX,y:event.clientY};
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", event => {
      if (!dragging || dragging.id!==event.pointerId) return;
      yaw+=(event.clientX-dragging.x)*.007;
      pitch=Math.max(-1.1,Math.min(1.1,pitch+(event.clientY-dragging.y)*.007));
      dragging.x=event.clientX;dragging.y=event.clientY;draw();
    });
    const stopDrag=()=>{dragging=null;canvas.classList.remove("is-dragging");};
    ["pointerup","pointercancel","lostpointercapture"].forEach(name=>canvas.addEventListener(name,stopDrag));
    canvas.addEventListener("wheel",event=>{
      event.preventDefault();zoom=Math.max(.55,Math.min(2.6,zoom*Math.exp(-event.deltaY*.001)));draw();
    },{passive:false});
    canvas.addEventListener("keydown",event=>{
      if (event.key==="ArrowLeft") yaw-=.12;
      else if (event.key==="ArrowRight") yaw+=.12;
      else if (event.key==="ArrowUp") pitch=Math.max(-1.1,pitch-.12);
      else if (event.key==="ArrowDown") pitch=Math.min(1.1,pitch+.12);
      else if (event.key==="+"||event.key==="=") zoom=Math.min(2.6,zoom*1.15);
      else if (event.key==="-"||event.key==="_") zoom=Math.max(.55,zoom/1.15);
      else return;
      event.preventDefault();draw();
    });
    window.addEventListener("resize",resize);
    if (typeof ResizeObserver!=="undefined") new ResizeObserver(resize).observe(canvas);
    setGeometry(initialGeometry);
    resize();setPaused(paused);
    return {engine:"WebGL2",setPaused,isPaused:()=>paused,geometry:()=>data,setGeometry,
      setActivity(next) {trace=next;elapsed=0;draw();},
      reset() {this.setGeometry(root.NeuroMorphology.makeSynthetic());},resize};
  }

  const api=Object.freeze({makeTubeMesh,makeSphereMesh,buildInstances,sampleTrace,createViewer});
  root.NeuroMorphologyWebGL=api;
  if (typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
