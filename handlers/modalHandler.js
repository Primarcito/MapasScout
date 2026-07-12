const { MessageFlags } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const { guardarDatos, guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { actualizarPanel, actualizarRevision } = require('../utils/panel');
const { cancelScoutVerification } = require('../utils/verification');
const { guardarUltimosMapas } = require('../utils/scouts');
const { normalizarListaMapas } = require('../utils/mapNames');
const { sincronizarMensajeAlertas } = require('../utils/alerts');
const { canUseAdmin } = require('../permissions');
const { getRevisionMultiplier, revisionConfig } = require('../utils/revisionRounds');
const { regenerateSummaryMessage } = require('../utils/dailySummary');

module.exports = async function handleModal(interaction) {

  /* ===== MODAL: REGENERAR RESUMEN ===== */

  if (interaction.customId === 'modal_revision_regenerate_summary') {
    if (!canUseAdmin(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso de admin.', flags: MessageFlags.Ephemeral });
    }
    const messageId = interaction.fields.getTextInputValue('summary_message_id').trim();
    if (!/^\d{17,20}$/.test(messageId)) {
      return interaction.reply({ content: 'El ID del mensaje no es válido.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await regenerateSummaryMessage(messageId);
      const url = `https://discord.com/channels/${interaction.guildId}/${result.replacement.channel.id}/${result.replacement.id}`;
      const deletion = result.deleted
        ? 'El resumen anterior fue eliminado.'
        : 'El reemplazo se publicó, pero no pude eliminar el mensaje anterior.';
      return interaction.editReply(
        `✅ [Resumen regenerado](${url}) sin puntos de Mapas y con los multiplicadores actuales. ${deletion}\n` +
        'Si RankingBot ya tenía un conteo del mensaje anterior, recházalo y genera uno nuevo con este ID.'
      );
    } catch (err) {
      return interaction.editReply(`No se pudo regenerar el resumen: ${err.message || err}`);
    }
  }

  /* ===== MODAL: MULTIPLICADOR MANUAL ===== */

  if (interaction.customId.startsWith('modal_revision_multiplier_')) {
    if (!canUseAdmin(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso de admin.', flags: MessageFlags.Ephemeral });
    }

    const userId = interaction.customId.replace('modal_revision_multiplier_', '');
    const raw = interaction.fields.getTextInputValue('multiplier_input').trim().toLowerCase();
    const score = state.revisionScores[userId] || {
      misses: 0,
      eligibleRounds: 0,
      compliantRounds: 0,
      multiplier: 1,
    };

    if (raw === 'auto' || raw === 'automático' || raw === 'automatico') {
      delete score.manualMultiplier;
    } else {
      const value = Number(raw.replace(',', '.'));
      const minimum = revisionConfig().minimumMultiplier;
      if (!Number.isFinite(value) || value < minimum || value > 1) {
        return interaction.reply({
          content: `Escribe un valor entre ${minimum.toFixed(2)} y 1.00, o \`auto\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      score.manualMultiplier = Math.round(value * 100) / 100;
    }

    state.revisionScores[userId] = score;
    guardarRevisionPanel();
    const modo = Number.isFinite(Number(score.manualMultiplier)) ? 'manual' : 'automático';
    return interaction.reply({
      content: `✅ Multiplicador de <@${userId}>: **x${getRevisionMultiplier(userId).toFixed(2)}** (${modo}).`,
      flags: MessageFlags.Ephemeral,
    });
  }

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

    for (const ciudad of Object.keys(cambios)) cambios[ciudad] = normalizarListaMapas(cambios[ciudad]);

    // Guardar la foto completa de cada scout antes de tocar cualquier ciudad.
    const afectados = new Set();
    for (const ciudad of Object.keys(cambios)) {
      for (const users of Object.values(state.registros[ciudad] || {})) {
        for (const userId of users) afectados.add(userId);
      }
      for (const [userId, entradas] of Object.entries(state.scoutsActivos)) {
        if ((entradas || []).some(e => e.ciudad === ciudad)) afectados.add(userId);
      }
    }
    for (const userId of afectados) guardarUltimosMapas(userId);

    // Aplicar cambios
    const ciudadesEditadas = [];
    for (const ciudad in cambios) {
      // Cerrar scouts activos de esa ciudad
      for (const userId in state.scoutsActivos) {
        const teniaCiudad = (state.scoutsActivos[userId] || []).some(e => e.ciudad === ciudad);
        state.scoutsActivos[userId] = (state.scoutsActivos[userId] || []).filter(e => e.ciudad !== ciudad);
        if (teniaCiudad) await cancelScoutVerification(userId, "Verificacion cancelada: mapas actualizados por admin.");
        if (state.scoutsActivos[userId].length === 0) {
          delete state.scoutsActivos[userId];
        }
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
    await sincronizarMensajeAlertas();
    state.revisionRound = null;
    state.revisionEstado = {};
    guardarRevisionPanel();
    await actualizarRevision();

    return interaction.reply({
      content: `✅ Mapas cargados:\n${ciudadesEditadas.map(c => `• ${c}`).join("\n")}`,
      flags: MessageFlags.Ephemeral
    });
  }

  /* ===== MODAL: EDITAR MAPAS (por ciudad) ===== */

  if (interaction.customId.startsWith("modal_")) {
    const ciudad = interaction.customId.replace("modal_", "");
    const texto = interaction.fields.getTextInputValue("mapas_input");
    const nuevos = normalizarListaMapas(texto.split("\n"));

    const afectados = new Set();
    for (const users of Object.values(state.registros[ciudad] || {})) {
      for (const userId of users) afectados.add(userId);
    }
    for (const [userId, entradas] of Object.entries(state.scoutsActivos)) {
      if ((entradas || []).some(e => e.ciudad === ciudad)) afectados.add(userId);
    }
    for (const userId of afectados) guardarUltimosMapas(userId);

    // Limpiar scouts activos de esa ciudad
    for (const userId in state.scoutsActivos) {
      const teniaCiudad = (state.scoutsActivos[userId] || []).some(e => e.ciudad === ciudad);
      state.scoutsActivos[userId] = (state.scoutsActivos[userId] || []).filter(e => e.ciudad !== ciudad);
      if (teniaCiudad) await cancelScoutVerification(userId, "Verificacion cancelada: mapas actualizados por admin.");
      if (state.scoutsActivos[userId].length === 0) {
        delete state.scoutsActivos[userId];
      }
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
    await sincronizarMensajeAlertas();
    state.revisionRound = null;
    state.revisionEstado = {};
    guardarRevisionPanel();
    await actualizarRevision();

    const confirmMsg = await interaction.reply({ content: `✅ Mapas de **${ciudad}** actualizados.`, flags: MessageFlags.Ephemeral, withResponse: true });
    setTimeout(async () => {
      try { await confirmMsg.resource.message.delete(); } catch (e) {}
    }, 45000);
  }
};
