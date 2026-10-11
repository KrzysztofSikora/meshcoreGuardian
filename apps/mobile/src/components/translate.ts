import type { TFunction } from "i18next";

import type { Text } from "../application/nodes/presenter";

/**
 * Renders a presenter `Text`. The key is a plain string there (the application layer has no i18n
 * types), so the catalog test checks that every key the presenter can produce exists.
 */
export function tr(t: TFunction, text: Text): string {
  return (t as unknown as (key: string, params?: object) => string)(text.key, text.params);
}
