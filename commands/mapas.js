const { SlashCommandBuilder, MessageFlags, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const { canManageMaps } = require('../permissions');
const { guardarPanel, guardarDatos, guardarScouts } = require('../data/persistence');
const { generarEmbed } = require('../embeds/panelEmbed');
const { componentesPanel } = require('../components/panelComponents');
const { actualizarPanel } = require('../utils/panel');
const { cerrarScoutsActivos } = require('../utils/scouts');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mapas")
    .setDescription("Comandos administrativos para el panel de mapas")
    .addSubcommand(subcmd => 
      subcmd.setName("panel")
        .setDescription("Crear el panel principal de mapas")
    )
    .addSubcommand(subcmd => 
      subcmd.setName("editar")
        .setDescription("Editar mapas de una ciudad")
    )
    .addSubcommand(subcmd => 
      subcmd.setName("cargar")
        .setDescription("Cargar todos los mapas del día de una vez (bulk)")
    )
    .addSubcommand(subcmd => 
      subcmd.setName("reset")
        .setDescription("Resetear el panel de mapas por completo")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    
    // Todos los subcomandos excepto 'panel' requieren permiso admin
    if (sub !== "panel") {
      if (!canManageMaps(interaction.member)) {
        return interaction.reply({ content: "No tienes permiso para administrar mapas.", flags: MessageFlags.Ephemeral });
      }
    }

    /* ===== PANEL ===== */
    if (sub === "panel") {
      const panelReply = await interaction.reply({
        embeds: [generarEmbed()],
        components: componentesPanel(),
        withResponse: true
      });
      state.panelMessage = panelReply.resource.message;
      state.panelChannelId = state.panelMessage.channel.id;
      state.panelMessageId = state.panelMessage.id;
      guardarPanel();
      return;
    }

    /* ===== EDITAR ===== */
    if (sub === "editar") {
      const select = new StringSelectMenuBuilder()
        .setCustomId("editar_ciudad")
        .setPlaceholder("Selecciona ciudad")
        .addOptions(Object.keys(state.mapas).map(c => ({ label: c, value: c })));

      return interaction.reply({
        content: "Selecciona ciudad a editar:",
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral
      });
    }

    /* ===== CARGAR ===== */
    if (sub === "cargar") {
      const modal = new ModalBuilder()
        .setCustomId("modal_cargar_mapas")
        .setTitle("Cargar Mapas del Día");

      const input = new TextInputBuilder()
        .setCustomId("mapas_bulk_input")
        .setLabel("Pega todos los mapas (Ciudad: + mapas)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Thetford:\nDeathwisp Sink\nDrownfield Slough\n\nLymhurst:\nGiantweald Woods")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    /* ===== RESET ===== */
    if (sub === "reset") {
      for (const userId in state.scoutsActivos) {
        cerrarScoutsActivos(userId);
      }

      for (const ciudad in state.mapas) state.mapas[ciudad] = [];
      for (const ciudad in state.registros) state.registros[ciudad] = {};

      state.ultimosMapas = {};
      state.ultimaEdicion = null;

      guardarDatos();
      guardarScouts();
      await actualizarPanel();

      return interaction.reply({
        content: "✅ Panel de mapas reseteado.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
