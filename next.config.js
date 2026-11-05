/** @type {import('next').NextConfig} */
const nextConfig = {
  // Loaded from node_modules at runtime: native bindings (Copilot SDK), optional
  // gateway dependencies (discord.js) and child-process transports (MCP).
  serverExternalPackages: ['@github/copilot-sdk', 'koffi', 'discord.js', '@discordjs/ws', '@modelcontextprotocol/sdk'],
};

module.exports = nextConfig;
