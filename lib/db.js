// Storage layer. Uses Supabase (free, persistent) when SUPABASE_URL + SUPABASE_KEY are set,
// otherwise falls back to a local JSON file (for local dev). Data is held in memory and
// persisted on write; reads are always from memory. Single-instance model.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SIH_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_KEY || '';
const USE_SB = !!(SB_URL && SB_KEY);
const TABLE = 'sih_appstate';
const ROW_ID = 1;

const empty = {
  meta: { seq: 1 }, users: [], teams: [], ideas: [], milestones: [], submissions: [], comments: [], pods: []
};

// Stable object reference — never reassigned, always mutated in place, so
// modules that captured `db` via destructuring keep seeing current data.
const db = JSON.parse(JSON.stringify(empty));
function replaceContents(obj) {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, JSON.parse(JSON.stringify(empty)), obj || {});
}

/* ---------- Supabase (REST via built-in fetch) ---------- */
function sbHeaders() { return { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }; }
async function sbLoad() {
  const url = SB_URL + '/rest/v1/' + TABLE + '?id=eq.' + ROW_ID + '&select=data';
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(url, { headers: sbHeaders() });
      if (r.ok) {
        const rows = await r.json();
        if (rows.length && rows[0].data) replaceContents(rows[0].data);
        else { replaceContents(empty); await sbSave(); } // seed the row
        return;
      }
      if (r.status !== 503 && r.status !== 502) throw new Error('Supabase load ' + r.status + ': ' + (await r.text()));
    } catch (e) { if (attempt === 5) throw e; }
    await new Promise(res => setTimeout(res, 1500 * attempt)); // project may be waking up
  }
}
async function sbSave() {
  const url = SB_URL + '/rest/v1/' + TABLE + '?on_conflict=id';
  const r = await fetch(url, { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates' }, sbHeaders()), body: JSON.stringify([{ id: ROW_ID, data: db }]) });
  if (!r.ok) throw new Error('Supabase save ' + r.status + ': ' + (await r.text()));
}

/* ---------- local file ---------- */
function fileLoad() {
  if (fs.existsSync(FILE)) { try { replaceContents(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { replaceContents(empty); } }
  else replaceContents(empty);
}
function fileSave() { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, FILE); }

/* ---------- public API ---------- */
async function init() {
  if (USE_SB) { await sbLoad(); console.log('[db] persistence: Supabase (' + SB_URL + ')'); }
  else { fileLoad(); console.log('[db] persistence: local file (' + FILE + ')'); }
}

let timer = null, saving = false, dirty = false;
function save() {
  if (!USE_SB) { try { fileSave(); } catch (e) { console.error('[db] file save failed:', e.message); } return; }
  dirty = true;
  if (!timer) timer = setTimeout(flush, 400); // debounce remote writes
}
async function flush() {
  timer = null;
  if (!dirty || saving) return;
  saving = true; dirty = false;
  try { await sbSave(); } catch (e) { console.error('[db] Supabase save failed:', e.message); dirty = true; }
  saving = false;
  if (dirty && !timer) timer = setTimeout(flush, 800);
}

function nextId() { return db.meta.seq++; }

module.exports = { db, save, init, nextId };
