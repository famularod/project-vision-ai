import { createECOSOwnerSourceViewGateway } from "../_shared/ecos-owner-source-view-gateway.ts";
import { readECOSOwnerPrivateGatewayIdentity } from "../_shared/ecos-owner-private-gateway-identity.ts";

/** Future customer source-opening route, independently OFF by default.
 * No source, model or Supabase service credential belongs in this gateway. */
export function createECOSOwnerSourceViewGatewayFromEnvironment(
  read: (name: string) => string | undefined = (name) => Deno.env.get(name),
) {
  if (read("ECOS_OWNER_SOURCE_VIEW_ENABLED") !== "true") {
    return createECOSOwnerSourceViewGateway();
  }
  try {
    return createECOSOwnerSourceViewGateway({
      enabled: true,
      sourceURL: "https://proof-cpu-b3914f1---ecos-owner-query-preview-vjn77z65la-uw.a.run.app/source",
      gatewayToken: read("ECOS_OWNER_QUERY_GATEWAY_TOKEN"),
      packagedSourceSha256: "54425112f70422f4975a46339cb6008c9104f54310dc812cf7bb944cc4c33374",
      googleIdentity: readECOSOwnerPrivateGatewayIdentity(read),
    });
  } catch {
    return createECOSOwnerSourceViewGateway();
  }
}
if (import.meta.main) {
  Deno.serve(createECOSOwnerSourceViewGatewayFromEnvironment());
}
