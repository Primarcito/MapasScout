const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const state = require('../data/state');
const settings = require('../settings');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario } = require('./scouts');
const { actualizarPanel } = require('./panel');
const { verificarMapaVacio } = require('./alerts');
const { sendScoutLog, formatMaps, formatUser } = require('./scoutLogs');
const { canScout, canDecideVerification } = require('../permissions');

let intervalId = null;

function numberOrDefault(value, fallback, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function normalizeVerificationMode(value) {
  return value === 'normal' ? 'normal' : 'foto';
}

function getVerificationMode() {
  return normalizeVerificationMode(state.verificationMode || settings.verification?.mode || 'foto');
}

function getVerificationConfig() {
  const raw = settings.verification || {};
  return {
    enabled: raw.enabled !== false,
    mode: getVerificationMode(),
    maxActiveMinutes: numberOrDefault(raw.maxActiveMinutes, 240, 15),
    graceMinutes: numberOrDefault(raw.graceMinutes, 10, 1),
    checkIntervalMinutes: numberOrDefault(raw.checkIntervalMinutes, 5, 1),
    scoutReviewVotes: numberOrDefault(raw.scoutReviewVotes, 3, 1),
  };
}

function getVerificationEvidenceChannelId() {
  return settings.channels?.verificationEvidence || process.env.SCOUT_VERIFICATION_EVIDENCE_CHANNEL_ID || null;
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
  return formatMaps(entries);
}

function shortMapsSummary(entries, limit = 3) {
  if (!entries || entries.length === 0) return 'sin mapas';
  const visibles = entries
    .slice(0, limit)
    .map(entry => `${entry.ciudad} - ${entry.mapa}`);
  const extra = entries.length - visibles.length;
  return extra > 0 ? `${visibles.join(', ')} +${extra} mas` : visibles.join(', ');
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

function evidenceReviewButtons(userId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verificacion_evidencia_ok_${userId}`)
        .setLabel('Bien')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`verificacion_evidencia_mal_${userId}`)
        .setLabel('Mal')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

async function getUserDmChannel(userId) {
  if (!state.client || !userId) return null;

  try {
    const user = await state.client.users.fetch(userId);
    return await user.createDM();
  } catch (err) {
    return null;
  }
}

async function editVerificationMessage(pending, content, components = []) {
  if (!pending || !state.client) return;

  try {
    const channel = await state.client.channels.fetch(pending.channelId);
    const message = await channel?.messages.fetch(pending.messageId);
    await message?.edit({ content, components });
  } catch (err) {
    // El MD o mensaje pudo haber sido borrado.
  }
}

function getImageAttachments(message) {
  return Array.from(message.attachments.values()).filter(attachment => {
    const contentType = attachment.contentType || '';
    const name = attachment.name || '';
    return contentType.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name);
  });
}

async function sendVerificationEvidence(userId, entries, attachments, message) {
  const channelId = getVerificationEvidenceChannelId();
  if (!channelId || !state.client) return null;

  const channel = await state.client.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const cfg = getVerificationConfig();

  const files = attachments.map((attachment, index) => ({
    attachment: attachment.url,
    name: attachment.name || `verificacion_${userId}_${index + 1}.png`,
  }));

  return channel.send({
    content: buildEvidenceReviewContent(userId, entries, {
      approve: [],
      reject: [],
    }, cfg, null, message.author.username),
    files,
    components: evidenceReviewButtons(userId),
    allowedMentions: { users: [userId] },
  });
}

function buildEvidenceReviewContent(userId, entries, votes, cfg, status = null, username = null) {
  const approve = votes?.approve?.length || 0;
  const reject = votes?.reject?.length || 0;
  const lines = [
    `**Verificacion de scout**`,
    `Scout: ${formatUser(userId, username || getScoutUsername(userId))}`,
    `Mapas: ${shortMapsSummary(entries)}`,
    `Hora: <t:${Math.floor(Date.now() / 1000)}:t>`,
    `Votos: ✅ ${approve}/${cfg.scoutReviewVotes} | ❌ ${reject}/${cfg.scoutReviewVotes}`,
    `Scouts: ${cfg.scoutReviewVotes} votos. GM/Officer: 1 voto.`,
  ];
  if (status) lines.push(`Estado: **${status}**`);
  return lines.join('\n');
}

async function requestVerification(userId, entries, now, cfg, options = {}) {
  if (state.verificacionesScout[userId]) {
    return { ok: false, reason: 'pending' };
  }

  const channel = await getUserDmChannel(userId);
  if (!channel) {
    console.warn(`No se pudo solicitar verificacion para ${userId}: MD no disponible.`);
    return { ok: false, reason: 'dm_unavailable' };
  }

  const oldestStart = getOldestStart(entries);
  const activeMinutes = Math.floor((now - oldestStart) / 60000);
  const creditFromOnExpire = Math.min(now, oldestStart + cfg.maxActiveMinutes * 60000);
  const expiresAt = now + cfg.graceMinutes * 60000;

  try {
    const modeText = cfg.mode === 'foto'
      ? 'Pulsa **Sigo activo** y luego envia una captura del scout con la hora visible.'
      : 'Pulsa **Sigo activo** para confirmar o **Salir de mapas** para retirarte.';
    const msg = await channel.send({
      content:
        `<@${userId}> verificacion de scout: llevas **${formatMinutes(activeMinutes)}** activo en ${mapsSummary(entries)}.\n` +
        `${modeText}\nTienes **${cfg.graceMinutes}m** para responder.`,
      components: verificationButtons(userId),
      allowedMentions: { users: [userId] }
    });

    state.verificacionesScout[userId] = {
      status: 'waiting_response',
      messageId: msg.id,
      channelId: msg.channel.id,
      isDm: true,
      createdAt: now,
      mode: cfg.mode,
      creditFromOnExpire,
      expiresAt,
    };

    await sendScoutLog('VERIFICACION_ENVIADA', [
      `Scout: ${formatUser(userId, getScoutUsername(userId))}`,
      `Mapas: ${formatMaps(entries)}`,
      `Tiempo activo: ${formatMinutes(activeMinutes)}`,
      `Origen: ${options.requestedBy ? `manual por <@${options.requestedBy}>` : 'automatico'}`
    ]);

    return { ok: true, message: msg };
  } catch (err) {
    console.error('Error enviando verificacion de scout:', err);
    return { ok: false, reason: 'send_failed' };
  }
}

async function forceScoutVerification(userId, requestedBy = null) {
  const entries = getActiveEntries(userId);
  if (entries.length === 0) {
    return { ok: false, reason: 'inactive' };
  }

  const cfg = getVerificationConfig();
  return requestVerification(userId, entries, Date.now(), cfg, { requestedBy });
}

async function closeScoutByVerification(userId, motivo, finOverride, options = {}) {
  const entries = getActiveEntries(userId);
  const pending = state.verificacionesScout[userId];
  const affectedMaps = getAffectedMaps(userId);
  const username = getScoutUsername(userId);

  guardarUltimosMapas(userId);
  cerrarScoutsActivos(userId, username, motivo, finOverride, {
    creditFrom: options.creditFrom || null,
  });
  borrarRegistrosUsuario(userId);
  delete state.verificacionesScout[userId];

  guardarDatos();
  guardarScouts();
  await actualizarPanel();

  for (const { ciudad, mapa } of affectedMaps) {
    await verificarMapaVacio(ciudad, mapa);
  }

  await sendScoutLog('RETIRADO', [
    `Scout: ${formatUser(userId, username)}`,
    `Mapas: ${formatMaps(affectedMaps)}`,
    `Motivo: ${motivo}`
  ]);

  if (!options.skipMessageEdit && pending) {
    const content = options.content || `<@${userId}> fuiste retirado de mapas por no completar la verificacion.`;
    await editVerificationMessage(pending, content);
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

    if (pending.status === 'waiting_review') {
      continue;
    }

    if (pending.expiresAt <= now) {
      await closeScoutByVerification(userId, 'verificacion_expirada', pending.expiresAt, {
        creditFrom: pending.creditFromOnExpire,
        content: `<@${userId}> fuiste retirado de mapas por no responder la verificacion a tiempo.`
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
    `Verificacion de scouts activa: modo ${cfg.mode}, ${cfg.maxActiveMinutes}m + ${cfg.graceMinutes}m, cada ${cfg.checkIntervalMinutes}m`
  );
}

function isVerificationButton(customId) {
  return /^verificacion_(confirmar|salir)_\d+$/.test(customId)
    || /^verificacion_evidencia_(ok|mal)_\d+$/.test(customId);
}

async function confirmScoutVerification(interaction, userId) {
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
      creditFrom: pending.creditFromOnExpire,
      skipMessageEdit: true
    });
    return;
  }

  const mode = normalizeVerificationMode(pending.mode || getVerificationMode());
  pending.status = 'waiting_screenshot';
  pending.screenshotRequestedAt = now;
  if (mode === 'normal') {
    const username = interaction.user.username || getScoutUsername(userId);
    await completeScoutVerification(userId, username, entries, {
      resultado: 'confirmado por boton'
    });
    await interaction.message.edit({
      content: `<@${userId}> verificacion confirmada. Sigues activo en tus mapas.`,
      components: []
    });
    return;
  }

  await interaction.message.edit({
    content:
      `<@${userId}> envia aqui una **captura del scout con la hora visible** para confirmar que sigues activo.\n` +
      `Tiempo restante: <t:${Math.floor(pending.expiresAt / 1000)}:R>.`,
    components: []
  });
}

async function completeScoutVerification(userId, username, entries, options = {}) {
  const now = Date.now();
  const nextEntries = entries.map(entry => ({
    ...entry,
    inicio: now,
    username,
  }));

  cerrarScoutsActivos(userId, username, 'verificacion_confirmada', now);
  state.scoutsActivos[userId] = nextEntries;
  delete state.verificacionesScout[userId];

  guardarScouts();
  await actualizarPanel();

  await sendScoutLog('VERIFICADO', [
    `Scout: ${formatUser(userId, username)}`,
    `Mapas: ${formatMaps(entries)}`,
    `Resultado: ${options.resultado || 'siguio activo'}`,
    options.evidenceUrl ? `Captura: ${options.evidenceUrl}` : null
  ].filter(Boolean));
}

async function handleVerificationScreenshotMessage(message) {
  if (message.author.bot || message.guild) return false;

  const userId = message.author.id;
  const pending = state.verificacionesScout[userId];
  if (!pending || pending.status !== 'waiting_screenshot') return false;
  if (pending.channelId && pending.channelId !== message.channel.id) return false;

  const entries = getActiveEntries(userId);
  if (entries.length === 0) {
    delete state.verificacionesScout[userId];
    await message.reply('Esta verificacion ya no esta activa.');
    return true;
  }

  const now = Date.now();
  if (pending.expiresAt <= now) {
    await closeScoutByVerification(userId, 'verificacion_expirada', pending.expiresAt, {
      creditFrom: pending.creditFromOnExpire,
      content: `<@${userId}> la verificacion expiro y fuiste retirado de mapas.`
    });
    await message.reply('La verificacion expiro y fuiste retirado de mapas.');
    return true;
  }

  const attachments = getImageAttachments(message);
  if (attachments.length === 0) {
    await message.reply('Envia una captura de imagen del scout con la hora visible para confirmar.');
    return true;
  }

  let evidenceMessage = null;
  try {
    evidenceMessage = await sendVerificationEvidence(userId, entries, attachments, message);
  } catch (err) {
    console.error('Error enviando captura de verificacion:', err);
    await message.reply('Recibi la captura, pero no pude archivarla en el canal de verificaciones. Avisa a un GM.');
    return true;
  }
  if (!evidenceMessage) {
    await message.reply('Recibi la captura, pero no encontre el canal de verificaciones. Avisa a un GM.');
    return true;
  }

  pending.status = 'waiting_review';
  pending.reviewChannelId = evidenceMessage.channel.id;
  pending.reviewMessageId = evidenceMessage.id;
  pending.reviewVotes = { approve: [], reject: [] };
  pending.evidenceUrl = evidenceMessage.url;

  await editVerificationMessage(
    pending,
    `<@${userId}> captura recibida. Espera la aprobacion de scouts o GM/officer.`
  );
  await sendScoutLog('VERIFICACION_CAPTURA', [
    `Scout: ${formatUser(userId, message.author.username)}`,
    `Mapas: ${formatMaps(entries)}`,
    `Captura: ${evidenceMessage.url}`,
    `Estado: pendiente de revision`
  ]);
  await message.reply('Captura enviada a revision. Espera aprobacion.');
  return true;
}

function ensureReviewVotes(pending) {
  if (!pending.reviewVotes) pending.reviewVotes = { approve: [], reject: [] };
  if (!Array.isArray(pending.reviewVotes.approve)) pending.reviewVotes.approve = [];
  if (!Array.isArray(pending.reviewVotes.reject)) pending.reviewVotes.reject = [];
  return pending.reviewVotes;
}

async function finalizeEvidenceReview(interaction, userId, approved, entries, pending, decidedBy) {
  const username = getScoutUsername(userId);
  const cfg = getVerificationConfig();
  const status = approved ? `Aprobada por ${decidedBy}` : `Rechazada por ${decidedBy}`;

  if (approved) {
    await completeScoutVerification(userId, username, entries, {
      resultado: 'captura aprobada',
      evidenceUrl: pending.evidenceUrl || interaction.message.url,
    });
    await editVerificationMessage(
      pending,
      `<@${userId}> verificacion aprobada. Sigues activo en tus mapas.`
    );
  } else {
    await closeScoutByVerification(userId, 'verificacion_rechazada', Date.now(), {
      creditFrom: pending.creditFromOnExpire,
      content: `<@${userId}> tu captura fue rechazada y fuiste retirado de mapas.`
    });
  }

  await interaction.message.edit({
    content: buildEvidenceReviewContent(
      userId,
      entries,
      ensureReviewVotes(pending),
      cfg,
      status,
      username
    ),
    components: evidenceReviewButtons(userId, true),
  });

  await sendScoutLog(approved ? 'VERIFICACION_APROBADA' : 'VERIFICACION_RECHAZADA', [
    `Scout: ${formatUser(userId, username)}`,
    `Mapas: ${formatMaps(entries)}`,
    `Decision: ${status}`,
    pending.evidenceUrl ? `Captura: ${pending.evidenceUrl}` : null
  ].filter(Boolean));
}

async function handleEvidenceReviewButton(interaction, action, userId) {
  const pending = state.verificacionesScout[userId];
  const entries = getActiveEntries(userId);

  if (!pending || pending.status !== 'waiting_review') {
    await interaction.reply({
      content: 'Esta verificacion ya no esta pendiente.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (entries.length === 0) {
    delete state.verificacionesScout[userId];
    await interaction.update({
      content: 'Esta verificacion ya no esta activa porque el scout no esta en mapas.',
      components: evidenceReviewButtons(userId, true)
    });
    return true;
  }

  const isOfficer = canDecideVerification(interaction.member);
  const isScout = canScout(interaction.member);
  if (interaction.user.id === userId && !isOfficer) {
    await interaction.reply({
      content: 'No puedes validar tu propia captura.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!isOfficer && !isScout) {
    await interaction.reply({
      content: 'Necesitas rol Scout o GM/Officer para revisar esta captura.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const approved = action === 'ok';
  const decidedBy = isOfficer ? `GM/Officer ${interaction.user}` : `${interaction.user}`;
  const votes = ensureReviewVotes(pending);

  if (isOfficer) {
    await interaction.deferUpdate();
    await finalizeEvidenceReview(interaction, userId, approved, entries, pending, decidedBy);
    return true;
  }

  const voterId = interaction.user.id;
  votes.approve = votes.approve.filter(id => id !== voterId);
  votes.reject = votes.reject.filter(id => id !== voterId);
  if (approved) votes.approve.push(voterId);
  else votes.reject.push(voterId);

  const cfg = getVerificationConfig();
  if (votes.approve.length >= cfg.scoutReviewVotes || votes.reject.length >= cfg.scoutReviewVotes) {
    await interaction.deferUpdate();
    await finalizeEvidenceReview(
      interaction,
      userId,
      votes.approve.length >= cfg.scoutReviewVotes,
      entries,
      pending,
      `${cfg.scoutReviewVotes} scouts`
    );
    return true;
  }

  await interaction.update({
    content: buildEvidenceReviewContent(userId, entries, votes, cfg, null, getScoutUsername(userId)),
    components: evidenceReviewButtons(userId),
  });
  return true;
}

async function leaveFromVerification(interaction, userId) {
  await interaction.deferUpdate();
  await interaction.message.edit({
    content: `<@${userId}> saliste de tus mapas desde la verificacion.`,
    components: []
  });

  await closeScoutByVerification(userId, 'verificacion_manual', Date.now(), {
    skipMessageEdit: true
  });
}

async function handleVerificationButton(interaction) {
  const reviewMatch = interaction.customId.match(/^verificacion_evidencia_(ok|mal)_(\d+)$/);
  if (reviewMatch) {
    const [, action, userId] = reviewMatch;
    return handleEvidenceReviewButton(interaction, action, userId);
  }

  const match = interaction.customId.match(/^verificacion_(confirmar|salir)_(\d+)$/);
  if (!match) return false;

  const [, action, userId] = match;

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: `Esta verificacion es para <@${userId}>.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === 'confirmar') {
    await confirmScoutVerification(interaction, userId);
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
}

module.exports = {
  startScoutVerification,
  reviewActiveScouts,
  forceScoutVerification,
  isVerificationButton,
  handleVerificationButton,
  handleVerificationScreenshotMessage,
  cancelScoutVerification,
  getVerificationMode,
  normalizeVerificationMode,
};
