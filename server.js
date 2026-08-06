const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { db, save, nextId } = require('./lib/db');
const { hashPassword, verifyPassword, signSession, verifySession, MAX_AGE_MS } = require('./lib/auth');
const seed = require('./lib/seed');

seed();
if (!Array.isArray(db.comments)) { db.comments = []; save(); }

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- helpers ---------------- */
function getUser(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sih_session=([^;]+)/);
  if (!m) return null;
  const uid = verifySession(decodeURIComponent(m[1]));
  if (!uid) return null;
  return db.users.find(u => String(u.id) === String(uid)) || null;
}
function setSession(res, userId) {
  res.setHeader('Set-Cookie', 'sih_session=' + encodeURIComponent(signSession(userId)) +
    '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + Math.floor(MAX_AGE_MS / 1000));
}
function clearSession(res) { res.setHeader('Set-Cookie', 'sih_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'); }
function isCore(u) { return u && (u.role === 'admin' || u.role === 'lead'); }
function clean(s, n) { return String(s == null ? '' : s).trim().slice(0, n || 200); }
function genTeamCode() {
  if (!db.meta.teamSeq) db.meta.teamSeq = 0;
  db.meta.teamSeq += 1;
  return 'SIH-' + String(db.meta.teamSeq).padStart(2, '0');
}
function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = ''; const b = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) s += chars[b[i] % chars.length];
  return s;
}
function progressFor(userId) {
  const total = db.milestones.length;
  const subs = db.submissions.filter(s => s.userId === userId);
  const approved = subs.filter(s => s.status === 'approved').length;
  const pending = subs.filter(s => s.status === 'submitted').length;
  const changes = subs.filter(s => s.status === 'changes').length;
  return { total, approved, pending, changes, submitted: subs.length, pct: total ? Math.round(approved / total * 100) : 0 };
}
function selfView(u) {
  if (!u) return null;
  return {
    id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, college: u.college,
    branch: u.branch, year: u.year, skills: u.skills,
    hasOwnIdea: u.hasOwnIdea, ownIdeaText: u.ownIdeaText, wantsLeader: u.wantsLeader,
    status: u.status, interview: u.interview || {},
    teamCode: u.teamCode || '', teamName: u.teamName || '', pod: u.pod || 'Flex',
    ideaId: u.ideaId || null, backupIdeaId: u.backupIdeaId || null, psId: u.psId || '', psCount: u.psCount == null ? null : u.psCount,
    members: u.members || [], femaleCount: u.femaleCount || 0,
    signedAgreement: !!u.signedAgreement, signedName: u.signedName || '', signedAt: u.signedAt || null,
    directives: u.directives || [],
    teamOf: u.teamOf || null, isCaptain: u.status === 'Selected'
  };
}
// The "team" a user belongs to is always the captain's record (a Selected member).
function resolveTeam(u) {
  if (!u) return null;
  if (u.status === 'Selected') return u;              // captain
  if (u.teamOf) { const cap = db.users.find(x => x.id === u.teamOf); if (cap && cap.status === 'Selected') return cap; }
  return null;
}
function teamContext(u) {
  const cap = resolveTeam(u);
  if (!cap) return null;
  const idea = db.ideas.find(i => i.id === cap.ideaId);
  const backup = db.ideas.find(i => i.id === cap.backupIdeaId);
  const memberAccounts = db.users.filter(x => x.teamOf === cap.id).map(x => ({ id: x.id, name: x.name, email: x.email }));
  return {
    captainId: cap.id, teamCode: cap.teamCode, teamName: cap.teamName || cap.name, captainName: cap.name, pod: cap.pod,
    ideaId: cap.ideaId, ideaName: idea ? idea.name : null, backupIdeaId: cap.backupIdeaId, backupName: backup ? backup.name : null,
    psId: cap.psId, psCount: cap.psCount == null ? null : cap.psCount,
    members: cap.members || [], femaleCount: cap.femaleCount, wantsLeader: cap.wantsLeader, ownIdeaText: cap.ownIdeaText,
    directives: cap.directives || [], signedByCaptain: !!cap.signedAgreement,
    teamPassword: (u.id === cap.id) ? (cap.teamPasswordPlain || '') : undefined,
    memberAccounts, isCaptain: u.id === cap.id
  };
}
function requireAuth(req, res, next) { const u = getUser(req); if (!u) return res.status(401).json({ error: 'Please log in.' }); req.me = u; next(); }
function requireCore(req, res, next) { const u = getUser(req); if (!isCore(u)) return res.status(403).json({ error: 'Core team only.' }); req.me = u; next(); }
function requireActiveTeam(req, res, next) {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Please log in.' });
  const team = resolveTeam(u);
  if (!team) return res.status(403).json({ error: 'You are not on an active team yet.' });
  if (!u.signedAgreement) return res.status(403).json({ error: 'Sign the agreement first.' });
  req.me = u; req.team = team; next();
}

