const state = require('../data/state');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { cerrarScoutsActivos } = require('./scouts');
const { actualizarPanel } = require('./panel');
const { generarEmbedsHistorial } = require('../commands/scout');
const { cancelScoutVerification } = require('./verification');
const config = require('../config');

function programarReset() {
  const ahora = new Date();

  const proximoReset = new Date(Date.UTC(
    ahora.getUTCFullYear(),
    ahora.getUTCMonth(),
    ahora.getUTCDate(),
    10, 0, 0, 0
  ));

  if (proximoReset <= ahora) {
    proximoReset.setUTCDate(proximoReset.getUTCDate() + 1);
  }

  const msHastaReset = proximoReset - ahora;
  console.log(`Reset programado en ${Math.round(msHastaReset / 60000)} minutos`);

  setTimeout(async () => {
    await ejecutarReset();
    programarReset();
  }, msHastaReset);
}

async function ejecutarReset() {
  console.log("Ejecutando reset diario...");

  // Cancelar si se editaron mapas desde las 7 UTC de hoy
  const hoy7UTC = new Date();
  hoy7UTC.setUTCHours(7, 0, 0, 0);

  const huboCambios = state.ultimaEdicion && state.ultimaEdicion >= hoy7UTC.getTime();

  if (huboCambios) {
    console.log("Reset cancelado — mapas editados después de las 7 UTC");

    if (state.panelMessage) {
      try {
        const resetMsg = await state.panelMessage.channel.send(
          "⚠️ **Reset cancelado** — Los mapas fueron actualizados hoy. El panel sigue vigente."
        );
        setTimeout(async () => {
          try { await resetMsg.delete(); } catch (e) {}
        }, 20 * 60 * 1000);
      } catch (err) {
        console.error("Error enviando aviso:", err);
      }
    }
    return;
  }

  // Auto-postear historial antes de borrar
  try {
    if (config.ARCHIVE_CHANNEL_ID && state.client) {
      const canalArchivo = await state.client.channels.fetch(config.ARCHIVE_CHANNEL_ID);
      if (canalArchivo) {
        const embedsHistorial = generarEmbedsHistorial();
        for (const embedHistorial of embedsHistorial) {
          await canalArchivo.send({ embeds: [embedHistorial] });
        }
        console.log("Historial diario archivado correctamente.");
      }
    }
  } catch (err) {
    console.error("Error archivando historial diario:", err);
  }

  // Reset total
  for (const ciudad in state.registros) state.registros[ciudad] = {};
  for (const ciudad in state.mapas) state.mapas[ciudad] = [];

  for (const userId in state.scoutsActivos) {
    cerrarScoutsActivos(userId, null, "reset");
    await cancelScoutVerification(userId, "Verificacion cancelada: reset diario completado.");
  }

  state.ultimosMapas = {};
  state.ultimaEdicion = null;
  state.historialDia = [];
  state.coberturaDia = {};
  state.logAdmin = [];

  guardarDatos();
  guardarScouts();
  await actualizarPanel();

  if (state.panelMessage) {
    try {
      await state.panelMessage.channel.send(
        "🔄 **Reset diario completado** — Los mapas han sido limpiados. Un admin puede cargar los nuevos con `/editar_mapas`."
      );
    } catch (err) {
      console.error("Error enviando aviso de reset:", err);
    }
  }

  console.log("Reset diario completado.");
}

module.exports = { programarReset, ejecutarReset };
