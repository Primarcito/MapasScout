const { SlashCommandBuilder, MessageFlags, StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const { canUseAdmin } = require('../permissions');
const { guardarDatos, guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { cerrarScoutsActivos, borrarRegistrosUsuario } = require('../utils/scouts');
const { actualizarRevision } = require('../utils/panel');
const { forceScoutVerification, getVerificationMode, normalizeVerificationMode } = require('../utils/verification');
const { getRevisionMultiplier, revisionConfig } = require('../utils/revisionRounds');

function usuariosConMultiplicador() {
  const ids = new Set(Object.keys(state.revisionScores || {}));
  for (const mapas of Object.values(state.registros || {})) {
    for (const users of Object.values(mapas || {})) for (const id of users) ids.add(id);
  }
  for (const id of Object.keys(state.scoutsActivos || {})) ids.add(id);
  for (const entry of state.historialDia || []) if (entry.userId) ids.add(entry.userId);
  return [...ids];
}

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
    )
    .addSubcommand(subcmd =>
      subcmd.setName("multiplicadores")
        .setDescription("Ver y ajustar manualmente los multiplicadores de scouts")
    )
    .addSubcommand(subcmd =>
      subcmd.setName("multiplicador")
        .setDescription("Ajustar el multiplicador de un scout específico")
        .addUserOption(option => option
          .setName('usuario')
          .setDescription('Scout que deseas ajustar')
          .setRequired(true))
        .addStringOption(option => option
          .setName('valor')
          .setDescription('Entre 0.70 y 1.00, o auto')
          .setRequired(true))
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

    /* ===== MULTIPLICADORES ===== */
    if (sub === 'multiplicador') {
      const usuario = interaction.options.getUser('usuario');
      const raw = interaction.options.getString('valor').trim().toLowerCase();
      const score = state.revisionScores[usuario.id] || {
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

      state.revisionScores[usuario.id] = score;
      guardarRevisionPanel();
      const modo = Number.isFinite(Number(score.manualMultiplier)) ? 'manual' : 'automático';
      return interaction.reply({
        content: `✅ Multiplicador de ${usuario}: **x${getRevisionMultiplier(usuario.id).toFixed(2)}** (${modo}).`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "multiplicadores") {
      const ids = usuariosConMultiplicador();
      const miembros = ids.map(id => {
        const username = interaction.guild.members.cache.get(id)?.user?.username || id;
        const score = state.revisionScores[id] || {};
        return { id, username, score, multiplier: getRevisionMultiplier(id) };
      }).sort((a, b) => a.username.localeCompare(b.username, 'es', { sensitivity: 'base' }));

      const description = miembros.length > 0
        ? miembros.map(item => {
            const manual = Number.isFinite(Number(item.score.manualMultiplier)) ? ' · manual' : '';
            return `• <@${item.id}> — **x${item.multiplier.toFixed(2)}**${manual} · ${item.score.misses || 0} fallos`;
          }).join('\n').slice(0, 3900)
        : 'Todavía no hay scouts con puntuación registrada.';

      const embed = new EmbedBuilder()
        .setTitle('Multiplicadores de scouts')
        .setColor(0x1f9d8a)
        .setDescription(description)
        .setFooter({ text: 'El ajuste manual se mantiene hasta elegir “automático”.' });

      const components = [];
      if (miembros.length > 0) {
        const select = new StringSelectMenuBuilder()
          .setCustomId('select_revision_multiplier')
          .setPlaceholder('Selecciona un scout para ajustar')
          .addOptions(miembros.slice(0, 25).map(item => ({
            label: `${item.username} · x${item.multiplier.toFixed(2)}`.slice(0, 100),
            value: item.id,
            description: Number.isFinite(Number(item.score.manualMultiplier)) ? 'Ajuste manual activo' : 'Cálculo automático',
          })));
        components.push(new ActionRowBuilder().addComponents(select));
      }

      return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }

    /* ===== RESET REVISION ===== */
    if (sub === "reset_revision") {
      // Limpiar todos los estados de revisión
      for (const key in state.revisionEstado) {
        if (state.revisionEstado[key]?.timeout) clearTimeout(state.revisionEstado[key].timeout);
        delete state.revisionEstado[key];
      }
      state.revisionRound = null;
      guardarRevisionPanel();
      await actualizarRevision();

      return interaction.reply({
        content: "✅ Revisión reseteada y detenida. Usa `/revisar` cuando quieras abrir la siguiente ronda.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
