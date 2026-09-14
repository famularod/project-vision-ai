import { Buffer } from "node:buffer";
import {
  assertECOSOperationalCitationSource,
  resolveECOSOperationalCitationSource,
} from "./ecos-operational-citation-source.ts";
import {
  copyECOSOwnerDocumentSourceViewPNG,
  type ECOSOwnerDocumentSourceViewPorts,
  resolveECOSOwnerDocumentSourceView,
} from "./ecos-owner-document-source-view.ts";
import type { ECOSProjectRecordInventoryRPC } from "./ecos-project-record-inventory-loader.ts";
import {
  ECOS_OWNER_SOURCE_VIEW_REQUEST_BYTES,
  ECOS_OWNER_SOURCE_VIEW_RESPONSE_BYTES,
  type ECOSOwnerSourceViewDependencies,
  parseECOSOwnerSourceViewRequest,
} from "./ecos-owner-source-view-handler.ts";
import { copyECOSV2JSON } from "./ecos-v2-json-model.ts";
import type { ECOSV2PreviewScope } from "./ecos-v2-preview-handler.ts";

const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!.get!;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export type ECOSOwnerSourceViewPorts = ECOSOwnerDocumentSourceViewPorts & {
  recordRPC: ECOSProjectRecordInventoryRPC;
};

/** Trusted server adapter between the two distinct exact-source resolvers and
 * the source-reading HTTP boundary. Neither records nor document locators are
 * coerced to legacy evidence. This is not a route, auth grant or model call.
 * Caller must perform actual bearer authorization before and after this read.
 * No URLs, storage keys or inferred highlights are released for page opening.
 * PNG base64 is a bounded wire encoding, never a separately fetched model link.
 */
export function createECOSOwnerSourceViewResolver(
  input: ECOSOwnerSourceViewPorts,
): ECOSOwnerSourceViewDependencies["resolve"] {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) {
    throw Error("Invalid source-view ports");
  }
  const required = [
    "inventoryRPC",
    "indexRPC",
    "pageRPC",
    "rasterRPC",
    "download",
    "recordRPC",
  ];
  const d = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(input).length !== required.length ||
    required.some((k) =>
      !d[k]?.enumerable || !Object.hasOwn(d[k], "value") ||
      typeof d[k].value !== "function"
    )
  ) throw Error("Invalid source-view ports");
  const ports = Object.freeze(
    Object.fromEntries(required.map((k) => [k, d[k].value])),
  ) as unknown as ECOSOwnerSourceViewPorts;
  const documentPorts = Object.freeze({
    inventoryRPC: ports.inventoryRPC,
    indexRPC: ports.indexRPC,
    pageRPC: ports.pageRPC,
    rasterRPC: ports.rasterRPC,
    download: ports.download,
  });
  return async (inputScope, inputRequest, signal, budgetMs) => {
    const started = performance.now();
    if (
      aborted.call(signal) ||
      !Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 120000
    ) throw Error("Invalid source-view bounds");
    const deadline = started + budgetMs;
    const check = () => {
      if (aborted.call(signal) || performance.now() >= deadline) {
        throw Error("Source view cancelled or over bounds");
      }
    };
    const request = parseECOSOwnerSourceViewRequest(JSON.stringify(
      copyECOSV2JSON(inputRequest, ECOS_OWNER_SOURCE_VIEW_REQUEST_BYTES),
    ));
    const scope = copyECOSV2JSON(inputScope, 2048) as ECOSV2PreviewScope;
    if (
      !scope || typeof scope !== "object" || Array.isArray(scope) ||
      Object.keys(scope).sort().join(",") !==
        "organizationId,ownerId,projectId" ||
      typeof scope.ownerId !== "string" || !UUID.test(scope.ownerId) ||
      scope.organizationId !== scope.ownerId ||
      scope.projectId !== request.projectId
    ) throw Error("Invalid source-view scope");
    Object.freeze(scope);
    const remaining = () => {
      check();
      const n = Math.floor(deadline - performance.now());
      if (n < 1) throw Error("Source view over bounds");
      return n;
    };
    check();
    let result: unknown;
    if (request.citation.kind === "operational_observation") {
      if (request.answerSchemaVersion !== "ecos-owner-source-answer/2.2") {
        throw Error("Wrong source-view protocol");
      }
      const record = await resolveECOSOperationalCitationSource(
        scope,
        request.citation,
        ports.recordRPC,
        { signal, budgetMs: remaining() },
      );
      check();
      assertECOSOperationalCitationSource(record);
      result = Object.freeze({ kind: "operational_record", result: record });
    } else {
      const page = await resolveECOSOwnerDocumentSourceView(
        {
          answerSchemaVersion: request.answerSchemaVersion,
          scope,
          citation: request.citation,
        },
        documentPorts,
        { signal, budgetMs: remaining() },
      );
      check();
      let png:
        | Readonly<
          { media_type: "image/png"; encoding: "base64"; data: string }
        >
        | null = null;
      if (page.state === "current_exact_page_image") {
        const bytes = copyECOSOwnerDocumentSourceViewPNG(page);
        if (bytes.length > 8 * 1024 * 1024) {
          throw Error("Source-view image exceeds bounds");
        }
        check();
        png = Object.freeze({
          media_type: "image/png",
          encoding: "base64",
          data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            .toString("base64"),
        });
        check();
      }
      result = Object.freeze({ kind: "document_page", result: page, png });
    }
    // Reserve envelope room for the public HTTP boundary. No truncation into a
    // usable prefix; returned values retain each resolver's exact semantics.
    if (
      new TextEncoder().encode(JSON.stringify(result)).length >
        ECOS_OWNER_SOURCE_VIEW_RESPONSE_BYTES - 4096
    ) throw Error("Source-view result exceeds bounds");
    check();
    return result;
  };
}
