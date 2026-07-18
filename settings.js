const SETTINGS = {
  servers: {
    // Servidor donde se registran y atienden los comandos del bot.
    main: '1435778823743340650',
  },

  creator: {
    // ID de Discord del creador. Configuralo en Railway/.env con CREATOR_USER_ID.
    userIds: (process.env.CREATOR_USER_ID || process.env.OWNER_USER_ID || '852823068475785217')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean),
    notifyScoutLogs: process.env.CREATOR_NOTIFY_SCOUT_LOGS === 'true',
    notifyVerification: process.env.CREATOR_NOTIFY_VERIFICATION !== 'false',
    notifyStartup: process.env.CREATOR_NOTIFY_STARTUP === 'true',
  },

  roles: {
    // Puede anotarse, revisar mapas y recibir alertas de mapas vacios.
    scout: [
      '1435778823743340651',
      // 'OTRO_ROL_ID',
    ],

    // Puede cargar, editar, resetear mapas y usar comandos admin.
    admin: [
      '1506387790265581588',
      '1435778823743340652',
      // 'OTRO_ROL_ID',
    ],

    // Operadores de mayor jerarquia. Pueden modificar horas, multiplicadores,
    // rondas y configuraciones globales que afectan puntuacion.
    seniorAdmin: [
      '1435778823743340652',
      // 'ROL_GM_U_OFFICER_ADICIONAL',
    ],

    // Puede exportar historial del dia.
    lider: [
      '1435778823743340652',
      // 'OTRO_ROL_ID',
    ],

    // Puede aprobar/rechazar capturas de verificacion al instante.
    verificationOfficer: [
      '1435778823743340652',
      // 'OTRO_ROL_ID',
    ],

  },

  channels: {
    // Canal canonico donde el panel principal se mantiene visible.
    maps: '1435778824775274578',

    // Canal fijo donde vive el panel de revision.
    revision: '1505951463460044913',

    // Canal donde se archiva el resumen diario.
    archive: '1505984531063377970',

    // Canal donde se registran entradas, salidas y verificaciones de scouts.
    scoutLog: '1508505812018921632',

    // Canal donde se archivan capturas de verificacion de scout.
    verificationEvidence: '1518825780816253028',
  },

  files: {
    // Carpeta de persistencia. Cuando tengas volume en Railway, usa DATA_DIR=/data.
    dataDir: process.env.DATA_DIR || null,

    // Archivos locales de datos. En Railway sin volume pueden perderse al redeploy.
    data: 'data.json',
    scouts: 'scouts.json',
    panel: 'panel.json',
    revisionPanel: 'revision_panel.json',
  },

  api: {
    // Puerto HTTP para exponer /mapas.
    port: Number(process.env.PORT || 8080),
  },

  verification: {
    // Corta sesiones abiertas que nadie confirma, para evitar horas infinitas.
    enabled: process.env.SCOUT_VERIFICATION_ENABLED !== 'false',
    mode: process.env.SCOUT_VERIFICATION_MODE || 'foto',
    maxActiveMinutes: Number(process.env.SCOUT_VERIFICATION_MAX_MINUTES || 240),
    graceMinutes: Number(process.env.SCOUT_VERIFICATION_GRACE_MINUTES || 10),
    checkIntervalMinutes: Number(process.env.SCOUT_VERIFICATION_CHECK_MINUTES || 5),
    scoutReviewVotes: Number(process.env.SCOUT_VERIFICATION_SCOUT_VOTES || 3),
    reviewReminderMinutes: Number(process.env.SCOUT_VERIFICATION_REVIEW_REMINDER_MINUTES || 30),
  },

  revision: {
    roundMinutes: Number(process.env.MAP_REVISION_ROUND_MINUTES || 20),
    warningMinutesBeforeEnd: Number(process.env.MAP_REVISION_WARNING_MINUTES || 5),
    penaltyPerMiss: Number(process.env.MAP_REVISION_PENALTY || 0.05),
    minimumMultiplier: Number(process.env.MAP_REVISION_MIN_MULTIPLIER || 0.70),
  },

  panel: {
    // Tras una conversacion, espera este tiempo de silencio antes de volver a
    // colocar el panel principal al final del canal.
    repostDelaySeconds: Number(process.env.MAPS_PANEL_REPOST_DELAY_SECONDS || 90),
  },
};

module.exports = SETTINGS;
