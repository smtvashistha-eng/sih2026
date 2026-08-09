const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { db, save, nextId, init } = require('./lib/db');
const { hashPassword, verifyPassword, signSession, verifySession, MAX_AGE_MS } = require('./lib/auth');
const seed = require('./lib/seed');

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

// Public aggregate stats for the homepage (counts only — no personal data).
app.get('/api/stats', (req, res) => {
  const members = db.users.filter(u => u.role === 'member');
  const registered = db.users.filter(u => u.role === 'member' || u.role === 'student').length;
  const teams = members.filter(m => m.status === 'Selected').length;
  const interviews = members.filter(m => m.status === 'Interview').length;
  const mentors = db.users.filter(u => u.role === 'admin' || u.role === 'lead').length;
  const projects = new Set(db.submissions.map(s => s.userId)).size; // teams that have started building
  const applied = members.length;
  const selectionRate = applied ? Math.round((teams / applied) * 100) : 0;
  res.json({ registered, teams, interviews, mentors, projects, selectionRate, winTarget: 6 });
});

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
  db.comments.push(c); save();
  try { emitToTeam(c.teamId, 'message', c); } catch (e) {}
  res.json({ ok: true, comment: c });
});

/* ---------------- tasks (Phase 2) ----------------
   A task belongs to a team (teamId = captain's user id). Roles:
   - core (admin/lead): full control over any team's tasks
   - leader (captain, u.id === team.id): create/edit/cancel/verify/reassign own team's tasks
   - member (assignee): accept / reject(+reason) / progress / complete their OWN assigned task
   Members can only see tasks assigned to them; leaders/core see all team tasks. */
