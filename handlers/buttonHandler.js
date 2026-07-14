const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const { canScout, canUseAdmin, canManageMaps, canManageSensitiveScoutData } = require('../permissions');
const { guardarDatos, guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { respuestaCiudades, respuestaMapas } = require('../components/panelComponents');
const { componentesRevision } = require('../components/revisionComponents');
const { generarEmbedRevision } = require('../embeds/revisionEmbed');
const { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario } = require('../utils/scouts');
const { actualizarPanel, actualizarRevision } = require('../utils/panel');
const { verificarMapaVacio } = require('../utils/alerts');
const { isVerificationButton, handleVerificationButton, cancelScoutVerification, normalizeVerificationMode } = require('../utils/verification');
const { sendScoutLog, formatMaps, formatUser } = require('../utils/scoutLogs');
const { tickRevisionRound, getRevisionMultiplier, revisionConfig } = require('../utils/revisionRounds');
const { payloadAjusteMultiplier } = require('../components/revisionMultiplierComponents');
const { mapConfigPanel, mapListEmbed, confirmClearMaps } = require('../components/mapConfigComponents');
const { adminPanel, activeScoutsEmbed, verificationQueueEmbed, auditEmbed, verificationModePanel } = require('../components/adminComponents');
const { userPicker, multipliersPanel } = require('../utils/adminActions');
const { takePendingMapChanges, applyMapChanges, scheduleMapChanges, clearScheduledMaps, clearActiveMaps } = require('../utils/mapManagement');
const { addAuditEntry } = require('../utils/audit');
const { regenerateSummaryMessage } = require('../utils/dailySummary');

function backRow(customId = 'admin_home') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel('Volver').setStyle(ButtonStyle.Secondary)
  );
}

