# Deploy SIH Command Center to Render (separate from trustinonline)

The code is a committed git repo. You do the 2 steps that need your login; I did the rest.

## Step 1 — Create an EMPTY GitHub repo
https://github.com/new → name `sih2026-command-center` → Private is fine → **don't** add README/.gitignore → Create.

## Step 2 — Push the code
```bash
cd "C:\Users\PC\Documents\SIH 2026\platform"
git branch -M main
git remote add origin https://github.com/smtvashistha-eng/sih2026-command-center.git
git push -u origin main
```
(Tell me once the repo exists and I'll run this push for you if your GitHub login is cached here.)

## Step 3 — Deploy on Render (your existing paid account)
1. https://dashboard.render.com → **New +** → **Blueprint** → pick `sih2026-command-center`.
2. `render.yaml` creates a **Starter** web service `sih2026` **with a 1 GB persistent disk** — so registrations never get wiped. It's a **separate service**; it cannot touch trustinonline.
3. Render will ask you to fill two secret env vars (they are NOT in the code):
   - `SIH_ADMIN_EMAIL` → e.g. `admin@trustinonline.in`
   - `SIH_ADMIN_PASSWORD` → a strong password only you know
   (`SIH_SECRET` auto-generates.)
4. **Apply** → live in ~2 min at **https://sih2026.onrender.com**.

## How to log in (important)
- **You (core team):** open `https://sih2026.onrender.com/` → click the **"Log in"** tab → enter your `SIH_ADMIN_EMAIL` + `SIH_ADMIN_PASSWORD`. It takes you to the admin dashboard.
  - Opening `/admin.html` directly when not logged in sends you to the Login tab — that's expected. **Admins log in; they do NOT use the Apply form.**
- **Students:** use the **"Apply now"** tab. After selection they log in with their **Team ID + password** (or their own email + password).

## Security notes
- Admin password lives ONLY in Render's env vars, never in the repo. Change it anytime in the dashboard → redeploy → it updates automatically.
- Sessions are signed with `SIH_SECRET`. Cookies are HttpOnly. Passwords are scrypt-hashed.
- To add more core-team members, create them as `role: 'lead'` in `lib/seed.js` (or ask me to add a lead-invite screen).

## Data
Lives in the persistent disk at `/var/data/db.json`. Survives redeploys. Back up occasionally by downloading it from the Render shell.