/* ---------------- apply / auth ---------------- */
app.post('/api/apply', (req, res) => {
  const b = req.body || {};
  const email = clean(b.email, 120).toLowerCase();
  const password = String(b.password || '');
  const name = clean(b.name, 80);
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (db.users.find(u => u.email === email)) return res.status(409).json({ error: 'This email has already applied.' });

  const hasOwnIdea = !!b.hasOwnIdea;
  const id = nextId();
  db.users.push({
    id, role: 'member', name, email, pass: hashPassword(password),
    phone: clean(b.phone, 20), college: clean(b.college, 120), branch: clean(b.branch, 60),
    year: clean(b.year, 20), skills: clean(b.skills, 300),
    hasOwnIdea, ownIdeaText: hasOwnIdea ? clean(b.ownIdeaText, 500) : '',
    wantsLeader: hasOwnIdea && !!b.wantsLeader,
    status: 'Applied', interview: { datetime: '', location: '', zoom: '', note: '' },
    teamCode: '', teamName: '', teamPasswordPlain: '', pod: 'Flex', teamOf: null,
    ideaId: null, backupIdeaId: null, psId: '', psCount: null, members: [], femaleCount: 0,
    signedAgreement: false, signedName: '', signedAt: null, directives: [], createdAt: Date.now()
  });
  save();
  setSession(res, id);
  res.json({ ok: true, user: selfView(db.users.find(u => u.id === id)) });
});

// A team member joins an existing selected team with the Team ID + team password.
app.post('/api/join', (req, res) => {
  const b = req.body || {};
  const code = clean(b.teamCode, 20).toLowerCase();
  const teamPass = String(b.teamPassword || '');
  const name = clean(b.name, 80);
  const email = clean(b.email, 120).toLowerCase();
  const password = String(b.password || '');
  if (!name || !email || !password || !code || !teamPass) return res.status(400).json({ error: 'Fill your name, email, password, and the Team ID + team password.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (!b.agree) return res.status(400).json({ error: 'You must accept the team agreement to join.' });
  if (db.users.find(u => u.email === email)) return res.status(409).json({ error: 'This email is already registered.' });
  const cap = db.users.find(u => (u.teamCode || '').toLowerCase() === code && u.status === 'Selected');
  if (!cap || !cap.teamPasswordPlain || cap.teamPasswordPlain !== teamPass) return res.status(401).json({ error: 'Wrong Team ID or team password. Ask your captain.' });
  const current = db.users.filter(u => u.teamOf === cap.id).length + 1; // +captain
  if (current >= 6) return res.status(409).json({ error: 'This team already has 6 members.' });

  const id = nextId();
  db.users.push({
    id, role: 'student', name, email, pass: hashPassword(password), teamOf: cap.id,
    status: 'Member', signedAgreement: true, signedName: name, signedAt: Date.now(),
    directives: [], createdAt: Date.now()
  });
  if (!Array.isArray(cap.members)) cap.members = [];
  if (!cap.members.includes(name) && cap.members.length < 6) cap.members.push(name);
  save();
  setSession(res, id);
  res.json({ ok: true, user: selfView(db.users.find(u => u.id === id)) });
});

app.post('/api/login', (req, res) => {
  const idf = clean((req.body || {}).identifier, 120).toLowerCase();
  const password = String((req.body || {}).password || '');
  // email + account password
  let user = db.users.find(u => u.email === idf);
  if (user && verifyPassword(password, user.pass)) { setSession(res, user.id); return res.json({ ok: true, user: selfView(user) }); }
  // team code + team password (case-insensitive code)
  const byCode = db.users.find(u => (u.teamCode || '').toLowerCase() === idf);
  if (byCode && byCode.teamPasswordPlain && byCode.teamPasswordPlain === password) { setSession(res, byCode.id); return res.json({ ok: true, user: selfView(byCode) }); }
  return res.status(401).json({ error: 'Wrong login or password.' });
});

app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });
app.get('/api/me', (req, res) => { const u = getUser(req); res.json({ user: selfView(u) }); });

