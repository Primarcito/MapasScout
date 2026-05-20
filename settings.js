const SETTINGS = {
  servers: {
    // Servidor donde se registran y atienden los comandos del bot.
    main: '1435778823743340650',
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

    // Puede exportar historial del dia.
    lider: [
      '1435778823743340652',
      // 'OTRO_ROL_ID',
    ],
  },

  channels: {
    // Canal fijo donde vive el panel de revision.
    revision: '1505951463460044913',

    // Canal donde se archiva el resumen diario.
    archive: '1505984531063377970',
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
};

module.exports = SETTINGS;
