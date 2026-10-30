"use strict";

const token = document.querySelector('meta[name="cortex-session-token"]').content;
const byId = id => document.getElementById(id);
let toastTimer;

async function request(path, options = {}) {
  const init = options.body ? {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-NeuroMemory-Token": token},
    body: JSON.stringify(options.body)
  } : {method: "GET", headers: {"X-NeuroMemory-Token": token}};
  const response = await fetch(path, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function alertLocal(message) {
  const node = byId("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 4200);
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function empty(container, message) {
  container.replaceChildren(element("div", "empty-state", message));
}

function button(label, className, action) {
  const b = element("button", className, label);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}

function shortHash(value) { return value ? `${value.slice(0, 12)}…` : ""; }
function isoDate(value) { return value ? value.replace("T", " ").slice(0, 16) : ""; }

async function updateStats() {
  const stats = await request("/api/stats");
  byId("metric-sources").textContent = stats.active_sources;
  byId("metric-passages").textContent = stats.active_passages;
  byId("metric-pending").textContent = stats.pending_claims;
  byId("nav-pending").textContent = stats.pending_claims;
  const audit = byId("metric-audit");
  audit.textContent = stats.audit_valid ? "完整" : "异常";
  audit.className = `audit-label ${stats.audit_valid ? "passed" : "failed"}`;
}

async function showPassages(source) {
  const payload = await request(`/api/passages?source_id=${encodeURIComponent(source.id)}`);
  const container = byId("search-results");
  if (!payload.items.length) return empty(container, "没有可展示的有效来源片段。")
  renderPassages(payload.items.map(p => ({...p, original_name: source.original_name})), container);
  location.hash = "#recall";
}

function renderPassages(passages, container) {
  container.replaceChildren();
  for (const p of passages) {
    const card = element("article", "result-card");
    const title = element("h4", "", p.original_name || "来源片段");
    const content = element("p", "", p.content);
    const meta = element("div", "result-meta", `原文字符 ${p.start_char}–${p.end_char} · ${p.retrieval_method || "来源原文"}`);
    const actions = element("div", "result-actions");
    actions.append(button("提出记忆候选 +", "small-action", () => proposeDialog(p)));
    card.append(title, content, meta, actions);
    container.append(card);
  }
}

async function updateSources() {
  const payload = await request("/api/sources");
  const list = byId("source-list");
  byId("source-count").textContent = `${payload.items.length} 项`;
  if (!payload.items.length) return empty(list, "还没有导入资料。你的记忆空间目前是空白的。");
  list.replaceChildren();
  for (const source of payload.items) {
    const card = element("article", "source-item");
    const info = element("div", "source-info");
    info.append(element("strong", "", source.original_name));
    info.append(element("small", "", `${source.status === "active" ? "已登记" : "已撤销"} · ${isoDate(source.created_at)} · ${shortHash(source.content_sha256)}`));
    const actions = element("div", "source-item-actions");
    if (source.status === "active") {
      actions.append(button("查看", "small-action", () => showPassages(source).catch(e => alertLocal(e.message))));
      actions.append(button("撤销", "small-action danger", async () => {
        if (!confirm(`撤销「${source.original_name}」的检索权限？\n\n注意：阶段 01 会保留原始归档用于审计，并不是物理删除。`)) return;
        try {
          await request("/api/revoke", {body: {source_id: source.id, consent: true}});
          alertLocal("已撤销：相关片段不再出现在检索结果中。原始归档仍保留。");
          await refresh();
        } catch (e) { alertLocal(`撤销失败：${e.message}`); }
      }));
    }
    card.append(info, actions); list.append(card);
  }
}

function proposeDialog(passage) {
  const dialog = document.createElement("dialog");
  dialog.className = "claim-dialog";
  const heading = element("h2", "", "创建待审核记忆");
  const description = element("p", "", "这是你主动编写的候选陈述，不是从原文自动推断的事实。提交后仍须单独审核。");
  const label = element("label", "", "记忆类型");
  const kind = element("select");
  for (const [value, text] of [["episodic", "情景 / 经历"], ["semantic", "知识 / 事实"], ["procedural", "操作 / 方法"], ["self_model", "偏好 / 自我认识"]]) {
    const opt = element("option", "", text); opt.value = value; kind.append(opt);
  }
  const text = element("textarea");
  text.rows = 5; text.maxLength = 1200; text.placeholder = "例如：该片段明确说明了什么？（不确定时请保留不确定性）";
  const actions = element("div", "dialog-actions");
  actions.append(button("取消", "button button-subtle", () => dialog.close()));
  actions.append(button("存为候选", "button button-primary", async () => {
    if (!text.value.trim()) return alertLocal("请先填写记忆陈述。")
    try {
      await request("/api/propose", {body: {source_id: passage.source_id,
        passage_id: passage.id, statement: text.value.trim(), kind: kind.value}});
      dialog.close();
      alertLocal("候选已记录，等待你审核。")
      await refresh();
    } catch (e) { alertLocal(`提交失败：${e.message}`); }
  }));
  dialog.append(heading, description, label, kind, text, actions);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog); dialog.showModal(); text.focus();
}

async function updateReviews() {
  const payload = await request("/api/claims");
  const list = byId("review-list");
  if (!payload.items.length) return empty(list, "暂时没有待审核的记忆陈述。");
  list.replaceChildren();
  for (const claim of payload.items) {
    const card = element("article", `claim-card ${claim.status}`);
    const head = element("h4");
    head.append(element("span", "", ({episodic: "情景", semantic: "事实", procedural: "方法", self_model: "自我模型"})[claim.kind] || claim.kind));
    const tag = element("span", `status-tag ${claim.status}`,
      ({pending: "待审核", confirmed: "已确认", rejected: "已拒绝"})[claim.status]);
    head.append(tag);
    card.append(head, element("p", "", claim.statement),
      element("div", "result-meta", `来源片段 ${shortHash(claim.passage_id)} · ${isoDate(claim.created_at)}`));
    if (claim.status === "pending") {
      const actions = element("div", "claim-actions");
      for (const [label, decision] of [["确认", "confirmed"], ["拒绝", "rejected"]]) {
        actions.append(button(label, "small-action", async () => {
          if (!confirm(`确定${label}这条个人记忆陈述？`)) return;
          try {
            await request("/api/review", {body: {claim_id: claim.id, decision, consent: true}});
            await refresh(); alertLocal(`已${label}该候选。`);
          } catch(e) { alertLocal(e.message); }
        }));
      }
      card.append(actions);
    }
    list.append(card);
  }
}

function binaryBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    str += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  }
  return btoa(str);
}

byId("source-file").addEventListener("change", event => {
  const file = event.target.files[0];
  byId("selected-filename").textContent = file ? file.name : "选择一份 Markdown 或 TXT 文档";
});

byId("import-form").addEventListener("submit", async event => {
  event.preventDefault();
  const file = byId("source-file").files[0];
  if (!file || !byId("import-consent").checked) return alertLocal("请选择文件并确认授权。")
  if (file.size > 2 * 1024 * 1024) return alertLocal("单个文件不能超过 2 MiB。")
  const submit = document.querySelector(".upload-submit");
  submit.disabled = true; submit.textContent = "正在登记来源…";
  try {
    const content_base64 = binaryBase64(await file.arrayBuffer());
    const result = await request("/api/import", {body: {
      name: file.name, content_base64,
      classification: byId("classification").value, consent: true
    }});
    alertLocal(result.duplicate ? "已有相同内容的有效来源，已跳过重复导入。" : `已导入并登记 ${result.passages} 个来源片段。`);
    byId("import-form").reset();
    byId("selected-filename").textContent = "选择一份 Markdown 或 TXT 文档";
    await refresh();
  } catch (e) { alertLocal(`导入失败：${e.message}`); }
  finally { submit.disabled = false; submit.textContent = "确认导入 →"; }
});

byId("search-form").addEventListener("submit", async event => {
  event.preventDefault();
  const query = byId("search-query").value.trim();
  if (!query) return;
  try {
    const result = await request(`/api/search?q=${encodeURIComponent(query)}`);
    if (!result.items.length) empty(byId("search-results"), "没有找到匹配的原文。请尝试其他线索。");
    else renderPassages(result.items, byId("search-results"));
  } catch (e) { alertLocal(`检索失败：${e.message}`); }
});

async function refresh() { await Promise.all([updateStats(), updateSources(), updateReviews()]); }
refresh().catch(e => alertLocal(`本地服务连接异常：${e.message}`));

// This canvas is a seeded *concept visualization*, not neural recordings.
// No data are fetched from personal memories, remote services or the model.
(function createNeuralField() {
  const canvas = byId("neural-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const wrap = canvas.parentElement;
  const focus = byId("field-focus");
  const pauseButton = byId("field-pause");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let paused = reduceMotion;
  let frame = 0;
  let width = 1;
  let height = 1;
  let selected = -1;
  let activityTime = 0;

  function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let x = state;
      x = Math.imul(x ^ x >>> 15, x | 1);
      x ^= x + Math.imul(x ^ x >>> 7, x | 61);
      return ((x ^ x >>> 14) >>> 0) / 4294967296;
    };
  }
  const rand = randomGenerator(0x1C00C0DE);
  const nodes = [];
  const edges = [];
  const clusters = [
    {x: .49, y: .53, n: 210, sx: .145, sy: .245, group: 0},
    {x: .18, y: .33, n: 23, sx: .042, sy: .09, group: 1},
    {x: .18, y: .78, n: 27, sx: .05, sy: .10, group: 2},
    {x: .75, y: .17, n: 37, sx: .07, sy: .12, group: 3},
    {x: .79, y: .74, n: 25, sx: .052, sy: .085, group: 4},
  ];

  for (const cluster of clusters) {
    const first = nodes.length;
    for (let i = 0; i < cluster.n; i++) {
      const angle = rand() * Math.PI * 2;
      // sqrt samples a uniform disk, with a slight dense central nucleus.
      const radius = Math.pow(rand(), cluster.group === 0 ? .72 : .55);
      nodes.push({
        x: cluster.x + Math.cos(angle) * radius * cluster.sx,
        y: cluster.y + Math.sin(angle) * radius * cluster.sy,
        group: cluster.group,
        tone: rand(), phase: rand() * Math.PI * 2,
        radius: cluster.group === 0 ? 1.2 + rand() * 1.5 : 1 + rand() * 1.2,
      });
    }
    const last = nodes.length;
    for (let i = first + 1; i < last; i++) {
      const nearest = [];
      for (let j = first; j < i; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = (nodes[i].y - nodes[j].y) * .66;
        nearest.push({j, distance: dx * dx + dy * dy});
      }
      nearest.sort((a, b) => a.distance - b.distance);
      const degree = i - first > 3 ? 2 : 1;
      for (const neighbor of nearest.slice(0, degree)) {
        edges.push({a: i, b: neighbor.j, long: false, phase: rand()});
      }
    }
  }
  // A few long-range projections, explicitly illustrative rather than anatomical.
  for (let group = 1; group <= 4; group++) {
    const outer = nodes.map((node, i) => ({node, i})).filter(item => item.node.group === group);
    for (let j = 0; j < 3; j++) {
      const peripheral = outer[Math.floor(rand() * outer.length)].i;
      const central = Math.floor(rand() * clusters[0].n);
      edges.push({a: peripheral, b: central, long: true, phase: rand()});
    }
  }

  function resize() {
    const bounds = wrap.getBoundingClientRect();
    width = Math.max(300, bounds.width);
    height = Math.max(280, canvas.getBoundingClientRect().height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (paused) render();
  }

  function point(node) {
    const drift = paused ? 0 : .0018;
    return {
      x: (node.x + drift * Math.sin(activityTime * .7 + node.phase)) * width,
      y: (node.y + drift * Math.cos(activityTime * .6 + node.phase)) * height,
    };
  }

  function render() {
    ctx.clearRect(0, 0, width, height);
    const positions = nodes.map(point);
    // Quiet concentric fields preserve the airy, scientific illustration style.
    for (const cluster of clusters) {
      ctx.beginPath();
      ctx.ellipse(cluster.x * width, cluster.y * height,
        cluster.sx * width * 1.15, cluster.sy * height * 1.1,
        0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(116, 145, 125, .15)";
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const edge of edges) {
      const a = positions[edge.a];
      const b = positions[edge.b];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = edge.long ? "rgba(104, 158, 164, .17)" : "rgba(93, 133, 137, .18)";
      ctx.lineWidth = edge.long ? .65 : .6;
      ctx.stroke();
    }
    // Sparse activity packets travel along projections; visual only.
    if (!paused) {
      for (let i = 0; i < edges.length; i += 19) {
        const edge = edges[i];
        const a = positions[edge.a], b = positions[edge.b];
        const t = (activityTime * .15 + edge.phase) % 1;
        ctx.beginPath();
        ctx.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 1.35, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(198, 128, 84, .54)";
        ctx.fill();
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i], p = positions[i];
      const emphasized = i === selected;
      const alpha = .50 + .32 * (paused ? .5 : Math.sin(activityTime * 1.1 + node.phase) ** 2);
      const color = node.tone < .14 ? `rgba(196, 135, 73, ${alpha})`
        : node.tone < .66 ? `rgba(123, 164, 107, ${alpha})`
          : `rgba(97, 164, 178, ${alpha})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, emphasized ? 5 : node.radius, 0, Math.PI * 2);
      ctx.fillStyle = emphasized ? "#b55f47" : color; ctx.fill();
      if (emphasized) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(181,95,71,.45)"; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }

  function animate(timestamp) {
    if (paused) { frame = 0; return; }
    activityTime = timestamp / 1000;
    if (!document.hidden) render();
    frame = requestAnimationFrame(animate);
  }

  function setPaused(next) {
    paused = next;
    pauseButton.textContent = paused ? "继续动画" : "暂停动画";
    pauseButton.setAttribute("aria-pressed", String(paused));
    cancelAnimationFrame(frame);
    if (paused) { frame = 0; render(); }
    else frame = requestAnimationFrame(animate);
  }

  pauseButton.addEventListener("click", () => setPaused(!paused));
  canvas.addEventListener("pointermove", e => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    let nearest = -1, dist = 14 * 14;
    for (let i = 0; i < nodes.length; i++) {
      const p = point(nodes[i]);
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < dist) { dist = d; nearest = i; }
    }
    if (selected !== nearest) {
      selected = nearest;
      focus.textContent = nearest < 0 ? "选择节点，观察局部连接"
        : `SYN-${String(nearest + 1).padStart(3, "0")} · 合成单元 · 簇 ${nodes[nearest].group + 1}`;
      if (paused) render();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    selected = -1; focus.textContent = "选择节点，观察局部连接";
    if (paused) render();
  });
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(wrap);
  resize();
  setPaused(paused);

  byId("run-neural-demo").addEventListener("click", async () => {
    const button = byId("run-neural-demo");
    button.disabled = true; button.textContent = "计算中…";
    try {
      const result = await request("/api/neural-demo");
      byId("field-readout").textContent =
        `纯合成数据 · LIF: ${result.lif_spikes} 次发放 / 160 ms · STDP: +${result.stdp_potentiation} / ${result.stdp_depression} · ` +
        `Hopfield: ${result.recovered_bits}/${result.pattern_size} 位恢复 · 能量 ${result.energy_before} → ${result.energy_after}`;
      alertLocal("已完成可复现的神经动力学演示；没有读取你的个人记忆。")
    } catch (e) {
      alertLocal(`神经演示失败：${e.message}`);
    } finally {
      button.disabled = false; button.textContent = "运行神经计算实验 ↗";
    }
  });
})();
