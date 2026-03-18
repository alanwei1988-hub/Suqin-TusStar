require('dotenv').config();
const MockAgent = require('./src/mock-agent');

const agent = new MockAgent();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Stopping agent...');
  agent.stop();
  process.exit();
});

agent.start();