/* ---------------- reference ---------------- */
app.get('/api/ideas', (req, res) => res.json(db.ideas));
app.get('/api/milestones', (req, res) => res.json(db.milestones.slice().sort((a, b) => a.order - b.order)));
app.get('/api/pods', (req, res) => res.json(db.pods));

app.get('/api/qr.png', async (req, res) => {
  const data = clean(req.query.data, 500) || 'https://';
  try {
    const buf = await QRCode.toBuffer(data, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#141821ff', light: '#ffffffff' } });
    res.type('png').set('Cache-Control', 'no-store').send(buf);
  } catch (e) { res.status(400).end(); }
});

/* ---------------- member (applicant / team) ---------------- */
app.get('/api/my', requireAuth, (req, res) => res.json({ user: selfView(req.me), team: teamContext(req.me) }));

app.post('/api/my/sign', requireAuth, (req, res) => {
  const u = req.me;
  if (u.status !== 'Selected') return res.status(403).json({ error: 'You are not selected yet.' });
  const signedName = clean((req.body || {}).signedName, 80);
  if (!signedName) return res.status(400).json({ error: 'Type your full name to sign.' });
  if (!(req.body || {}).agree) return res.status(400).json({ error: 'You must tick the agreement box.' });
  u.signedAgreement = true; u.signedName = signedName; u.signedAt = Date.now();
  save(); res.json({ ok: true, user: selfView(u) });
});

app.put('/api/my/team', requireActiveTeam, (req, res) => {
  const t = req.team, b = req.body || {};
  if (b.teamName !== undefined) t.teamName = clean(b.teamName, 60);
  if (b.ideaId !== undefined && !t.wantsLeader) t.ideaId = b.ideaId ? parseInt(b.ideaId, 10) : null;
  if (b.backupIdeaId !== undefined && !t.wantsLeader) t.backupIdeaId = b.backupIdeaId ? parseInt(b.backupIdeaId, 10) : null;
  if (b.psId !== undefined) t.psId = clean(b.psId, 40);
  if (b.psCount !== undefined) t.psCount = b.psCount === '' || b.psCount === null ? null : Math.max(0, parseInt(b.psCount, 10) || 0);
  if (b.members !== undefined && Array.isArray(b.members)) t.members = b.members.map(x => clean(x, 60)).filter(Boolean).slice(0, 6);
  if (b.femaleCount !== undefined) t.femaleCount = Math.max(0, parseInt(b.femaleCount, 10) || 0);
  if (b.pod !== undefined && db.pods.includes(b.pod)) t.pod = b.pod;
  save(); res.json({ ok: true, team: teamContext(req.me) });
});

app.get('/api/my/submissions', requireActiveTeam, (req, res) => res.json(db.submissions.filter(s => s.userId === req.team.id)));

app.post('/api/my/submission', requireActiveTeam, (req, res) => {
  const b = req.body || {}; const milestoneId = parseInt(b.milestoneId, 10);
  const ms = db.milestones.find(m => m.id === milestoneId);
  if (!ms) return res.status(400).json({ error: 'Unknown target.' });
  const fields = { github: clean(b.github, 500), deck: clean(b.deck, 500), demo: clean(b.demo, 500), live: clean(b.live, 500), notes: clean(b.notes, 500) };
  if (!fields.github && !fields.deck && !fields.demo && !fields.live && !fields.notes)
    return res.status(400).json({ error: 'Add at least one link or a note.' });
  let sub = db.submissions.find(s => s.userId === req.team.id && s.milestoneId === milestoneId);
  if (sub) Object.assign(sub, fields, { status: 'submitted', updatedAt: Date.now(), by: req.me.name });
  else { sub = Object.assign({ id: nextId(), userId: req.team.id, milestoneId, status: 'submitted', feedback: '', by: req.me.name, createdAt: Date.now(), updatedAt: Date.now() }, fields); db.submissions.push(sub); }
  save(); res.json({ ok: true, submission: sub });
});

app.post('/api/my/directive/:did/ack', requireActiveTeam, (req, res) => {
  const d = (req.team.directives || []).find(x => x.id === parseInt(req.params.did, 10));
  if (!d) return res.status(404).json({ error: 'Not found' });
  d.done = true; save(); res.json({ ok: true });
});

// ---- team chat (comments) ----
app.get('/api/my/comments', requireActiveTeam, (req, res) => {
  res.json(db.comments.filter(c => c.teamId === req.team.id).sort((a, b) => a.at - b.at));
});
app.post('/api/my/comment', requireActiveTeam, (req, res) => {
  const text = clean((req.body || {}).text, 800);
  if (!text) return res.status(400).json({ error: 'Type a message.' });
  const c = { id: nextId(), teamId: req.team.id, authorId: req.me.id, authorName: req.me.name, role: req.me.isCaptain ? 'captain' : 'member', text, at: Date.now() };
  db.comments.push(c); save(); res.json({ ok: true, comment: c });
});

/* ---------------- core team ---------------- */
function adminRow(u) {
  const prog = progressFor(u.id);
  const idea = db.ideas.find(i => i.id === u.ideaId);
  const odds = u.psCount ? Math.min(100, 5 / u.psCount * 100) : null;
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, college: u.college, branch: u.branch, year: u.year, skills: u.skills,
    hasOwnIdea: u.hasOwnIdea, ownIdeaText: u.ownIdeaText, wantsLeader: u.wantsLeader,
    status: u.status, interview: u.interview || {},
    teamCode: u.teamCode, teamName: u.teamName, teamPassword: u.teamPasswordPlain || '',
    pod: u.pod, ideaId: u.ideaId, ideaName: idea ? idea.name : null, ideaZone: idea ? idea.zone : null,
    psId: u.psId, psCount: u.psCount, odds, members: u.members || [], femaleCount: u.femaleCount,
    signedAgreement: !!u.signedAgreement, signedName: u.signedName, signedAt: u.signedAt,
    directives: u.directives || [], progress: prog, createdAt: u.createdAt
  };
}
app.get('/api/admin/overview', requireCore, (req, res) => {
  const members = db.users.filter(u => u.role === 'member').map(adminRow);
  const applicants = members.filter(m => m.status === 'Applied' || m.status === 'Interview');
  const teams = members.filter(m => m.status === 'Selected');
  const stats = {
    applicants: applicants.length,
    interviews: members.filter(m => m.status === 'Interview').length,
    teams: teams.length,
    signed: teams.filter(t => t.signedAgreement).length,
    needsReview: db.submissions.filter(s => s.status === 'submitted').length,
    atRisk: teams.filter(t => t.progress.pct < 25).length,
    avgProgress: teams.length ? Math.round(teams.reduce((a, t) => a + t.progress.pct, 0) / teams.length) : 0
  };
  res.json({ stats, applicants, teams, ideas: db.ideas, pods: db.pods });
});

