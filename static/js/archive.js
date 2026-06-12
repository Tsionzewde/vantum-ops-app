import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, { Background, Controls, MiniMap, ReactFlowProvider, Handle, Position, useStoreApi } from "reactflow";
import htm from "htm";

const html = htm.bind(React.createElement);

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (e) { return iso; }
}

/* same rich node as the builder so saved maps render identically */
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

function stepTitle(s) {
  if (typeof s === "string") return s;
  return (s && (s.title || s.text || s.step)) || "";
}
function stepDetail(s) {
  return (s && typeof s === "object" && (s.detail || s.description)) || "";
}
function stepPhase(s) {
  return (s && typeof s === "object" && s.phase) || "";
}

function openFileResource(r) {
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
  } catch (e) {}
}

function DetailMap({ map }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const nodes = (map && map.nodes) || [];
  const edges = (map && map.edges) || [];
  if (!nodes.length) {
    return html`<div class="detail-map"><div class="empty-canvas"><div class="muted">No map saved for this project.</div></div></div>`;
  }
  return html`
    <div class=${"detail-map" + (expanded ? " expanded" : "")}>
      <button class="btn-ghost btn-small map-expand" onClick=${() => setExpanded(!expanded)}>
        ${expanded ? "✕ Close" : "⛶ Expand"}
      </button>
      <${ReactFlowProvider} key=${expanded ? "x" : "n"}>
        <${ReactFlow}
          nodes=${nodes} edges=${edges} nodeTypes=${nodeTypes}
          nodesDraggable=${false} nodesConnectable=${false} elementsSelectable=${false}
          fitView proOptions=${{ hideAttribution: true }}>
          <${MeasureFix} ids=${nodes.map((n) => n.id)} />
          <${Background} color="#1B2C45" gap=${22} />
          <${Controls} showInteractive=${false} />
          <${MiniMap} style=${{ background: "#0A1626", border: "1px solid #1B2C45" }}
            nodeColor=${(n) => (n.data && n.data.color) || "#059669"} maskColor="rgba(3,10,23,0.6)" />
        <//>
      <//>
    </div>`;
}

function Detail({ project, onBack }) {
  const steps = Array.isArray(project.steps) ? project.steps : [];
  const resources = Array.isArray(project.resources) ? project.resources : [];
  const approved = project.status === "Approved";
  return html`
    <div>
      <div style=${{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
        <button class="btn-ghost btn-small" onClick=${onBack}>← Back</button>
        <h2 style=${{ margin: 0, flex: 1 }}>${project.name}</h2>
        <span class=${"badge " + (approved ? "approved" : "active")}>${project.status || "Active"}</span>
        <button class="btn-primary btn-small" onClick=${() => { window.location.href = "/?edit=" + project.id; }}>✎ Edit</button>
      </div>

      <div style=${{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: "18px", alignItems: "start" }} class="detail-grid">
        <div>
          <div class="card">
            <span class="panel-title">Goal</span>
            <div>${project.goal || html`<span class="muted">—</span>`}</div>
            ${project.team && html`<hr class="divider" /><span class="panel-title">Team</span><div>${project.team}</div>`}
          </div>
          <div class="card">
            <span class="panel-title">Written process</span>
            ${steps.length === 0 && html`<div class="muted">No steps.</div>`}
            ${steps.map((s, i) => html`
              <div class="step-row" key=${i} style=${{ alignItems: "flex-start" }}>
                <span class="step-num">${i + 1}</span>
                <div style=${{ flex: 1, paddingTop: "3px" }}>
                  <div style=${{ fontSize: "14px", lineHeight: 1.5 }}>${stepTitle(s)}
                    ${stepPhase(s) && html` <span class="phase-chip">${stepPhase(s)}</span>`}
                  </div>
                  ${stepDetail(s) && html`<div class="muted" style=${{ marginTop: "2px" }}>${stepDetail(s)}</div>`}
                </div>
              </div>`)}
          </div>
          <div class="card">
            <span class="panel-title">Resources</span>
            ${resources.length === 0 && html`<div class="muted">None.</div>`}
            <div>
              ${resources.map((r, i) => {
                if (r && r.kind === "file") {
                  return html`<div class="res-file" key=${i}>
                    <svg class="res-icon" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
                    <span class="res-name">${r.name}</span>
                    <button type="button" class="mini" onClick=${() => openFileResource(r)}>Open</button>
                  </div>`;
                }
                const label = typeof r === "string" ? r : (r && (r.value || r.name)) || "";
                return html`<span class="list-tag" key=${i}>${label}</span>`;
              })}
            </div>
          </div>
        </div>
        <div>
          <span class="panel-title">Process map</span>
          <${DetailMap} map=${project.map_data} />
        </div>
      </div>
    </div>`;
}

function Archive() {
  const [projects, setProjects] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then(setProjects).catch(() => setProjects([]));
  }, []);

  function openProject(id) {
    fetch("/api/projects/" + id).then((r) => r.json()).then(setActive).catch(() => {});
  }

  if (active) {
    return html`<div class="archive-wrap"><${Detail} project=${active} onBack=${() => setActive(null)} /></div>`;
  }

  return html`
    <div class="archive-wrap">
      <h2 style=${{ marginTop: 0 }}>Saved Projects</h2>
      ${projects === null && html`<div class="muted">Loading…</div>`}
      ${projects && projects.length === 0 && html`
        <div class="card" style=${{ textAlign: "center", padding: "60px 20px" }}>
          <h3 style=${{ margin: "0 0 6px" }}>No saved projects yet.</h3>
          <div class="muted">Build one on the <a href="/" style=${{ color: "#34d399" }}>Builder</a> page and hit Approve & Save.</div>
        </div>`}
      ${projects && projects.length > 0 && html`
        <div class="grid">
          ${projects.map((p) => html`
            <div class="proj-card" key=${p.id} onClick=${() => openProject(p.id)}>
              <h3>${p.name}</h3>
              <div class="muted">${(Array.isArray(p.steps) ? p.steps.length : 0)} steps</div>
              <div class="meta">
                <span class="date">${fmtDate(p.created_at)}</span>
                <span class=${"badge " + (p.status === "Approved" ? "approved" : "active")}>${p.status || "Active"}</span>
              </div>
            </div>`)}
        </div>`}
    </div>`;
}

createRoot(document.getElementById("root")).render(html`<${Archive} />`);
