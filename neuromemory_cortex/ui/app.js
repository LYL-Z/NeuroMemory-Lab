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

// Morphological renderer is separate from the provenance-controlled memory vault.
// The synthetic scene and SWC file picker never send geometry over the network.
(function startMorphology() {
  const canvas = byId("neural-canvas");
  const focus = byId("field-focus");
  const pauseButton = byId("field-pause");
  const fileInput = byId("swc-picker");
  const resetButton = byId("morph-reset");
  const sourceNote = byId("morph-source");
  const counter = byId("morph-count");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let viewer;
  try {
    viewer = window.NeuroMorphology.createViewer(canvas, {reduceMotion: prefersReducedMotion});
  } catch (error) {
    focus.textContent = `无法初始化形态视图：${error.message}`;
    return;
  }

  function setPaused(next) {
    viewer.setPaused(next);
    pauseButton.textContent = next ? "继续旋转" : "暂停旋转";
    pauseButton.setAttribute("aria-pressed", String(next));
  }

  function updateDescription(geometry) {
    counter.textContent = `${geometry.count.toLocaleString("zh-CN")} 个形态采样节点 · ${geometry.unitLabel}`;
    sourceNote.textContent = geometry.label + " · 非真实脑成像";
    focus.textContent = "拖动旋转 · 滚轮缩放 · 方向键调整";
  }

  updateDescription(viewer.geometry());
  setPaused(prefersReducedMotion);
  pauseButton.addEventListener("click", () => setPaused(!viewer.isPaused()));
  fileInput.addEventListener("change", async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("文件超过 5 MiB 上限。");
      const geometry = window.NeuroMorphology.parseSWC(await file.text());
      viewer.setGeometry(geometry);
      updateDescription(geometry);
      sourceNote.textContent = `本地 SWC：${file.name} · 未核验来源或物种 · 未上传`;
      resetButton.hidden = false;
      alertLocal("SWC 形态已在浏览器内加载；请自行核实物种、样本、作者和来源。");
    } catch (error) {
      alertLocal(`SWC 解析失败：${error.message}`);
    } finally {
      fileInput.value = "";
    }
  });
  resetButton.addEventListener("click", () => {
    viewer.reset();
    updateDescription(viewer.geometry());
    resetButton.hidden = true;
  });

  byId("run-neural-demo").addEventListener("click", async () => {
    const trigger = byId("run-neural-demo");
    trigger.disabled = true;
    trigger.textContent = "计算中…";
    try {
      const result = await request("/api/neural-demo");
      byId("field-readout").textContent =
        `纯合成实验 · LIF: ${result.lif_spikes} 次发放 / 160 ms · STDP: +${result.stdp_potentiation} / ${result.stdp_depression} · ` +
        `Hopfield: ${result.recovered_bits}/${result.pattern_size} 位恢复 · 能量 ${result.energy_before} → ${result.energy_after}`;
      alertLocal("合成神经计算完成；不涉及任何个人记忆，也不代表画面中的细胞在发放。");
    } catch (error) {
      alertLocal(`神经演示失败：${error.message}`);
    } finally {
      trigger.disabled = false;
      trigger.textContent = "运行神经计算实验 ↗";
    }
  });
})();

(function trackNavigation() {
  const links = [...document.querySelectorAll(".main-nav .nav-item")];
  function update() {
    const section = location.hash || "#home";
    links.forEach(link => link.classList.toggle("active", link.getAttribute("href") === section));
  }
  window.addEventListener("hashchange", update);
  update();
})();
