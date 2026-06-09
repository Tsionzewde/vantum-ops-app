# VANTUM OPS — Project & Process Tracker

Flask + React Flow web app for turning a plain-English project description
into a structured, editable process with a visual draggable map — powered by
a Claude.ai hand-off and saved to Supabase.

## Stack
- **Backend:** Python Flask
- **Frontend:** single-page HTML/CSS/JS (React + React Flow via ES modules — no build step)
- **Visual map:** React Flow
- **Storage:** Supabase (with a local JSON fallback for dev)
- **AI:** Claude.ai via pre-filled prompt buttons

## Quick start

```bash
cd vantum-ops
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000

> With no `.env`, the app runs against a local `projects_local.json` file so
> you can try everything immediately. Add Supabase creds for shared storage.

## Supabase setup
1. Create a project at supabase.com.
2. Run `schema.sql` in the Supabase SQL editor (creates the `projects` table
   + open Row Level Security policies).
3. Copy `.env.example` to `.env` and fill in:
   ```
   SUPABASE_URL=https://YOUR-REF.supabase.co
   SUPABASE_KEY=YOUR-ANON-PUBLIC-KEY
   ```
4. Restart `python app.py`. The top-right badge shows **Supabase** when connected.

## How to use
1. **Describe your project** in the left panel → **Process with Claude**
   (opens Claude with a pre-filled extraction prompt).
2. Copy Claude's JSON reply → **Paste Claude Output** → **Apply**. Fields and
   the visual map populate automatically.
3. Edit name/goal/team/steps/resources inline. Each step is a node on the map.
4. On the **right**, drag boxes, **+ Add box**, connect dots into arrows,
   select a box/arrow and press Delete to remove. Use **Tell Claude what to
   change…** to get an updated JSON, then paste it back to refresh.
5. **Approve & Save** stores everything to Supabase and locks the project.
6. The **Archive** page lists all saved projects; click one to view its
   written process + map (read-only when approved).

## API
- `GET  /api/projects` — list all
- `GET  /api/projects/<id>` — one project
- `POST /api/projects` — create (used by Approve & Save)
- `GET  /api/config` — reports `supabase` or `local` storage

## Files
```
app.py              Flask server + storage layer
requirements.txt    Python deps
.env.example        Supabase config template
schema.sql          Supabase table + policies
templates/          index.html (builder) + archive.html
static/css/         style.css (Vantum design system)
static/js/          app.js (builder) + archive.js
```
