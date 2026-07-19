const state = require('../data/state');
const { calcularTiempoReal } = require('./timeCalc');

const MINUTES_PER_VALID_MAP = 60;

function collectDailyMapSessions(now = Date.now()) {
  const byUser = {};
  const add = (userId, entry, fin = entry.fin) => {
    if (!entry || entry.manualTimeAdjustment || entry.provisional || !entry.ciudad || !entry.mapa || !entry.inicio) return;
    const id = String(userId || entry.userId);
    if (!id) return;
    const key = `${entry.ciudad}__${entry.mapa}`;
    byUser[id] ||= {};
    byUser[id][key] ||= [];
    byUser[id][key].push({ inicio: entry.inicio, fin: fin || now });
  };

  for (const entry of state.historialDia || []) add(entry.userId, entry);
  for (const [userId, entries] of Object.entries(state.scoutsActivos || {})) {
    for (const entry of entries || []) add(userId, entry, now);
  }
  return byUser;
}

function projectDailyMapCredits(now = Date.now()) {
  const sessions = collectDailyMapSessions(now);
  const userIds = new Set([
    ...Object.keys(state.mapMinuteBalances || {}),
    ...Object.keys(sessions),
  ]);
  const result = {};

  for (const userId of userIds) {
    const previous = state.mapMinuteBalances?.[userId] || {};
    const mapKeys = new Set([...Object.keys(previous), ...Object.keys(sessions[userId] || {})]);
    const pending = {};
    let validMaps = 0;

    for (const key of mapKeys) {
      const priorMinutes = Math.max(0, Number(previous[key]) || 0);
      const dailyMinutes = calcularTiempoReal(sessions[userId]?.[key] || []);
      const totalMinutes = priorMinutes + dailyMinutes;
      if (dailyMinutes > 0 && totalMinutes >= MINUTES_PER_VALID_MAP) {
        validMaps += 1;
      } else if (totalMinutes > 0 && totalMinutes < MINUTES_PER_VALID_MAP) {
        pending[key] = totalMinutes;
      }
    }
    result[userId] = { validMaps, pending };
  }
  return result;
}

function commitDailyMapCredits(now = Date.now()) {
  const projection = projectDailyMapCredits(now);
  state.mapMinuteBalances = Object.fromEntries(
    Object.entries(projection)
      .filter(([, value]) => Object.keys(value.pending).length > 0)
      .map(([userId, value]) => [userId, value.pending])
  );
  return projection;
}

module.exports = {
  MINUTES_PER_VALID_MAP,
  collectDailyMapSessions,
  projectDailyMapCredits,
  commitDailyMapCredits,
};
