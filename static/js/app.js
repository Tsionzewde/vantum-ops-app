import React, { useState, useRef, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  addEdge,
  updateEdge,
  MarkerType,
  Handle,
  Position,
  useStoreApi,
} from "reactflow";
import htm from "htm";

const html = htm.bind(React.createElement);

/* ---------------- constants ---------------- */
const PHASE_COLORS = ["#059669", "#C97B00", "#3B82F6", "#A855F7", "#14B8A6", "#E0527A"];

const EDGE_OPTS = {
  animated: true,
  style: { stroke: "#059669", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#059669" },
};

const MAX_FILE_BYTES = 1.5 * 1024 * 1024; // per uploaded resource

const EXAMPLE_DESC =
  "I want to build a free “5-Day Email Audit” guide as a lead magnet to grow my newsletter. " +
  "Goal: collect 300 emails in 30 days. I'll write the guide in Google Docs, design it in Canva, " +
  "build a landing page in Carrd, hook up Mailchimp to deliver it, and promote it on LinkedIn for two weeks.";

const PROCESS_PROMPT = (desc) =>
`You are Vantum Ops. I have a new project.
Extract: project name, goal, numbered steps, and resources.
Each step needs: a short title (3-6 words), a one-line detail explaining what exactly happens in that step, and a phase that groups related steps (e.g. "Plan", "Build", "Launch", "Review").
Return ONLY JSON in this exact format, nothing else:
{"name":"","goal":"","steps":[{"title":"","detail":"","phase":""}],"resources":[""]}
My project: ${desc}`;

const CHANGE_PROMPT = (state, change) =>
`You are Vantum Ops. Here is my current project process map as JSON:
${JSON.stringify(state, null, 2)}

Requested change: ${change}

Apply the change and return ONLY the full updated project as JSON in this exact format, nothing else:
{"name":"","goal":"","steps":[{"title":"","detail":"","phase":""}],"resources":[""]}`;

/* ---------------- helpers ---------------- */
let toastEl = null;
let toastTimer = null;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4500);
}

function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch (e) {
    return false;
  }
}

function openClaude(prompt) {
  copyText(prompt);
  const url = "https://claude.ai/new?q=" + encodeURIComponent(prompt);
  if (url.length <= 6000) {
    window.open(url, "_blank", "noopener");
    toast("Opening Claude — prompt also copied to your clipboard.");
  } else {
    window.open("https://claude.ai/new", "_blank", "noopener");
    toast("Prompt copied (it's long) — paste into Claude with Ctrl+V.");
  }
}

function parseClaudeJSON(raw) {
  if (!raw || !raw.trim()) throw new Error("empty");
  let txt = raw.trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(txt.slice(start, end + 1));
}

