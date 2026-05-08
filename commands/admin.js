const { SlashCommandBuilder, MessageFlags, StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const { guardarDatos, guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { cerrarScoutsActivos, borrarRegistrosUsuario } = require('../utils/scouts');
const { actualizarPanel, crearPanelRevision } = require('../utils/panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Utilidades de administración para moderadores")
    .addSubcommand(subcmd => 
      subcmd.setName("limpiar")
        .setDescription("Remover forzosamente a un scout de todos sus mapas")
    )
    .addSubcommand(subcmd => 
      subcmd.setName("log")
        .setDescription("Ver el log de cambios administrativos de hoy")
    )
    .addSubcommand(subcmd => 
      subcmd.setName("reset_revision")
        .setDescription("Reiniciar el panel de revisión a cero")
    ),

  async execute(interaction) {
    const tieneRol = interaction.member.roles.cache.some(
      role => role.name.toLowerCase() === "prio1"
    );

    if (!tieneRol) {
      return interaction.reply({ content: "Necesitas el rol prio1 para usar este comando.", flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();

    /* ===== LIMPIAR SCOUT ===== */
    if (sub === "limpiar") {
      const scouts = new Set();
      for (const ciudad in state.registros) {
        for (const mapa in state.registros[ciudad]) {
          state.registros[ciudad][mapa].forEach(id => scouts.add(id));
        }
      }

      if (scouts.size === 0) {
        return interaction.reply({ content: "No hay scouts registrados.", flags: MessageFlags.Ephemeral });
      }

      const opciones = Array.from(scouts).slice(0, 25).map(id => ({
        label: interaction.guild.members.cache.get(id)?.user?.username || id,
        value: id
      }));

      const select = new StringSelectMenuBuilder()
        .setCustomId("select_limpiar_scout")
        .setPlaceholder("Selecciona scout a remover")
        .addOptions(opciones);

      return interaction.reply({
        content: "Selecciona el scout a remover:",
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral
      });
    }

    /* ===== LOG ADMIN ===== */
    if (sub === "log") {
      if (state.logAdmin.length === 0) {
        return interaction.reply({ content: "No hay cambios registrados hoy.", flags: MessageFlags.Ephemeral });
      }

      let texto = "";
      state.logAdmin.slice(-20).forEach(log => {
        const hora = new Date(log.timestamp).toISOString().slice(11, 16);
        texto += `• **${log.username}** — ${log.accion} — ${hora} UTC\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle("📝 Log de Cambios Admin")
        .setColor(0xe91e63)
        .setDescription(texto);

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    /* ===== RESET REVISION ===== */
    if (sub === "reset_revision") {
      // Limpiar todos los estados de revisión
      for (const key in state.revisionEstado) {
        if (state.revisionEstado[key]?.timeout) clearTimeout(state.revisionEstado[key].timeout);
        delete state.revisionEstado[key];
      }

      // Borrar mensaje viejo
      if (state.revisionMessage) {
        try { await state.revisionMessage.delete(); } catch (e) {}
        state.revisionMessage = null;
        state.revisionMessageId = null;
        guardarRevisionPanel();
      }

      // Recrear panel en el canal fijo
      await crearPanelRevision();

      return interaction.reply({
        content: "✅ Panel de revisión reseteado.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
