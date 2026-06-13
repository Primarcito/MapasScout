const state = require('../data/state');
const config = require('../config');
const { generarEmbeds } = require('../embeds/panelEmbed');
const { generarEmbedRevision } = require('../embeds/revisionEmbed');
const { componentesPanel } = require('../components/panelComponents');
const { componentesRevision } = require('../components/revisionComponents');
const { guardarRevisionPanel } = require('../data/persistence');

async function actualizarPanel() {
  if (!state.panelMessage) return;

  try {
    await state.panelMessage.edit({
      embeds: generarEmbeds(),
      components: componentesPanel()
    });
  } catch (err) {
    console.error("Error actualizando panel:", err);
    state.panelMessage = null;
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
