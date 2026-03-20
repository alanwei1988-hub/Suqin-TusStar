const fs = require('fs');
const path = require('path');

module.exports = async function mockMarkItDownHandler({ attachmentPath }) {
  const content = fs.readFileSync(attachmentPath, 'utf8');
  return `# Converted ${path.basename(attachmentPath)}\n\n${content}\n`;
};
