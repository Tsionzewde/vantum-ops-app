import React, { useState, useRef, useCallback, useEffect, useContext } from "react";
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
  useUpdateNodeInternals,
} from "reactflow";
import htm from "htm";

const html = htm.bind(React.createElement);

/* ---------------- constants ---------------- */
const PHASE_COLORS = ["#059669", "#C97B00", "#3B82F6", "#A855F7", "#14B8A6", "#E0527A"];

const EDGE_OPTS = {
  animated: false,
  style: { stroke: "#059669", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#059669" },
};

const MAX_FILE_BYTES = 1.5 * 1024 * 1024; // per uploaded resource

const EXAMPLE_DESC =
  "I want to build a free “5-Day Email Audit” guide as a lead magnet to grow my newsletter. " +
  "Goal: collect 300 emails in 30 days. I'll write the guide in Google Docs, design it in Canva, " +
  "build a landing page in Carrd, hook up Mailchimp to deliver it, and promote it on LinkedIn for two weeks.";

const SCHEMA = `{"name":"","goal":"","steps":[{"id":"s1","title":"","detail":"","phase":"","depends_on":[]}],"resources":[""]}`;
const SCHEMA_RULES = `Each step has an id (s1, s2…), a short title (3-6 words), a one-line detail, a phase (e.g. "Plan", "Build", "Launch", "Review"), and depends_on (list of step ids it follows — empty for the first). Use depends_on to show branching.`;

// ① Idea → confirm, ask questions, then deep-reasoned plan
const IDEA_PROMPT = (idea) =>
`You are Vantum Ops. I'm planning a new project. My idea:
${idea}

1. First, briefly say back your understanding of what I'm building and confirm it's right. Wait for my yes.
2. Then ask me up to 5 clarifying questions to fill the gaps (goal/number, constraints, tools, deadline, what "done" means). Wait for my answers.
3. Then think from first principles and work out the BEST path — logical order, which steps are parallel vs dependent, likely blockers, and a better way if one exists — and output ONLY this JSON, nothing else:
${SCHEMA}
${SCHEMA_RULES}`;

// ② From a call → pull my assigned task from Fathom
const CALL_PROMPT = (ref) =>
`You are Vantum Ops. Using my connected Fathom, pull ${ref && ref.trim() ? ref.trim() : "my most recent meeting"} that I (Tsion) attended.
Several people talk in it; find the task that was assigned to ME — what I'm responsible for building.
1. First tell me the task/project you found and confirm it's the right one. Wait for my yes.
2. Then ask up to 5 clarifying questions about anything missing or ambiguous. Wait for my answers.
3. Then combine the transcript + my answers, reason the best path from first principles (order, blockers, parallel vs dependent steps), and output ONLY this JSON, nothing else:
${SCHEMA}
${SCHEMA_RULES}`;

// ③ Finished project → reverse-engineer with minimal input (zero admin)
const REVERSE_PROMPT = (desc) =>
`You are Vantum Ops. I already finished this project — here's what it is (a link, or a short note, is enough):
${desc}

Do the work for me. If I gave a link, infer from it; otherwise infer from the note. Reverse-engineer the step-by-step process I most likely followed, so it's documented for the team to understand and reuse. Only ask a question if something essential is missing — otherwise just produce it. Infer phases, order, dependencies, and the tools/resources likely used.
${SCHEMA_RULES}
Return ONLY this JSON, nothing else:
${SCHEMA}`;

const CHANGE_PROMPT = (state, change) =>
`You are Vantum Ops. Here is my current project process map as JSON:
${JSON.stringify(state, null, 2)}

Requested change: ${change}

Apply the change and return ONLY the full updated project as JSON in this exact format, nothing else. Keep ids stable and use depends_on (list of step ids) to show branching:
{"name":"","goal":"","steps":[{"id":"s1","title":"","detail":"","phase":"","depends_on":[]}],"resources":[""]}`;

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
  if (typeof s === "string") return { id: newId("step"), srcId: String(i + 1), text: s, detail: "", phase: "", deps: [] };
  return {
    id: newId("step"),
    srcId: s && s.id != null ? String(s.id) : String(i + 1),
    text: (s && (s.title || s.step || s.text || s.name)) || `Step ${i + 1}`,
    detail: (s && (s.detail || s.description)) || "",
    phase: (s && s.phase) || "",
    deps: Array.isArray(s && s.depends_on) ? s.depends_on.map(String) : [],
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

function buildFlowFromSteps(steps, projectName) {
  const colors = phaseColorMap(steps);
  const bySrc = {};
  steps.forEach((s) => { if (s.srcId != null) bySrc[s.srcId] = s.id; });
  const hasDeps = steps.some((s) => s.deps && s.deps.length);

  // ---- columns (x) flow left→right; related steps stack within a column ----
  // Group by phase when phases exist; otherwise by dependency depth.
  const phaseOf = (s) => (s.phase || "").trim();
  const phaseOrder = [];
  steps.forEach((s) => { const p = phaseOf(s); if (p && !phaseOrder.includes(p)) phaseOrder.push(p); });
  const usePhases = phaseOrder.length > 1;

  const colOf = {};
  if (usePhases) {
    steps.forEach((s) => { colOf[s.id] = Math.max(0, phaseOrder.indexOf(phaseOf(s))); });
  } else if (hasDeps) {
    const memo = {};
    const calc = (s, stack) => {
      if (memo[s.id] != null) return memo[s.id];
      if (stack.has(s.id)) return 0;
      stack.add(s.id);
      let d = 0;
      (s.deps || []).forEach((dep) => {
        const parent = steps.find((x) => x.id === bySrc[String(dep)]);
        if (parent) d = Math.max(d, calc(parent, stack) + 1);
      });
      stack.delete(s.id);
      memo[s.id] = d;
      return d;
    };
    steps.forEach((s) => { colOf[s.id] = calc(s, new Set()); });
  } else {
    steps.forEach((s, i) => { colOf[s.id] = i; });
  }

  // row within each column = order of appearance
  const rowCount = {};
  const rowOf = {};
  steps.forEach((s) => {
    const c = colOf[s.id];
    rowCount[c] = rowCount[c] || 0;
    rowOf[s.id] = rowCount[c]++;
  });

  const COL_W = 290, ROW_H = 175, START_X = 60, NODE_HALF = 110;
  const hasRoot = !!(projectName && projectName.trim());
  const yBase = hasRoot ? 150 : 40;
  const maxCol = Math.max(0, ...steps.map((s) => colOf[s.id]));

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
    position: { x: START_X + colOf[s.id] * COL_W, y: yBase + rowOf[s.id] * ROW_H },
  }));

  // same column → vertical (bottom→top); different column → sideways (right→left)
  const mkEdge = (src, tgt) => {
    const side = colOf[src] !== colOf[tgt];
    return {
      id: `e-${src}-${tgt}`, source: src, target: tgt,
      sourceHandle: side ? "out-r" : "out-b",
      targetHandle: side ? "in-l" : "in-t",
      ...EDGE_OPTS,
    };
  };

  const edges = [];
  if (hasDeps) {
    steps.forEach((s) => (s.deps || []).forEach((dep) => {
      const src = bySrc[String(dep)];
      if (src) edges.push(mkEdge(src, s.id));
    }));
  } else {
    for (let i = 0; i < steps.length - 1; i++) edges.push(mkEdge(steps[i].id, steps[i + 1].id));
  }

  // floating project header centered at the top — NOT connected to anything
  if (hasRoot) {
    nodes.unshift({
      id: "root",
      type: "vantum",
      deletable: false,
      data: { label: projectName.trim(), root: true, color: "#C97B00" },
      position: { x: START_X + (maxCol / 2) * COL_W, y: 20 },
    });
  }

  return { nodes, edges };
}

