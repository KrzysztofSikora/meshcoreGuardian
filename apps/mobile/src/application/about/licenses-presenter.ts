import type { Text } from "../nodes/presenter";

/** One entry of `licenses/notices.json`, written by `scripts/licenses.mjs`. */
export interface Notice {
  name: string;
  version: string;
  license: string;
  /** Null when the package ships no licence file. */
  text: string | null;
  source: "npm" | "asset";
}

export interface LicenseRow {
  /** Unique per name and version; used as the list key. */
  id: string;
  name: string;
  version: string;
  license: string;
  /** The full notice, or null with `missing` set. */
  text: string | null;
  missing: Text | null;
}

/** Shown first: the codec and the bundled font, whose licences ask for a notice in the app. */
const PINNED = ["@liamcottle/meshcore.js", "IBM Plex"];

const pinnedRank = (name: string): number => {
  const index = PINNED.indexOf(name);
  return index < 0 ? PINNED.length : index;
};

/** Pinned notices first (in `PINNED` order), then the rest by name and version (D-4). */
export function licenseRows(notices: readonly Notice[]): LicenseRow[] {
  return [...notices]
    .sort(
      (a, b) =>
        pinnedRank(a.name) - pinnedRank(b.name) ||
        a.name.localeCompare(b.name, "en") ||
        a.version.localeCompare(b.version, "en", { numeric: true }),
    )
    .map((notice) => ({
      id: `${notice.name}@${notice.version}`,
      name: notice.name,
      version: notice.version,
      license: notice.license,
      text: notice.text,
      missing:
        notice.text === null ? { key: "licenses.textMissing", params: { id: notice.license } } : null,
    }));
}
