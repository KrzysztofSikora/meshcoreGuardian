import type { ConnectionState } from "@guardian/domain";
import { useTranslation } from "react-i18next";

import { connectionLook } from "../application/diagnostics/presenter";
import { StatusChip } from "./ui/status-chip";

/** One of four states as an icon plus text in a chip, never colour alone (FR-01 AC5). */
export function ConnectionStatus({ connection }: { connection: ConnectionState }) {
  const { t } = useTranslation();
  const { icon, tone } = connectionLook(connection.kind);
  return <StatusChip tone={tone} icon={icon} label={t(`connection.${connection.kind}`)} />;
}