/* ---------------- custom node ---------------- */
const NodeEditCtx = React.createContext({ editable: false, update: () => {} });
const stop = (e) => e.stopPropagation();

function VantumNode({ id, data }) {
  const ctx = useContext(NodeEditCtx);
  const [open, setOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [editDetail, setEditDetail] = useState(false);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [open, editDetail, editTitle]);

  if (data.root) {
    return html`
      <div class="vnode vroot" style=${{ borderColor: data.color || "#C97B00" }}>
        <span class="vroot-label">PROJECT</span>
        ${ctx.editable && editTitle
          ? html`<input class="vnode-edit vroot-edit nodrag" defaultValue=${data.label} autoFocus
              onPointerDown=${stop}
              onBlur=${(e) => { ctx.update(id, { label: e.target.value.trim() || data.label }); setEditTitle(false); }}
              onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } if (e.key === "Escape") setEditTitle(false); }} />`
          : html`<span class="vroot-title" onDoubleClick=${() => ctx.editable && setEditTitle(true)}>${data.label}</span>`}
        <${Handle} id="out-b" type="source" position=${Position.Bottom} />
      </div>`;
  }

  const commitTitle = (e) => { ctx.update(id, { label: e.target.value.trim() || data.label }); setEditTitle(false); };
  const commitDetail = (e) => { ctx.update(id, { detail: e.target.value }); setEditDetail(false); };

  return html`
    <div class="vnode" style=${{ borderTop: `3px solid ${data.color || "#059669"}` }}>
      <${Handle} id="in-t" type="target" position=${Position.Top} />
      <${Handle} id="in-l" type="target" position=${Position.Left} />
      <div class="vnode-head">
        ${data.num != null && html`<span class="vnode-num" style=${{ background: data.color || "#059669" }}>${data.num}</span>`}
        ${ctx.editable && editTitle
          ? html`<input class="vnode-edit nodrag" defaultValue=${data.label} autoFocus
              onPointerDown=${stop}
              onBlur=${commitTitle}
              onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } if (e.key === "Escape") setEditTitle(false); }} />`
          : html`<span class="vnode-title" title="Double-click to rename" onDoubleClick=${() => ctx.editable && setEditTitle(true)}>${data.label}</span>`}
      </div>
      ${data.phase && html`<div class="vnode-phase" style=${{ color: data.color || "#059669" }}>${data.phase}</div>`}
      ${(data.detail || ctx.editable) && html`
        <button class="vnode-more nodrag" onPointerDown=${stop} onClick=${(e) => { e.stopPropagation(); setOpen(!open); }}>
          ${open ? "Hide details ▴" : "Details ▾"}
        </button>`}
      ${open && html`
        ${ctx.editable && editDetail
          ? html`<textarea class="vnode-edit-area nodrag" defaultValue=${data.detail} autoFocus
              onPointerDown=${stop} onBlur=${commitDetail}
              onKeyDown=${(e) => { if (e.key === "Escape") setEditDetail(false); }}></textarea>`
          : html`<div class="vnode-detail" title=${ctx.editable ? "Double-click to edit" : ""} onDoubleClick=${() => ctx.editable && setEditDetail(true)}>${data.detail || (ctx.editable ? "Double-click to add details…" : "")}</div>`}`}
      <${Handle} id="out-b" type="source" position=${Position.Bottom} />
      <${Handle} id="out-r" type="source" position=${Position.Right} />
    </div>`;
}
// free-floating sticky note for ideation (not a step)
function NoteNode({ id, data }) {
  const ctx = useContext(NodeEditCtx);
  const [edit, setEdit] = useState(false);
  return html`
    <div class="note">
      ${ctx.editable && edit
        ? html`<textarea class="note-edit nodrag" defaultValue=${data.text} autoFocus
            onPointerDown=${stop}
            onBlur=${(e) => { ctx.update(id, { text: e.target.value }); setEdit(false); }}
            onKeyDown=${(e) => { if (e.key === "Escape") setEdit(false); }}></textarea>`
        : html`<div class="note-text" onDoubleClick=${() => ctx.editable && setEdit(true)}>${data.text || (ctx.editable ? "Double-click to write…" : "")}</div>`}
    </div>`;
}

