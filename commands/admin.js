const { SlashCommandBuilder, MessageFlags, StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const { canUseAdmin } = require('../permissions');
const { guardarDatos, guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { cerrarScoutsActivos, borrarRegistrosUsuario } = require('../utils/scouts');
const { actualizarPanel, crearPanelRevision } = require('../utils/panel');
const { forceScoutVerification, getVerificationMode, normalizeVerificationMode } = require('../utils/verification');

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
      subcmd.setName("verificar")
        .setDescription("Mandar verificacion por MD a un scout activo")
        .addUserOption(option =>
          option.setName("usuario")
            .setDescription("Scout a verificar")
            .setRequired(true)
        )
    )
    .addSubcommand(subcmd =>
      subcmd.setName("verificacion")
        .setDescription("Ver o cambiar el modo de verificacion de scouts")
        .addStringOption(option =>
          option.setName("modo")
            .setDescription("normal: boton directo | foto: pide captura con hora visible")
            .setRequired(false)
            .addChoices(
              { name: "Normal", value: "normal" },
              { name: "Con foto", value: "foto" }
            )
        )
    )
    .addSubcommand(subcmd => 
      subcmd.setName("reset_revision")
        .setDescription("Reiniciar el panel de revisión a cero")
    ),

  async execute(interaction) {
    if (!canUseAdmin(interaction.member)) {
      return interaction.reply({ content: "No tienes permiso de admin para usar este comando.", flags: MessageFlags.Ephemeral });
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

    /* ===== VERIFICAR SCOUT ===== */
    if (sub === "verificar") {
      const usuario = interaction.options.getUser("usuario");
      const result = await forceScoutVerification(usuario.id, interaction.user.id);

      const mensajes = {
        inactive: "Ese usuario no esta anotado en ningun mapa activo.",
        pending: "Ese usuario ya tiene una verificacion pendiente.",
        dm_unavailable: "No pude enviarle MD a ese usuario. Puede tener mensajes privados cerrados.",
        send_failed: "No pude enviar la verificacion por MD.",
      };

      if (!result.ok) {
        return interaction.reply({
          content: mensajes[result.reason] || "No se pudo mandar la verificacion.",
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.reply({
        content: `Verificacion enviada a ${usuario}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    /* ===== MODO VERIFICACION ===== */
    if (sub === "verificacion") {
      const modo = interaction.options.getString("modo");
      if (modo) {
        state.verificationMode = normalizeVerificationMode(modo);
        guardarDatos();
      }

      const actual = getVerificationMode();
      const label = actual === "foto" ? "Con foto" : "Normal";
      const detalle = actual === "foto"
        ? "El scout debe pulsar **Sigo activo** y enviar una captura con la hora visible."
        : "El scout confirma solo pulsando **Sigo activo**.";

      const embed = new EmbedBuilder()
        .setTitle("Modo de verificacion")
        .setColor(actual === "foto" ? 0xf1c40f : 0x57f287)
        .setDescription(`Modo actual: **${label}**\n${detalle}`);

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
