const state = require('../data/state');
const config = require('../config');

async function verificarMapaVacio(ciudad, mapa) {
  const users = state.registros[ciudad]?.[mapa] || [];
  const key = `${ciudad}__${mapa}`;

  if (users.length === 0) {
    await enviarAlertaMapa(ciudad, mapa, key);
  } else {
    await limpiarAlertaMapa(key);
  }
}

async function enviarAlertaMapa(ciudad, mapa, key) {
  if (state.alertasMapas[key]) return;
  if (!state.panelMessage) return;

  try {
    const msg = await state.panelMessage.channel.send(
      `⚠️ **${mapa}** sin scout, alguien que se anote pes`
    );

    const timeout20 = setTimeout(async () => {
      await limpiarAlertaMapa(key);
    }, 20 * 60 * 1000);

    const timeout90 = setTimeout(async () => {
      await enviarRecordatorioMapasVacios();
    }, 150 * 60 * 1000);

    state.alertasMapas[key] = { messageId: msg.id, timeout20, timeout90 };
  } catch (err) {
    console.error("Error enviando alerta de mapa vacío:", err);
  }
}

async function limpiarAlertaMapa(key) {
  const alerta = state.alertasMapas[key];
  if (!alerta) return;

  clearTimeout(alerta.timeout20);
  clearTimeout(alerta.timeout90);

  if (state.panelMessage) {
    try {
      const msg = await state.panelMessage.channel.messages.fetch(alerta.messageId);
      await msg.delete();
    } catch (err) {
      // Mensaje ya borrado, ignorar
    }
  }

  delete state.alertasMapas[key];
}

async function enviarRecordatorioMapasVacios() {
  if (!state.panelMessage) return;

  // No mandar entre 6:00 y 10:00 UTC
  const horaUTC = new Date().getUTCHours();
  if (horaUTC >= 6 && horaUTC < 10) return;

  const vacios = [];
  for (const ciudad in state.mapas) {
    for (const mapa of state.mapas[ciudad]) {
      const users = state.registros[ciudad]?.[mapa] || [];
      if (users.length === 0) vacios.push(mapa);
    }
  }

  if (vacios.length === 0) return;

  try {
    await state.panelMessage.channel.send({
      content: `${config.SCOUT_ROLE_MENTIONS} ⚠️ Estos mapas llevan rato solos causitas: ${vacios.map(m => `**${m}**`).join(", ")}`,
      allowedMentions: { roles: config.SCOUT_ROLE_IDS }
    });
  } catch (err) {
    console.error("Error enviando recordatorio:", err);
  }
}

module.exports = { verificarMapaVacio, enviarAlertaMapa, limpiarAlertaMapa, enviarRecordatorioMapasVacios };
