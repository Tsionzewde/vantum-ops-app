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
} from "reactflow";
import htm from "htm";

const html = htm.bind(React.createElement);

/* ---------------- constants ---------------- */
const NODE_STYLE = {
  background: "linear-gradient(180deg,#0E1C30,#0A1626)",
  color: "#fff",
  border: "1px solid #1B2C45",
  borderRadius: "12px",
  padding: "10px 14px",
  fontSize: "13px",
  fontWeight: 600,
  width: 190,
  textAlign: "center",
};

const EDGE_OPTS = {
  animated: true,
  style: { stroke: "#059669", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#059669" },
};

const PROCESS_PROMPT = (desc) =>
`You are Vantum Ops. I have a new project.
Extract: project name, goal, team, numbered steps, and resources.
Then return the result as JSON in this format:
{name, goal, team, steps[], resources[]}
My project: ${desc}`;

const CHANGE_PROMPT = (state, change) =>
`You are Vantum Ops. Here is my current project process map as JSON:
${JSON.stringify(state, null, 2)}

Requested change: ${change}

Apply the change and return the full updated project as JSON in this exact format:
{name, goal, team, steps[], resources[]}`;

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
  // strip code fences
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  // grab the outermost object
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(txt.slice(start, end + 1));
}

let SEQ = 0;
const newId = (p) => `${p}-${SEQ++}`;

function buildFlowFromSteps(steps) {
  const nodes = steps.map((s, i) => ({
    id: s.id,
    data: { label: s.text || `Step ${i + 1}` },
    position: { x: 130, y: 60 + i * 110 },
    style: NODE_STYLE,
  }));
  const edges = [];
  for (let i = 0; i < steps.length - 1; i++) {
    edges.push({ id: `e-${steps[i].id}-${steps[i + 1].id}`, source: steps[i].id, target: steps[i + 1].id, ...EDGE_OPTS });
  }
  return { nodes, edges };
}

