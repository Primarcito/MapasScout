// Estado global compartido — todos los módulos importan este mismo objeto por referencia.
module.exports = {
  client: null,

  procesando: new Set(),

  // Historial del día actual (se limpia a las 10 UTC)
  historialDia: [],

  // Log de cambios de admin
  logAdmin: [],

  // Configuracion completa que se activara en el siguiente cierre diario.
  scheduledMaps: null,

  // Vistas previas efimeras de cambios, indexadas por usuario administrador.
  pendingMapChanges: new Map(),

  // Cobertura: tiempo total por mapa { "ciudad__mapa": { ciudad, mapa, minutos, ... } }
  coberturaDia: {},

  // Minutos pendientes por scout para acumular unidades de tiempo (4h) entre días.
  timeMinuteBalances: {},

  // Minutos pendientes (< 60) por scout y mapa para acreditar mapas entre días (legacy).
  mapMinuteBalances: {},

  // mapasEnAlerta[ciudad__mapa] = { ciudad, mapa, vacioDesde }
  mapasEnAlerta: {},
  alertMessageId: null,
  alertChannelId: null,
  legacyAlertsCleaned: false,

  revisionMessageId: null,
  revisionMobileMessageId: null,
  revisionMobileChannelId: null,
  panelChannelId: null,
  panelMessageId: null,

  // scoutsActivos[userId] = [ { ciudad, mapa, inicio, username }, ... ]
  scoutsActivos: {},
  historialScouts: [],

  // verificacionesScout[userId] = { status, messageId, channelId, reviewMessageId, expiresAt, ... }
  verificacionesScout: {},

  // Modo de verificacion de scout: "normal" confirma con boton, "foto" pide captura por MD.
  verificationMode: null,

  // ultimosMapas[userId] = [ { ciudad, mapa }, ... ]
  ultimosMapas: {},

  mapas: {
    "Lymhurst": [],
    "Bridgewatch": [],
    "Fort Sterling": [],
    "Thetford": [],
    "Martlock": [],
    "Zona Roja": []
  },

  registros: {},
  panelMessage: null,

  // Timestamp de la última edición de mapas
  ultimaEdicion: null,

  // Último cierre diario completado. Permite recuperar un reset perdido tras
  // un redeploy o reinicio de Railway.
  lastDailyResetAt: null,

  revisionMessage: null,
  revisionMobileMessage: null,
  // revisionEstado[ciudad__mapa] = { revisadoEn: timestamp, revisores: [...] }
  revisionEstado: {},
  revisionRound: null,
  revisionScores: {},
  revisionRoundHistory: [],
  lastArchivedSummaryMessageId: null,
  lastArchivedSummaryChannelId: null,
  completedSummaryRegenerations: [],
  completedOneTimeReplies: [],
};
