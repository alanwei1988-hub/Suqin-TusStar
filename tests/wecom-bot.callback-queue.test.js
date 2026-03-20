const assert = require('node:assert/strict');
const WeComAIBot = require('../channel/wxwork/src/wecom-bot');

module.exports = async function runWecomBotCallbackQueueTest() {
  const bot = new WeComAIBot({
    botId: 'test-bot',
    secret: 'test-secret',
    debug: false,
    callbackResponseRetryDelay: 1,
    callbackResponseMaxRetries: 2,
  });

  const sentContents = [];
  let firstAcked = false;
  let sentBeforePreviousAck = false;
  let secondAttempt = 0;

  bot.send = payload => {
    const content = payload.body.stream.content;
    sentContents.push(content);

    if (content === '第一条') {
      setTimeout(() => {
        firstAcked = true;
        bot.handleMessage({ headers: { req_id: 'req-1' }, errcode: 0, errmsg: 'ok' });
      }, 5);
      return true;
    }

    if (!firstAcked) {
      sentBeforePreviousAck = true;
    }

    secondAttempt += 1;
    const response = secondAttempt === 1
      ? { headers: { req_id: 'req-1' }, errcode: 6000, errmsg: 'conflict' }
      : { headers: { req_id: 'req-1' }, errcode: 0, errmsg: 'ok' };

    setTimeout(() => {
      bot.handleMessage(response);
    }, 0);

    return true;
  };

  const [firstResponse, secondResponse] = await Promise.all([
    bot.respondStreamMsg('req-1', '第一条', 'sid-1', false),
    bot.respondStreamMsg('req-1', '第二条', 'sid-1', true),
  ]);

  assert.equal(sentBeforePreviousAck, false);
  assert.deepEqual(sentContents, ['第一条', '第二条', '第二条']);
  assert.equal(firstResponse.errcode, 0);
  assert.equal(secondResponse.errcode, 0);
  assert.equal(bot.callbackResponseQueues.has('req-1'), false);
  assert.equal(bot.pendingRequests.size, 0);
};