app.get('/api/admin/user/:id', requireCore, (req, res) => {
  const u = db.users.find(x => x.id === parseInt(req.params.id, 10) && x.role === 'member');
  if (!u) return res.status(404).json({ error: 'Not found' });
  const timeline = db.milestones.slice().sort((a, b) => a.order - b.order).map(m => ({ milestone: m, submission: db.submissions.find(s => s.userId === u.id && s.milestoneId === m.id) || null }));
  const memberAccounts = db.users.filter(x => x.teamOf === u.id).map(x => ({ id: x.id, name: x.name, email: x.email }));
  const comments = db.comments.filter(c => c.teamId === u.id).sort((a, b) => a.at - b.at);
  res.json({ user: adminRow(u), idea: db.ideas.find(i => i.id === u.ideaId) || null, backup: db.ideas.find(i => i.id === u.backupIdeaId) || null, timeline, memberAccounts, comments });
});

app.post('/api/admin/user/:id/comment', requireCore, (req, res) => {
  const u = db.users.find(x => x.id === parseInt(req.params.id, 10) && x.role === 'member');
  if (!u) return res.status(404).json({ error: 'Not found' });
  const text = clean((req.body || {}).text, 800);
  if (!text) return res.status(400).json({ error: 'Type a message.' });
  const c = { id: nextId(), teamId: u.id, authorId: req.me.id, authorName: req.me.name, role: 'core', text, at: Date.now() };
  db.comments.push(c); save(); res.json({ ok: true, comment: c });
});

