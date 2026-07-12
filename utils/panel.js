const state = require('../data/state');
const config = require('../config');
const { generarEmbeds } = require('../embeds/panelEmbed');
const { generarEmbedRevision } = require('../embeds/revisionEmbed');
const { componentesPanel } = require('../components/panelComponents');
const { componentesRevision } = require('../components/revisionComponents');
const { guardarPanel, guardarRevisionPanel } = require('../data/persistence');

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

async function crearPanelRevision() {
  try {
    const channel = await state.client.channels.fetch(config.REVISION_CHANNEL_ID);
    if (!channel) return;

    const comps = componentesRevision();
    const msg = await channel.send({
      embeds: [generarEmbedRevision()],
      components: comps.length > 0 ? comps : []
    });

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

async function crearPanelRevisionMovil(channel) {
  if (!channel?.send) return null;
  if (channel.id === config.REVISION_CHANNEL_ID) {
    if (state.revisionMessage) {
      await actualizarRevision();
      return state.revisionMessage;
    }
    return crearPanelRevision();
  }
  await eliminarPanelRevisionMovil();
  const comps = componentesRevision();
  const msg = await channel.send({
    embeds: [generarEmbedRevision()],
    components: comps.length > 0 ? comps : [],
  });
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
  actualizarRevision,
};