/* ---------------- App ---------------- */
function App() {
  const [desc, setDesc] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [rawJson, setRawJson] = useState("");

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [team, setTeam] = useState("");
  const [steps, setSteps] = useState([]); // [{id, text}]
  const [resources, setResources] = useState([]); // [string]

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [status, setStatus] = useState("Active");
  const [changeText, setChangeText] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);

  const edgeUpdateOk = useRef(true);
  const locked = status === "Approved";
  const hasContent = Boolean(name || steps.length || nodes.length);

  /* ----- Claude: process description ----- */
  function processWithClaude() {
    if (!desc.trim()) { toast("Describe your project first."); return; }
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
    setTeam(data.team || "");
    const rawSteps = Array.isArray(data.steps) ? data.steps : [];
    const newSteps = rawSteps.map((s) => ({
      id: newId("step"),
      text: typeof s === "string" ? s : (s && (s.step || s.text || s.name)) || String(s),
    }));
    setSteps(newSteps);
    const rawRes = Array.isArray(data.resources) ? data.resources : [];
    setResources(rawRes.map((r) => (typeof r === "string" ? r : (r && (r.name || r.resource)) || String(r))));
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
  function updateStep(id, text) {
    setSteps((arr) => arr.map((s) => (s.id === id ? { ...s, text } : s)));
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: text } } : n)));
  }
  function addStep() {
    const id = newId("step");
    const s = { id, text: "" };
    setSteps((arr) => [...arr, s]);
    setNodes((ns) => ns.concat({
      id, data: { label: "New step" },
      position: { x: 130, y: 60 + ns.length * 110 }, style: NODE_STYLE,
    }));
    // link from previous step node if any
    setSteps((arr) => {
      if (arr.length > 1) {
        const prev = arr[arr.length - 2];
        setEdges((es) => addEdge({ id: `e-${prev.id}-${id}`, source: prev.id, target: id, ...EDGE_OPTS }, es));
      }
      return arr;
    });
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
  const updateResource = (i, v) => setResources((a) => a.map((r, idx) => (idx === i ? v : r)));
  const addResource = () => setResources((a) => [...a, ""]);
  const removeResource = (i) => setResources((a) => a.filter((_, idx) => idx !== i));

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
      id, data: { label: "New box" },
      position: { x: 360, y: 80 + (ns.length % 6) * 70 }, style: NODE_STYLE,
    }));
  }

  /* ----- Claude: change the map ----- */
  function changeWithClaude() {
    if (!changeText.trim()) { toast("Type what you'd like Claude to change."); return; }
    const state = {
      name, goal, team,
      steps: steps.map((s) => s.text),
      resources,
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
      name, goal, team,
      steps: steps.map((s) => s.text),
      resources,
      map_data: { nodes, edges },
      status: "Approved",
    };
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("save failed");
      const saved = await res.json();
      setSavedId(saved.id);
      setStatus("Approved");
      toast("Approved & saved. This project is now locked.");
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
      <div class="panel left">
        <div class="card">
          <div class="field">
            <label>Describe your project</label>
            <textarea
              placeholder="Describe your project... goals, who's involved, what needs to happen."
              value=${desc}
              disabled=${locked}
              onInput=${(e) => setDesc(e.target.value)}
              rows="4"></textarea>
          </div>
          <div class="row">
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
            <div class="field">
              <label>Team</label>
              <input value=${team} disabled=${locked} onInput=${(e) => setTeam(e.target.value)} placeholder="Who is involved?" />
            </div>
          </div>

          <div class="card">
            <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span class="panel-title" style=${{ margin: 0 }}>Written process</span>
              ${!locked && html`<button class="btn-ghost btn-small" onClick=${rebuildMap}>Rebuild map</button>`}
            </div>
            ${steps.length === 0 && html`<div class="muted">No steps yet.</div>`}
            ${steps.map((s, i) => html`
              <div class="step-row" key=${s.id}>
                <span class="step-num">${i + 1}</span>
                <input value=${s.text} disabled=${locked} onInput=${(e) => updateStep(s.id, e.target.value)} placeholder=${"Step " + (i + 1)} />
                ${!locked && html`<button class="x" onClick=${() => removeStep(s.id)}>✕</button>`}
              </div>
            `)}
            ${!locked && html`<button class="btn-ghost btn-small" style=${{ marginTop: "8px" }} onClick=${addStep}>+ Add step</button>`}
          </div>

          <div class="card">
            <span class="panel-title">Resources</span>
            ${resources.length === 0 && html`<div class="muted">No resources yet.</div>`}
            ${resources.map((r, i) => html`
              <div class="step-row" key=${"r" + i}>
                <input value=${r} disabled=${locked} onInput=${(e) => updateResource(i, e.target.value)} placeholder="Resource" />
                ${!locked && html`<button class="x" onClick=${() => removeResource(i)}>✕</button>`}
              </div>
            `)}
            ${!locked && html`<button class="btn-ghost btn-small" style=${{ marginTop: "8px" }} onClick=${addResource}>+ Add resource</button>`}
          </div>

          <div class="card" style=${{ display: "flex", gap: "10px", alignItems: "center" }}>
            ${locked
              ? html`<div style=${{ flex: 1 }}>
                  <strong style=${{ color: "#34d399" }}>Approved & locked.</strong>
                  ${savedId && html` <a href="/archive" style=${{ color: "#6ba4ff" }}>View in archive →</a>`}
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
            <${Background} color="#1B2C45" gap=${22} />
            <${Controls} showInteractive=${false} />
            <${MiniMap} pannable zoomable
              style=${{ background: "#0A1626", border: "1px solid #1B2C45" }}
              nodeColor=${() => "#059669"} maskColor="rgba(3,10,23,0.6)" />
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
            <textarea rows="12" placeholder=${'{\n  "name": "...",\n  "goal": "...",\n  "team": "...",\n  "steps": ["..."],\n  "resources": ["..."]\n}'}
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
