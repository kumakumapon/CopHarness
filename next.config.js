/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Copilot SDK 1.x loads a native runtime through koffi (.node binaries) and platform-specific
  // optional packages; webpack cannot bundle those, so load them from node_modules at runtime.
  serverExternalPackages: ['@github/copilot-sdk', 'koffi'],
}

module.exports = nextConfig
