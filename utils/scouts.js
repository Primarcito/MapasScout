const state = require('../data/state');
const { normalizarReferenciasMapas } = require('./mapNames');
const { calcularTiempoReal } = require('./timeCalc');

function isRegisteredActiveEntry(userId, entry) {
  if (!entry?.ciudad || !entry?.mapa || !entry?.inicio) return false;
  if (!state.mapas[entry.ciudad]?.includes(entry.mapa)) return false;
  return Boolean(state.registros[entry.ciudad]?.[entry.mapa]?.includes(String(userId)));
}

function getRegisteredActiveEntries(userId) {
  return (state.scoutsActivos[String(userId)] || []).filter(entry => isRegisteredActiveEntry(userId, entry));
}

function reconcileRegisteredActiveScouts() {
  const removed = [];
  for (const userId of Object.keys(state.scoutsActivos || {})) {
    const original = state.scoutsActivos[userId] || [];
    const valid = original.filter(entry => isRegisteredActiveEntry(userId, entry));
    if (valid.length === original.length) continue;
    removed.push(...original.filter(entry => !isRegisteredActiveEntry(userId, entry)).map(entry => ({ userId, ...entry })));
    if (valid.length) state.scoutsActivos[userId] = valid;
    else delete state.scoutsActivos[userId];
  }
  return removed;
}

function guardarUltimosMapas(userId) {
  const lista = [];
  for (const ciudad in state.registros) {
    for (const mapa in state.registros[ciudad]) {
      if (state.registros[ciudad][mapa].includes(userId)) {
        lista.push({ ciudad, mapa });
      }
    }
  }

  // scoutsActivos es una segunda fuente de verdad. Al unir ambas evitamos
  // perder mapas si un flujo parcial ya modificó registros.
  lista.push(...(state.scoutsActivos[userId] || []));
  const completa = normalizarReferenciasMapas(lista).map(({ ciudad, mapa }) => ({ ciudad, mapa }));
  if (completa.length > 0) state.ultimosMapas[userId] = completa;
  return completa;
}

function cerrarScoutsActivosFiltrados(userId, predicate, username = null, motivo = "manual", finOverride = null, options = {}) {
  const entradas = state.scoutsActivos[userId];
  if (!entradas || entradas.length === 0) return;

  const fin = finOverride || Date.now();
  const creditFrom = options.creditFrom || null;
  const creditPenaltyMs = Math.max(0, Number(options.creditPenaltyMs) || 0);
  const cerradas = entradas.filter(predicate);
  const restantes = entradas.filter(entry => !predicate(entry));
  cerradas.forEach(entry => {
    const inicioBase = creditFrom ? Math.max(entry.inicio, creditFrom) : entry.inicio;
    const inicio = Math.min(fin, inicioBase + creditPenaltyMs);
    const duracionMin = Math.max(0, Math.floor((fin - inicio) / 60000));
    const verificationId = options.verificationId || entry.provisionalVerificationId;
    const provisional = options.provisional ?? entry.provisional;
    const registro = {
      userId,
      username: username || entry.username || userId,
      ciudad: entry.ciudad,
      mapa: entry.mapa,
      inicio,
      inicioOriginal: entry.inicio,
      fin,
      duracionMin,
      motivo,
      ...(verificationId ? { verificationId } : {}),
      ...(provisional ? { provisional: true } : {}),
    };
    state.historialScouts.push(registro);
    // Solo agregar al historialDia si no fue por reset
    if (motivo !== "reset") {
      state.historialDia.push(registro);
    }
    // Actualizar cobertura
    const cobKey = `${entry.ciudad}__${entry.mapa}`;
    if (!state.coberturaDia[cobKey]) state.coberturaDia[cobKey] = { ciudad: entry.ciudad, mapa: entry.mapa, minutos: 0 };
    state.coberturaDia[cobKey].minutos += duracionMin;
    state.coberturaDia[cobKey].ultimaActividad = fin;
  });

  if (restantes.length > 0) state.scoutsActivos[userId] = restantes;
  else delete state.scoutsActivos[userId];
  return cerradas;
}

function cerrarScoutsActivos(userId, username = null, motivo = "manual", finOverride = null, options = {}) {
  return cerrarScoutsActivosFiltrados(userId, () => true, username, motivo, finOverride, options);
}

function descartarScoutsActivos(userId) {
  delete state.scoutsActivos[userId];
}

function asignarTiempoManual(userId, username, minutos, adminId = null, motivo = null) {
  const requestedMinutes = Math.round(Number(minutos) || 0);
  if (requestedMinutes === 0) throw new Error('El ajuste debe ser distinto de cero.');

  const id = String(userId);
  const sesiones = (state.historialDia || [])
    .filter(entry => String(entry.userId) === id && !entry.manualTimeAdjustment)
    .map(entry => ({ inicio: entry.inicio, fin: entry.fin }));
  for (const entry of state.scoutsActivos?.[id] || []) {
    sesiones.push({ inicio: entry.inicio, fin: Date.now() });
  }
  const minutosManuales = (state.historialDia || [])
    .filter(entry => String(entry.userId) === id && entry.manualTimeAdjustment)
    .reduce((total, entry) => total + (Number(entry.duracionMin) || 0), 0);
  const previousMinutes = Math.max(0, calcularTiempoReal(sesiones) + minutosManuales);
  const duracionMin = requestedMinutes < 0
    ? -Math.min(Math.abs(requestedMinutes), previousMinutes)
    : requestedMinutes;

  if (duracionMin === 0) {
    return { record: null, requestedMinutes, appliedMinutes: 0, previousMinutes, totalMinutes: previousMinutes };
  }

  const fin = Date.now();
  const registro = {
    userId: id,
    username: username || id,
    ciudad: 'Ajuste admin',
    mapa: 'Ajuste de tiempo',
    inicio: fin,
    fin,
    duracionMin,
    motivo: motivo || 'asignación manual de tiempo',
    manualTimeAdjustment: true,
    ...(adminId ? { adminId: String(adminId) } : {}),
  };
  state.historialScouts.push(registro);
  state.historialDia.push(registro);
  return {
    record: registro,
    requestedMinutes,
    appliedMinutes: duracionMin,
    previousMinutes,
    totalMinutes: previousMinutes + duracionMin,
  };
}

function borrarRegistrosUsuario(userId) {
  for (const ciudad in state.registros) {
    for (const mapa in state.registros[ciudad]) {
      state.registros[ciudad][mapa] = state.registros[ciudad][mapa].filter(id => id !== userId);
    }
  }
}

module.exports = {
  guardarUltimosMapas,
  cerrarScoutsActivos,
  cerrarScoutsActivosFiltrados,
  descartarScoutsActivos,
  asignarTiempoManual,
  borrarRegistrosUsuario,
  isRegisteredActiveEntry,
  getRegisteredActiveEntries,
  reconcileRegisteredActiveScouts,
};
