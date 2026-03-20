const assert = require('node:assert/strict');
const WeComAIBot = require('../channel/wxwork/src/wecom-bot');

module.exports = async function runWecomBotLoggingTest() {
  const bot = new WeComAIBot({
    botId: 'test-bot',
    secret: 'test-secret',
    debug: true,
  });

  const logs = [];
  bot.log = (...args) => {
    logs.push(args.join(' '));
  };
  bot.error = () => {};
  bot.ws = {
    readyState: 1,
    send: () => {},
  };
  bot.send = payload => {
    bot.logOutgoingPayload(payload);
    setTimeout(() => {
      bot.handleMessage({ headers: { req_id: payload.headers.req_id }, errcode: 0, errmsg: 'ok' });
    }, 0);
    return true;
  };

  await bot.respondStreamMsg('req-1', '中间草稿', 'sid-1', false);
  assert.equal(logs.length, 0);

  await bot.respondStreamMsg('req-1', '最终完整回复', 'sid-1', true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Sending final stream:/);
  assert.match(logs[0], /最终完整回复/);

  bot.handleMessage({ cmd: 'ping' });
  bot.handleMessage({ errmsg: 'ok', headers: { req_id: 'req-1' } });
  assert.equal(logs.length, 1);

  bot.handleMessage({ cmd: 'aibot_msg_callback', headers: { req_id: 'req-2' }, body: { text: { content: 'hello' } } });
  assert.equal(logs.length, 2);
  assert.match(logs[1], /Received:/);
};
