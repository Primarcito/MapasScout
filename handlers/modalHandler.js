const { MessageFlags } = require('discord.js');
const state = require('../data/state');
const { guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { canManageMaps, canManageSensitiveScoutData } = require('../permissions');
const { getRevisionMultiplier, revisionConfig } = require('../utils/revisionRounds');
const { regenerateSummaryMessage } = require('../utils/dailySummary');
const { normalizarListaMapas } = require('../utils/mapNames');
const { parseBulkMapInput, storePendingMapChanges } = require('../utils/mapManagement');
const { mapChangesPreview } = require('../components/mapConfigComponents');
const { asignarTiempoManual } = require('../utils/scouts');
const { addAuditEntry } = require('../utils/audit');

function formatTime(value) {
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${hours ? `${hours}h ` : ''}${minutes}m`.trim();
}

module.exports = async function handleModal(interaction) {
  if (interaction.customId === 'modal_revision_regenerate_summary') {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    const messageId = interaction.fields.getTextInputValue('summary_message_id').trim();
    if (!/^\d{17,20}$/.test(messageId)) {
      return interaction.reply({ content: 'El ID del mensaje no es válido.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await regenerateSummaryMessage(messageId);
      const url = `https://discord.com/channels/${interaction.guildId}/${result.replacement.channel.id}/${result.replacement.id}`;
      addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: 'regenero el resumen diario', details: { oldMessageId: messageId, newMessageId: result.replacement.id } });
      return interaction.editReply(`✅ [Resumen regenerado](${url}). ${result.deleted ? 'El anterior fue eliminado.' : 'No pude eliminar el anterior.'}`);
    } catch (err) {
      return interaction.editReply(`No se pudo regenerar el resumen: ${err.message || err}`);
    }
  }

  if (interaction.customId.startsWith('modal_revision_multiplier_')) {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    const userId = interaction.customId.replace('modal_revision_multiplier_', '');
    const raw = interaction.fields.getTextInputValue('multiplier_input').trim().toLowerCase();
    const score = state.revisionScores[userId] || { misses: 0, eligibleRounds: 0, compliantRounds: 0, multiplier: 1 };
    if (['auto', 'automático', 'automatico'].includes(raw)) {
      delete score.manualMultiplier;
    } else {
      const value = Number(raw.replace(',', '.'));
      const minimum = revisionConfig().minimumMultiplier;
      if (!Number.isFinite(value) || value < minimum || value > 1) {
        return interaction.reply({ content: `Escribe un valor entre ${minimum.toFixed(2)} y 1.00.`, flags: MessageFlags.Ephemeral });
      }
      score.manualMultiplier = Math.round(value * 100) / 100;
    }
    state.revisionScores[userId] = score;
    guardarRevisionPanel();
    addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: `ajusto el multiplicador a x${getRevisionMultiplier(userId).toFixed(2)}`, targetId: userId });
    return interaction.reply({ content: `✅ Multiplicador de <@${userId}>: **x${getRevisionMultiplier(userId).toFixed(2)}**.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId.startsWith('modal_admin_assign_hours_')) {
    if (!canManageSensitiveScoutData(interaction.member)) {
      return interaction.reply({ content: 'Esta acción requiere rol GM u Officer.', flags: MessageFlags.Ephemeral });
    }
    const userId = interaction.customId.replace('modal_admin_assign_hours_', '');
    const rawHours = interaction.fields.getTextInputValue('hours_value').trim().replace(',', '.');
    const hours = Number(rawHours);
    const reason = interaction.fields.getTextInputValue('hours_reason').trim();
    if (!Number.isFinite(hours) || hours === 0 || hours < -24 || hours > 24) {
      return interaction.reply({ content: 'Escribe una cantidad distinta de cero entre -24 y 24 horas.', flags: MessageFlags.Ephemeral });
    }
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    const result = asignarTiempoManual(userId, user?.globalName || user?.username || userId, Math.round(hours * 60), interaction.user.id, reason);
    guardarScouts();
    addAuditEntry({ actorId: interaction.user.id, actorName: interaction.user.username, action: `ajusto ${result.appliedMinutes > 0 ? '+' : ''}${result.appliedMinutes} minutos`, targetId: userId, details: { reason } });
    if (!result.appliedMinutes) {
      return interaction.reply({ content: `<@${userId}> no tiene tiempo disponible para restar.`, flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: `✅ Se ${result.appliedMinutes > 0 ? 'sumaron' : 'restaron'} **${formatTime(result.appliedMinutes)}** a <@${userId}>. Total: **${formatTime(result.totalMinutes)}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.customId === 'modal_cargar_mapas') {
    if (!canManageMaps(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso para configurar mapas.', flags: MessageFlags.Ephemeral });
    }
    const changes = parseBulkMapInput(interaction.fields.getTextInputValue('mapas_bulk_input'));
    if (!Object.keys(changes).length) {
      return interaction.reply({ content: 'No se detectó ninguna ciudad válida.', flags: MessageFlags.Ephemeral });
    }
    storePendingMapChanges(interaction.user.id, changes, 'bulk');
    return interaction.reply({ ...mapChangesPreview(changes), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId.startsWith('modal_')) {
    if (!canManageMaps(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso para configurar mapas.', flags: MessageFlags.Ephemeral });
    }
    const city = interaction.customId.replace('modal_', '');
    if (!Object.hasOwn(state.mapas, city)) {
      return interaction.reply({ content: 'La ciudad indicada no es válida.', flags: MessageFlags.Ephemeral });
    }
    const changes = { [city]: normalizarListaMapas(interaction.fields.getTextInputValue('mapas_input').split(/\r?\n/)) };
    storePendingMapChanges(interaction.user.id, changes, 'city');
    return interaction.reply({ ...mapChangesPreview(changes), flags: MessageFlags.Ephemeral });
  }
};
