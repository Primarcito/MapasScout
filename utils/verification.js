const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const settings = require('../settings');
const { canReviewScoutVerification } = require('../permissions');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario } = require('./scouts');
const { actualizarPanel } = require('./panel');
const { verificarMapaVacio } = require('./alerts');

let intervalId = null;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

function numberOrDefault(value, fallback, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function getVerificationConfig() {
  const raw = settings.verification || {};
  return {
    enabled: raw.enabled !== false,
    maxActiveMinutes: numberOrDefault(raw.maxActiveMinutes, 120, 15),
    graceMinutes: numberOrDefault(raw.graceMinutes, 10, 1),
    checkIntervalMinutes: numberOrDefault(raw.checkIntervalMinutes, 5, 1),
  };
}

function formatMinutes(totalMin) {
  const horas = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (horas <= 0) return `${mins}m`;
  return `${horas}h ${mins}m`;
}

function getActiveEntries(userId) {
  return (state.scoutsActivos[userId] || []).filter(entry => entry && entry.inicio);
}

function getOldestStart(entries) {
  return entries.reduce((oldest, entry) => Math.min(oldest, entry.inicio), Date.now());
}

function getRegisteredMaps(userId) {
  const maps = [];
  for (const ciudad in state.registros) {
    for (const mapa in state.registros[ciudad]) {
      if (state.registros[ciudad][mapa].includes(userId)) {
        maps.push({ ciudad, mapa });
      }
    }
  }
  return maps;
}

function getAffectedMaps(userId) {
  const seen = new Set();
  const maps = [];
  const add = ({ ciudad, mapa }) => {
    const key = `${ciudad}__${mapa}`;
    if (seen.has(key)) return;
    seen.add(key);
    maps.push({ ciudad, mapa });
  };

  getRegisteredMaps(userId).forEach(add);
  getActiveEntries(userId).forEach(add);
  return maps;
}

function mapsSummary(entries) {
  const names = entries.map(entry => `${entry.ciudad} - ${entry.mapa}`);
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 4).join(', ')} y ${names.length - 4} mas`;
}

function getScoutUsername(userId, fallback = null) {
  const entries = getActiveEntries(userId);
  return fallback || entries[0]?.username || userId;
}

function verificationButtons(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verificacion_confirmar_${userId}`)
        .setLabel('Sigo activo')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`verificacion_salir_${userId}`)
        .setLabel('Salir de mapas')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function awaitingEvidenceButtons(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verificacion_salir_${userId}`)
        .setLabel('Salir de mapas')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function reviewButtons(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verificacion_aprobar_${userId}`)
        .setLabel('Aprobar')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`verificacion_retirar_${userId}`)
        .setLabel('Retirar del mapa')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

async function fetchChannel(channelId) {
  if (!state.client || !channelId) return null;
  try {
    return await state.client.channels.fetch(channelId);
  } catch (err) {
    return null;
  }
}

async function getNotificationChannel() {
  if (state.panelMessage?.channel) return state.panelMessage.channel;

  const panelChannel = await fetchChannel(state.panelChannelId);
  if (panelChannel) return panelChannel;

  return fetchChannel(config.REVISION_CHANNEL_ID);
}

async function getAdminReviewChannel() {
  return fetchChannel(config.SCOUT_VERIFICATION_ADMIN_CHANNEL_ID);
}

async function editMessage(channelId, messageId, payload) {
  try {
    const channel = await fetchChannel(channelId);
    const message = await channel?.messages.fetch(messageId);
    if (!message) return;
    await message.edit(payload);
  } catch (err) {
    // El mensaje pudo haber sido borrado manualmente.
  }
}

async function editVerificationMessage(pending, content, components = []) {
  if (!pending) return;
  await editMessage(pending.channelId, pending.messageId, { content, components });
}

async function editReviewMessage(pending, content) {
  if (!pending?.reviewChannelId || !pending?.reviewMessageId) return;
  await editMessage(pending.reviewChannelId, pending.reviewMessageId, { content, components: [] });
}

function getImageAttachment(message) {
  return message.attachments.find(attachment => {
    const contentType = attachment.contentType || '';
    const filename = (attachment.name || attachment.filename || '').toLowerCase();
    if (contentType === 'image/gif' || filename.endsWith('.gif')) return false;
    return contentType.startsWith('image/') || IMAGE_EXTENSIONS.some(ext => filename.endsWith(ext));
  });
}

