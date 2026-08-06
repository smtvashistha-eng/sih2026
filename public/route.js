// Central role/status router used by every page.
function routeUser(u) {
  if (!u) { location.href = '/'; return; }
  if (u.role === 'admin' || u.role === 'lead') { location.href = '/admin.html'; return; }
  // captain (Selected) or a joined team member → workspace (it handles the captain sign gate)
  if (u.status === 'Selected' || u.status === 'Member' || u.teamOf) { location.href = '/workspace.html'; return; }
  location.href = '/status.html';
}
