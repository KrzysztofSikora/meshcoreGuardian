export interface LppMeaning {
  name: string;
  unit: string | null;
}

/** The CayenneLPP types meshcore.js parses, with the unit of the value it returns (already scaled). */
const LPP_TYPES: Record<number, LppMeaning> = {
  100: { name: "generic", unit: null },
  101: { name: "illuminance", unit: "lx" },
  102: { name: "presence", unit: null },
  103: { name: "temperature", unit: "°C" },
  104: { name: "humidity", unit: "%" },
  115: { name: "pressure", unit: "hPa" },
  116: { name: "voltage", unit: "V" },
  117: { name: "current", unit: "A" },
  120: { name: "percentage", unit: "%" },
  125: { name: "concentration", unit: "ppm" },
  128: { name: "power", unit: "W" },
  136: { name: "gps", unit: null },
};

/** Name and unit of an LPP type. A type outside the table has no unit: it is never guessed. */
export function lppMeaning(type: number): LppMeaning {
  return LPP_TYPES[type] ?? { name: `lpp_${type}`, unit: null };
}
