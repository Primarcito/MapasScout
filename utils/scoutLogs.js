const state = require('../data/state');
const config = require('../config');
const { sendCreatorMessage } = require('./creatorMessages');

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
  const timestamp = Math.floor(Date.now() / 1000);
  const content = `**[${type}]** <t:${timestamp}:T>\n${lines.join('\n')}`;

  if (!state.client) return;

  if (config.SCOUT_LOG_CHANNEL_ID) {
    try {
      const channel = await state.client.channels.fetch(config.SCOUT_LOG_CHANNEL_ID);
      if (channel) {
        await channel.send({
          content,
          allowedMentions: { parse: [] }
        });
      }
    } catch (err) {
      console.error('Error enviando log de scout:', err);
    }
  }

  if (config.CREATOR_NOTIFY_SCOUT_LOGS) {
    await sendCreatorMessage(content);
  }
}

module.exports = {
  sendScoutLog,
  formatMaps,
  formatUser,
};
