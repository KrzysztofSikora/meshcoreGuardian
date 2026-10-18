export interface ExportFile {
  name: string;
  mimeType: string;
  content: string;
}

/** Writes the export to the app cache and opens the system share sheet with it. */
export interface ExportFilePort {
  available(): Promise<boolean>;
  share(file: ExportFile): Promise<void>;
}
