const state = require('../data/state');

function guardarUltimosMapas(userId) {
  const lista = [];
  for (const ciudad in state.registros) {
    for (const mapa in state.registros[ciudad]) {
      if (state.registros[ciudad][mapa].includes(userId)) {
        lista.push({ ciudad, mapa });
      }
    }
  }
  if (lista.length > 0) state.ultimosMapas[userId] = lista;
}

function cerrarScoutsActivos(userId, username = null, motivo = "manual", finOverride = null, options = {}) {
  const entradas = state.scoutsActivos[userId];
  if (!entradas || entradas.length === 0) return;

  const fin = finOverride || Date.now();
  const creditFrom = options.creditFrom || null;
  entradas.forEach(entry => {
    const inicio = creditFrom ? Math.max(entry.inicio, creditFrom) : entry.inicio;
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
      motivo
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

function borrarRegistrosUsuario(userId) {
  for (const ciudad in state.registros) {
    for (const mapa in state.registros[ciudad]) {
      state.registros[ciudad][mapa] = state.registros[ciudad][mapa].filter(id => id !== userId);
    }
  }
}

module.exports = { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario };
