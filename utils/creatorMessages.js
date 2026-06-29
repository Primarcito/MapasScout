const config = require('../config');
const state = require('../data/state');

function getCreatorUserIds() {
  return (config.CREATOR_USER_IDS || []).filter(Boolean);
}

function isCreatorUser(userId) {
  return getCreatorUserIds().includes(userId);
}

async function sendCreatorDm(payload) {
  const userIds = getCreatorUserIds();
  if (!state.client || userIds.length === 0 || !payload) return [];

  const messages = [];
  for (const userId of userIds) {
    try {
      const user = await state.client.users.fetch(userId);
      const dm = await user.createDM();
      const msg = await dm.send({
        ...payload,
        allowedMentions: payload.allowedMentions || { parse: [] },
      });
      messages.push(msg);
    } catch (err) {
      console.error(`No se pudo enviar MD al creador ${userId}:`, err.message);
    }
  }

  return messages;
}

async function sendCreatorMessage(content, options = {}) {
  const messages = await sendCreatorDm({
    content,
    allowedMentions: options.allowedMentions || { parse: [] },
  });

  return messages.length;
}

module.exports = {
  getCreatorUserIds,
  isCreatorUser,
  sendCreatorDm,
  sendCreatorMessage,
};
