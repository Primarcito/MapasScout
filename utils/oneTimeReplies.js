const state = require('../data/state');
const { guardarRevisionPanel } = require('../data/persistence');

const PIEDRA_TAUNT = {
  channelId: '1505951463460044913',
  messageId: '1540219271743930478',
  content: 'Encontramos la piedra, boludo. Ahora falta encontrar tu aporte en la ronda, que no aparece ni con GPS. 🔍🪨',
};

async function sendOneTimeReply(client, target = PIEDRA_TAUNT, persist = guardarRevisionPanel) {
  state.completedOneTimeReplies ||= [];
  if (state.completedOneTimeReplies.includes(target.messageId)) return false;

  const channel = await client.channels.fetch(target.channelId);
  const message = await channel.messages.fetch(target.messageId);
  await message.reply({
    content: target.content,
    allowedMentions: { repliedUser: true },
  });

  state.completedOneTimeReplies.push(target.messageId);
  persist();
  return true;
}

module.exports = { PIEDRA_TAUNT, sendOneTimeReply };
