/** Nordic UART service that MeshCore companions expose (verified in S-01). */
export const NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";

const NAME_PREFIX = "MeshCore";

/** Plan D-8: either the service UUID or a name prefix identifies a companion. */
export function isCompanionAdvertisement(ad: {
  name: string | null;
  serviceUUIDs: readonly string[] | null;
}): boolean {
  const byUuid = (ad.serviceUUIDs ?? []).some((uuid) => uuid.toLowerCase() === NUS_SERVICE_UUID);
  return byUuid || (ad.name?.startsWith(NAME_PREFIX) ?? false);
}