function buildReviewEmbed(userId, pending, message, imageUrl) {
  const entries = getActiveEntries(userId);
  const activeSince = entries.length > 0 ? getOldestStart(entries) : pending.createdAt;
  const activeMinutes = Math.max(0, Math.floor((Date.now() - activeSince) / 60000));
  const submittedAt = Math.floor(message.createdTimestamp / 1000);

  return new EmbedBuilder()
    .setTitle('Verificacion de scout pendiente')
    .setColor(0xfee75c)
    .setDescription(
      `Scout: <@${userId}>\n` +
      `Tiempo activo: **${formatMinutes(activeMinutes)}**\n` +
      `Mapas: **${mapsSummary(entries)}**\n` +
      `Captura enviada: <t:${submittedAt}:R>\n` +
      `[Abrir mensaje original](${message.url})`
    )
    .setImage(imageUrl)
    .setFooter({ text: `User ID: ${userId}` });
}

async function requestVerification(userId, entries, now, cfg) {
  if (state.verificacionesScout[userId]) return;

  const channel = await getNotificationChannel();
  if (!channel) {
    console.warn(`No se pudo solicitar verificacion para ${userId}: canal no disponible.`);
    return;
  }

  const oldestStart = getOldestStart(entries);
  const activeMinutes = Math.floor((now - oldestStart) / 60000);
  const expiresAt = now + cfg.graceMinutes * 60000;

  try {
    const msg = await channel.send({
      content:
        `<@${userId}> verificacion de scout: llevas **${formatMinutes(activeMinutes)}** activo en ${mapsSummary(entries)}.\n` +
        `Pulsa **Sigo activo** y luego envia una foto/captura en este canal en **${cfg.graceMinutes}m**. ` +
        `Si no respondes o eliges salir, te retiro del panel.`,
      components: verificationButtons(userId),
      allowedMentions: { users: [userId] }
    });

    state.verificacionesScout[userId] = {
      status: 'waiting_response',
      messageId: msg.id,
      channelId: msg.channel.id,
      createdAt: now,
      expiresAt,
    };
  } catch (err) {
    console.error('Error enviando verificacion de scout:', err);
  }
}

async function closeScoutByVerification(userId, motivo, finOverride, options = {}) {
  const entries = getActiveEntries(userId);
  const pending = state.verificacionesScout[userId];
  const affectedMaps = getAffectedMaps(userId);
  const username = getScoutUsername(userId);

  guardarUltimosMapas(userId);
  cerrarScoutsActivos(userId, username, motivo, finOverride);
  borrarRegistrosUsuario(userId);
  delete state.verificacionesScout[userId];

  guardarDatos();
  guardarScouts();
  await actualizarPanel();

  for (const { ciudad, mapa } of affectedMaps) {
    await verificarMapaVacio(ciudad, mapa);
  }

  if (!options.skipMessageEdit) {
    const content = options.content || `<@${userId}> fue retirado de mapas por no completar la verificacion.`;
    if (pending) {
      await editVerificationMessage(pending, content);
    } else {
      const channel = await getNotificationChannel();
      if (channel) {
        try {
          await channel.send({ content, allowedMentions: { users: [userId] } });
        } catch (err) {
          console.error('Error notificando cierre por verificacion:', err);
        }
      }
    }
  }
}

async function reviewActiveScouts() {
  const cfg = getVerificationConfig();
  if (!cfg.enabled) return;

  const now = Date.now();
  const maxMs = cfg.maxActiveMinutes * 60000;

  for (const userId of Object.keys(state.verificacionesScout)) {
    const entries = getActiveEntries(userId);
    const pending = state.verificacionesScout[userId];

    if (entries.length === 0) {
      await cancelScoutVerification(userId, 'Verificacion cancelada: ya no tienes mapas activos.');
      continue;
    }

    if (pending.status === 'pending_review') continue;

    if (pending.expiresAt <= now) {
      await closeScoutByVerification(userId, 'verificacion_expirada', pending.expiresAt, {
        content: `<@${userId}> fue retirado de mapas por no responder con captura a tiempo.`
      });
    }
  }

  for (const userId of Object.keys(state.scoutsActivos)) {
    const entries = getActiveEntries(userId);
    if (entries.length === 0 || state.verificacionesScout[userId]) continue;

    const oldestStart = getOldestStart(entries);

    if (oldestStart + maxMs <= now) {
      await requestVerification(userId, entries, now, cfg);
    }
  }
}

