import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { ExportFile, ExportFilePort } from "../application/export/ports";

/** Writes the export to the app cache and opens the Android share sheet (plan D-11, D-12). */
export class ExpoExportFiles implements ExportFilePort {
  available(): Promise<boolean> {
    return Sharing.isAvailableAsync();
  }

  async share(file: ExportFile): Promise<void> {
    const target = new File(Paths.cache, file.name);
    // A second share of the same range replaces the first file.
    target.create({ overwrite: true });
    target.write(file.content);
    await Sharing.shareAsync(target.uri, { mimeType: file.mimeType, dialogTitle: file.name });
  }
}
