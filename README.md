# SIH 2026 Command Center

The base for your whole Smart India Hackathon 2026 campaign — a real recruitment + team-tracking platform.

## The flow it runs
1. **Apply** — student scans the recruitment **QR** (shown on the admin dashboard) → lands on the Apply page → fills details, skills, and whether they have their **own idea**.
2. **Interview** — core team schedules a slot (date/time + location or **Zoom link**); the student sees it live on their status page.
3. **Select** — core team clicks **Select**; the platform auto-generates a **Team ID (e.g. SIH-07) + password** to hand over, and assigns an idea + pod.
4. **Sign** — on first login the selected student must **sign the agreement**:
   - Standard: the 30 ideas are the organiser's IP; the student claims **no ownership rights**.
   - "Own idea" applicants can tick **"I want to be the leader"** → they **keep ownership** of their idea and sign the owner variant instead.
5. **Build & track** — teams submit work against the **8-week targets**; core team **approves / requests changes**, sends **direct targets**, and watches progress + the **odds radar**. Anyone can be **removed** for inactivity or misconduct.

## Run locally (Windows)
```bash
cd "C:\Users\PC\Documents\SIH 2026\platform"
npm install
npm start
```
Open **http://localhost:4000**

- **Core team login:** `admin@sih.local` / `sihwin2026`  ← change in `lib/seed.js` before real use.
- **Students** use the **Apply now** tab. Selected students log in with their **Team ID + password** (or their original email + password).

## Deploy (Render — separate from trustinonline, free)
1. Put this `platform/` folder in its **own** GitHub repo (NOT trustinonlinefront).
2. Render → **New → Blueprint** → pick that repo. `render.yaml` sets it up as a **free** web service named `sih2026` → URL becomes `https://sih2026.onrender.com` (name must be free; else it appends a suffix).
3. The **recruitment QR auto-updates** to the live URL once deployed — no manual edit.

> **Free-tier data caveat:** Render free has no persistent disk and resets its filesystem on redeploys, so `db.json` (registrations) can be wiped. For the real campaign either upgrade to Starter + a disk (see `render.yaml` comments) **or** ask to wire a free Supabase Postgres. For a short pilot, back up `data/db.json` regularly.

## Data & backup
Everything lives in `data/db.json` (auto-created). Back it up by copying that file. No database server needed locally.

## Change the admin password / add core-team leads
Edit `lib/seed.js` (the `hashPassword('sihwin2026')` line), delete `data/db.json`, restart. Add more core-team members as `role: 'lead'` the same way — leads get the same dashboard.
