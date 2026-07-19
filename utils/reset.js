const state = require('../data/state');
const { guardarDatos, guardarScouts, guardarRevisionPanel } = require('../data/persistence');
const { sincronizarMensajeAlertas } = require('./alerts');
const { cerrarScoutsActivos } = require('./scouts');
const { actualizarPanel, actualizarRevision } = require('./panel');
const { generarEmbedsHistorial } = require('../commands/scout');
const { cancelScoutVerification } = require('./verification');
const config = require('../config');
const { addAuditEntry } = require('./audit');
const { commitDailyMapCredits } = require('./mapCredits');

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

function resetDailyRevisionState() {
  state.revisionEstado = {};
  state.revisionRound = null;
  state.revisionRoundHistory = [];
  state.revisionScores = {};
}

async function ejecutarReset() {
  console.log("Ejecutando reset diario...");
  const resetAt = Date.now();

  // Auto-postear historial antes de borrar
  try {
    if (config.ARCHIVE_CHANNEL_ID && state.client) {
      const canalArchivo = await state.client.channels.fetch(config.ARCHIVE_CHANNEL_ID);
      if (canalArchivo) {
        const embedsHistorial = generarEmbedsHistorial(resetAt);
        for (const embedHistorial of embedsHistorial) {
          const archived = await canalArchivo.send({ embeds: [embedHistorial] });
          state.lastArchivedSummaryMessageId = archived.id;
          state.lastArchivedSummaryChannelId = canalArchivo.id;
        }
        console.log("Historial diario archivado correctamente.");
      }
    }
  } catch (err) {
    console.error("Error archivando historial diario:", err);
  }

  // Consolidar minutos por mapa una sola vez después de publicar el resumen.
  commitDailyMapCredits(resetAt);
  // El ranking semanal reinicia los lunes a las 10 UTC; los pendientes no cruzan semana.
  if (new Date(resetAt).getUTCDay() === 1) state.mapMinuteBalances = {};

  // Cerrar el periodo anterior antes de activar la configuracion siguiente.
  for (const userId in state.scoutsActivos) {
    cerrarScoutsActivos(userId, null, "reset");
    await cancelScoutVerification(userId, "Verificacion cancelada: reset diario completado.");
  }

  const nextMaps = state.scheduledMaps?.maps || Object.fromEntries(
    Object.keys(state.mapas).map(city => [city, []])
  );
  for (const ciudad of Object.keys(state.mapas)) {
    state.mapas[ciudad] = [...(nextMaps[ciudad] || [])];
    state.registros[ciudad] = Object.fromEntries(state.mapas[ciudad].map(map => [map, []]));
  }
  state.scheduledMaps = null;

  state.ultimosMapas = {};
  state.mapasEnAlerta = {};
  state.ultimaEdicion = null;
  state.historialDia = [];
  state.coberturaDia = {};
  resetDailyRevisionState();

  guardarDatos();
  guardarScouts();
  guardarRevisionPanel();
  addAuditEntry({ action: 'completo el cierre diario y activo el siguiente periodo' });
  await actualizarPanel();
  await actualizarRevision();
  await sincronizarMensajeAlertas();

  if (state.panelMessage) {
    try {
      await state.panelMessage.channel.send(
        `🔄 **Cierre diario completado** — ${Object.values(state.mapas).flat().length > 0 ? 'Se activaron los mapas programados.' : 'Los mapas quedaron vacíos; usa `/mapas-configurar`.'}`
      );
    } catch (err) {
      console.error("Error enviando aviso de reset:", err);
    }
  }

  console.log("Reset diario completado.");
}

module.exports = { programarReset, ejecutarReset, resetDailyRevisionState };
