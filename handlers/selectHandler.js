const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const state = require('../data/state');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario } = require('../utils/scouts');
const { actualizarPanel } = require('../utils/panel');
const { cancelScoutVerification } = require('../utils/verification');
const { sendScoutLog, formatMaps, formatUser } = require('../utils/scoutLogs');

module.exports = async function handleSelect(interaction) {

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
