import type { RunStatus as Status } from "@guardian/domain";
import { useTranslation } from "react-i18next";

import { statusLook, statusText } from "../application/diagnostics/presenter";
import { StatusChip } from "./ui/status-chip";
import { tr } from "./translate";

/** The last-run status as an icon plus words in a chip, never colour alone (FR-11, NFR-05). */
export function RunStatus({ status }: { status: Status }) {
  const { t } = useTranslation();
  const { icon, tone } = statusLook(status);
  return <StatusChip tone={tone} icon={icon} label={tr(t, statusText(status))} />;
}