module.exports = async function handleButton(interaction) {

  if (isVerificationButton(interaction.customId)) {
    return handleVerificationButton(interaction);
  }

  /* ===== CONFIGURACIÓN DE MAPAS ===== */

  if (interaction.customId.startsWith('map_config_') || interaction.customId.startsWith('map_changes_')) {
    if (!canManageMaps(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso para configurar mapas.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.customId === 'map_config_home') return interaction.update(mapConfigPanel());

    if (interaction.customId === 'map_config_import') {
      const input = new TextInputBuilder()
        .setCustomId('mapas_bulk_input')
        .setLabel('Ciudades y mapas')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Thetford:\nDeathwisp Sink\n\nLymhurst:\nHigh Tree Isle')
        .setRequired(true);
      const modal = new ModalBuilder()
        .setCustomId('modal_cargar_mapas')
        .setTitle('Importar mapas')
        .addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.customId === 'map_config_edit') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('editar_ciudad')
        .setPlaceholder('Selecciona una ciudad')
        .addOptions(Object.keys(state.mapas).map(city => ({ label: city, value: city })));
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('Editar ciudad').setDescription('Selecciona la ciudad cuya lista completa deseas editar.').setColor(0x3498db)],
        components: [new ActionRowBuilder().addComponents(select), backRow('map_config_home')],
      });
    }

    if (interaction.customId === 'map_config_active') {
      return interaction.update({ embeds: [mapListEmbed('Mapas activos', state.mapas)], components: [backRow('map_config_home')] });
    }
    if (interaction.customId === 'map_config_scheduled') {
      const maps = state.scheduledMaps?.maps;
      return interaction.update({
        embeds: [maps ? mapListEmbed('Próximo período · 10 UTC', maps) : new EmbedBuilder().setTitle('Próximo período').setDescription('No hay mapas programados.').setColor(0x95a5a6)],
        components: [backRow('map_config_home')],
      });
    }
    if (interaction.customId === 'map_config_cancel_scheduled') {
      clearScheduledMaps({ id: interaction.user.id, name: interaction.user.username });
      return interaction.update(mapConfigPanel());
    }
    if (interaction.customId === 'map_config_clear') return interaction.update(confirmClearMaps());
    if (interaction.customId === 'map_config_clear_confirm') {
      await interaction.deferUpdate();
      await clearActiveMaps({ id: interaction.user.id, name: interaction.user.username });
      return interaction.editReply({ content: '✅ Mapas activos vaciados correctamente.', ...mapConfigPanel() });
    }

    if (interaction.customId === 'map_changes_cancel') {
      takePendingMapChanges(interaction.user.id);
      return interaction.update(mapConfigPanel());
    }
    if (interaction.customId === 'map_changes_apply' || interaction.customId === 'map_changes_schedule') {
      const pending = takePendingMapChanges(interaction.user.id);
      if (!pending) {
        return interaction.update({ content: 'La vista previa venció. Abre nuevamente la configuración.', embeds: [], components: [backRow('map_config_home')] });
      }
      if (interaction.customId === 'map_changes_schedule') {
        scheduleMapChanges(pending.changes, { id: interaction.user.id, name: interaction.user.username });
        return interaction.update({ content: '✅ Configuración programada para el próximo cierre de las 10 UTC.', ...mapConfigPanel() });
      }
      await interaction.deferUpdate();
      const result = await applyMapChanges(pending.changes, { id: interaction.user.id, name: interaction.user.username });
      return interaction.editReply({ content: `✅ Cambios aplicados. Scouts afectados: **${result.affectedUsers.length}**.`, ...mapConfigPanel() });
    }
  }

  /* ===== PANEL ADMINISTRATIVO ===== */

  if (interaction.customId === 'admin_home') {
    if (!canUseAdmin(interaction.member)) return interaction.reply({ content: 'No tienes permiso.', flags: MessageFlags.Ephemeral });
    return interaction.update(adminPanel({ sensitive: canManageSensitiveScoutData(interaction.member) }));
  }

  if (interaction.customId.startsWith('admin_')) {
    if (!canUseAdmin(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso para operar MapasBot.', flags: MessageFlags.Ephemeral });
    }
    const sensitive = canManageSensitiveScoutData(interaction.member);
    if (interaction.customId === 'admin_active_scouts') {
      return interaction.update({ embeds: [activeScoutsEmbed()], components: [backRow()] });
    }
    if (interaction.customId === 'admin_remove_scout') {
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('Retirar scout').setDescription('Selecciona un scout activo.').setColor(0xed4245)],
        components: [userPicker('select_admin_remove_scout', 'Selecciona un scout'), backRow()],
      });
    }
    if (interaction.customId === 'admin_force_verify') {
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('Enviar verificación').setDescription('Selecciona un scout activo.').setColor(0xf1c40f)],
        components: [userPicker('select_admin_force_verify', 'Selecciona un scout'), backRow()],
      });
    }
    if (interaction.customId === 'admin_verification_queue') {
      return interaction.update({ embeds: [verificationQueueEmbed()], components: [backRow()] });
    }
    if (interaction.customId === 'admin_audit') {
      return interaction.update({ embeds: [auditEmbed()], components: [backRow()] });
    }

    if (!sensitive) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.customId === 'admin_assign_hours') {
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('Asignar o restar horas').setDescription('Selecciona un scout y luego indica el ajuste.').setColor(0x5865f2)],
        components: [userPicker('select_admin_assign_hours', 'Selecciona un scout'), backRow()],
      });
    }
    if (interaction.customId === 'admin_multipliers') {
      await interaction.deferUpdate();
      return interaction.editReply(await multipliersPanel(interaction));
    }
    if (interaction.customId === 'admin_revision_control') {
      const round = state.revisionRound;
      const description = round
        ? `Ronda activa hasta <t:${Math.floor(round.endsAt / 1000)}:R>. Puedes detenerla sin aplicar penalizaciones.`
        : 'No hay una ronda activa.';
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('Control de revisiones').setDescription(description).setColor(round ? 0xf1c40f : 0x57f287)],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('admin_revision_reset_confirm').setLabel('Detener y limpiar').setStyle(ButtonStyle.Danger).setDisabled(!round),
          new ButtonBuilder().setCustomId('admin_home').setLabel('Volver').setStyle(ButtonStyle.Secondary),
        )],
      });
    }
    if (interaction.customId === 'admin_revision_reset_confirm') {
      state.revisionRound = null;
      state.revisionEstado = {};
      guardarRevisionPanel();
      await actualizarRevision();
      addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: 'detuvo y limpio la ronda de revision' });
      return interaction.update({ embeds: [new EmbedBuilder().setTitle('Revisión detenida').setDescription('La ronda fue cancelada sin aplicar penalizaciones.').setColor(0x57f287)], components: [backRow()] });
    }
    if (interaction.customId === 'admin_verification_mode') return interaction.update(verificationModePanel());
    if (interaction.customId === 'admin_verification_mode_photo' || interaction.customId === 'admin_verification_mode_normal') {
      state.verificationMode = normalizeVerificationMode(interaction.customId.endsWith('normal') ? 'normal' : 'foto');
      guardarDatos();
      addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: `cambio el modo de verificacion a ${state.verificationMode}` });
      return interaction.update(verificationModePanel());
    }
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

  /* ===== MULTIPLICADORES DE REVISIÓN ===== */

  if (interaction.customId === 'revision_regenerate_summary') {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    if (!state.lastArchivedSummaryMessageId) {
      const input = new TextInputBuilder()
        .setCustomId('summary_message_id')
        .setLabel('ID del resumen que será reemplazado')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      return interaction.showModal(new ModalBuilder()
        .setCustomId('modal_revision_regenerate_summary')
        .setTitle('Regenerar resumen diario')
        .addComponents(new ActionRowBuilder().addComponents(input)));
    }
    return interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle('Regenerar último resumen')
        .setColor(0xf1c40f)
        .setDescription(`Se reemplazará el resumen guardado con ID \`${state.lastArchivedSummaryMessageId}\` usando los multiplicadores actuales.`)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('revision_regenerate_summary_confirm').setLabel('Confirmar').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('revision_regenerate_summary_other').setLabel('Elegir otro').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin_home').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      )],
    });
  }

  if (interaction.customId === 'revision_regenerate_summary_other') {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    const input = new TextInputBuilder()
      .setCustomId('summary_message_id')
      .setLabel('ID del resumen que será reemplazado')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ej: 1525803909573116065')
      .setRequired(true);
    if (state.lastArchivedSummaryMessageId) input.setValue(state.lastArchivedSummaryMessageId);
    const modal = new ModalBuilder()
      .setCustomId('modal_revision_regenerate_summary')
      .setTitle('Regenerar resumen diario')
      .addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.customId === 'revision_regenerate_summary_confirm') {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    const messageId = state.lastArchivedSummaryMessageId;
    if (!messageId) return interaction.update({ content: 'No hay un resumen archivado para regenerar.', embeds: [], components: [backRow()] });
    await interaction.deferUpdate();
    try {
      const result = await regenerateSummaryMessage(messageId);
      const url = `https://discord.com/channels/${interaction.guildId}/${result.replacement.channel.id}/${result.replacement.id}`;
      addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: 'regenero el ultimo resumen diario', details: { oldMessageId: messageId, newMessageId: result.replacement.id } });
      return interaction.editReply({ content: `✅ [Resumen regenerado](${url}).`, embeds: [], components: [backRow()] });
    } catch (err) {
      return interaction.editReply({ content: `No se pudo regenerar: ${err.message || err}`, embeds: [], components: [backRow()] });
    }
  }

  const multiplierButton = /^revision_mult_(down|up|exact)_(\d+)$/.exec(interaction.customId);
  if (multiplierButton) {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    const [, action, userId] = multiplierButton;
    const score = state.revisionScores[userId] || {
      misses: 0,
      eligibleRounds: 0,
      compliantRounds: 0,
      multiplier: 1,
    };
    state.revisionScores[userId] = score;

    if (action === 'exact') {
      const input = new TextInputBuilder()
        .setCustomId('multiplier_input')
        .setLabel('Entre 0.70 y 1.00, o auto')
        .setStyle(TextInputStyle.Short)
        .setValue(getRevisionMultiplier(userId).toFixed(2))
        .setRequired(true);
      const modal = new ModalBuilder()
        .setCustomId(`modal_revision_multiplier_${userId}`)
        .setTitle('Ajustar multiplicador')
        .addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    const delta = action === 'down' ? -0.05 : 0.05;
    const minimum = revisionConfig().minimumMultiplier;
    score.manualMultiplier = Math.max(minimum, Math.min(1, Math.round((getRevisionMultiplier(userId) + delta) * 100) / 100));
    guardarRevisionPanel();
    addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: `ajusto el multiplicador a x${score.manualMultiplier.toFixed(2)}`, targetId: userId });
    return interaction.update({ content: null, ...payloadAjusteMultiplier(userId) });
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
    const pendientes = [];

    for (const { ciudad, mapa } of lista) {
      if (!state.mapas[ciudad]?.includes(mapa)) {
        saltados.push(`${ciudad} - ${mapa} (eliminado)`);
        pendientes.push({ ciudad, mapa });
        continue;
      }

      if (!state.registros[ciudad]) state.registros[ciudad] = {};
      if (!state.registros[ciudad][mapa]) state.registros[ciudad][mapa] = [];

      if (state.registros[ciudad][mapa].includes(userId)) continue;

      if (state.registros[ciudad][mapa].length >= 5) {
        saltados.push(`${ciudad} - ${mapa} (lleno)`);
        pendientes.push({ ciudad, mapa });
        continue;
      }

      state.registros[ciudad][mapa].push(userId);

      if (!state.scoutsActivos[userId]) state.scoutsActivos[userId] = [];
      const yaActivo = state.scoutsActivos[userId].some(e => e.ciudad === ciudad && e.mapa === mapa);
      if (!yaActivo) {
        state.scoutsActivos[userId].push({ ciudad, mapa, inicio: Date.now(), username: interaction.user.username });
      }

      anotados.push(`${ciudad} - ${mapa}`);
      mapasAnotados.push({ ciudad, mapa });
    }

    if (pendientes.length > 0) state.ultimosMapas[userId] = pendientes;
    else delete state.ultimosMapas[userId];

    guardarDatos();
    guardarScouts();
    await actualizarPanel();
    for (const { ciudad, mapa } of mapasAnotados) {
      await verificarMapaVacio(ciudad, mapa);
    }
    if (mapasAnotados.length > 0) {
      await sendScoutLog('ANOTADO', [
        `Scout: ${formatUser(userId, interaction.user.username)}`,
        `Mapas: ${formatMaps(mapasAnotados)}`,
        `Origen: volver a mis mapas`
      ]);
    }

    let respuesta = "";
    if (anotados.length > 0) respuesta += `✅ Ahí estás de vuelta hermano:\n${anotados.map(m => `• ${m}`).join("\n")}`;
    if (saltados.length > 0) respuesta += `\n⚠️ No se pudo (queda guardado para reintentar):\n${saltados.map(m => `• ${m}`).join("\n")}`;
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

    if (!state.revisionRound) {
      return interaction.editReply({ content: 'No hay una ronda activa. Usa `/revisar` o `!revisar` para iniciar una.' });
    }

    if (ahora >= state.revisionRound.endsAt) {
      await tickRevisionRound(ahora);
      return interaction.editReply({ content: 'La ronda acaba de cerrar. Usa `/revisar` o `!revisar` para iniciar la siguiente.' });
    }

    // Verificar rol Scout
    if (!canScout(interaction.member) && !canUseAdmin(interaction.member)) {
      return interaction.editReply({ content: "Necesitas el rol Scout para marcar mapas." });
    }

    const asignados = state.revisionRound?.assignments?.[key]?.userIds || [];
    if (!asignados.includes(userId) && !canUseAdmin(interaction.member)) {
      return interaction.editReply({ content: "Solo un scout anotado en este mapa o un administrador puede revisarlo." });
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
    guardarRevisionPanel();

    await interaction.editReply({ content: `✅ **${mapa}** marcado como revisado.` });

    await actualizarRevision();
  }
};
