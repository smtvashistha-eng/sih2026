const { db, save, nextId } = require('./db');
const { hashPassword } = require('./auth');

// zone: open = under-crowded (best odds) | proven = your 2025 strength | mid = selective
const IDEAS = [
  { name: 'RakshaNet', theme: 'Disaster Mgmt', zone: 'open', diff: 3, edge: 'Works with internet OFF on stage — Bluetooth mesh + SMS fallback for floods.' },
  { name: 'AapdaMitra AI', theme: 'Disaster Mgmt', zone: 'open', diff: 2, edge: 'Fuses IMD + river-gauge feeds into a hyperlocal risk score, auto voice-calls villages.' },
  { name: 'DharoharAR', theme: 'Heritage & Culture', zone: 'open', diff: 2, edge: 'Point phone at a ruin → AI rebuilds the original in AR + narrates its story.' },
  { name: 'BhashaBridge', theme: 'Heritage & Culture', zone: 'open', diff: 2, edge: 'Digitises + translates dying manuscripts/scripts into a searchable public archive.' },
  { name: 'YatraSaathi', theme: 'Travel & Tourism', zone: 'open', diff: 2, edge: 'AI planner for temple/heritage circuits: crowd prediction, safety, guide marketplace.' },
  { name: 'SafeSolo', theme: 'Travel & Tourism', zone: 'open', diff: 2, edge: 'Women solo-traveller companion: AI risk zones, verified homestays, mesh panic.' },
  { name: 'FasalDoctor', theme: 'Agri / Rural', zone: 'open', diff: 2, edge: 'On-device crop-disease scan (no internet) + mandi price + govt-scheme matcher by voice.' },
  { name: 'PashuMitra', theme: 'Agri / Rural', zone: 'open', diff: 2, edge: 'Photo/voice AI vet-triage for livestock + vaccine reminders + nearest-vet link.' },
  { name: 'AnnData Trace', theme: 'Agri / Rural', zone: 'open', diff: 2, edge: 'Farm-to-fork traceability + fair-price transparency with lightweight QR.' },
  { name: 'KheloAI', theme: 'Fitness & Sports', zone: 'open', diff: 2, edge: 'Scout rural athletic talent from a phone video via pose estimation → Khelo India.' },
  { name: 'SahiPath', theme: 'Smart Education', zone: 'open', diff: 1, edge: 'AI career + scholarship counsellor for rural students in regional languages.' },
  { name: 'GyaanSetu', theme: 'Smart Education', zone: 'mid', diff: 3, edge: 'Offline AI tutor for low-connectivity govt schools + teacher dashboard.' },
  { name: 'SignSetu', theme: 'Smart Education', zone: 'mid', diff: 3, edge: 'Real-time sign-language ↔ text/speech tutor for deaf students.' },
  { name: 'KachraKart', theme: 'Clean & Green', zone: 'mid', diff: 2, edge: 'Camera waste-segregation + gamified recycling + kabadiwala marketplace for ULBs.' },
  { name: 'SolarSaathi', theme: 'Renewable Energy', zone: 'open', diff: 2, edge: 'Rooftop solar feasibility + subsidy + ROI from roof imagery.' },
  { name: 'NyayaMitra', theme: 'Governance / Misc', zone: 'mid', diff: 1, edge: 'Legal-aid chatbot: explains rights, drafts RTI/FIR/complaints in regional language.' },
  { name: 'SahayakSarkar', theme: 'Governance / Misc', zone: 'mid', diff: 1, edge: 'Answer 5 questions → every central+state scheme you qualify for, and how to apply.' },
  { name: 'ShikayatSetu', theme: 'Governance / Misc', zone: 'mid', diff: 2, edge: 'Photo of a pothole → auto-classify → right department → SLA tracking.' },
  { name: 'ASHA Copilot', theme: 'MedTech / Health', zone: 'mid', diff: 2, edge: 'Offline assistant for ASHA workers: triage, maternal checklists, auto-fills records.' },
  { name: 'DawaiTrack', theme: 'MedTech / Health', zone: 'mid', diff: 2, edge: 'Scan a medicine strip → verify authenticity + expiry + PHC stock.' },
  { name: 'PhishRakshak', theme: 'Cyber / Misc', zone: 'mid', diff: 2, edge: 'Real-time scam-SMS + UPI-fraud detector for elders, regional languages.' },
  { name: 'PramaanID', theme: 'Blockchain / Cyber', zone: 'mid', diff: 3, edge: 'Consent-based verifiable credentials for marksheets/certs — kills fraud.' },
  { name: 'DroneDrishti', theme: 'Robotics & Drones', zone: 'mid', diff: 3, edge: 'Software layer on drone imagery: crop-health / disaster-damage / illegal-construction maps.' },
  { name: 'BusBandhu', theme: 'Transport & Logistics', zone: 'proven', diff: 2, edge: 'Live public-bus tracking + demand routing using only driver phone GPS — no hardware.' },
  { name: 'DocuFlow AI', theme: 'Smart Automation', zone: 'proven', diff: 2, edge: 'Messy MSME/govt paperwork → AI extracts, validates, fills forms, flags errors.' },
  { name: 'MannMitra', theme: 'MedTech / Misc', zone: 'mid', diff: 1, edge: 'Anonymous AI mental-health first-aid for students + counsellor escalation.' },
  { name: 'DivyangSetu', theme: 'Governance / Accessibility', zone: 'open', diff: 2, edge: 'AI scene-description navigation for the blind + benefits + job matching.' },
  { name: 'AutoList AI', theme: 'Smart Automation', zone: 'proven', diff: 2, edge: '2025 AUTOVISION — one-click AI product listings across marketplaces + dynamic pricing.', star: true },
  { name: 'ChargeLink', theme: 'Clean & Green', zone: 'mid', diff: 2, edge: '2025 EVCONN — P2P EV-charging, rent idle private chargers, instant UPI payouts.', star: true },
  { name: 'FastFare', theme: 'Transport & Logistics', zone: 'proven', diff: 2, edge: '2025 TRUELINK — 12-hour Delhi↔Jaipur B2B corridor, flat-rate shipping.', star: true },
  { name: 'TrustAsia', theme: 'Transport & Logistics', zone: 'proven', diff: 3, edge: '2025 — pooled B2B imports from China for MSMEs — shared MOQ, escrow, customs.', star: true }
];

