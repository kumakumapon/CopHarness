class CopilotClient {
  constructor(_) {}
  async start() {}
  async stop() {}
  async createSession() {
    return {
      destroy: async () => {},
      sendAndWait: async () => ({ data: { content: '' } }),
    };
  }
}
const approveAll = () => {};
module.exports = { CopilotClient, approveAll };
