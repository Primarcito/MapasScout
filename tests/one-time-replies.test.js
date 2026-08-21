const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../data/state');
const { sendOneTimeReply } = require('../utils/oneTimeReplies');

test('responde al mensaje configurado una sola vez y persiste la marca', async () => {
  const previous = state.completedOneTimeReplies;
  state.completedOneTimeReplies = [];
  const replies = [];
  let persisted = 0;
  const target = { channelId: 'channel', messageId: 'message', content: 'respuesta' };
  const client = {
    channels: {
      async fetch(channelId) {
        assert.equal(channelId, 'channel');
        return {
          messages: {
            async fetch(messageId) {
              assert.equal(messageId, 'message');
              return { async reply(payload) { replies.push(payload); } };
            },
          },
        };
      },
    },
  };

  try {
    assert.equal(await sendOneTimeReply(client, target, () => { persisted += 1; }), true);
    assert.equal(await sendOneTimeReply(client, target, () => { persisted += 1; }), false);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].content, 'respuesta');
    assert.equal(persisted, 1);
  } finally {
    state.completedOneTimeReplies = previous;
  }
});
