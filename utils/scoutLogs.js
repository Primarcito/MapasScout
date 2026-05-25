const state = require('../data/state');
const config = require('../config');

function formatMap({ ciudad, mapa }) {
  return `${ciudad} - ${mapa}`;
}

function formatMaps(maps) {
  if (!maps || maps.length === 0) return 'sin mapas';
  if (maps.length <= 8) return maps.map(formatMap).join(', ');
  return `${maps.slice(0, 8).map(formatMap).join(', ')} y ${maps.length - 8} mas`;
}

function formatUser(userId, username = null) {
  return username ? `${username} (<@${userId}>)` : `<@${userId}>`;
}

async function sendScoutLog(type, lines) {
  if (!state.client || !config.SCOUT_LOG_CHANNEL_ID) return;

  try {
    const channel = await state.client.channels.fetch(config.SCOUT_LOG_CHANNEL_ID);
    if (!channel) return;

    const timestamp = Math.floor(Date.now() / 1000);
    await channel.send({
      content: `**[${type}]** <t:${timestamp}:T>\n${lines.join('\n')}`,
      allowedMentions: { parse: [] }
    });
  } catch (err) {
    console.error('Error enviando log de scout:', err);
  }
}

module.exports = {
  sendScoutLog,
  formatMaps,
  formatUser,
};
