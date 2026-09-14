import {
  assertECOSOwnerGoogleIDToken,
  createECOSOwnerGoogleIDTokenSupplier,
} from "./ecos-owner-google-id-token.ts";

/** Owner-user delegation only, never proof of an Edge workload. No keys or
 * tokens are persisted/cached. Hosted IAM and session checks remain mandatory. */
export type ECOSOwnerPrivateGatewayIdentity = Readonly<{
  ownerId: string;
  providerResource: string;
  invokerResource: string;
}>;

export function createECOSOwnerPrivateGatewayIdentity(
  identity: ECOSOwnerPrivateGatewayIdentity,
  serviceURL: string,
  fetchImpl: typeof fetch,
) {
  const keys = ["ownerId", "providerResource", "invokerResource"];
  if (
    !identity || Object.getPrototypeOf(identity) !== Object.prototype ||
    Reflect.ownKeys(identity).length !== keys.length
  ) {
    throw Error("Private gateway configuration unavailable");
  }
  const values: Record<string, string> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(identity, key);
    if (
      !d?.enumerable || !Object.hasOwn(d, "value") ||
      typeof d.value !== "string"
    ) {
      throw Error("Private gateway configuration unavailable");
    }
    values[key] = d.value;
  }
  const supply = createECOSOwnerGoogleIDTokenSupplier({
    ownerId: values.ownerId,
    providerResource: values.providerResource,
    invokerResource: values.invokerResource,
    serviceURL,
    fetchImpl,
  });
  return async (
    authorization: string,
    options: { signal: AbortSignal; deadline: number },
  ) => {
    const credential = await supply(authorization, options);
    assertECOSOwnerGoogleIDToken(credential);
    if (
      credential.headers.Authorization !== authorization ||
      credential.service_url !== serviceURL
    ) {
      throw Error("Private gateway identity unavailable");
    }
    return credential.headers["X-Serverless-Authorization"];
  };
}

/** Called only by enabled server entrypoints. Missing fields fail closed. */
export function readECOSOwnerPrivateGatewayIdentity(
  read: (name: string) => string | undefined,
): ECOSOwnerPrivateGatewayIdentity {
  const ownerId = read("ECOS_OWNER_PREVIEW_OWNER_ID");
  const providerResource = read("ECOS_OWNER_GOOGLE_PROVIDER_RESOURCE");
  const invokerResource = read("ECOS_OWNER_GOOGLE_INVOKER_RESOURCE");
  if (!ownerId || !providerResource || !invokerResource) {
    throw Error("Private gateway configuration unavailable");
  }
  return { ownerId, providerResource, invokerResource };
}
