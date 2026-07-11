const state = require('../data/state');
const { normalizarReferenciasMapas } = require('./mapNames');

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

function cerrarScoutsActivos(userId, username = null, motivo = "manual", finOverride = null, options = {}) {
  const entradas = state.scoutsActivos[userId];
  if (!entradas || entradas.length === 0) return;

  const fin = finOverride || Date.now();
  const creditFrom = options.creditFrom || null;
  const creditPenaltyMs = Math.max(0, Number(options.creditPenaltyMs) || 0);
  entradas.forEach(entry => {
    const inicioBase = creditFrom ? Math.max(entry.inicio, creditFrom) : entry.inicio;
    const inicio = Math.min(fin, inicioBase + creditPenaltyMs);
    const duracionMin = Math.max(0, Math.floor((fin - inicio) / 60000));
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
      ...(options.verificationId ? { verificationId: options.verificationId } : {}),
      ...(options.provisional ? { provisional: true } : {}),
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

  delete state.scoutsActivos[userId];
}

function descartarScoutsActivos(userId) {
  delete state.scoutsActivos[userId];
}

function borrarRegistrosUsuario(userId) {
  for (const ciudad in state.registros) {
    for (const mapa in state.registros[ciudad]) {
      state.registros[ciudad][mapa] = state.registros[ciudad][mapa].filter(id => id !== userId);
    }
  }
}

module.exports = { guardarUltimosMapas, cerrarScoutsActivos, descartarScoutsActivos, borrarRegistrosUsuario };
