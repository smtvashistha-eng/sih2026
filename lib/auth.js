const crypto = require('crypto');

const SECRET = process.env.SIH_SECRET || 'sih2026-change-this-secret-in-production';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + h;
}

function verifyPassword(pw, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const [salt, h] = stored.split(':');
  const hh = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hh, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// token = base64( "<userId>.<timestamp>.<hmac>" )
function signSession(userId) {
  const payload = userId + '.' + Date.now();
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(payload + '.' + sig).toString('base64');
}

function verifySession(token) {
  try {
    const s = Buffer.from(token, 'base64').toString('utf8');
    const i = s.lastIndexOf('.');
    if (i < 0) return null;
    const payload = s.slice(0, i);
    const sig = s.slice(i + 1);
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parts = payload.split('.');
    const userId = parts[0];
    const ts = Number(parts[1]);
    if (!ts || Date.now() - ts > MAX_AGE_MS) return null;
    return userId;
  } catch (e) {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signSession, verifySession, MAX_AGE_MS };
