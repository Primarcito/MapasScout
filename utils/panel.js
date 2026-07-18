const state = require('../data/state');
const config = require('../config');
const { generarEmbeds } = require('../embeds/panelEmbed');
const { generarEmbedRevision } = require('../embeds/revisionEmbed');
const { componentesPanel } = require('../components/panelComponents');
const { componentesRevision } = require('../components/revisionComponents');
const { guardarPanel, guardarRevisionPanel } = require('../data/persistence');

let panelRepublishPromise = null;

function esMensajeDesconocido(err) {
  return err?.code === 10008;
}

async function obtenerCanalPanel() {
  if (state.panelMessage?.channel) return state.panelMessage.channel;
  if (!state.client || !state.panelChannelId) return null;

  return state.client.channels.fetch(state.panelChannelId);
}

async function recuperarMensajePanel() {
  if (state.panelMessage) return state.panelMessage;
  if (!state.client || !state.panelChannelId || !state.panelMessageId) return null;

  const channel = await state.client.channels.fetch(state.panelChannelId);
  state.panelMessage = await channel.messages.fetch(state.panelMessageId);
  return state.panelMessage;
}

async function crearPanelPrincipal(channel) {
  if (!channel?.send) return null;

  const msg = await channel.send({
    embeds: generarEmbeds(),
    components: componentesPanel()
  });

  state.panelMessage = msg;
  state.panelChannelId = msg.channel.id;
  state.panelMessageId = msg.id;
  guardarPanel();
  console.log("Panel principal creado/recreado");
  return msg;
}

async function eliminarPanelPrincipalAnterior() {
  let message = state.panelMessage;
  if (!message && state.client && state.panelChannelId && state.panelMessageId) {
    try {
      const channel = await state.client.channels.fetch(state.panelChannelId);
      message = await channel?.messages.fetch(state.panelMessageId);
    } catch (err) {
      if (!esMensajeDesconocido(err)) console.error('No se pudo recuperar el panel principal anterior:', err);
    }
  }
  if (message) {
    try { await message.delete(); } catch (err) {
      if (!esMensajeDesconocido(err)) console.error('No se pudo borrar el panel principal anterior:', err);
    }
  }
  state.panelMessage = null;
  state.panelMessageId = null;
  guardarPanel();
}

async function republicarPanelPrincipal(channel) {
  if (!channel?.send) return null;
  if (panelRepublishPromise) return panelRepublishPromise;

  panelRepublishPromise = (async () => {
    await eliminarPanelPrincipalAnterior();
    return crearPanelPrincipal(channel);
  })();

  try {
    return await panelRepublishPromise;
  } finally {
    panelRepublishPromise = null;
  }
}

function olvidarMensajePanel() {
  state.panelMessage = null;
  state.panelMessageId = null;
  guardarPanel();
}

async function actualizarPanel({ recrearSiFalta = true } = {}) {
  let channel = null;

  try {
    const msg = await recuperarMensajePanel();
    if (!msg) {
      if (!recrearSiFalta) return null;
      channel = await obtenerCanalPanel();
      return crearPanelPrincipal(channel);
    }

    await msg.edit({
      embeds: generarEmbeds(),
      components: componentesPanel()
    });
    return msg;
  } catch (err) {
    if (esMensajeDesconocido(err)) {
      console.warn("El mensaje del panel principal ya no existe. Recreando panel...");
      try {
        channel = channel || await obtenerCanalPanel();
      } catch (channelErr) {
        console.error("No se pudo recuperar el canal del panel principal:", channelErr);
      }
      olvidarMensajePanel();

      if (recrearSiFalta && channel) {
        try {
          return await crearPanelPrincipal(channel);
        } catch (crearErr) {
          console.error("Error recreando panel principal:", crearErr);
        }
      }

      return null;
    }

    console.error("Error actualizando panel:", err);
    state.panelMessage = null;
    return null;
  }
}

async function eliminarPanelRevisionPermanente() {
  if (state.revisionMessage) {
    try { await state.revisionMessage.delete(); } catch (err) {
      if (!esMensajeDesconocido(err)) console.error('No se pudo borrar el panel permanente de revisión:', err);
    }
  } else if (state.client && state.revisionMessageId) {
    try {
      const channel = await state.client.channels.fetch(config.REVISION_CHANNEL_ID);
      const message = await channel?.messages.fetch(state.revisionMessageId);
      await message?.delete();
    } catch (err) {
      if (!esMensajeDesconocido(err)) console.error('No se pudo recuperar el panel permanente anterior:', err);
    }
  }
  state.revisionMessage = null;
  state.revisionMessageId = null;
  guardarRevisionPanel();
}

