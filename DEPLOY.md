# Deploy SIH Command Center to Render (free, separate from trustinonline)

The code is already a committed git repo. You only do 2 things I can't: **create the GitHub repo** and **click deploy** (both need your login).

## Step 1 — Create an EMPTY GitHub repo
Go to https://github.com/new
- Name: `sih2026-command-center`
- **Private** is fine. **Do NOT** add a README/.gitignore (repo must be empty).
- Click **Create repository**.

## Step 2 — Push the code (run these in the platform folder)
```bash
cd "C:\Users\PC\Documents\SIH 2026\platform"
git branch -M main
git remote add origin https://github.com/smtvashistha-eng/sih2026-command-center.git
git push -u origin main
```
> If it asks to log in, use your GitHub account (same one as trustinonlinefront).
> **Tell me once the repo exists and I can run this push for you** if your GitHub login is cached on this PC.

## Step 3 — Deploy on Render
1. Go to https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect GitHub, pick **sih2026-command-center**.
3. Render reads `render.yaml` and creates a **free** web service named `sih2026`.
4. Click **Apply**. In ~2 min you get: **https://sih2026.onrender.com**
   (if the name is taken it adds a suffix — that's fine.)

## Step 4 — Use it
- Students: `https://sih2026.onrender.com/` (Apply). The recruitment QR on the admin page **auto-points** to this URL.
- You: `https://sih2026.onrender.com/admin.html` — login `admin@sih.local` / `sihwin2026` (change it first in `lib/seed.js` and re-push).

## ⚠️ Free-tier data note (important before real launch)
Render **free** has no persistent disk — a redeploy can wipe `db.json` (all registrations). Two fixes:
- **(a)** Upgrade the service to **Starter ($7/mo)** + add the disk block in `render.yaml` (commented there) + env `SIH_DATA_DIR=/var/data`. Reliable.
- **(b) Free + permanent:** ask me to wire a **free Supabase Postgres** as the datastore. Best free option for real registrations.

Also: free services **sleep after 15 min** idle (first visit then takes ~50s to wake). Fine for internal use.
