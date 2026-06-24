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

async function actualizarRevision() {
  try {
    if (state.revisionMessage) {
      await state.revisionMessage.edit({
        embeds: [generarEmbedRevision()],
        components: componentesRevision()
      });
    } else {
      await crearPanelRevision();
    }
  } catch (err) {
    console.error("Error actualizando panel revisión:", err);
    state.revisionMessage = null;
    state.revisionMessageId = null;
    await crearPanelRevision();
  }
}

module.exports = { actualizarPanel, crearPanelRevision, actualizarRevision };
