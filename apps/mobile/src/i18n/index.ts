import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";

export const resources = { en: { translation: en } } as const;

export const i18n = createInstance();

// English only for now (C-09, plan D-14); a second locale adds a resource and locale detection.
void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources,
  initAsync: false,
  interpolation: { escapeValue: false },
});
