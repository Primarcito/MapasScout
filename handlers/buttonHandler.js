const { MessageFlags } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const { canScout } = require('../permissions');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { respuestaCiudades, respuestaMapas } = require('../components/panelComponents');
const { componentesRevision } = require('../components/revisionComponents');
const { generarEmbedRevision } = require('../embeds/revisionEmbed');
const { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario } = require('../utils/scouts');
const { actualizarPanel, actualizarRevision } = require('../utils/panel');
const { verificarMapaVacio } = require('../utils/alerts');
const { isVerificationButton, handleVerificationButton, cancelScoutVerification } = require('../utils/verification');
const { sendScoutLog, formatMaps, formatUser } = require('../utils/scoutLogs');

module.exports = async function handleButton(interaction) {

  if (isVerificationButton(interaction.customId)) {
    return handleVerificationButton(interaction);
  }

  /* ===== ABRIR ANOTARSE ===== */

  if (interaction.customId === "abrir_anotarse") {
    return interaction.reply({ ...respuestaCiudades(), flags: MessageFlags.Ephemeral });
  }

  /* ===== SELECCIONAR CIUDAD ===== */

  if (interaction.customId.startsWith("ciudad_btn_")) {
    const ciudad = interaction.customId.replace("ciudad_btn_", "");
    return interaction.update(respuestaMapas(ciudad, interaction.user.id));
  }

  /* ===== VOLVER A CIUDADES ===== */

  if (interaction.customId === "volver_ciudades") {
    return interaction.update(respuestaCiudades());
  }

  /* ===== REGISTRO MAPA ===== */

  if (interaction.customId.startsWith("registro_idx_") || interaction.customId.startsWith("registro_btn_")) {
    const isIndexedButton = interaction.customId.startsWith("registro_idx_");
    const partes = interaction.customId
      .replace(isIndexedButton ? "registro_idx_" : "registro_btn_", "")
      .split("__");
    const ciudad = partes[0];
    const mapa = isIndexedButton
      ? state.mapas[ciudad]?.[Number(partes[1])]
      : partes[1];
    const userId = interaction.user.id;

    await interaction.deferUpdate();

    if (!mapa) {
      return interaction.editReply({
        content: "Ese mapa ya no existe o fue editado. Vuelve a abrir Anotarse desde el panel.",
        components: []
      });
    }

    if (!state.registros[ciudad]) state.registros[ciudad] = {};
    if (!state.registros[ciudad][mapa]) state.registros[ciudad][mapa] = [];

    if (state.registros[ciudad][mapa].includes(userId)) {
      // Ya está anotado → desanotarlo
      state.registros[ciudad][mapa] = state.registros[ciudad][mapa].filter(id => id !== userId);

      // Cerrar scout activo de ese mapa
      if (state.scoutsActivos[userId]) {
        const entry = state.scoutsActivos[userId].find(e => e.ciudad === ciudad && e.mapa === mapa);
        if (entry) {
          const duracionMin = Math.floor((Date.now() - entry.inicio) / 60000);
          const reg = { userId, username: interaction.user.username, ciudad, mapa, inicio: entry.inicio, fin: Date.now(), duracionMin };
          state.historialScouts.push(reg);
          state.historialDia.push(reg);
          state.scoutsActivos[userId] = state.scoutsActivos[userId].filter(e => !(e.ciudad === ciudad && e.mapa === mapa));
          await cancelScoutVerification(userId, "Verificacion cancelada: cambiaste tus mapas activos.");
          if (state.scoutsActivos[userId].length === 0) {
            delete state.scoutsActivos[userId];
          }
          // Track ultima actividad para alerta 30min
          const cobKey2 = `${ciudad}__${mapa}`;
          if (!state.coberturaDia[cobKey2]) state.coberturaDia[cobKey2] = { ciudad, mapa, minutos: 0 };
          state.coberturaDia[cobKey2].ultimaActividad = Date.now();
        }
      }

      guardarDatos();
      guardarScouts();
      await actualizarPanel();
      await verificarMapaVacio(ciudad, mapa);
      await sendScoutLog('RETIRADO', [
        `Scout: ${formatUser(userId, interaction.user.username)}`,
        `Mapas: ${formatMaps([{ ciudad, mapa }])}`,
        `Motivo: salida manual`
      ]);

      const resp = respuestaMapas(ciudad, userId);
      resp.content = `❌ Saliste de **${mapa}**\n\n` + resp.content;
      return interaction.editReply(resp);

    } else if (state.registros[ciudad][mapa].length < 5) {
      // No está anotado y hay lugar → anotarlo
      state.registros[ciudad][mapa].push(userId);

      if (!state.scoutsActivos[userId]) state.scoutsActivos[userId] = [];
      state.scoutsActivos[userId].push({ ciudad, mapa, inicio: Date.now(), username: interaction.user.username });
      // Inicializar cobertura si no existe
      const cobKey = `${ciudad}__${mapa}`;
      if (!state.coberturaDia[cobKey]) state.coberturaDia[cobKey] = { ciudad, mapa, minutos: 0, inicio: Date.now() };

      guardarDatos();
      guardarScouts();
      await actualizarPanel();
      await verificarMapaVacio(ciudad, mapa);
      await sendScoutLog('ANOTADO', [
        `Scout: ${formatUser(userId, interaction.user.username)}`,
        `Mapas: ${formatMaps([{ ciudad, mapa }])}`,
        `Origen: boton Anotarse`
      ]);

      const resp = respuestaMapas(ciudad, userId);
      resp.content = `✅ Listo causa, ya estás en **${mapa}**\n\n` + resp.content;
      return interaction.editReply(resp);
    } else {
      // Lleno
      const resp = respuestaMapas(ciudad, userId);
      resp.content = `⚠️ **${mapa}** está lleno.\n\n` + resp.content;
      return interaction.editReply(resp);
    }
  }

  /* ===== DROPEAR ===== */

  if (interaction.customId === "dropear_mapas") {
    const userId = interaction.user.id;

    if (state.procesando.has(userId)) {
      return interaction.reply({ content: "⏳ Espera un momento...", flags: MessageFlags.Ephemeral });
    }
    state.procesando.add(userId);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Guardar mapas antes de dropear
    guardarUltimosMapas(userId);
    const tieneMaps = state.ultimosMapas[userId]?.length > 0;

    // Guardar qué mapas tenía antes de borrar
    const mapasDropeados = [];
    for (const c in state.registros) {
      for (const m in state.registros[c]) {
        if (state.registros[c][m].includes(userId)) mapasDropeados.push({ ciudad: c, mapa: m });
      }
    }

    cerrarScoutsActivos(userId);
    await cancelScoutVerification(userId, "Verificacion cancelada: el scout salio de sus mapas.");
    borrarRegistrosUsuario(userId);
    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    // Verificar alertas para cada mapa que abandonó
    for (const { ciudad, mapa } of mapasDropeados) {
      await verificarMapaVacio(ciudad, mapa);
    }

    await sendScoutLog('RETIRADO', [
      `Scout: ${formatUser(userId, interaction.user.username)}`,
      `Mapas: ${formatMaps(mapasDropeados)}`,
      `Motivo: dropear mapas`
    ]);

    const msg = tieneMaps
      ? "🔴 Te borraste de todo pata.\nUsá **VOLVER A MIS MAPAS** en el panel para volver."
      : "🔴 Te borraste de todo pata.";

    await interaction.editReply({ content: msg });
    state.procesando.delete(userId);
  }

  /* ===== VOLVER A MAPAS ===== */

  if (interaction.customId === "volver_mapas" || interaction.customId === "volver_mapas_panel") {
    const userId = interaction.user.id;
    const lista = state.ultimosMapas[userId];

    if (!lista || lista.length === 0) {
      return interaction.reply({ content: "No tienes nada guardado pe.", flags: MessageFlags.Ephemeral });
    }

    const anotados = [];
    const mapasAnotados = [];
    const saltados = [];

    for (const { ciudad, mapa } of lista) {
      if (!state.mapas[ciudad]?.includes(mapa)) {
        saltados.push(`${ciudad} - ${mapa} (eliminado)`);
        continue;
      }

      if (!state.registros[ciudad]) state.registros[ciudad] = {};
      if (!state.registros[ciudad][mapa]) state.registros[ciudad][mapa] = [];

      if (state.registros[ciudad][mapa].includes(userId)) continue;

      if (state.registros[ciudad][mapa].length >= 5) {
        saltados.push(`${ciudad} - ${mapa} (lleno)`);
        continue;
      }

      state.registros[ciudad][mapa].push(userId);

      if (!state.scoutsActivos[userId]) state.scoutsActivos[userId] = [];
      state.scoutsActivos[userId].push({ ciudad, mapa, inicio: Date.now() });

      anotados.push(`${ciudad} - ${mapa}`);
      mapasAnotados.push({ ciudad, mapa });
    }

    delete state.ultimosMapas[userId];

    guardarDatos();
    guardarScouts();
    await actualizarPanel();
    if (mapasAnotados.length > 0) {
      await sendScoutLog('ANOTADO', [
        `Scout: ${formatUser(userId, interaction.user.username)}`,
        `Mapas: ${formatMaps(mapasAnotados)}`,
        `Origen: volver a mis mapas`
      ]);
    }

    let respuesta = "";
    if (anotados.length > 0) respuesta += `✅ Ahí estás de vuelta hermano:\n${anotados.map(m => `• ${m}`).join("\n")}`;
    if (saltados.length > 0) respuesta += `\n⚠️ No se pudo:\n${saltados.map(m => `• ${m}`).join("\n")}`;
    if (!respuesta) respuesta = "No se pudo volver a ningún mapa.";

    return interaction.reply({ content: respuesta, flags: MessageFlags.Ephemeral });
  }

  /* ===== REVISIÓN CIUDAD ===== */

  if (interaction.customId.startsWith("revision_ciudad_")) {
    const ciudad = interaction.customId.replace("revision_ciudad_", "");
    await interaction.update({
      embeds: [generarEmbedRevision()],
      components: componentesRevision(ciudad)
    });
    return;
  }

  /* ===== REVISIÓN VOLVER CIUDADES ===== */

  if (interaction.customId === "revision_volver_ciudades") {
    await interaction.update({
      embeds: [generarEmbedRevision()],
      components: componentesRevision()
    });
    return;
  }

  /* ===== REVISIÓN MAPA ===== */

  if (interaction.customId.startsWith("revision_idx_") || interaction.customId.startsWith("revision_btn_")) {
    const isIndexedRevision = interaction.customId.startsWith("revision_idx_");
    const rawKey = interaction.customId
      .replace(isIndexedRevision ? "revision_idx_" : "revision_btn_", "");
    const userId = interaction.user.id;
    const ahora = Date.now();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [ciudad, mapaRef] = rawKey.split("__");
    const mapa = isIndexedRevision
      ? state.mapas[ciudad]?.[Number(mapaRef)]
      : mapaRef;

    if (!mapa) {
      return interaction.editReply({ content: "Ese mapa ya no existe o fue editado. Vuelve a abrir el panel de revision." });
    }

    const key = `${ciudad}__${mapa}`;

    // Verificar rol Scout
    if (!canScout(interaction.member)) {
      return interaction.editReply({ content: "Necesitas el rol Scout para marcar mapas." });
    }

    // Obtener revisores actuales (max 2, orden de llegada)
    let revisores = state.revisionEstado[key]?.revisores || [];

    if (!revisores.includes(userId)) {
      if (revisores.length >= 2) {
        revisores = [revisores[1], userId];
      } else {
        revisores = [...revisores, userId];
      }
    }

    // Guardar sin timeout — queda hasta reset manual
    state.revisionEstado[key] = { revisadoEn: ahora, revisores };

    await interaction.editReply({ content: `✅ **${mapa}** marcado como revisado.` });

    await actualizarRevision();
  }
};
