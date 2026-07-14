const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const { buttonEmoji } = require('../emojis');
const { mapChangesDiff } = require('../utils/mapManagement');

function mapCounts(maps) {
  return Object.entries(maps || {})
    .map(([city, list]) => `• **${city}:** ${(list || []).length}`)
    .join('\n');
}

function mapConfigPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Configuración de mapas')
    .setColor(0x3498db)
    .setDescription(
      `**Mapas activos**\n${mapCounts(state.mapas)}\n\n` +
      `**Próximo período:** ${state.scheduledMaps ? 'configurado' : 'sin programación'}\n` +
      'Los cambios muestran una vista previa antes de aplicarse.'
    );

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('map_config_import').setLabel('Importar').setEmoji(buttonEmoji('MAP')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('map_config_edit').setLabel('Editar ciudad').setEmoji(buttonEmoji('MAP')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('map_config_active').setLabel('Mapas activos').setEmoji(buttonEmoji('ACTIVE')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('map_config_scheduled').setLabel('Próximo período').setEmoji(buttonEmoji('REVIEW')).setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('map_config_clear').setLabel('Vaciar mapas').setEmoji(buttonEmoji('DROP')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('map_config_cancel_scheduled').setLabel('Cancelar programación').setStyle(ButtonStyle.Secondary).setDisabled(!state.scheduledMaps),
    ),
  ];
  return { embeds: [embed], components: rows };
}

function mapListEmbed(title, maps) {
  const embed = new EmbedBuilder().setTitle(title).setColor(0x5865f2);
  for (const [city, list] of Object.entries(maps || {})) {
    embed.addFields({
      name: `${city} · ${(list || []).length}`,
      value: (list || []).length ? list.map(map => `• ${map}`).join('\n').slice(0, 850) : 'Sin mapas',
      inline: true,
    });
  }
  return embed;
}

function mapChangesPreview(changes) {
  const diff = mapChangesDiff(changes);
  const description = diff.map(item => {
    const added = item.added.length ? item.added.map(map => `+ ${map}`).join('\n') : '+ Sin agregados';
    const removed = item.removed.length ? item.removed.map(map => `− ${map}`).join('\n') : '− Sin eliminados';
    return `**${item.city}**\n${added}\n${removed}\n= ${item.kept.length} sin cambios`;
  }).join('\n\n').slice(0, 3900);

  const embed = new EmbedBuilder()
    .setTitle('Vista previa de cambios')
    .setColor(0xf1c40f)
    .setDescription(description || 'No hay cambios válidos.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('map_changes_apply').setLabel('Aplicar ahora').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('map_changes_schedule').setLabel('Programar 10 UTC').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('map_changes_cancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

function confirmClearMaps() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Vaciar mapas activos')
      .setColor(0xed4245)
      .setDescription('Se cerrarán correctamente las sesiones afectadas y se vaciarán mapas y asignaciones. No se borrarán multiplicadores ni historial disciplinario.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('map_config_clear_confirm').setLabel('Confirmar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('map_config_home').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
    )],
  };
}

module.exports = { mapConfigPanel, mapListEmbed, mapChangesPreview, confirmClearMaps };
