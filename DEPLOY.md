# Deploying VANTUM OPS to a public URL (Render)

The app is a Flask server, so it needs a host. These steps put it online for
free on Render. Anyone you share the resulting URL with can use it — no install.

## 1. Push to GitHub
Already done if you used the connected account. The repo includes `render.yaml`,
which Render reads automatically.

## 2. Create the Render service
1. Sign up / log in at https://render.com (free).
2. Click **New → Blueprint**.
3. Connect your GitHub and pick the **vantum-ops-app** repo.
4. Render detects `render.yaml` and proposes a free web service. Click **Apply**.
5. Wait for the build (installs `requirements.txt`, starts `gunicorn`).
6. You get a public URL like `https://vantum-ops.onrender.com` — share that.

## 3. Make data persistent + shared (recommended)
Without Supabase, the app runs but stores data on Render's **ephemeral disk**,
which resets on every redeploy/restart — fine for a demo, not for real use.

To persist and share data across everyone:
1. Create a free project at https://supabase.com.
2. Run `schema.sql` in the Supabase SQL editor.
3. In Render → your service → **Environment**, set:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_KEY` = your anon public key
4. **Save** → Render redeploys. The app now uses Supabase (top-right badge
   shows "Supabase"), and all visitors share the same live project list.

## Notes
- Free Render services **sleep after inactivity**; the first request after a
  nap takes ~30s to wake. Fine for internal/team use.
- Any push to the repo's `main` branch triggers an automatic redeploy.
