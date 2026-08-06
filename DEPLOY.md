# Deploy SIH Command Center — FREE (Render free + Supabase free)

Code is on GitHub already. This runs **fully free** and data is **permanent** (stored in your free Supabase project, not on Render's disk).

## Deploy on Render (free)
1. https://dashboard.render.com → **New +** → **Blueprint** → connect GitHub → pick **`sih2026`**.
2. `render.yaml` creates a **free** web service `sih2026`. It will ask you to fill 4 env vars:

   | Key | Value |
   |-----|-------|
   | `SIH_ADMIN_EMAIL` | `admin@trustinonline.in` |
   | `SIH_ADMIN_PASSWORD` | a strong password only you know |
   | `SUPABASE_URL` | `https://fatwvkswuklpjvusmjsb.supabase.co` |
   | `SUPABASE_KEY` | your Supabase **service_role** key (see below) |

   (`SIH_SECRET` auto-generates.)
3. Click **Apply** → live in ~2–5 min at **https://sih2026.onrender.com**.

## Where to get the SUPABASE_KEY (service_role)
1. Open: https://supabase.com/dashboard/project/fatwvkswuklpjvusmjsb/settings/api
2. Scroll to **Project API keys** → find **`service_role`** (marked *secret*) → click **Reveal** → **Copy**.
3. Paste it as `SUPABASE_KEY` in Render.

> Use the **service_role** key (not anon). It stays server-side only and is never exposed to the browser. The `sih_appstate` table has Row-Level Security ON, so only this key can read/write your student data.

## After deploy
- Students: `https://sih2026.onrender.com/` → **Apply** / **Join team**
- You: same URL → **Log in** tab → `admin@trustinonline.in` + your password → admin dashboard
- The recruitment QR auto-points to the live URL.

## Free-tier notes (fine for the campaign)
- Render free service **sleeps after 15 min idle**; first visit after that takes ~50s to wake. No data loss — data is in Supabase.
- Supabase free project **pauses after ~1 week of no activity**. Regular use during the campaign keeps it awake; if it ever pauses, open the Supabase dashboard once to restore it.

## Local dev
Without `SUPABASE_URL`/`SUPABASE_KEY`, the app falls back to a local `data/db.json` file — so `npm start` still works offline.
