const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const state = require('../data/state');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario } = require('../utils/scouts');
const { actualizarPanel } = require('../utils/panel');
const { cancelScoutVerification } = require('../utils/verification');
const { sendScoutLog, formatMaps, formatUser } = require('../utils/scoutLogs');
const { canUseAdmin } = require('../permissions');
const { getRevisionMultiplier } = require('../utils/revisionRounds');

module.exports = async function handleSelect(interaction) {

  /* ===== AJUSTAR MULTIPLICADOR ===== */

  if (interaction.customId === 'select_revision_multiplier') {
    if (!canUseAdmin(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso de admin.', flags: MessageFlags.Ephemeral });
    }

    const userId = interaction.values[0];
    const score = state.revisionScores[userId] || {};
    const modal = new ModalBuilder()
      .setCustomId(`modal_revision_multiplier_${userId}`)
      .setTitle('Ajustar multiplicador');

    const input = new TextInputBuilder()
      .setCustomId('multiplier_input')
      .setLabel('Entre 0.70 y 1.00, o auto')
      .setStyle(TextInputStyle.Short)
      .setValue(Number.isFinite(Number(score.manualMultiplier))
        ? Number(score.manualMultiplier).toFixed(2)
        : getRevisionMultiplier(userId).toFixed(2))
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  /* ===== EDITAR CIUDAD ===== */

  if (interaction.customId === "editar_ciudad") {
    const ciudad = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`modal_${ciudad}`)
      .setTitle(`Editar mapas - ${ciudad}`);

    const input = new TextInputBuilder()
      .setCustomId("mapas_input")
      .setLabel("Pega mapas (uno por línea)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  /* ===== LIMPIAR SCOUT ===== */

  if (interaction.customId === "select_limpiar_scout") {
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

    return interaction.update({
      content: `✅ Scout <@${userId}> removido correctamente.`,
      components: []
    });
  }
};
