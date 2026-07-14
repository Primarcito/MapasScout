const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const state = require('../data/state');
const { guardarDatos, guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario } = require('../utils/scouts');
const { actualizarPanel } = require('../utils/panel');
const { cancelScoutVerification, forceScoutVerification } = require('../utils/verification');
const { sendScoutLog, formatMaps, formatUser } = require('../utils/scoutLogs');
const { canUseAdmin, canManageMaps, canManageSensitiveScoutData } = require('../permissions');
const { payloadAjusteMultiplier } = require('../components/revisionMultiplierComponents');
const { addAuditEntry } = require('../utils/audit');

module.exports = async function handleSelect(interaction) {

  /* ===== AJUSTAR MULTIPLICADOR ===== */

  if (interaction.customId === 'select_revision_multiplier') {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }

    const userId = interaction.values[0];
    const member = interaction.members?.get(userId) || interaction.guild?.members?.cache?.get(userId);
    const score = state.revisionScores[userId] || {};
    score.aliases = [...new Set([
      ...(score.aliases || []),
      score.username,
      member?.displayName,
      member?.user?.username,
      member?.user?.globalName,
    ].filter(Boolean))];
    score.username = member?.displayName || score.username || member?.user?.username || userId;
    state.revisionScores[userId] = score;
    guardarRevisionPanel();
    return interaction.update({
      content: null,
      ...payloadAjusteMultiplier(userId),
    });
  }

  /* ===== EDITAR CIUDAD ===== */

  if (interaction.customId === "editar_ciudad") {
    if (!canManageMaps(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso para configurar mapas.', flags: MessageFlags.Ephemeral });
    }
    const ciudad = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`modal_${ciudad}`)
      .setTitle(`Editar mapas - ${ciudad}`);

    const input = new TextInputBuilder()
      .setCustomId("mapas_input")
      .setLabel("Pega mapas (uno por línea)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    const currentMaps = (state.mapas[ciudad] || []).join('\n').slice(0, 4000);
    if (currentMaps) input.setValue(currentMaps);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  /* ===== ACCIONES DEL PANEL ADMIN ===== */

  if (interaction.customId === 'select_admin_force_verify') {
    if (!canUseAdmin(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso.', flags: MessageFlags.Ephemeral });
    }
    const userId = interaction.values[0];
    const result = await forceScoutVerification(userId, interaction.user.id);
    const errors = {
      inactive: 'Ese usuario no está en ningún mapa activo.',
      pending: 'Ese usuario ya tiene una verificación pendiente.',
      dm_unavailable: 'No pude enviarle MD; puede tener los mensajes privados cerrados.',
      send_failed: 'No pude enviar la verificación por MD.',
    };
    if (!result.ok) return interaction.update({ content: errors[result.reason] || 'No se pudo enviar la verificación.', embeds: [], components: [] });
    addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: 'envio una verificacion manual', targetId: userId });
    return interaction.update({ content: `✅ Verificación enviada a <@${userId}>.`, embeds: [], components: [] });
  }

  if (interaction.customId === 'select_admin_assign_hours') {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    const userId = interaction.values[0];
    const hours = new TextInputBuilder()
      .setCustomId('hours_value')
      .setLabel('Horas: positivo suma, negativo resta')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ejemplo: 3 o -1.5')
      .setRequired(true);
    const reason = new TextInputBuilder()
      .setCustomId('hours_reason')
      .setLabel('Motivo')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ajuste administrativo')
      .setRequired(true);
    return interaction.showModal(new ModalBuilder()
      .setCustomId(`modal_admin_assign_hours_${userId}`)
      .setTitle('Asignar o restar horas')
      .addComponents(new ActionRowBuilder().addComponents(hours), new ActionRowBuilder().addComponents(reason)));
  }

  /* ===== LIMPIAR SCOUT ===== */

  if (interaction.customId === "select_limpiar_scout" || interaction.customId === 'select_admin_remove_scout') {
    if (!canUseAdmin(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso.', flags: MessageFlags.Ephemeral });
    }
    const userId = interaction.values[0];
    const mapasRemovidos = [];
    for (const ciudad in state.registros) {
      for (const mapa in state.registros[ciudad]) {
        if (state.registros[ciudad][mapa].includes(userId)) {
          mapasRemovidos.push({ ciudad, mapa });
        }
      }
    }

    guardarUltimosMapas(userId);
    cerrarScoutsActivos(userId);
    await cancelScoutVerification(userId, "Verificacion cancelada: el scout fue removido por admin.");
    borrarRegistrosUsuario(userId);

    guardarDatos();
    guardarScouts();
    await actualizarPanel();
    await sendScoutLog('RETIRADO', [
      `Scout: ${formatUser(userId)}`,
      `Mapas: ${formatMaps(mapasRemovidos)}`,
      `Motivo: removido por admin ${interaction.user}`
    ]);
    addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: 'retiro un scout de todos sus mapas', targetId: userId, details: { maps: mapasRemovidos } });

    return interaction.update({
      content: `✅ Scout <@${userId}> removido correctamente.`,
      components: []
    });
  }
};
