const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canExport } = require('../permissions');
const { csvCell, sesionesExportables } = require('./scout');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapas-exportar')
    .setDescription('Exportar la actividad del día como CSV'),

  async execute(interaction) {
    if (!canExport(interaction.member)) {
      return interaction.reply({ content: 'Necesitas el rol Líder para usar este comando.', flags: MessageFlags.Ephemeral });
    }
    const sesiones = sesionesExportables();
    if (!sesiones.length) {
      return interaction.reply({ content: 'No hay actividad registrada hoy.', flags: MessageFlags.Ephemeral });
    }
    const fecha = new Date().toISOString().split('T')[0];
    let csv = 'Usuario,Mapa,Ciudad,Entrada UTC,Salida UTC,Duracion (min)\n';
    for (const session of sesiones) {
      const start = new Date(session.inicio).toISOString().replace('T', ' ').slice(0, 19);
      const end = session.fin ? new Date(session.fin).toISOString().replace('T', ' ').slice(0, 19) : 'activo';
      csv += [session.username || session.userId, session.mapa, session.ciudad, start, end, session.duracionMin].map(csvCell).join(',') + '\n';
    }
    return interaction.reply({
      content: `📊 Historial del día ${fecha}`,
      files: [{ attachment: Buffer.from(csv, 'utf-8'), name: `historial_${fecha}.csv` }],
      flags: MessageFlags.Ephemeral,
    });
  },
};