const PODS = ['Disaster', 'Heritage/Tourism', 'AgriRural', 'Governance/Edu', 'Clean/Energy', 'Automation/Logistics', 'Cyber', 'Health', 'Flex'];

const MILESTONES = [
  { week: 1, title: 'Recruit & Lock', detail: 'Team formed (6 members, ≥1 female). Roles assigned: Captain, 2x Frontend, Backend/AI, Domain/Research, Design/Deck.', asks: 'Team roster + role assignment doc' },
  { week: 2, title: 'PS + Problem Fit', detail: 'Choose your problem statement + note its live submission count. Wireframes + Deck v1.', asks: 'PS id, submission count, wireframe link, deck v1' },
  { week: 3, title: 'Build the Core', detail: 'Fork the shared starter kit. Ship the ONE hero feature judges will remember, on real data.', asks: 'GitHub repo + short demo video of the hero feature' },
  { week: 4, title: 'Internal Hackathon #1', detail: 'Pitch to core team. Weakest teams cut/merged. Rank toward the top 30.', asks: 'Deck v2 + live demo link' },
  { week: 5, title: 'Polish the Demo', detail: 'Make the happy-path demo flawless. Handle the on-stage edge case. India-scale impact slide.', asks: 'Demo video + live URL + impact numbers' },
  { week: 6, title: 'Submit on Portal', detail: 'Submit EARLY — beat the 500 lock. Use both idea slots. Screenshot the low submission count.', asks: 'Portal submission screenshot + confirm both slots used' },
  { week: 7, title: 'Mock Finale', detail: 'Grilled like real judges: deployment, cost, scale, why-you. Fix the weakest decks.', asks: 'Final deck + repo + Q&A prep notes' },
  { week: 8, title: 'Buffer & Screening', detail: 'Final build locked. Demo videos recorded. Ready for PS-owner queries + travel.', asks: 'Final deliverables bundle + recorded demo' }
];

// Admin credentials come from env (never committed). Falls back to a dev default locally.
function ensureAdmin() {
  const email = String(process.env.SIH_ADMIN_EMAIL || 'admin@sih.local').trim().toLowerCase();
  const pw = process.env.SIH_ADMIN_PASSWORD || 'sihwin2026';
  let a = db.users.find(u => u.role === 'admin');
  if (!a) {
    a = { id: nextId(), role: 'admin', name: 'Core Team', email, pass: hashPassword(pw), teamId: null, createdAt: Date.now() };
    db.users.push(a);
  } else {
    a.email = email;
    if (process.env.SIH_ADMIN_PASSWORD) a.pass = hashPassword(pw); // update password when provided via env
  }
  save();
  if (!process.env.SIH_ADMIN_PASSWORD) {
    console.warn('[SECURITY] Using the default admin password. Set SIH_ADMIN_PASSWORD (and SIH_ADMIN_EMAIL) env vars for production.');
  }
  console.log('Admin ready: ' + email);
}

module.exports = function seed() {
  if (db.ideas.length === 0) {
    IDEAS.forEach(o => db.ideas.push(Object.assign({ id: nextId() }, o)));
    PODS.forEach(p => db.pods.push(p));
    MILESTONES.forEach((m, i) => db.milestones.push(Object.assign({ id: nextId(), order: i + 1 }, m)));
    save();
    console.log('Seeded: ' + db.ideas.length + ' ideas, ' + db.milestones.length + ' milestones');
  }
  ensureAdmin(); // always runs so env password changes take effect on redeploy
  return true;
};
