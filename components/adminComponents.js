const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const { buttonEmoji } = require('../emojis');
const { getVerificationMode } = require('../utils/verification');

function adminPanel({ sensitive = false } = {}) {
  const embed = new EmbedBuilder()
    .setTitle('Administración de MapasBot')
    .setColor(sensitive ? 0xe0a82e : 0x3498db)
    .setDescription(
      sensitive
        ? 'Acceso superior detectado. Puedes operar mapas y modificar horas, multiplicadores y revisiones.'
        : 'Acceso operativo. Puedes gestionar scouts, verificaciones y consultar la actividad.'
    );

  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_active_scouts').setLabel('Scouts activos').setEmoji(buttonEmoji('ACTIVE')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_remove_scout').setLabel('Retirar scout').setEmoji(buttonEmoji('DROP')).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_force_verify').setLabel('Enviar verificación').setEmoji(buttonEmoji('VERIFIED')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_verification_queue').setLabel('Verificaciones').setEmoji(buttonEmoji('REVIEW')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_audit').setLabel('Auditoría').setStyle(ButtonStyle.Secondary),
  )];

  if (sensitive) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_assign_hours').setLabel('Asignar horas').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_multipliers').setLabel('Multiplicadores').setEmoji(buttonEmoji('ALERT')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_revision_control').setLabel('Revisiones').setEmoji(buttonEmoji('REVIEW')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_verification_mode').setLabel('Modo verificación').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('revision_regenerate_summary').setLabel('Regenerar resumen').setStyle(ButtonStyle.Secondary),
  ));

  return { embeds: [embed], components: rows };
}

function activeScoutsEmbed() {
  const entries = Object.entries(state.scoutsActivos || {});
  const lines = entries.slice(0, 40).map(([userId, maps]) => {
    const oldest = Math.min(...maps.map(map => Number(map.inicio) || Date.now()));
    return `• <@${userId}> · **${maps.length}** mapas · desde <t:${Math.floor(oldest / 1000)}:R>`;
  });
  return new EmbedBuilder()
    .setTitle(`Scouts activos · ${entries.length}`)
    .setColor(0x57f287)
    .setDescription(lines.join('\n') || 'No hay scouts activos.');
}

function verificationQueueEmbed() {
  const entries = Object.entries(state.verificacionesScout || {});
  const lines = entries.slice(0, 40).map(([userId, pending]) => {
    const labels = {
      waiting_response: 'esperando respuesta',
      waiting_screenshot: 'esperando captura',
      waiting_review: 'pendiente de revisión',
    };
    const since = pending.createdAt || Date.now();
    return `• <@${userId}> · **${labels[pending.status] || pending.status}** · <t:${Math.floor(since / 1000)}:R>`;
  });
  return new EmbedBuilder()
    .setTitle(`Verificaciones · ${entries.length}`)
    .setColor(entries.length ? 0xf1c40f : 0x57f287)
    .setDescription(lines.join('\n') || 'No hay verificaciones pendientes.');
}

function auditEmbed() {
  const lines = (state.logAdmin || []).slice(-30).reverse().map(entry => {
    const actor = entry.userId ? `<@${entry.userId}>` : `**${entry.username || 'sistema'}**`;
    return `• <t:${Math.floor(entry.timestamp / 1000)}:t> ${actor} ${entry.accion}`;
  });
  return new EmbedBuilder()
    .setTitle('Auditoría administrativa')
    .setColor(0x95a5a6)
    .setDescription(lines.join('\n').slice(0, 3900) || 'No hay movimientos registrados.');
}

function verificationModePanel() {
  const current = getVerificationMode();
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Modo de verificación')
      .setColor(current === 'foto' ? 0xf1c40f : 0x57f287)
      .setDescription(`Modo actual: **${current === 'foto' ? 'Con foto' : 'Normal'}**`)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin_verification_mode_photo').setLabel('Con foto').setStyle(ButtonStyle.Primary).setDisabled(current === 'foto'),
      new ButtonBuilder().setCustomId('admin_verification_mode_normal').setLabel('Normal').setStyle(ButtonStyle.Secondary).setDisabled(current === 'normal'),
      new ButtonBuilder().setCustomId('admin_home').setLabel('Volver').setStyle(ButtonStyle.Secondary),
    )],
  };
}

module.exports = {
  adminPanel,
  activeScoutsEmbed,
  verificationQueueEmbed,
  auditEmbed,
  verificationModePanel,
};
