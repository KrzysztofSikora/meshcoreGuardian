import Svg, { Circle, Path, Rect } from "react-native-svg";

import type { IconName } from "../../application/diagnostics/presenter";

export type { IconName };

/** 24-px stroke icons copied from the design mockup; every icon sits behind this one switch (plan D-1). */
function Shapes({ name }: { name: IconName }) {
  switch (name) {
    case "check":
      return <Path d="M5 12.5l4.5 4.5L19 7.5" />;
    case "question":
      return (
        <>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4" />
          <Path d="M12 17h.01" />
        </>
      );
    case "alert":
      return (
        <>
          <Path d="M12 3l10 18H2z" />
          <Path d="M12 10v5M12 18h.01" />
        </>
      );
    case "slash":
      return (
        <>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M6 6l12 12" />
        </>
      );
    case "dash":
      return <Path d="M6 12h12" />;
    case "circle":
      return <Circle cx="12" cy="12" r="8" />;
    case "clock":
      return (
        <>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M12 7v5l3 2" />
        </>
      );
    case "sync":
      return (
        <>
          <Path d="M20 12a8 8 0 1 1-2.3-5.6" />
          <Path d="M20 4v5h-5" />
        </>
      );
    case "play":
      return <Path d="M7 4l12 8-12 8z" />;
    case "bluetooth":
      return <Path d="M7 7l10 10-5 5V2l5 5L7 17" />;
    case "grid":
      return (
        <>
          <Rect x="4" y="4" width="7" height="7" rx="1.5" />
          <Rect x="13" y="4" width="7" height="7" rx="1.5" />
          <Rect x="4" y="13" width="7" height="7" rx="1.5" />
          <Rect x="13" y="13" width="7" height="7" rx="1.5" />
        </>
      );
    case "sliders":
      return (
        <>
          <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <Circle cx="16" cy="7" r="2" />
          <Circle cx="10" cy="17" r="2" />
        </>
      );
    case "compass":
      return <Path d="M12 3l7 18-7-4-7 4z" />;
    case "info":
      return (
        <>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M12 11v5M12 8h.01" />
        </>
      );
    case "search":
      return (
        <>
          <Circle cx="11" cy="11" r="6.5" />
          <Path d="M16 16l4.5 4.5" />
        </>
      );
  }
}

/** Decoration only: hidden from accessibility, the label next to it carries the meaning. */
export function Icon({ name, size = 16, color }: { name: IconName; size?: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Shapes name={name} />
    </Svg>
  );
}
