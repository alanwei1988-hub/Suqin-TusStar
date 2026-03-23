const fs = require('fs');
const path = require('path');

module.exports = async function mockMarkItDownHandler({ attachmentPath, options = {} }) {
  const content = fs.readFileSync(attachmentPath, 'utf8');
  const pageStart = Number.isFinite(options.pageStart) ? options.pageStart : 1;
  const pageCount = Number.isFinite(options.pageCount) && options.pageCount > 0 ? options.pageCount : 0;
  return `# Converted ${path.basename(attachmentPath)}\n\nPage start: ${pageStart}\nPage count: ${pageCount || 'all'}\n\n${content}\n`;
};