function revisionInvocationContent(created) {
  const remaining = state.revisionRound
    ? Math.max(1, Math.ceil((state.revisionRound.endsAt - Date.now()) / 60000))
    : config.REVISION_ROUND_MINUTES;
  const minutes = created ? config.REVISION_ROUND_MINUTES : remaining;
  return `${config.SCOUT_ROLE_MENTIONS} ${created ? '**Nueva ronda de revisión**' : '**Ronda de revisión actualizada**'} · ${created ? 'Tienen' : 'Quedan'} **${minutes} minutos**.`;
}

async function crearPanelRevision({ mentionRole = false, created = false } = {}) {
  try {
    const channel = await state.client.channels.fetch(config.REVISION_CHANNEL_ID);
    if (!channel) return;

    await eliminarPanelRevisionPermanente();
    const comps = componentesRevision();
    const payload = {
      embeds: [generarEmbedRevision()],
      components: comps.length > 0 ? comps : [],
    };
    if (mentionRole) {
      payload.content = revisionInvocationContent(created);
      payload.allowedMentions = { roles: config.SCOUT_ROLE_IDS };
    }
    const msg = await channel.send(payload);

    state.revisionMessage = msg;
    state.revisionMessageId = msg.id;
    guardarRevisionPanel();
    console.log("Panel de revisión creado/recreado");
  } catch (err) {
    console.error("Error creando panel revisión:", err);
  }
}

async function eliminarPanelRevisionMovil() {
  if (state.revisionMobileMessage) {
    try { await state.revisionMobileMessage.delete(); } catch (err) {
      if (!esMensajeDesconocido(err)) console.error('No se pudo borrar el panel móvil de revisión:', err);
    }
  } else if (state.client && state.revisionMobileChannelId && state.revisionMobileMessageId) {
    try {
      const channel = await state.client.channels.fetch(state.revisionMobileChannelId);
      const message = await channel?.messages.fetch(state.revisionMobileMessageId);
      await message?.delete();
    } catch (err) {
      if (!esMensajeDesconocido(err)) console.error('No se pudo recuperar el panel móvil anterior:', err);
    }
  }
  state.revisionMobileMessage = null;
  state.revisionMobileMessageId = null;
  state.revisionMobileChannelId = null;
  guardarRevisionPanel();
}

async function crearPanelRevisionMovil(channel, { mentionRole = false, created = false } = {}) {
  if (!channel?.send) return null;
  if (channel.id === config.REVISION_CHANNEL_ID) {
    return crearPanelRevision({ mentionRole, created });
  }
  await eliminarPanelRevisionMovil();
  const comps = componentesRevision();
  const payload = {
    embeds: [generarEmbedRevision()],
    components: comps.length > 0 ? comps : [],
  };
  if (mentionRole) {
    payload.content = revisionInvocationContent(created);
    payload.allowedMentions = { roles: config.SCOUT_ROLE_IDS };
  }
  const msg = await channel.send(payload);
  state.revisionMobileMessage = msg;
  state.revisionMobileMessageId = msg.id;
  state.revisionMobileChannelId = msg.channel.id;
  guardarRevisionPanel();
  return msg;
}

async function actualizarRevision() {
  const payload = { embeds: [generarEmbedRevision()], components: componentesRevision() };
  if (state.revisionMessage) {
    try {
      await state.revisionMessage.edit(payload);
    } catch (err) {
      if (!esMensajeDesconocido(err)) console.error("Error actualizando panel revisión permanente:", err);
      state.revisionMessage = null;
      state.revisionMessageId = null;
      guardarRevisionPanel();
    }
  }

  if (state.revisionMobileMessage) {
    try {
      await state.revisionMobileMessage.edit(payload);
    } catch (err) {
      if (!esMensajeDesconocido(err)) console.error('Error actualizando panel móvil de revisión:', err);
      state.revisionMobileMessage = null;
      state.revisionMobileMessageId = null;
      state.revisionMobileChannelId = null;
      guardarRevisionPanel();
    }
  }
}

module.exports = {
  actualizarPanel,
  crearPanelRevision,
  crearPanelRevisionMovil,
  eliminarPanelRevisionMovil,
  republicarPanelPrincipal,
  actualizarRevision,
};
