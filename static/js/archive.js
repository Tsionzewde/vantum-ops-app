import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, { Background, Controls, MiniMap, ReactFlowProvider } from "reactflow";
import htm from "htm";

const html = htm.bind(React.createElement);

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (e) { return iso; }
}

function DetailMap({ map }) {
  const nodes = (map && map.nodes) || [];
  const edges = (map && map.edges) || [];
  if (!nodes.length) {
    return html`<div class="detail-map"><div class="empty-canvas"><div class="muted">No map saved for this project.</div></div></div>`;
  }
  return html`
    <div class="detail-map">
      <${ReactFlowProvider}>
        <${ReactFlow}
          nodes=${nodes} edges=${edges}
          nodesDraggable=${false} nodesConnectable=${false} elementsSelectable=${false}
          fitView proOptions=${{ hideAttribution: true }}>
          <${Background} color="#1B2C45" gap=${22} />
          <${Controls} showInteractive=${false} />
          <${MiniMap} style=${{ background: "#0A1626", border: "1px solid #1B2C45" }}
            nodeColor=${() => "#059669"} maskColor="rgba(3,10,23,0.6)" />
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
      </div>

      <div style=${{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: "18px", alignItems: "start" }} class="detail-grid">
        <div>
          <div class="card">
            <span class="panel-title">Goal</span>
            <div>${project.goal || html`<span class="muted">—</span>`}</div>
            <hr class="divider" />
            <span class="panel-title">Team</span>
            <div>${project.team || html`<span class="muted">—</span>`}</div>
          </div>
          <div class="card">
            <span class="panel-title">Written process</span>
            ${steps.length === 0 && html`<div class="muted">No steps.</div>`}
            ${steps.map((s, i) => html`
              <div class="step-row" key=${i} style=${{ alignItems: "flex-start" }}>
                <span class="step-num">${i + 1}</span>
                <div style=${{ flex: 1, fontSize: "14px", lineHeight: 1.5, paddingTop: "3px" }}>${typeof s === "string" ? s : JSON.stringify(s)}</div>
              </div>`)}
          </div>
          <div class="card">
            <span class="panel-title">Resources</span>
            ${resources.length === 0 && html`<div class="muted">None.</div>`}
            <div>${resources.map((r, i) => html`<span class="list-tag" key=${i}>${typeof r === "string" ? r : JSON.stringify(r)}</span>`)}</div>
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
