const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// meshcore.js imports its Node-only connection classes from its entry point. They load these
// modules lazily and the app never constructs them, so an empty module is enough (plan D-13).
const NODE_ONLY = new Set(["serialport", "net"]);
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (NODE_ONLY.has(moduleName)) return { type: "empty" };
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
