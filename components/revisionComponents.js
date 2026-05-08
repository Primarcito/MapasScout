const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const state = require('../data/state');
const config = require('../config');

function contarMapasRevision() {
  let total = 0;
  for (const ciudad in state.mapas) {
    if (state.mapas[ciudad] && state.mapas[ciudad].length > 0) total += state.mapas[ciudad].length;
  }
  return total;
}

function componentesRevisionCiudades() {
  const filas = [];
  let fila = new ActionRowBuilder();
  let count = 0;

  for (const ciudad in state.mapas) {
    if (!state.mapas[ciudad] || state.mapas[ciudad].length === 0) continue;
    if (count % 5 === 0 && count !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }
    const revisadosCiudad = state.mapas[ciudad].filter(mapa => {
      const key = `${ciudad}__${mapa}`;
      return state.revisionEstado[key]?.revisores?.length > 0;
    }).length;
    const totalCiudad = state.mapas[ciudad].length;
    const emoji = config.ICONOS_CIUDAD[ciudad] || "📍";
    const label = `${emoji} ${ciudad} (${revisadosCiudad}/${totalCiudad})`;

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`revision_ciudad_${ciudad}`)
        .setLabel(label)
        .setStyle(revisadosCiudad === totalCiudad ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    count++;
  }
  if (count > 0) filas.push(fila);
  return filas;
}

function componentesRevisionMapas(ciudad) {
  const filas = [];
  let fila = new ActionRowBuilder();
  let count = 0;

  (state.mapas[ciudad] || []).forEach(mapa => {
    if (count % 5 === 0 && count !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }
    const key = `${ciudad}__${mapa}`;
    const estado = state.revisionEstado[key];
    const revisado = estado?.revisores?.length > 0;
    const mins = revisado ? Math.floor((Date.now() - estado.revisadoEn) / 60000) : 0;
    const expirado = revisado && mins >= 15;
    const emoji = config.ICONOS_CIUDAD[ciudad] || "📍";
    const label = revisado && !expirado ? `✅ ${emoji} ${mapa}` : `${emoji} ${mapa}`;

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`revision_btn_${key}`)
        .setLabel(label)
        .setStyle(revisado && !expirado ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    count++;
  });

  if (count > 0) filas.push(fila);

  // Botón volver
  filas.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("revision_volver_ciudades")
        .setLabel("← Volver")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return filas;
}

function componentesRevision(ciudad = null) {
  const totalMapas = contarMapasRevision();

  if (totalMapas > 25) {
    if (ciudad) return componentesRevisionMapas(ciudad);
    return componentesRevisionCiudades();
  }

  // Modo normal - todos los botones directos
  const filas = [];
  let fila = new ActionRowBuilder();
  let count = 0;

  for (const c in state.mapas) {
    if (!state.mapas[c] || state.mapas[c].length === 0) continue;
    state.mapas[c].forEach(mapa => {
      if (count % 5 === 0 && count !== 0) {
        filas.push(fila);
        fila = new ActionRowBuilder();
      }
      const key = `${c}__${mapa}`;
      const estado = state.revisionEstado[key];
      const revisado = estado?.revisores?.length > 0;
      const mins = revisado ? Math.floor((Date.now() - estado.revisadoEn) / 60000) : 0;
      const expirado = revisado && mins >= 15;
      const emoji = config.ICONOS_CIUDAD[c] || "📍";
      const label = revisado && !expirado ? `✅ ${emoji} ${mapa}` : `${emoji} ${mapa}`;

      fila.addComponents(
        new ButtonBuilder()
          .setCustomId(`revision_btn_${key}`)
          .setLabel(label)
          .setStyle(revisado && !expirado ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
      count++;
    });
  }
  if (count > 0) filas.push(fila);
  return filas;
}

module.exports = { componentesRevision, contarMapasRevision };