app.put('/api/admin/user/:id/interview', requireCore, (req, res) => {
  const u = db.users.find(x => x.id === parseInt(req.params.id, 10) && x.role === 'member');
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  u.interview = { datetime: clean(b.datetime, 40), location: clean(b.location, 160), zoom: clean(b.zoom, 300), note: clean(b.note, 300) };
  if (u.status === 'Applied' && (u.interview.datetime || u.interview.zoom || u.interview.location)) u.status = 'Interview';
  save(); res.json({ ok: true, user: adminRow(u) });
});

app.put('/api/admin/user/:id/status', requireCore, (req, res) => {
  const u = db.users.find(x => x.id === parseInt(req.params.id, 10) && x.role === 'member');
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const allowed = ['Applied', 'Interview', 'Selected', 'Rejected', 'Removed'];
  if (!allowed.includes(b.status)) return res.status(400).json({ error: 'Bad status' });
  u.status = b.status;
  if (b.status === 'Selected') {
    if (!u.teamCode) u.teamCode = genTeamCode();
    if (!u.teamPasswordPlain || b.regenerate) u.teamPasswordPlain = genPassword();
    if (!u.teamName) u.teamName = u.name.split(' ')[0] + "'s Team";
    if (b.ideaId && !u.wantsLeader) u.ideaId = parseInt(b.ideaId, 10);
    if (b.pod && db.pods.includes(b.pod)) u.pod = b.pod;
  }
  save(); res.json({ ok: true, user: adminRow(u) });
});

app.put('/api/admin/user/:id', requireCore, (req, res) => {
  const u = db.users.find(x => x.id === parseInt(req.params.id, 10) && x.role === 'member');
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.pod && db.pods.includes(b.pod)) u.pod = b.pod;
  if (b.ideaId !== undefined && !u.wantsLeader) u.ideaId = b.ideaId ? parseInt(b.ideaId, 10) : null;
  if (b.teamName !== undefined) u.teamName = clean(b.teamName, 60);
  save(); res.json({ ok: true, user: adminRow(u) });
});

app.post('/api/admin/user/:id/directive', requireCore, (req, res) => {
  const u = db.users.find(x => x.id === parseInt(req.params.id, 10) && x.role === 'member');
  if (!u) return res.status(404).json({ error: 'Not found' });
  const text = clean((req.body || {}).text, 400);
  if (!text) return res.status(400).json({ error: 'Text required' });
  if (!Array.isArray(u.directives)) u.directives = [];
  u.directives.unshift({ id: nextId(), text, by: req.me.name, at: Date.now(), done: false });
  save(); res.json({ ok: true, directives: u.directives });
});

app.post('/api/admin/review', requireCore, (req, res) => {
  const b = req.body || {};
  const sub = db.submissions.find(s => s.id === parseInt(b.submissionId, 10));
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  const status = b.status === 'approved' ? 'approved' : (b.status === 'changes' ? 'changes' : null);
  if (!status) return res.status(400).json({ error: 'Bad status' });
  sub.status = status; sub.feedback = clean(b.feedback, 1000); sub.reviewedBy = req.me.name; sub.reviewedAt = Date.now();
  save(); res.json({ ok: true, submission: sub });
});

app.delete('/api/admin/user/:id', requireCore, (req, res) => {
  const idn = parseInt(req.params.id, 10);
  const u = db.users.find(x => x.id === idn && x.role === 'member');
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.submissions = db.submissions.filter(s => s.userId !== idn);
  db.comments = db.comments.filter(c => c.teamId !== idn);
  db.users = db.users.filter(x => x.id !== idn && x.teamOf !== idn); // remove captain + joined members
  save(); res.json({ ok: true });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('SIH Command Center running on http://localhost:' + PORT));
