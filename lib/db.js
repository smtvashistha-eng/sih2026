// Tiny zero-dependency JSON store. In-memory with atomic file persistence.
// Fine for an internal tool at ~30 teams / ~200 users scale.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SIH_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const empty = {
  meta: { seq: 1 },
  users: [],
  teams: [],
  ideas: [],
  milestones: [],
  submissions: [],
  comments: [],
  pods: []
};

let db;
function load() {
  if (fs.existsSync(FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
      console.error('DB parse failed, starting fresh:', e.message);
      db = JSON.parse(JSON.stringify(empty));
    }
  } else {
    db = JSON.parse(JSON.stringify(empty));
  }
  return db;
}
load();

let saveTimer = null;
function save() {
  // debounce rapid writes, but always flush on demand
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

function nextId() {
  return db.meta.seq++;
}

module.exports = { db, save, load, nextId };
