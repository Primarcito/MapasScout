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

function cerrarScoutsActivos(userId, username = null, motivo = "manual") {
  const entradas = state.scoutsActivos[userId];
  if (!entradas || entradas.length === 0) return;

  const fin = Date.now();
  entradas.forEach(entry => {
    const duracionMin = Math.floor((fin - entry.inicio) / 60000);
    const registro = {
      userId,
      username: username || entry.username || userId,
      ciudad: entry.ciudad,
      mapa: entry.mapa,
      inicio: entry.inicio,
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
