const state = require('../data/state');
const config = require('../config');
const { normalizarListaMapas } = require('./mapNames');
const { guardarDatos, guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { guardarUltimosMapas, cerrarScoutsActivosFiltrados } = require('./scouts');
const { cancelScoutVerification } = require('./verification');
const { actualizarPanel, actualizarRevision } = require('./panel');
const { sincronizarMensajeAlertas } = require('./alerts');
const { addAuditEntry } = require('./audit');

function cloneMaps(source = state.mapas) {
  return Object.fromEntries(
    Object.keys(state.mapas).map(ciudad => [ciudad, [...(source?.[ciudad] || [])]])
  );
}

function parseBulkMapInput(text) {
  const cities = Object.keys(state.mapas);
  const changes = {};
  let currentCity = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const lower = line.toLowerCase().replace(/:$/, '').trim();
    const city = config.CIUDADES_ALIAS[lower]
      || cities.find(item => item.toLowerCase() === lower);

    if (city) {
      currentCity = city;
      if (!changes[currentCity]) changes[currentCity] = [];
      continue;
    }

    if (line.endsWith(':')) {
      currentCity = null;
      continue;
    }

    if (/^0\s*(map|mapas?)/i.test(line)) {
      if (currentCity) changes[currentCity] = [];
      continue;
    }

    if (currentCity) changes[currentCity].push(line);
  }

  for (const city of Object.keys(changes)) {
    changes[city] = normalizarListaMapas(changes[city]);
  }
  return changes;
}

function normalizeChanges(changes) {
  const result = {};
  for (const [city, maps] of Object.entries(changes || {})) {
    if (!Object.hasOwn(state.mapas, city)) continue;
    result[city] = normalizarListaMapas(maps || []);
  }
  return result;
}

function mapChangesDiff(changes, base = state.mapas) {
  const normalized = normalizeChanges(changes);
  return Object.entries(normalized).map(([city, nextMaps]) => {
    const previous = [...(base?.[city] || [])];
    const previousSet = new Set(previous);
    const nextSet = new Set(nextMaps);
    return {
      city,
      previous,
      next: nextMaps,
      added: nextMaps.filter(map => !previousSet.has(map)),
      removed: previous.filter(map => !nextSet.has(map)),
      kept: nextMaps.filter(map => previousSet.has(map)),
    };
  });
}

function storePendingMapChanges(userId, changes, source = 'manual') {
  const normalized = normalizeChanges(changes);
  state.pendingMapChanges.set(String(userId), {
    changes: normalized,
    source,
    createdAt: Date.now(),
  });
  return normalized;
}

function takePendingMapChanges(userId, { keep = false } = {}) {
  const key = String(userId);
  const pending = state.pendingMapChanges.get(key) || null;
  if (!keep) state.pendingMapChanges.delete(key);
  if (pending && Date.now() - pending.createdAt > 15 * 60 * 1000) return null;
  return pending;
}

function scheduledBaseMaps() {
  return cloneMaps(state.scheduledMaps?.maps || state.mapas);
}

function scheduleMapChanges(changes, actor = {}) {
  const next = scheduledBaseMaps();
  for (const [city, maps] of Object.entries(normalizeChanges(changes))) next[city] = [...maps];
  state.scheduledMaps = {
    maps: next,
    scheduledAt: Date.now(),
    scheduledBy: actor.id ? String(actor.id) : null,
    scheduledByName: actor.name || null,
  };
  guardarDatos();
  addAuditEntry({
    actorId: actor.id,
    actorName: actor.name,
    action: 'programo la configuracion de mapas para el siguiente periodo',
    details: { cities: Object.keys(normalizeChanges(changes)) },
  });
  return state.scheduledMaps;
}

function clearScheduledMaps(actor = {}) {
  state.scheduledMaps = null;
  guardarDatos();
  addAuditEntry({
    actorId: actor.id,
    actorName: actor.name,
    action: 'cancelo la configuracion programada de mapas',
  });
}

async function applyMapChanges(changes, actor = {}, options = {}) {
  const normalized = normalizeChanges(changes);
  const diff = mapChangesDiff(normalized);
  const now = options.now || Date.now();
  const affectedUsers = new Set();

  for (const item of diff) {
    const removedSet = new Set(item.removed);
    if (removedSet.size === 0) continue;
    for (const map of item.removed) {
      for (const userId of state.registros[item.city]?.[map] || []) affectedUsers.add(userId);
    }
    for (const [userId, entries] of Object.entries(state.scoutsActivos || {})) {
      if ((entries || []).some(entry => entry.ciudad === item.city && removedSet.has(entry.mapa))) {
        affectedUsers.add(userId);
      }
    }
  }

  for (const userId of affectedUsers) guardarUltimosMapas(userId);

  for (const item of diff) {
    const removedSet = new Set(item.removed);
    if (removedSet.size > 0) {
      for (const userId of affectedUsers) {
        const closed = cerrarScoutsActivosFiltrados(
          userId,
          entry => entry.ciudad === item.city && removedSet.has(entry.mapa),
          null,
          'mapa_eliminado_por_configuracion',
          now,
        );
        if (closed?.length) {
          await cancelScoutVerification(userId, 'Verificacion cancelada: un mapa activo fue retirado por configuracion.');
        }
      }
    }

    const previousRecords = state.registros[item.city] || {};
    state.mapas[item.city] = [...item.next];
    state.registros[item.city] = Object.fromEntries(
      item.next.map(map => [map, [...new Set(previousRecords[map] || [])]])
    );
  }

  if (diff.some(item => item.added.length || item.removed.length)) {
    state.revisionRound = null;
    state.revisionEstado = {};
  }
  state.ultimaEdicion = now;
  guardarDatos();
  guardarScouts();
  guardarRevisionPanel();
  await actualizarPanel();
  await actualizarRevision();
  await sincronizarMensajeAlertas();

  addAuditEntry({
    actorId: actor.id,
    actorName: actor.name,
    action: options.action || 'aplico cambios de mapas',
    details: diff.map(item => ({ city: item.city, added: item.added, removed: item.removed })),
  });
  return { diff, affectedUsers: [...affectedUsers] };
}

async function clearActiveMaps(actor = {}) {
  const changes = Object.fromEntries(Object.keys(state.mapas).map(city => [city, []]));
  state.scheduledMaps = null;
  return applyMapChanges(changes, actor, { action: 'vacio el panel de mapas' });
}

module.exports = {
  cloneMaps,
  parseBulkMapInput,
  normalizeChanges,
  mapChangesDiff,
  storePendingMapChanges,
  takePendingMapChanges,
  scheduledBaseMaps,
  scheduleMapChanges,
  clearScheduledMaps,
  applyMapChanges,
  clearActiveMaps,
};