let SEQ = 0;
const newId = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}-${SEQ++}`;

function normalizeStep(s, i) {
  if (typeof s === "string") return { id: newId("step"), text: s, detail: "", phase: "" };
  return {
    id: newId("step"),
    text: (s && (s.title || s.step || s.text || s.name)) || `Step ${i + 1}`,
    detail: (s && (s.detail || s.description)) || "",
    phase: (s && s.phase) || "",
  };
}

function normalizeResource(r) {
  if (typeof r === "string") return { kind: "text", value: r };
  if (r && r.kind) return r;
  return { kind: "text", value: (r && (r.name || r.value)) || String(r) };
}

function phaseColorMap(steps) {
  const map = {};
  let idx = 0;
  steps.forEach((s) => {
    const ph = (s.phase || "").trim();
    if (ph && !(ph in map)) map[ph] = PHASE_COLORS[idx++ % PHASE_COLORS.length];
  });
  return map;
}

function buildFlowFromSteps(steps) {
  const colors = phaseColorMap(steps);

  // Branch layout: one column per phase; steps flow down a column and
  // branch sideways into the next phase. Without phases, wrap every 4.
  const phaseOf = (s) => (s.phase || "").trim() || "__none__";
  const phaseOrder = [];
  steps.forEach((s) => { const p = phaseOf(s); if (!phaseOrder.includes(p)) phaseOrder.push(p); });

  let columns;
  if (phaseOrder.length > 1) {
    columns = phaseOrder.map((p) => steps.filter((s) => phaseOf(s) === p));
  } else {
    columns = [];
    for (let i = 0; i < steps.length; i += 4) columns.push(steps.slice(i, i + 4));
  }

  const place = {};
  columns.forEach((col, ci) => col.forEach((s, ri) => {
    place[s.id] = { x: 60 + ci * 300, y: 50 + ri * 175, col: ci };
  }));

  const nodes = steps.map((s, i) => ({
    id: s.id,
    type: "vantum",
    data: {
      label: s.text || `Step ${i + 1}`,
      detail: s.detail || "",
      phase: s.phase || "",
      color: colors[(s.phase || "").trim()] || "#059669",
      num: i + 1,
    },
    position: { x: place[s.id].x, y: place[s.id].y },
  }));

  const edges = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i], b = steps[i + 1];
    const sameCol = place[a.id].col === place[b.id].col;
    edges.push({
      id: `e-${a.id}-${b.id}`,
      source: a.id, target: b.id,
      sourceHandle: sameCol ? "out-b" : "out-r",
      targetHandle: sameCol ? "in-t" : "in-l",
      ...EDGE_OPTS,
    });
  }
  return { nodes, edges };
}

/* ---------------- custom node ---------------- */
function VantumNode({ data }) {
  return html`
    <div class="vnode" style=${{ borderTop: `3px solid ${data.color || "#059669"}` }}>
      <${Handle} id="in-t" type="target" position=${Position.Top} />
      <${Handle} id="in-l" type="target" position=${Position.Left} />
      <div class="vnode-head">
        ${data.num != null && html`<span class="vnode-num" style=${{ background: data.color || "#059669" }}>${data.num}</span>`}
        <span class="vnode-title">${data.label}</span>
      </div>
      ${data.detail && html`<div class="vnode-detail">${data.detail}</div>`}
      ${data.phase && html`<div class="vnode-phase" style=${{ color: data.color || "#059669" }}>${data.phase}</div>`}
      <${Handle} id="out-b" type="source" position=${Position.Bottom} />
      <${Handle} id="out-r" type="source" position=${Position.Right} />
    </div>`;
}
const nodeTypes = { vantum: VantumNode };

/* Workaround: this build doesn't auto-measure nodes on mount, which silently
   drops edges (no handle bounds). Force-measure nodes until bounds exist. */
function MeasureFix({ ids }) {
  const store = useStoreApi();
  useEffect(() => {
    if (!ids.length) return;
    let tries = 0;
    let timer = null;
    const tick = () => {
      const s = store.getState();
      const updates = ids
        .map((id) => ({
          id,
          nodeElement: (s.domNode || document).querySelector(`.react-flow__node[data-id="${id}"]`),
          forceUpdate: true,
        }))
        .filter((u) => u.nodeElement);
      if (updates.length) s.updateNodeDimensions(updates);
      const first = s.nodeInternals.get(ids[0]);
      const sym = first ? Object.getOwnPropertySymbols(first)[0] : null;
      const measured = first && sym && first[sym] && first[sym].handleBounds;
      if (!measured && tries++ < 12) timer = setTimeout(tick, 120);
    };
    timer = setTimeout(tick, 80);
    return () => clearTimeout(timer);
  }, [ids.join("|")]);
  return null;
}

/* ---------------- App ---------------- */
function App() {
  const [desc, setDesc] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [rawJson, setRawJson] = useState("");

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState([]); // [{id, text, detail, phase}]
  const [resources, setResources] = useState([]); // [{kind:'text'|'file', ...}]

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [status, setStatus] = useState("Active");
  const [changeText, setChangeText] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const edgeUpdateOk = useRef(true);
  const fileInputRef = useRef(null);
  const locked = status === "Approved";
  const hasContent = Boolean(name || steps.length || nodes.length);

  /* ----- load an archived project for editing (?edit=<id>) ----- */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("edit");
    if (!id) return;
    fetch("/api/projects/" + id)
      .then((r) => r.json())
      .then((p) => {
        if (!p || p.error) { toast("Couldn't load that project."); return; }
        setEditingId(p.id);
        setName(p.name || "");
        setGoal(p.goal || "");
        const ns = (Array.isArray(p.steps) ? p.steps : []).map(normalizeStep);
        const savedNodes = (p.map_data && Array.isArray(p.map_data.nodes)) ? p.map_data.nodes : [];
        if (savedNodes.length && savedNodes.length === ns.length) {
          // adopt saved node ids so inline step edits stay linked to the map
          const ordered = [...savedNodes].sort((a, b) => ((a.data && a.data.num) || 0) - ((b.data && b.data.num) || 0));
          ordered.forEach((n, i) => { if (ns[i]) ns[i].id = n.id; });
          setNodes(savedNodes);
          setEdges((p.map_data && p.map_data.edges) || []);
        } else {
          const flow = buildFlowFromSteps(ns);
          setNodes(flow.nodes);
          setEdges(flow.edges);
        }
        setSteps(ns);
        setResources((Array.isArray(p.resources) ? p.resources : []).map(normalizeResource));
        setStatus("Active");
        toast("Editing saved project — Approve & Save updates the archive copy.");
      })
      .catch(() => toast("Couldn't load that project."));
  }, []);

  /* ----- Claude: process description ----- */
  function processWithClaude() {
    if (!desc.trim()) { toast("Describe your project first — open the guide if you're unsure."); return; }
    openClaude(PROCESS_PROMPT(desc.trim()));
  }

  /* ----- apply pasted JSON ----- */
  function applyJson() {
    let data;
    try {
      data = parseClaudeJSON(rawJson);
    } catch (e) {
      toast("Could not read JSON — paste the full {…} block Claude returned.");
      return;
    }
    setName(data.name || "");
    setGoal(data.goal || "");
    const newSteps = (Array.isArray(data.steps) ? data.steps : []).map(normalizeStep);
    setSteps(newSteps);
    setResources((Array.isArray(data.resources) ? data.resources : []).map(normalizeResource));
    const flow = buildFlowFromSteps(newSteps);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setStatus("Active");
    setSavedId(null);
    setPasteOpen(false);
    setRawJson("");
    toast("Project loaded from Claude output.");
  }

  /* ----- steps ----- */
  function patchStep(id, patch) {
    setSteps((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setNodes((ns) => ns.map((n) => {
      if (n.id !== id) return n;
      const d = { ...n.data };
      if ("text" in patch) d.label = patch.text;
      if ("detail" in patch) d.detail = patch.detail;
      if ("phase" in patch) d.phase = patch.phase;
      return { ...n, data: d };
    }));
  }
  function addStep() {
    const id = newId("step");
    setSteps((arr) => {
      const prev = arr[arr.length - 1];
      if (prev) {
        setEdges((es) => addEdge({ id: `e-${prev.id}-${id}`, source: prev.id, target: id, ...EDGE_OPTS }, es));
      }
      return [...arr, { id, text: "", detail: "", phase: "" }];
    });
    setNodes((ns) => ns.concat({
      id, type: "vantum",
      data: { label: "New step", detail: "", phase: "", color: "#059669", num: ns.length + 1 },
      position: { x: 140, y: 50 + ns.length * 150 },
    }));
  }
  function removeStep(id) {
    setSteps((arr) => arr.filter((s) => s.id !== id));
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }
  function rebuildMap() {
    const flow = buildFlowFromSteps(steps);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    toast("Map rebuilt from the written steps.");
  }

  /* ----- resources ----- */
  const addTextResource = () => setResources((a) => [...a, { kind: "text", value: "" }]);
  const patchResource = (i, v) => setResources((a) => a.map((r, idx) => (idx === i ? { ...r, value: v } : r)));
  const removeResource = (i) => setResources((a) => a.filter((_, idx) => idx !== i));

  function onFilePicked(e) {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      if (file.size > MAX_FILE_BYTES) {
        toast(`"${file.name}" is too big — keep uploads under 1.5 MB each.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setResources((a) => [...a, { kind: "file", name: file.name, size: file.size, dataUrl: reader.result }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }

  function openResourceFile(r) {
    try {
      const parts = r.dataUrl.split(",");
      const mime = ((parts[0].match(/:(.*?);/)) || [])[1] || "application/octet-stream";
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8 = new Uint8Array(n);
      while (n--) u8[n] = bstr.charCodeAt(n);
      const url = URL.createObjectURL(new Blob([u8], { type: mime }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast("Couldn't open that file."); }
  }

  const fmtSize = (b) => (b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB");

  /* ----- flow editing ----- */
  const onConnect = useCallback((params) => setEdges((eds) => addEdge({ ...params, ...EDGE_OPTS }, eds)), [setEdges]);
  const onEdgeUpdateStart = useCallback(() => { edgeUpdateOk.current = false; }, []);
  const onEdgeUpdate = useCallback((oldEdge, conn) => {
    edgeUpdateOk.current = true;
    setEdges((els) => updateEdge(oldEdge, conn, els));
  }, [setEdges]);
  const onEdgeUpdateEnd = useCallback((_, edge) => {
    if (!edgeUpdateOk.current) setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    edgeUpdateOk.current = true;
  }, [setEdges]);

  function addNode() {
    const id = newId("node");
    setNodes((ns) => ns.concat({
      id, type: "vantum",
      data: { label: "New box", detail: "", phase: "", color: "#059669", num: null },
      position: { x: 420, y: 80 + (ns.length % 6) * 80 },
    }));
  }

  /* ----- Claude: change the map ----- */
  function changeWithClaude() {
    if (!changeText.trim()) { toast("Type what you'd like Claude to change."); return; }
    const state = {
      name, goal,
      steps: steps.map((s) => ({ title: s.text, detail: s.detail, phase: s.phase })),
      resources: resources.map((r) => (r.kind === "file" ? r.name + " (uploaded file)" : r.value)),
      map: {
        nodes: nodes.map((n) => ({ id: n.id, label: n.data.label, position: n.position })),
        edges: edges.map((e) => ({ source: e.source, target: e.target })),
      },
    };
    openClaude(CHANGE_PROMPT(state, changeText.trim()));
  }

  /* ----- approve & save ----- */
  async function approveSave() {
    if (!name.trim()) { toast("Add a project name before saving."); return; }
    setSaving(true);
    const payload = {
      name, goal,
      steps: steps.map((s) => ({ title: s.text, detail: s.detail, phase: s.phase })),
      resources,
      map_data: { nodes, edges },
      status: "Approved",
    };
    try {
      const res = await fetch(editingId ? "/api/projects/" + editingId : "/api/projects", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("save failed");
      const saved = await res.json();
      setSavedId(saved.id);
      setEditingId(saved.id);
      setStatus("Approved");
      toast(editingId ? "Updated & saved to the archive." : "Approved & saved. This project is now locked.");
    } catch (e) {
      toast("Save failed — check the server / Supabase connection.");
    } finally {
      setSaving(false);
    }
  }

  /* ---------------- render ---------------- */
  return html`
    <div class="layout">
      <!-- LEFT -->
      <div class=${"panel left" + (panelOpen ? "" : " collapsed")}>
        <div class="card">
          <div class="field">
            <label>Describe your project</label>
            <textarea
              placeholder="Describe your project... what it is, the goal, the main steps, and the tools you'll use."
              value=${desc}
              disabled=${locked}
              onInput=${(e) => setDesc(e.target.value)}
              rows="4"></textarea>
          </div>

          <div class="guide ${guideOpen ? "open" : ""}">
            <button type="button" class="guide-toggle" onClick=${() => setGuideOpen(!guideOpen)}>
              💡 How to describe your project ${guideOpen ? "▴" : "▾"}
            </button>
            ${guideOpen && html`
              <div class="guide-body">
                <div class="muted" style=${{ marginBottom: "8px" }}>The more of these you include, the better the breakdown:</div>
                <ul>
                  <li><strong>What it is</strong> — “a lead magnet PDF”, “a 5-email welcome sequence”…</li>
                  <li><strong>The goal, with a number</strong> — “collect 300 emails in 30 days”</li>
                  <li><strong>The main actions in order</strong> — write → design → build page → connect email → promote</li>
                  <li><strong>Tools you'll use</strong> — Canva, Mailchimp, Carrd, LinkedIn…</li>
                  <li><strong>Timeline or deadline</strong> — “launch in two weeks”</li>
                </ul>
                <button type="button" class="btn-ghost btn-small" onClick=${() => { setDesc(EXAMPLE_DESC); setGuideOpen(false); }}>Insert example</button>
              </div>`}
          </div>

          <div class="row" style=${{ marginTop: "12px" }}>
            <button class="btn-primary" disabled=${locked} onClick=${processWithClaude}>Process with Claude</button>
            <button class="btn-ghost" disabled=${locked} onClick=${() => setPasteOpen(true)}>Paste Claude Output</button>
          </div>
        </div>

        ${hasContent && html`
          <div class="card">
            <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span class="panel-title" style=${{ margin: 0 }}>Project details</span>
              <span class=${"badge " + (locked ? "approved" : "active")}>${status}</span>
            </div>
            <div class="field">
              <label>Project name</label>
              <input value=${name} disabled=${locked} onInput=${(e) => setName(e.target.value)} placeholder="Project name" />
            </div>
            <div class="field">
              <label>Goal</label>
              <textarea value=${goal} disabled=${locked} onInput=${(e) => setGoal(e.target.value)} rows="2" placeholder="What is the goal?"></textarea>
            </div>
          </div>

          <div class="card">
            <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span class="panel-title" style=${{ margin: 0 }}>Written process</span>
              ${!locked && html`<button class="btn-ghost btn-small" onClick=${rebuildMap}>Rebuild map</button>`}
            </div>
            ${steps.length === 0 && html`<div class="muted">No steps yet.</div>`}
            ${steps.map((s, i) => html`
              <div class="step-block" key=${s.id}>
                <div class="step-row">
                  <span class="step-num">${i + 1}</span>
                  <input class="step-title" value=${s.text} disabled=${locked} onInput=${(e) => patchStep(s.id, { text: e.target.value })} placeholder=${"Step " + (i + 1)} />
                  ${!locked && html`<button class="x" onClick=${() => removeStep(s.id)}>✕</button>`}
                </div>
                <div class="step-sub">
                  <input class="step-detail" value=${s.detail} disabled=${locked} onInput=${(e) => patchStep(s.id, { detail: e.target.value })} placeholder="Detail — what exactly happens here?" />
                  <input class="step-phase" value=${s.phase} disabled=${locked} onInput=${(e) => patchStep(s.id, { phase: e.target.value })} placeholder="Phase" />
                </div>
              </div>
            `)}
            ${!locked && html`<button class="btn-ghost btn-small" style=${{ marginTop: "8px" }} onClick=${addStep}>+ Add step</button>`}
          </div>

          <div class="card">
            <span class="panel-title">Resources</span>
            ${resources.length === 0 && html`<div class="muted">No resources yet — add tools/links or upload files.</div>`}
            ${resources.map((r, i) => r.kind === "file"
              ? html`
                <div class="res-file" key=${"r" + i}>
                  <svg class="res-icon" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
                  <span class="res-name">${r.name}</span>
                  <span class="res-size">${fmtSize(r.size || 0)}</span>
                  <button type="button" class="mini" onClick=${() => openResourceFile(r)}>Open</button>
                  ${!locked && html`<button type="button" class="mini x2" onClick=${() => removeResource(i)}>Remove</button>`}
                </div>`
              : html`
                <div class="step-row" key=${"r" + i}>
                  <input value=${r.value} disabled=${locked} onInput=${(e) => patchResource(i, e.target.value)} placeholder="Tool, link or resource" />
                  ${!locked && html`<button class="x" onClick=${() => removeResource(i)}>✕</button>`}
                </div>`)}
            ${!locked && html`
              <div class="row" style=${{ marginTop: "10px" }}>
                <button class="btn-ghost btn-small" onClick=${addTextResource}>+ Add link / tool</button>
                <button class="btn-ghost btn-small" onClick=${() => fileInputRef.current && fileInputRef.current.click()}>⬆ Upload file</button>
              </div>
              <input type="file" multiple style=${{ display: "none" }} ref=${fileInputRef} onChange=${onFilePicked} />
              <div class="muted" style=${{ marginTop: "8px" }}>Files up to 1.5 MB each — PDFs, docs, images.</div>`}
          </div>

          <div class="card" style=${{ display: "flex", gap: "10px", alignItems: "center" }}>
            ${locked
              ? html`<div style=${{ flex: 1, display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style=${{ flex: 1 }}>
                    <strong style=${{ color: "#34d399" }}>Approved & locked.</strong>
                    ${savedId && html` <a href="/archive" style=${{ color: "#6ba4ff" }}>View in archive →</a>`}
                  </div>
                  <button class="btn-ghost btn-small" onClick=${() => setStatus("Active")}>Edit again</button>
                </div>`
              : html`<button class="btn-primary" style=${{ flex: 1 }} disabled=${saving} onClick=${approveSave}>
                  ${saving ? "Saving…" : "Approve & Save"}
                </button>`}
          </div>
        `}
      </div>

      <!-- RIGHT -->
      <div class="panel right">
        <div class="flow-wrap">
          <button class="btn-ghost btn-small panel-toggle" title=${panelOpen ? "Hide the details panel" : "Show the details panel"}
            onClick=${() => setPanelOpen(!panelOpen)}>
            ${panelOpen ? "⮜ Hide panel" : "⮞ Show panel"}
          </button>
          ${nodes.length === 0 && html`
            <div class="empty-canvas">
              <div>
                <h3>Visual process map</h3>
                <div>Process a project with Claude and paste the JSON<br/>to generate your draggable map.</div>
              </div>
            </div>`}
          ${!locked && nodes.length > 0 && html`
            <div class="flow-toolbar">
              <button class="btn-ghost btn-small" onClick=${addNode}>+ Add box</button>
              <span class="muted" style=${{ alignSelf: "center" }}>Drag boxes · connect dots · select + Delete to remove</span>
            </div>`}
          <${ReactFlow}
            nodes=${nodes}
            edges=${edges}
            nodeTypes=${nodeTypes}
            onNodesChange=${locked ? undefined : onNodesChange}
            onEdgesChange=${locked ? undefined : onEdgesChange}
            onConnect=${locked ? undefined : onConnect}
            onEdgeUpdate=${locked ? undefined : onEdgeUpdate}
            onEdgeUpdateStart=${locked ? undefined : onEdgeUpdateStart}
            onEdgeUpdateEnd=${locked ? undefined : onEdgeUpdateEnd}
            nodesDraggable=${!locked}
            nodesConnectable=${!locked}
            elementsSelectable=${!locked}
            deleteKeyCode=${locked ? null : ["Backspace", "Delete"]}
            defaultEdgeOptions=${EDGE_OPTS}
            fitView
            proOptions=${{ hideAttribution: true }}>
            <${MeasureFix} ids=${nodes.map((n) => n.id)} />
            <${Background} color="#1B2C45" gap=${22} />
            <${Controls} showInteractive=${false} />
            <${MiniMap} pannable zoomable
              style=${{ background: "#0A1626", border: "1px solid #1B2C45" }}
              nodeColor=${(n) => (n.data && n.data.color) || "#059669"} maskColor="rgba(3,10,23,0.6)" />
          <//>
        </div>

        <div class="flow-bar">
          <input
            placeholder="Tell Claude what to change..."
            value=${changeText}
            disabled=${locked}
            onInput=${(e) => setChangeText(e.target.value)}
            onKeyDown=${(e) => { if (e.key === "Enter") changeWithClaude(); }} />
          <button class="btn-ochre" disabled=${locked} onClick=${changeWithClaude}>Ask Claude to change</button>
        </div>
      </div>

      <!-- paste modal -->
      <div class=${"overlay" + (pasteOpen ? " open" : "")} onClick=${(e) => { if (e.target === e.currentTarget) setPasteOpen(false); }}>
        <div class="modal">
          <h2>Paste Claude Output</h2>
          <p class="modal-sub">Paste the JSON Claude returned. The app extracts the {…} block automatically.</p>
          <div class="field">
            <textarea rows="12" placeholder=${'{\n  "name": "...",\n  "goal": "...",\n  "steps": [{"title": "...", "detail": "...", "phase": "..."}],\n  "resources": ["..."]\n}'}
              value=${rawJson} onInput=${(e) => setRawJson(e.target.value)}></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn-ghost" onClick=${() => setPasteOpen(false)}>Cancel</button>
            <button class="btn-primary" onClick=${applyJson}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* mount */
createRoot(document.getElementById("root")).render(
  html`<${ReactFlowProvider}><${App} /><//>`
);

/* storage badge */
fetch("/api/config").then((r) => r.json()).then((c) => {
  const el = document.getElementById("storeTag");
  if (el) el.textContent = c.storage === "supabase" ? "Supabase" : "Local store";
}).catch(() => {});