const nodeTypes = { vantum: VantumNode, note: NoteNode };

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
  const [inputMode, setInputMode] = useState("idea"); // idea | call | finished
  const [desc, setDesc] = useState("");
  const [callRef, setCallRef] = useState("");
  const [finishedDesc, setFinishedDesc] = useState("");
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
        if (savedNodes.length) {
          // reuse the saved map exactly (keeps positions, notes, header, branches);
          // align step ids to the saved step nodes so inline edits stay linked
          const stepNodes = savedNodes
            .filter((n) => n.type === "vantum" && !(n.data && n.data.root))
            .sort((a, b) => ((a.data && a.data.num) || 0) - ((b.data && b.data.num) || 0));
          stepNodes.forEach((n, i) => { if (ns[i]) ns[i].id = n.id; });
          setNodes(savedNodes);
          setEdges((p.map_data && p.map_data.edges) || []);
        } else {
          const flow = buildFlowFromSteps(ns, p.name);
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
  function startWithClaude() {
    if (inputMode === "idea") {
      if (!desc.trim()) { toast("Describe your idea first — open the guide if unsure."); return; }
      openClaude(IDEA_PROMPT(desc.trim()));
    } else if (inputMode === "call") {
      openClaude(CALL_PROMPT(callRef));
    } else {
      if (!finishedDesc.trim()) { toast("Describe the finished project first."); return; }
      openClaude(REVERSE_PROMPT(finishedDesc.trim()));
    }
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
    const flow = buildFlowFromSteps(newSteps, data.name);
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

  // edit a node directly on the board → keep the sidebar step in sync too
  const updateNodeData = useCallback((nid, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)));
    if (nid === "root" && "label" in patch) { setName(patch.label); return; }
    setSteps((arr) => arr.map((s) => {
      if (s.id !== nid) return s;
      const u = { ...s };
      if ("label" in patch) u.text = patch.label;
      if ("detail" in patch) u.detail = patch.detail;
      return u;
    }));
  }, [setNodes]);

  // when boxes are deleted on the board (Delete key), drop their steps too
  const onNodesDelete = useCallback((deleted) => {
    const ids = new Set(deleted.map((d) => d.id));
    setSteps((arr) => arr.filter((s) => !ids.has(s.id)));
  }, []);

  function rebuildMap() {
    const flow = buildFlowFromSteps(steps, name);
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
    setSteps((arr) => [...arr, { id, srcId: id, text: "New step", detail: "", phase: "", deps: [] }]);
    setNodes((ns) => {
      const num = ns.filter((n) => !n.data.root).length + 1;
      return ns.concat({
        id, type: "vantum",
        data: { label: "New step", detail: "", phase: "", color: "#059669", num },
        position: { x: 420, y: 120 + (ns.length % 6) * 80 },
      });
    });
    toast("Box added — double-click it to name it.");
  }

  function addNote() {
    const id = newId("note");
    setNodes((ns) => ns.concat({
      id, type: "note", deletable: true,
      data: { text: "" },
      position: { x: 480, y: 140 + (ns.length % 5) * 70 },
    }));
    toast("Note added — double-click to write.");
  }

  /* ----- Claude: change the map ----- */
  function changeWithClaude() {
    if (!changeText.trim()) { toast("Type what you'd like Claude to change."); return; }
    const state = {
      name, goal,
      steps: steps.map((s) => ({ id: s.srcId || s.id, title: s.text, detail: s.detail, phase: s.phase, depends_on: s.deps || [] })),
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
      steps: steps.map((s) => ({ id: s.srcId || s.id, title: s.text, detail: s.detail, phase: s.phase, depends_on: s.deps || [] })),
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
    <${NodeEditCtx.Provider} value=${{ editable: !locked, update: updateNodeData }}>
    <div class=${"layout" + (hasContent ? "" : " no-canvas")}>
      <!-- LEFT -->
      <div class=${"panel left" + (panelOpen ? "" : " collapsed")}>
        <div class="card">
          ${!hasContent && html`<div class="new-title">Start a new project</div>`}
          <div class="modes">
            <button class=${"mode" + (inputMode === "idea" ? " on" : "")} disabled=${locked} onClick=${() => setInputMode("idea")}>💡 Idea</button>
            <button class=${"mode" + (inputMode === "call" ? " on" : "")} disabled=${locked} onClick=${() => setInputMode("call")}>🎙️ From a call</button>
            <button class=${"mode" + (inputMode === "finished" ? " on" : "")} disabled=${locked} onClick=${() => setInputMode("finished")}>📦 Finished project</button>
          </div>

          ${inputMode === "idea" && html`
            <div class="field">
              <label>Describe your idea <span class="hint">— Claude researches the best path</span></label>
              <textarea rows="4" disabled=${locked} value=${desc} onInput=${(e) => setDesc(e.target.value)}
                placeholder="What do you want to build? Goal, context, and any tools you'll use."></textarea>
            </div>
            <div class="guide">
              <button type="button" class="guide-toggle" onClick=${() => setGuideOpen(!guideOpen)}>💡 How to describe it ${guideOpen ? "▴" : "▾"}</button>
              ${guideOpen && html`
                <div class="guide-body">
                  <div class="muted" style=${{ marginBottom: "8px" }}>The more of these you include, the better the path:</div>
                  <ul>
                    <li><strong>What it is</strong> — “a lead magnet PDF”, “a 5-email sequence”…</li>
                    <li><strong>The goal, with a number</strong> — “collect 300 emails in 30 days”</li>
                    <li><strong>Tools</strong> — Canva, Mailchimp, Carrd…</li>
                    <li><strong>Timeline</strong> — “launch in two weeks”</li>
                  </ul>
                  <button type="button" class="btn-ghost btn-small" onClick=${() => { setDesc(EXAMPLE_DESC); setGuideOpen(false); }}>Insert example</button>
                </div>`}
            </div>
            <div class="row" style=${{ marginTop: "12px" }}>
              <button class="btn-primary" disabled=${locked} onClick=${startWithClaude}>Research with Claude</button>
              <button class="btn-ghost" disabled=${locked} onClick=${() => setPasteOpen(true)}>Paste Claude Output</button>
            </div>`}

          ${inputMode === "call" && html`
            <div class="field">
              <label>Which call? <span class="hint">— date or keywords (optional)</span></label>
              <input disabled=${locked} value=${callRef} onInput=${(e) => setCallRef(e.target.value)}
                placeholder="e.g. my June 6 call about the lead magnet" />
            </div>
            <div class="muted" style=${{ marginBottom: "4px" }}>Pulls your assigned task from Fathom. Requires Fathom connected in your Claude account.</div>
            <div class="row" style=${{ marginTop: "12px" }}>
              <button class="btn-primary" disabled=${locked} onClick=${startWithClaude}>Pull from the call</button>
              <button class="btn-ghost" disabled=${locked} onClick=${() => setPasteOpen(true)}>Paste Claude Output</button>
            </div>`}

          ${inputMode === "finished" && html`
            <div class="field">
              <label>Paste a link or one line <span class="hint">— Claude does the rest</span></label>
              <textarea rows="3" disabled=${locked} value=${finishedDesc} onInput=${(e) => setFinishedDesc(e.target.value)}
                placeholder="A repo/doc/live link, or one sentence — e.g. “the lead-magnet landing page in Carrd”. No writing-up needed."></textarea>
            </div>
            <div class="muted" style=${{ marginBottom: "4px" }}>No admin work — give the lightest hint and Claude reconstructs the process.</div>
            <div class="row" style=${{ marginTop: "12px" }}>
              <button class="btn-primary" disabled=${locked} onClick=${startWithClaude}>Reverse-engineer with Claude</button>
              <button class="btn-ghost" disabled=${locked} onClick=${() => setPasteOpen(true)}>Paste Claude Output</button>
            </div>`}
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
              <button class="btn-ghost btn-small" onClick=${addNote}>+ Note</button>
              <span class="muted" style=${{ alignSelf: "center" }}>Drag · connect dots · select + Delete to remove</span>
            </div>`}
          <${ReactFlow}
            nodes=${nodes}
            edges=${edges}
            nodeTypes=${nodeTypes}
            onNodesChange=${locked ? undefined : onNodesChange}
            onNodesDelete=${locked ? undefined : onNodesDelete}
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
    <//>
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
