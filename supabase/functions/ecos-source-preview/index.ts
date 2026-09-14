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
      sourceURL: "https://proof-4292042---ecos-owner-query-preview-vjn77z65la-uw.a.run.app/source",
      gatewayToken: read("ECOS_OWNER_QUERY_GATEWAY_TOKEN"),
      packagedSourceSha256: "fa1ba27723e5111e8fdbedf40e50ee3b1a6059dd5daec7789cef3fb97e473768",
      googleIdentity: readECOSOwnerPrivateGatewayIdentity(read),
    });
  } catch {
    return createECOSOwnerSourceViewGateway();
  }
}
if (import.meta.main) {
  Deno.serve(createECOSOwnerSourceViewGatewayFromEnvironment());
}
