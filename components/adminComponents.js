const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const { buttonEmoji } = require('../emojis');
const { getVerificationMode } = require('../utils/verification');
const { getRegisteredActiveEntries } = require('../utils/scouts');

function homeButton() {
  return new ButtonBuilder().setCustomId('admin_home').setLabel('Volver').setStyle(ButtonStyle.Secondary);
}

function adminPanel({ sensitive = false } = {}) {
  const embed = new EmbedBuilder()
    .setTitle('Administración de MapasBot')
    .setColor(sensitive ? 0xe0a82e : 0x3498db)
    .setDescription(
      sensitive
        ? 'Acceso superior detectado. Puedes operar mapas y modificar horas, multiplicadores y revisiones.'
        : 'Acceso operativo. Puedes gestionar scouts, verificaciones y consultar la actividad.'
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_section_scouts').setLabel('Scouts').setEmoji(buttonEmoji('ACTIVE')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_section_verifications').setLabel('Verificaciones').setEmoji(buttonEmoji('VERIFIED')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_section_revisions').setLabel('Revisiones').setEmoji(buttonEmoji('REVIEW')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_audit').setLabel('Logs').setStyle(ButtonStyle.Secondary),
  )] };
}

function adminScoutsPanel({ sensitive = false } = {}) {
  const buttons = [
    new ButtonBuilder().setCustomId('admin_active_scouts').setLabel('Ver activos').setEmoji(buttonEmoji('ACTIVE')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_remove_scout').setLabel('Retirar').setEmoji(buttonEmoji('DROP')).setStyle(ButtonStyle.Danger),
  ];
  if (sensitive) buttons.push(new ButtonBuilder().setCustomId('admin_assign_hours').setLabel('Asignar horas').setStyle(ButtonStyle.Secondary));
  buttons.push(homeButton());
  return {
    embeds: [new EmbedBuilder().setTitle('Gestión de scouts').setColor(0x3498db).setDescription('Consulta scouts visibles en el panel o administra su actividad.')],
    components: [new ActionRowBuilder().addComponents(...buttons)],
  };
}

function adminVerificationsPanel({ sensitive = false } = {}) {
  const buttons = [
    new ButtonBuilder().setCustomId('admin_verification_queue').setLabel('Ver pendientes').setEmoji(buttonEmoji('REVIEW')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_force_verify').setLabel('Enviar verificación').setEmoji(buttonEmoji('VERIFIED')).setStyle(ButtonStyle.Secondary),
  ];
  if (sensitive) buttons.push(new ButtonBuilder().setCustomId('admin_verification_mode').setLabel('Cambiar modo').setStyle(ButtonStyle.Secondary));
  buttons.push(homeButton());
  return {
    embeds: [new EmbedBuilder().setTitle('Verificaciones').setColor(0xf1c40f).setDescription('Revisa pendientes o envía una verificación a un scout visible y activo.')],
    components: [new ActionRowBuilder().addComponents(...buttons)],
  };
}

function adminRevisionsPanel({ sensitive = false } = {}) {
  const round = state.revisionRound;
  const buttons = [];
  if (sensitive) {
    buttons.push(
      new ButtonBuilder().setCustomId('admin_multipliers').setLabel('Multiplicadores').setEmoji(buttonEmoji('ALERT')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('admin_revision_control').setLabel('Control de ronda').setEmoji(buttonEmoji('REVIEW')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('revision_regenerate_summary').setLabel('Regenerar resumen').setStyle(ButtonStyle.Secondary),
    );
  }
  buttons.push(homeButton());
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Revisiones')
      .setColor(round ? 0xf1c40f : 0x57f287)
      .setDescription(round ? `Ronda activa hasta <t:${Math.floor(round.endsAt / 1000)}:R>.` : 'No hay una ronda activa.')],
    components: [new ActionRowBuilder().addComponents(...buttons)],
  };
}

function activeScoutsEmbed() {
  const entries = Object.keys(state.scoutsActivos || {})
    .map(userId => [userId, getRegisteredActiveEntries(userId)])
    .filter(([, maps]) => maps.length > 0);
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
    .setTitle('Logs administrativos')
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
  adminScoutsPanel,
  adminVerificationsPanel,
  adminRevisionsPanel,
  activeScoutsEmbed,
  verificationQueueEmbed,
  auditEmbed,
  verificationModePanel,
};