function startScoutVerification() {
  const cfg = getVerificationConfig();
  if (!cfg.enabled) {
    console.log('Verificacion de scouts desactivada.');
    return;
  }

  if (intervalId) clearInterval(intervalId);

  setTimeout(() => {
    reviewActiveScouts().catch(err => console.error('Error revisando scouts activos:', err));
  }, 15 * 1000);

  intervalId = setInterval(() => {
    reviewActiveScouts().catch(err => console.error('Error revisando scouts activos:', err));
  }, cfg.checkIntervalMinutes * 60 * 1000);

  console.log(
    `Verificacion de scouts activa: ${cfg.maxActiveMinutes}m + ${cfg.graceMinutes}m, cada ${cfg.checkIntervalMinutes}m`
  );
}

function isVerificationButton(customId) {
  return /^verificacion_(confirmar|salir|aprobar|retirar)_\d+$/.test(customId);
}

async function askForScoutEvidence(interaction, userId) {
  const entries = getActiveEntries(userId);
  const pending = state.verificacionesScout[userId];

  await interaction.deferUpdate();

  if (!pending || entries.length === 0) {
    delete state.verificacionesScout[userId];
    await interaction.message.edit({
      content: 'Esta verificacion ya no esta activa.',
      components: []
    });
    return;
  }

  const now = Date.now();
  if (pending.expiresAt <= now) {
    await interaction.message.edit({
      content: `<@${userId}> la verificacion expiro y fuiste retirado de mapas.`,
      components: []
    });
    await closeScoutByVerification(userId, 'verificacion_expirada', pending.expiresAt, {
      skipMessageEdit: true
    });
    return;
  }

  pending.status = 'waiting_image';
  pending.acknowledgedAt = now;

  await interaction.message.edit({
    content:
      `<@${userId}> envia ahora una **foto o captura de pantalla** en este canal para revisar que sigues activo.\n` +
      `Tienes hasta <t:${Math.floor(pending.expiresAt / 1000)}:R>. Si no envias la captura, te retiro del panel.`,
    components: awaitingEvidenceButtons(userId)
  });
}

async function sendScoutEvidenceToReview(message, userId, pending, image) {
  const reviewChannel = await getAdminReviewChannel();
  if (!reviewChannel) {
    await message.reply('No pude encontrar el canal de administracion para revisar tu captura.');
    return true;
  }

  const embed = buildReviewEmbed(userId, pending, message, image.url);
  const reviewMsg = await reviewChannel.send({
    content: `Revision de captura para <@${userId}>`,
    embeds: [embed],
    components: reviewButtons(userId),
    allowedMentions: { users: [] }
  });

  pending.status = 'pending_review';
  pending.evidenceMessageId = message.id;
  pending.evidenceChannelId = message.channel.id;
  pending.evidenceUrl = message.url;
  pending.imageUrl = image.url;
  pending.reviewMessageId = reviewMsg.id;
  pending.reviewChannelId = reviewMsg.channel.id;
  pending.submittedAt = message.createdTimestamp || Date.now();

  try {
    await message.react('⌛');
  } catch (err) {}

  await editVerificationMessage(
    pending,
    `<@${userId}> captura recibida y enviada a revision. Espera aprobacion del equipo.`,
    []
  );

  await message.reply({
    content: `Captura enviada a revision: ${reviewMsg.url}`,
    allowedMentions: { repliedUser: false }
  });

  return true;
}

