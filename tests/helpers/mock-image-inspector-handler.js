module.exports = async function mockImageInspectorHandler({ attachmentPath, config = {} }) {
  return {
    model: config.model || 'mock-image-model',
    text: `Image summary for ${require('path').basename(attachmentPath)}: Q-version mascot poster with visible title 启迪之星算力服务`,
  };
};
