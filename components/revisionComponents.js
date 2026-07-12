const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const state = require('../data/state');
const { buttonEmoji, cityButtonEmoji } = require('../emojis');

function contarMapasRevision() {
  let total = 0;
  for (const ciudad in state.mapas) {
    if (state.mapas[ciudad] && state.mapas[ciudad].length > 0) total += state.mapas[ciudad].length;
  }
  return total;
}

function estaRevisado(estado) {
  const round = state.revisionRound;
  return Boolean(
    estado?.revisores?.length > 0
    && estado.revisadoEn >= (round?.startedAt || 0)
    && estado.revisadoEn <= (round?.endsAt || Infinity)
  );
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
      return estaRevisado(state.revisionEstado[key]);
    }).length;
    const totalCiudad = state.mapas[ciudad].length;
    const label = `${ciudad} (${revisadosCiudad}/${totalCiudad})`;

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`revision_ciudad_${ciudad}`)
        .setLabel(label)
        .setEmoji(cityButtonEmoji(ciudad))
        .setStyle(revisadosCiudad === totalCiudad ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    count++;
  }
  if (count > 0) filas.push(fila);
  return filas;
}

function revisionCustomId(ciudad, index) {
  return `revision_idx_${ciudad}__${index}`;
}

function ordenarMapas(items) {
  return [...items].sort((a, b) => a.mapa.localeCompare(b.mapa, 'es', { sensitivity: 'base' }));
}

function componentesRevisionMapas(ciudad) {
  const filas = [];
  let fila = new ActionRowBuilder();
  let count = 0;

  const mapasOrdenados = ordenarMapas(
    (state.mapas[ciudad] || []).map((mapa, index) => ({ mapa, index }))
  );

  mapasOrdenados.forEach(({ mapa, index }) => {
    if (count % 5 === 0 && count !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }
    const key = `${ciudad}__${mapa}`;
    const estado = state.revisionEstado[key];
    const revisado = estaRevisado(estado);
    const label = mapa;

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(revisionCustomId(ciudad, index))
        .setLabel(label)
        .setEmoji(revisado ? buttonEmoji('VERIFIED') : cityButtonEmoji(ciudad))
        .setStyle(revisado ? ButtonStyle.Success : ButtonStyle.Secondary)
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

  const mapasOrdenados = ordenarMapas(
    Object.entries(state.mapas).flatMap(([c, mapas]) =>
      (mapas || []).map((mapa, index) => ({ c, mapa, index }))
    )
  );

  mapasOrdenados.forEach(({ c, mapa, index }) => {
      if (count % 5 === 0 && count !== 0) {
        filas.push(fila);
        fila = new ActionRowBuilder();
      }
      const key = `${c}__${mapa}`;
      const estado = state.revisionEstado[key];
      const revisado = estaRevisado(estado);
      const label = mapa;

      fila.addComponents(
        new ButtonBuilder()
          .setCustomId(revisionCustomId(c, index))
          .setLabel(label)
          .setEmoji(revisado ? buttonEmoji('VERIFIED') : cityButtonEmoji(c))
          .setStyle(revisado ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
      count++;
  });
  if (count > 0) filas.push(fila);
  return filas;
}

module.exports = { componentesRevision, contarMapasRevision };
