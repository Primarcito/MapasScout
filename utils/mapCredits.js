const state = require('../data/state');
const { calcularTiempoReal } = require('./timeCalc');

const MINUTES_PER_TIME_UNIT = 240; // 4 horas
const MAPS_PER_MAP_UNIT = 3;       // 3 mapas

function isCurrentMapKey(key) {
  const separator = String(key).indexOf('__');
  if (separator < 1) return false;
  const ciudad = String(key).slice(0, separator);
  const mapa = String(key).slice(separator + 2);
  return Boolean(state.mapas?.[ciudad]?.includes(mapa));
}

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

function collectDailyManualMinutes(now = Date.now()) {
  const byUser = {};
  for (const entry of state.historialDia || []) {
    if (entry && entry.manualTimeAdjustment && !entry.provisional) {
      const id = String(entry.userId);
      if (!id) continue;
      byUser[id] = (byUser[id] || 0) + (Number(entry.duracionMin) || 0);
    }
  }
  return byUser;
}

function projectDailyMapCredits(now = Date.now(), options = {}) {
  const sessions = collectDailyMapSessions(now);
  const manualMinutes = collectDailyManualMinutes(now);
  const includeBalances = options.includeBalances !== false;
  const userIds = new Set([
    ...Object.keys(state.timeMinuteBalances || {}),
    ...Object.keys(state.mapMinuteBalances || {}),
    ...Object.keys(sessions),
    ...Object.keys(manualMinutes),
  ]);
  const result = {};

  for (const userId of userIds) {
    const userSessions = sessions[userId] || {};
    let validMaps = 0;
    const userAllSessions = [];

    for (const key of Object.keys(userSessions)) {
      if (!isCurrentMapKey(key)) continue;
      const dailyMinutes = calcularTiempoReal(userSessions[key]);
      if (dailyMinutes > 0) {
        validMaps += 1;
      }
      userAllSessions.push(...userSessions[key]);
    }

    const todayTime = Math.max(0, calcularTiempoReal(userAllSessions) + (manualMinutes[userId] || 0));
    const priorMinutes = includeBalances ? Math.max(0, Number(state.timeMinuteBalances?.[userId]) || 0) : 0;
    const totalEffectiveMinutes = todayTime + priorMinutes;

    const timeUnits = Math.floor(totalEffectiveMinutes / MINUTES_PER_TIME_UNIT);
    const pendingMinutes = totalEffectiveMinutes % MINUTES_PER_TIME_UNIT;
    const mapUnits = Math.floor(validMaps / MAPS_PER_MAP_UNIT);
    const totalUnits = timeUnits + mapUnits;

    result[userId] = {
      validMaps,
      todayTime,
      priorMinutes,
      totalEffectiveMinutes,
      timeUnits,
      mapUnits,
      totalUnits,
      pendingMinutes,
      pending: { time: pendingMinutes },
    };
  }
  return result;
}

function commitDailyMapCredits(now = Date.now()) {
  const projection = projectDailyMapCredits(now, { includeBalances: true });
  state.timeMinuteBalances = Object.fromEntries(
    Object.entries(projection)
      .filter(([, value]) => value.pendingMinutes > 0)
      .map(([userId, value]) => [userId, value.pendingMinutes])
  );
  return projection;
}

module.exports = {
  MINUTES_PER_TIME_UNIT,
  MAPS_PER_MAP_UNIT,
  isCurrentMapKey,
  collectDailyMapSessions,
  projectDailyMapCredits,
  commitDailyMapCredits,
};
