const state = require('../data/state');
const { guardarDatos, guardarPanel } = require('../data/persistence');
const { textEmoji } = require('../emojis');
const { normalizarNombreMapa } = require('./mapNames');

function keyMapa(ciudad, mapa) {
  return `${ciudad}__${normalizarNombreMapa(mapa)}`;
}

function obtenerAlertasVigentes() {
  const vigentes = [];

  for (const [key, alerta] of Object.entries(state.mapasEnAlerta || {})) {
    const ciudad = alerta?.ciudad;
    const mapa = normalizarNombreMapa(alerta?.mapa);
    const existe = Boolean(ciudad && mapa && state.mapas[ciudad]?.includes(mapa));
    const users = existe ? (state.registros[ciudad]?.[mapa] || []) : [];

    if (!existe || users.length > 0) {
      delete state.mapasEnAlerta[key];
      continue;
    }

    vigentes.push({
      key,
      ciudad,
      mapa,
      vacioDesde: Number(alerta.vacioDesde) || Date.now(),
    });
  }

  return vigentes.sort((a, b) => a.vacioDesde - b.vacioDesde || a.mapa.localeCompare(b.mapa, 'es'));
}

function contenidoAlerta(alertas) {
  const lineas = alertas.map(({ ciudad, mapa, vacioDesde }) => {
    const timestamp = Math.floor(vacioDesde / 1000);
    return `• **${mapa}** · ${ciudad} · solo desde <t:${timestamp}:R>`;
  });

  return [
    `${textEmoji('EMPTY')} **Mapas sin scout**`,
    lineas.join('\n'),
    '',
    '_Este mensaje se actualiza automáticamente._',
  ].join('\n');
}

async function obtenerCanalAlerta() {
  if (state.panelMessage?.channel) return state.panelMessage.channel;
  const channelId = state.alertChannelId || state.panelChannelId;
  if (!state.client || !channelId) return null;
  return state.client.channels.fetch(channelId);
}

async function obtenerMensajeAlerta(channel) {
  if (!channel || !state.alertMessageId) return null;
  try {
    return await channel.messages.fetch(state.alertMessageId);
  } catch (err) {
    if (err?.code !== 10008) console.error('No se pudo recuperar la alerta consolidada:', err);
    state.alertMessageId = null;
    guardarPanel();
    return null;
  }
}

async function limpiarAlertasLegacy(channel) {
  if (state.legacyAlertsCleaned || !channel?.messages?.fetch) return;
  state.legacyAlertsCleaned = true;

  try {
    const recientes = await channel.messages.fetch({ limit: 100 });
    const legacy = recientes.filter(message => (
      message.author?.id === state.client?.user?.id
      && /sin scout, alguien que se anote/i.test(message.content || '')
    ));
    await Promise.all(legacy.map(message => message.delete().catch(() => null)));
  } catch (err) {
    console.error('No se pudieron limpiar alertas individuales antiguas:', err);
  }
}

async function sincronizarMensajeAlertas() {
  const alertas = obtenerAlertasVigentes();
  guardarDatos();

  const channel = await obtenerCanalAlerta();
  if (!channel) return null;
  await limpiarAlertasLegacy(channel);
  const existente = await obtenerMensajeAlerta(channel);

  if (alertas.length === 0) {
    if (existente) {
      try { await existente.delete(); } catch (err) {
        if (err?.code !== 10008) console.error('No se pudo borrar la alerta consolidada:', err);
      }
    }
    state.alertMessageId = null;
    state.alertChannelId = channel.id;
    guardarPanel();
    return null;
  }

  const payload = {
    content: contenidoAlerta(alertas),
    allowedMentions: { parse: [] },
  };

  let message = existente;
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }

  state.alertMessageId = message.id;
  state.alertChannelId = channel.id;
  guardarPanel();
  return message;
}

async function verificarMapaVacio(ciudad, mapa) {
  const nombre = normalizarNombreMapa(mapa);
  const users = state.registros[ciudad]?.[nombre] || [];
  const key = keyMapa(ciudad, nombre);

  if (users.length === 0 && state.mapas[ciudad]?.includes(nombre)) {
    const anterior = state.mapasEnAlerta[key];
    state.mapasEnAlerta[key] = {
      ciudad,
      mapa: nombre,
      vacioDesde: anterior?.vacioDesde || Date.now(),
    };
  } else {
    delete state.mapasEnAlerta[key];
  }

  return sincronizarMensajeAlertas();
}

// Compatibilidad con llamadas antiguas: ahora todas actualizan el mensaje único.
async function enviarAlertaMapa(ciudad, mapa) {
  return verificarMapaVacio(ciudad, mapa);
}

async function limpiarAlertaMapa(key) {
  delete state.mapasEnAlerta[key];
  return sincronizarMensajeAlertas();
}

async function enviarRecordatorioMapasVacios() {
  return sincronizarMensajeAlertas();
}

module.exports = {
  verificarMapaVacio,
  enviarAlertaMapa,
  limpiarAlertaMapa,
  enviarRecordatorioMapasVacios,
  sincronizarMensajeAlertas,
  obtenerAlertasVigentes,
};
