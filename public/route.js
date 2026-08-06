// Central role/status router used by every page.
function routeUser(u) {
  if (!u) { location.href = '/'; return; }
  if (u.role === 'admin' || u.role === 'lead') { location.href = '/admin.html'; return; }
  // member
  if (u.status === 'Selected') { location.href = '/workspace.html'; return; } // workspace handles the sign gate
  location.href = '/status.html';
}