async function handleScoutVerificationMessage(message) {
  if (message.author.bot || !message.guild || message.guild.id !== config.GUILD_ID) return false;

  const userId = message.author.id;
  const pending = state.verificacionesScout[userId];
  if (!pending || pending.status !== 'waiting_image') return false;

  const now = Date.now();
  if (pending.expiresAt <= now) {
    await closeScoutByVerification(userId, 'verificacion_expirada', pending.expiresAt, {
      content: `<@${userId}> fue retirado de mapas por enviar la captura fuera de tiempo.`
    });
    return true;
  }

  const image = getImageAttachment(message);
  if (!image) {
    await message.reply({
      content: 'Necesito una imagen como adjunto: PNG, JPG, JPEG o WEBP.',
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  return sendScoutEvidenceToReview(message, userId, pending, image);
}

async function approveScoutVerification(interaction, userId) {
  if (!canReviewScoutVerification(interaction.member)) {
    await interaction.reply({ content: 'No tienes permiso para revisar capturas.', flags: MessageFlags.Ephemeral });
    return;
  }

  const pending = state.verificacionesScout[userId];
  const entries = getActiveEntries(userId);
  if (!pending || pending.status !== 'pending_review' || pending.reviewMessageId !== interaction.message.id || entries.length === 0) {
    await interaction.reply({ content: 'Esta verificacion ya fue resuelta o no esta vigente.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  const approvedAt = pending.submittedAt || Date.now();
  const nextEntries = entries.map(entry => ({
    ...entry,
    inicio: approvedAt,
    username: getScoutUsername(userId),
  }));

  cerrarScoutsActivos(userId, getScoutUsername(userId), 'verificacion_aprobada', approvedAt);
  state.scoutsActivos[userId] = nextEntries;
  delete state.verificacionesScout[userId];

  guardarScouts();
  await actualizarPanel();
  await editVerificationMessage(pending, `<@${userId}> captura aprobada. Sigues activo en tus mapas.`, []);

  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0x57f287)
    .addFields({ name: 'Estado', value: `Aprobado por ${interaction.user}`, inline: false });

  await interaction.message.edit({ embeds: [embed], components: [] });
}

async function rejectScoutVerification(interaction, userId) {
  if (!canReviewScoutVerification(interaction.member)) {
    await interaction.reply({ content: 'No tienes permiso para revisar capturas.', flags: MessageFlags.Ephemeral });
    return;
  }

  const pending = state.verificacionesScout[userId];
  if (!pending || pending.status !== 'pending_review' || pending.reviewMessageId !== interaction.message.id) {
    await interaction.reply({ content: 'Esta verificacion ya fue resuelta o no esta vigente.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  const fin = pending.submittedAt || Date.now();
  await closeScoutByVerification(userId, 'verificacion_retirada', fin, {
    content: `<@${userId}> fue retirado de mapas porque la captura no fue aprobada.`
  });

  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xed4245)
    .addFields({ name: 'Estado', value: `Retirado por ${interaction.user}`, inline: false });

  await interaction.message.edit({ embeds: [embed], components: [] });
}

async function leaveFromVerification(interaction, userId) {
  await interaction.deferUpdate();
  await interaction.message.edit({
    content: `<@${userId}> salio de sus mapas desde la verificacion.`,
    components: []
  });

  await closeScoutByVerification(userId, 'verificacion_manual', Date.now(), {
    skipMessageEdit: true
  });
}

async function handleVerificationButton(interaction) {
  const match = interaction.customId.match(/^verificacion_(confirmar|salir|aprobar|retirar)_(\d+)$/);
  if (!match) return false;

  const [, action, userId] = match;

  if (action === 'aprobar') {
    await approveScoutVerification(interaction, userId);
    return true;
  }

  if (action === 'retirar') {
    await rejectScoutVerification(interaction, userId);
    return true;
  }

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: `Esta verificacion es para <@${userId}>.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === 'confirmar') {
    await askForScoutEvidence(interaction, userId);
    return true;
  }

  await leaveFromVerification(interaction, userId);
  return true;
}

async function cancelScoutVerification(userId, content = 'Verificacion cancelada.') {
  const pending = state.verificacionesScout[userId];
  if (!pending) return;

  delete state.verificacionesScout[userId];
  await editVerificationMessage(pending, content);
  await editReviewMessage(pending, `Verificacion cancelada para <@${userId}>.`);
}

module.exports = {
  startScoutVerification,
  reviewActiveScouts,
  isVerificationButton,
  handleVerificationButton,
  handleScoutVerificationMessage,
  cancelScoutVerification,
};
