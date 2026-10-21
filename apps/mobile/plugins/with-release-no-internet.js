// Removes the INTERNET permission from the release variant only. The app makes no network
// requests (NFR-02); debug builds keep it because Metro serves the JS bundle over HTTP.
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.INTERNET" tools:node="remove" />
</manifest>
`;

function writeReleaseManifest(androidDir) {
  const dir = path.join(androidDir, "app", "src", "release");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "AndroidManifest.xml"), MANIFEST);
}

function withReleaseNoInternet(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      writeReleaseManifest(cfg.modRequest.platformProjectRoot);
      return cfg;
    },
  ]);
}

module.exports = withReleaseNoInternet;
module.exports.writeReleaseManifest = writeReleaseManifest;