const TASK_STATES = ['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'REJECTED', 'CANCELLED'];
const TASK_PRIOS = ['low', 'medium', 'high'];
function teamMemberIds(capId) { const ids = [capId]; db.users.filter(u => u.teamOf === capId).forEach(u => ids.push(u.id)); return ids; }
function nameOf(id) { const u = db.users.find(x => x.id === id); return u ? u.name : ''; }
function isLeaderOf(u, teamId) { const cap = resolveTeam(u); return !!(cap && cap.id === teamId && cap.id === u.id); }
function canManageTask(u, t) { return isCore(u) || isLeaderOf(u, t.teamId); }
function logActivity(teamId, text, meta) { db.activityLog.push({ id: nextId(), teamId, text, meta: meta || {}, at: Date.now() }); if (db.activityLog.length > 500) db.activityLog.splice(0, db.activityLog.length - 500); }
function findTask(req, res) { const t = db.tasks.find(x => x.id === parseInt(req.params.id, 10)); if (!t) { res.status(404).json({ error: 'Task not found.' }); return null; } return t; }

// List the caller's team tasks (members: only theirs; leader/core: all for the team).
app.get('/api/my/tasks', requireActiveTeam, (req, res) => {
  const teamId = req.team.id;
  const isLeader = req.me.id === teamId;
  let tasks = db.tasks.filter(t => t.teamId === teamId);
  if (!isLeader) tasks = tasks.filter(t => t.assignedTo === req.me.id);
  tasks = tasks.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json({ tasks, isLeader, members: teamMemberIds(teamId).map(id => ({ id, name: nameOf(id), isLeader: id === teamId })) });
});

// Create a task. Leader (own team) or core (any team via body.teamId).
app.post('/api/tasks', requireAuth, (req, res) => {
  const b = req.body || {};
  const core = isCore(req.me);
  const cap = resolveTeam(req.me);
  const leader = !!(cap && cap.id === req.me.id);
  if (!core && !leader) return res.status(403).json({ error: 'Only the team leader or core team can create tasks.' });
  const teamId = core ? parseInt(b.teamId, 10) : cap.id;
  const team = db.users.find(u => u.id === teamId && u.status === 'Selected');
  if (!team) return res.status(404).json({ error: 'Team not found.' });
  const title = clean(b.title, 160);
  if (!title) return res.status(400).json({ error: 'Task title is required.' });
  const assignedTo = b.assignedTo === '' || b.assignedTo == null ? null : parseInt(b.assignedTo, 10);
  if (!assignedTo || !teamMemberIds(teamId).includes(assignedTo)) return res.status(400).json({ error: 'Pick an assignee who is on this team.' });
  const priority = TASK_PRIOS.includes(b.priority) ? b.priority : 'medium';
  const t = {
    id: nextId(), teamId, title, description: clean(b.description, 2000),
    createdBy: req.me.id, createdByName: req.me.name, createdByRole: core ? 'core' : 'leader',
    assignedTo, assignedToName: nameOf(assignedTo), priority, deadline: clean(b.deadline, 30),
    status: 'PENDING_ACCEPTANCE', rejectionReason: '', progress: 0,
    createdAt: Date.now(), updatedAt: Date.now(), completedAt: null, verifiedAt: null
  };
  db.tasks.push(t); logActivity(teamId, (core ? 'Core team' : req.me.name) + ' assigned "' + title + '" to ' + t.assignedToName, { type: 'task', taskId: t.id }); save();
  try { emitToTeam(teamId, 'task', { action: 'created', task: t }); } catch (e) {}
  res.json({ ok: true, task: t });
});

// Assignee accepts.
app.post('/api/tasks/:id/accept', requireAuth, (req, res) => {
  const t = findTask(req, res); if (!t) return;
  if (t.assignedTo !== req.me.id) return res.status(403).json({ error: 'Only the assignee can accept this task.' });
  if (t.status !== 'PENDING_ACCEPTANCE') return res.status(400).json({ error: 'This task is not awaiting acceptance.' });
  t.status = 'ACCEPTED'; t.updatedAt = Date.now();
  logActivity(t.teamId, req.me.name + ' accepted "' + t.title + '"', { type: 'task', taskId: t.id }); save();
  try { emitToTeam(t.teamId, 'task', { action: 'accepted', task: t }); } catch (e) {}
  res.json({ ok: true, task: t });
});

// Assignee rejects with a required reason.
app.post('/api/tasks/:id/reject', requireAuth, (req, res) => {
  const t = findTask(req, res); if (!t) return;
  if (t.assignedTo !== req.me.id) return res.status(403).json({ error: 'Only the assignee can reject this task.' });
  if (t.status !== 'PENDING_ACCEPTANCE') return res.status(400).json({ error: 'This task is not awaiting acceptance.' });
  const reason = clean((req.body || {}).reason, 500);
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required.' });
  t.status = 'REJECTED'; t.rejectionReason = reason; t.updatedAt = Date.now();
  logActivity(t.teamId, req.me.name + ' rejected "' + t.title + '": ' + reason, { type: 'task', taskId: t.id }); save();
  try { emitToTeam(t.teamId, 'task', { action: 'rejected', task: t }); } catch (e) {}
  res.json({ ok: true, task: t });
});

// Assignee advances progress (ACCEPTED -> IN_PROGRESS -> COMPLETED).
app.post('/api/tasks/:id/status', requireAuth, (req, res) => {
  const t = findTask(req, res); if (!t) return;
  const s = (req.body || {}).status;
  if (!TASK_STATES.includes(s)) return res.status(400).json({ error: 'Bad status.' });
  const assignee = t.assignedTo === req.me.id;
  const manager = canManageTask(req.me, t);
  if (!assignee && !manager) return res.status(403).json({ error: 'Not allowed.' });
  if (assignee && !manager) {
    const ok = (s === 'IN_PROGRESS' && ['ACCEPTED', 'IN_PROGRESS'].includes(t.status)) ||
               (s === 'COMPLETED' && ['ACCEPTED', 'IN_PROGRESS'].includes(t.status));
    if (!ok) return res.status(400).json({ error: 'You can only start or complete an accepted task.' });
  }
  if (s === 'COMPLETED') { t.completedAt = Date.now(); t.progress = 100; }
  if (s === 'IN_PROGRESS' && (req.body || {}).progress != null) t.progress = Math.max(0, Math.min(100, parseInt(req.body.progress, 10) || 0));
  t.status = s; t.updatedAt = Date.now();
  logActivity(t.teamId, req.me.name + ' set "' + t.title + '" to ' + s.toLowerCase().replace('_', ' '), { type: 'task', taskId: t.id }); save();
  try { emitToTeam(t.teamId, 'task', { action: 'status', task: t }); } catch (e) {}
  res.json({ ok: true, task: t });
});

// Leader/core verifies a completed task.
app.post('/api/tasks/:id/verify', requireAuth, (req, res) => {
  const t = findTask(req, res); if (!t) return;
  if (!canManageTask(req.me, t)) return res.status(403).json({ error: 'Only the team leader or core team can verify.' });
  if (t.status !== 'COMPLETED') return res.status(400).json({ error: 'Task must be completed first.' });
  t.status = 'VERIFIED'; t.verifiedAt = Date.now(); t.progress = 100; t.updatedAt = Date.now();
  logActivity(t.teamId, req.me.name + ' verified "' + t.title + '"', { type: 'task', taskId: t.id }); save();
  try { emitToTeam(t.teamId, 'task', { action: 'verified', task: t }); } catch (e) {}
  res.json({ ok: true, task: t });
});

// Leader/core edits (title, description, priority, deadline, reassign).
app.put('/api/tasks/:id', requireAuth, (req, res) => {
  const t = findTask(req, res); if (!t) return;
  if (!canManageTask(req.me, t)) return res.status(403).json({ error: 'Only the team leader or core team can edit.' });
  const b = req.body || {};
  if (b.title !== undefined) { const ti = clean(b.title, 160); if (ti) t.title = ti; }
  if (b.description !== undefined) t.description = clean(b.description, 2000);
  if (b.priority !== undefined && TASK_PRIOS.includes(b.priority)) t.priority = b.priority;
  if (b.deadline !== undefined) t.deadline = clean(b.deadline, 30);
  if (b.assignedTo !== undefined) {
    const aid = b.assignedTo ? parseInt(b.assignedTo, 10) : null;
    if (!aid || !teamMemberIds(t.teamId).includes(aid)) return res.status(400).json({ error: 'Assignee must be on this team.' });
    if (aid !== t.assignedTo) { t.assignedTo = aid; t.assignedToName = nameOf(aid); t.status = 'PENDING_ACCEPTANCE'; t.rejectionReason = ''; t.progress = 0; }
  }
  t.updatedAt = Date.now();
  logActivity(t.teamId, req.me.name + ' updated "' + t.title + '"', { type: 'task', taskId: t.id }); save();
  try { emitToTeam(t.teamId, 'task', { action: 'updated', task: t }); } catch (e) {}
  res.json({ ok: true, task: t });
});

// Leader/core cancels a task.
app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const t = findTask(req, res); if (!t) return;
  if (!canManageTask(req.me, t)) return res.status(403).json({ error: 'Not allowed.' });
  t.status = 'CANCELLED'; t.updatedAt = Date.now();
  logActivity(t.teamId, req.me.name + ' cancelled "' + t.title + '"', { type: 'task', taskId: t.id }); save();
  try { emitToTeam(t.teamId, 'task', { action: 'cancelled', task: t }); } catch (e) {}
  res.json({ ok: true, task: t });
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
  db.comments.push(c); save();
  try { emitToTeam(c.teamId, 'message', c); } catch (e) {}
  res.json({ ok: true, comment: c });
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

/* ==================== SIH Connect (additive · server-side auth · SSE realtime) ====================
   Reuses existing session auth + team membership (resolveTeam) + the existing db.comments store.
   Team messages written here also appear in the workspace/admin chat and vice-versa (one source). */
const sseClients = new Map(); // userId(string) -> Set<res>
function connTeamMemberIds(teamId) {
  const ids = new Set();
  db.users.forEach(u => { if (u.id === teamId || u.teamOf === teamId) ids.add(u.id); });
  db.users.forEach(u => { if (u.role === 'admin' || u.role === 'lead') ids.add(u.id); }); // core team follows all
  return ids;
}
function emitToTeam(teamId, event, payload) {
  const ids = connTeamMemberIds(teamId);
  for (const [uid, set] of sseClients) {
    if (!ids.has(Number(uid))) continue;
    for (const res of set) { try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n'); } catch (e) {} }
  }
}
function connCanAccess(u, teamId) {
  if (!u) return false;
  if (u.role === 'admin' || u.role === 'lead') return true;
  const t = resolveTeam(u); return !!(t && t.id === teamId);
}
function connConversations(u) {
  let teams;
  if (u.role === 'admin' || u.role === 'lead') teams = db.users.filter(x => x.role === 'member' && x.status === 'Selected');
  else { const t = resolveTeam(u); teams = t ? [t] : []; }
  const readMap = u.connectReadAt || {};
  return teams.map(t => {
    const msgs = db.comments.filter(c => c.teamId === t.id);
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    const lastRead = readMap[t.id] || 0;
    const unread = msgs.filter(c => c.at > lastRead && c.authorId !== u.id).length;
    return { id: t.id, type: 'team', code: t.teamCode || '', name: t.teamName || t.name, unread, lastText: last ? last.text : '', lastAt: last ? last.at : (t.createdAt || 0), members: (db.users.filter(x => x.teamOf === t.id).length + 1) };
  }).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}
app.get('/api/connect/summary', requireAuth, (req, res) => {
  res.json({ me: { id: req.me.id, name: req.me.name, role: req.me.role, isCaptain: req.me.status === 'Selected' }, conversations: connConversations(req.me) });
});
app.get('/api/connect/messages', requireAuth, (req, res) => {
  const teamId = parseInt(req.query.teamId, 10);
  if (!connCanAccess(req.me, teamId)) return res.status(403).json({ error: 'No access to this conversation.' });
  res.json({ messages: db.comments.filter(c => c.teamId === teamId).slice(-50) });
});
app.post('/api/connect/message', requireAuth, (req, res) => {
  const b = req.body || {}; const teamId = parseInt(b.teamId, 10);
  if (!connCanAccess(req.me, teamId)) return res.status(403).json({ error: 'No access to this conversation.' });
  const text = clean(b.text, 2000);
  if (!text) return res.status(400).json({ error: 'Type a message.' });
  const isCore = req.me.role === 'admin' || req.me.role === 'lead';
  const cap = resolveTeam(req.me); const isCap = !!(cap && cap.id === req.me.id);
  const c = { id: nextId(), teamId, authorId: req.me.id, authorName: req.me.name, role: isCore ? 'core' : (isCap ? 'captain' : 'member'), text, at: Date.now() };
  db.comments.push(c); save();
  emitToTeam(teamId, 'message', c);
  res.json({ ok: true, message: c });
});
app.post('/api/connect/read', requireAuth, (req, res) => {
  const teamId = parseInt((req.body || {}).teamId, 10);
  if (!connCanAccess(req.me, teamId)) return res.status(403).json({ error: 'No access.' });
  if (!req.me.connectReadAt) req.me.connectReadAt = {};
  req.me.connectReadAt[teamId] = Date.now(); save();
  res.json({ ok: true });
});
app.get('/api/connect/stream', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (res.flushHeaders) res.flushHeaders();
  res.write('event: ready\ndata: {}\n\n');
  const uid = String(req.me.id);
  if (!sseClients.has(uid)) sseClients.set(uid, new Set());
  sseClients.get(uid).add(res);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(hb); const set = sseClients.get(uid); if (set) { set.delete(res); if (!set.size) sseClients.delete(uid); } });
});

const PORT = process.env.PORT || 4000;
(async () => {
  await init();
  seed();
  if (!Array.isArray(db.comments)) { db.comments = []; save(); }
  app.listen(PORT, () => console.log('SIH Command Center running on http://localhost:' + PORT));
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });
