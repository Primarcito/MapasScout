const { MessageFlags } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { actualizarPanel } = require('../utils/panel');

module.exports = async function handleModal(interaction) {

  /* ===== MODAL: CARGAR MAPAS BULK ===== */

  if (interaction.customId === "modal_cargar_mapas") {
    const texto = interaction.fields.getTextInputValue("mapas_bulk_input");
    const lineas = texto.split("\n").map(l => l.trim());

    const ciudadesValidas = Object.keys(state.mapas);

    let ciudadActual = null;
    const cambios = {};

    for (const linea of lineas) {
      if (!linea) continue;

      // Detectar si es una ciudad
      const lineaLower = linea.toLowerCase().replace(/:$/, "").trim();
      const ciudadMatch = config.CIUDADES_ALIAS[lineaLower] ||
        ciudadesValidas.find(c => c.toLowerCase() === lineaLower);

      if (ciudadMatch || linea.endsWith(":")) {
        ciudadActual = ciudadMatch || ciudadesValidas.find(
          c => c.toLowerCase() === linea.replace(/:$/, "").trim().toLowerCase()
        );
        if (ciudadActual && !cambios[ciudadActual]) {
          cambios[ciudadActual] = [];
        }
        continue;
      }

      // Detectar "0 mapas" o "0 map"
      if (/^0\s*(map|mapas?)/i.test(linea)) {
        if (ciudadActual) cambios[ciudadActual] = [];
        continue;
      }

      // Es un mapa
      if (ciudadActual && linea.length > 0) {
        cambios[ciudadActual].push(linea);
      }
    }

    if (Object.keys(cambios).length === 0) {
      return interaction.reply({
        content: "No se detectó ninguna ciudad válida. Verificá el formato.",
        flags: MessageFlags.Ephemeral
      });
    }

    // Aplicar cambios
    const ciudadesEditadas = [];
    for (const ciudad in cambios) {
      // Cerrar scouts activos de esa ciudad
      for (const userId in state.scoutsActivos) {
        state.scoutsActivos[userId] = (state.scoutsActivos[userId] || []).filter(e => e.ciudad !== ciudad);
        if (state.scoutsActivos[userId].length === 0) delete state.scoutsActivos[userId];
      }
      state.mapas[ciudad] = cambios[ciudad];
      state.registros[ciudad] = {};
      ciudadesEditadas.push(`${ciudad} (${cambios[ciudad].length} mapas)`);

      state.logAdmin.push({
        userId: interaction.user.id,
        username: interaction.user.username,
        accion: `Cargó mapas de ${ciudad} via /cargar_mapas`,
        timestamp: Date.now()
      });
    }

    state.ultimaEdicion = Date.now();
    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    return interaction.reply({
      content: `✅ Mapas cargados:\n${ciudadesEditadas.map(c => `• ${c}`).join("\n")}`,
      flags: MessageFlags.Ephemeral
    });
  }

  /* ===== MODAL: EDITAR MAPAS (por ciudad) ===== */

  if (interaction.customId.startsWith("modal_")) {
    const ciudad = interaction.customId.replace("modal_", "");
    const texto = interaction.fields.getTextInputValue("mapas_input");
    const nuevos = texto.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    // Limpiar scouts activos de esa ciudad
    for (const userId in state.scoutsActivos) {
      state.scoutsActivos[userId] = (state.scoutsActivos[userId] || []).filter(e => e.ciudad !== ciudad);
      if (state.scoutsActivos[userId].length === 0) delete state.scoutsActivos[userId];
    }

    state.mapas[ciudad] = nuevos;
    state.registros[ciudad] = {};
    state.ultimaEdicion = Date.now();
    state.logAdmin.push({
      userId: interaction.user.id,
      username: interaction.user.username,
      accion: `Editó mapas de ${ciudad}`,
      timestamp: Date.now()
    });

    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    const confirmMsg = await interaction.reply({ content: `✅ Mapas de **${ciudad}** actualizados.`, flags: MessageFlags.Ephemeral, withResponse: true });
    setTimeout(async () => {
      try { await confirmMsg.resource.message.delete(); } catch (e) {}
    }, 45000);
  }
};
