require('dotenv').config();
const WeComAIBot = require('./src/wecom-bot');
const fs = require('fs');

async function testUpload() {
  const bot = new WeComAIBot({
    botId: process.env.BOT_ID,
    secret: process.env.SECRET,
    debug: true
  });

  bot.connect();

  // Wait for subscribe to complete
  await new Promise(r => setTimeout(r, 2000));

  try {
    // Create a dummy file buffer
    const buffer = Buffer.from("This is a test file content for WeCom media upload.");
    console.log('Starting upload...');
    const mediaId = await bot.uploadMedia('file', 'test.txt', buffer);
    console.log('Upload success! Media ID:', mediaId);
  } catch (err) {
    console.error('Upload failed:', err);
  } finally {
    bot.disconnect();
  }
}

testUpload();
