const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const state = require('../data/state');
const config = require('../config');

function componentesPanel() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("abrir_anotarse")
        .setLabel("Anotarse")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("dropear_mapas")
        .setLabel("Dropear Mapas")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("volver_mapas_panel")
        .setLabel("Volver a mis Mapas")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function respuestaCiudades() {
  const ciudadesDisponibles = Object.keys(state.mapas).filter(
    c => state.mapas[c] && state.mapas[c].length > 0
  );

  if (ciudadesDisponibles.length === 0) {
    return { content: "No hay mapas configurados aún.", components: [] };
  }

  const filas = [];
  let fila = new ActionRowBuilder();

  ciudadesDisponibles.forEach((ciudad, i) => {
    if (i % 5 === 0 && i !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }
    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`ciudad_btn_${ciudad}`)
        .setLabel(`${config.ICONOS_CIUDAD[ciudad] || "📍"} ${ciudad}`)
        .setStyle(ButtonStyle.Secondary)
    );
  });

  filas.push(fila);

  return { content: "📍 **Selecciona una ciudad:**", components: filas };
}

function respuestaMapas(ciudad, userId) {
  const listaMapas = state.mapas[ciudad];

  if (!listaMapas || listaMapas.length === 0) {
    return { content: "No hay mapas en esa ciudad.", components: [] };
  }

  const filas = [];
  let fila = new ActionRowBuilder();

  listaMapas.forEach((mapa, i) => {
    if (i % 5 === 0 && i !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }

    const users = state.registros[ciudad]?.[mapa] || [];
    const lleno = users.length >= 5;
    const yaAnotado = users.includes(userId);

    let label, style, disabled;

    if (yaAnotado) {
      label = `✓ ${mapa}`;
      style = ButtonStyle.Primary;
      disabled = false;
    } else if (lleno) {
      label = `🔴 ${mapa}`;
      style = ButtonStyle.Secondary;
      disabled = true;
    } else {
      label = `${mapa} (${users.length}/5)`;
      style = ButtonStyle.Success;
      disabled = false;
    }

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`registro_idx_${ciudad}__${i}`)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled)
    );
  });

  filas.push(fila);

  // Botón volver
  filas.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("volver_ciudades")
        .setLabel("← Volver")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { content: `📍 **${ciudad}** — elige tu mapa:`, components: filas };
}

module.exports = { componentesPanel, respuestaCiudades, respuestaMapas };
