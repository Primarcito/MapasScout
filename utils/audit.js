const state = require('../data/state');
const { guardarScouts } = require('../data/persistence');

function addAuditEntry({ actorId = null, actorName = null, action, targetId = null, details = null }) {
  const entry = {
    timestamp: Date.now(),
    userId: actorId ? String(actorId) : null,
    username: actorName || actorId || 'sistema',
    accion: action,
    targetId: targetId ? String(targetId) : null,
    details: details || null,
  };
  state.logAdmin.push(entry);
  state.logAdmin = state.logAdmin.slice(-500);
  guardarScouts();
  return entry;
}

module.exports = { addAuditEntry };
