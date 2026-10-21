import type { Text } from "../nodes/presenter";

export interface PrivacyBlock {
  kind: "heading" | "paragraph";
  text: Text;
}

/** Number of sections in the policy; keys are `privacy.h<n>` and `privacy.p<n>` (D-5). */
export const PRIVACY_SECTIONS = 9;

/** The policy in reading order: effective line, then a heading and a paragraph per section. */
export function privacyBlocks(): PrivacyBlock[] {
  const blocks: PrivacyBlock[] = [{ kind: "paragraph", text: { key: "privacy.effective" } }];
  for (let n = 1; n <= PRIVACY_SECTIONS; n++) {
    blocks.push({ kind: "heading", text: { key: `privacy.h${n}` } });
    blocks.push({ kind: "paragraph", text: { key: `privacy.p${n}` } });
  }
  return blocks;
}
