// Synthetic JSON wires + genuine inventory/page/geometry/PNG binders. No live
// database, Storage, customer PDF, model or caller-authorization proof.
// deno-lint-ignore-file no-explicit-any require-await
import {
  copyECOSOwnerDocumentSourceViewPNG as copyPNG,
  resolveECOSOwnerDocumentSourceView as resolve,
} from "./ecos-owner-document-source-view.ts";
import {
  ownerPageTestHash as hash,
  ownerPageTestId as id,
} from "./ecos-owner-indexed-page-observations-fixture.ts";
import {
  copyECOSOwnerRasterImageForSourceView,
  loadECOSOwnerRasterImages,
} from "./ecos-owner-raster-images.ts";
import { createOwnerDocumentSourceViewFixture as setup } from "./ecos-owner-document-source-view-fixture.ts";

Deno.test("source document diagnostics isolate failing port without input or exception disclosure", async () => {
  const previous = console.warn, logs: string[] = [];
  console.warn = (...values: unknown[]) => {
    logs.push(String(values[0]));
  };
  try {
    for (
      const [port, phase] of [
        ["inventoryRPC", "inventory"],
        ["indexRPC", "indexes"],
        ["pageRPC", "page_observations"],
        ["rasterRPC", "raster_load"],
        ["download", "raster_load"],
      ] as const
    ) {
      const f = await setup();
      logs.length = 0;
      await rejects(() =>
        resolve(f.input(f.visualCitation), {
          ...f.ports,
          [port]: async () => {
            throw Error("secret source data");
          },
        })
      );
      const failures = logs.map((line) => JSON.parse(line)).filter((event) =>
        event.event === "ecos_owner_document_source_view_failed"
      );
      equal(failures.length, 1);
      const event = failures[0];
      equal(Object.keys(event).sort(), ["elapsedMs", "event", "phase"]);
      equal(event.event, "ecos_owner_document_source_view_failed");
      equal(event.phase, phase);
      assert(Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0);
      assert(
        logs.every((line) => !line.includes("secret") &&
          !line.includes(f.visualCitation.source_id)),
      );
    }
    console.warn = () => {
      throw Error("broken logging");
    };
    const f = await setup();
    await rejects(() =>
      resolve(f.input(), {
        ...f.ports,
        download: async () => {
          throw Error("secret");
        },
      })
    );
  } finally {
    console.warn = previous;
  }
});
function assert(v: unknown, message = "Assertion failed"): asserts v {
  if (!v) throw Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(JSON.stringify(a) === JSON.stringify(b));
}
async function rejects(run: () => unknown) {
  let failed = false;
  try {
    await run();
  } catch (error) {
    failed = true;
    assert(error instanceof Error);
    assert(!error.message.includes("secret"));
  }
  assert(failed, "Expected rejection");
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
Deno.test("source view: one post-download freshness pass without an unused post-model pass", async () => {
  const f = await setup();
  await resolve(f.input(), f.ports);
  // Initial exact raster read plus post-download raster-head read. Source view
  // performs no model call or asynchronous work requiring another full pass.
  equal(f.calls.filter((c) => c.name === "ecos_read_owner_page_raster").length, 2);
  const downloaded = f.calls.findIndex((c) => c.name === "download");
  const after = f.calls.slice(downloaded + 1).map((c) => c.name);
  equal(after, [
    "ecos_read_owner_page_raster",
    "ecos_resolve_linked_owner_project_document_indexes",
    "ecos_resolve_linked_owner_project_document_indexes",
  ]);
});
Deno.test("source view: genuine native/table/visual exact pins and PNG, both answer versions", async () => {
  const f = await setup();
  for (
    const version of [
      "ecos-owner-source-answer/2.1",
      "ecos-owner-source-answer/2.2",
    ] as const
  ) {
    for (const c of [f.native, f.tableCitation, f.visualCitation]) {
      const result = await resolve(f.input(c, version), f.ports);
      assert(result.state === "current_exact_page_image");
      equal(result.citation, c);
      equal([...copyPNG(result)], [...f.bytes]);
      assert(
        result.highlight === null && !result.semantic_verified &&
          !result.whole_answer_verified && !result.retrieval_authorized,
      );
      assert(result.authorization === "caller_required_before_and_after");
      assert(
        result.image_relation ===
          (c.kind === "visual_page"
            ? "exact_cited_visual_receipt"
            : "current_image_of_exact_cited_checkpoint_not_old_answer_image_proof"),
      );
      assert(
        result.raster?.coordinate_system ===
          "rotated_display_cropbox_pixels_top_left",
      );
      assert(!JSON.stringify(result).includes("object_key"));
    }
  }
  assert(
    f.calls.every((c) =>
      c.name === "download" ||
      /^(ecos_list_linked_owner|ecos_resolve_linked_owner|ecos_read_owner_page)/
        .test(c.name)
    ),
  );
});
Deno.test("source view: exact quote, block, offsets, table row/cell and native geometry required", async () => {
  const f = await setup();
  for (
    const [citation, key, value] of [
      [f.native, "quote", "approved for installation"],
      [f.native, "text_start", 1],
      [f.native, "block_ordinal", 77],
      [f.native, "bbox", [0, 0, 1, 1]],
      [f.tableCitation, "row_number", 1],
      [f.tableCitation, "column_number", 1],
      [f.tableCitation, "table_id", "other"],
    ] as const
  ) {
    const c: any = clone(citation);
    if (key === "quote") c.quote = value;
    else c.locator[key] = value;
    const result = await resolve(f.input(c), f.ports);
    assert(result.state === "changed");
    assert(result.page === null && result.raster === null);
    await rejects(() => copyPNG(result));
  }
  assert(!f.calls.some((c) => c.name === "download"));
});
Deno.test("source view: each source authority/managed/execution/page pin changed returns no replacement", async () => {
  const f = await setup();
  for (
    const key of [
      "authority_decision_id",
      "authority_receipt_sha256",
      "managed_attempt_id",
      "managed_receipt_sha256",
      "execution_id",
      "binding_id",
      "source_revision",
      "page_attempt_id",
      "page_sha256",
    ] as const
  ) {
    const c: any = clone(f.native);
    c.locator[key] = key.endsWith("sha256")
      ? "f".repeat(64)
      : key === "source_revision"
      ? "changed"
      : id(999);
    const result = await resolve(f.input(c), f.ports);
    assert(result.state === "changed");
    assert(result.page === null && result.raster === null);
  }
  assert(
    !f.calls.some((c) =>
      c.name === "ecos_read_owner_page_observations" || c.name === "download"
    ),
  );
});
Deno.test("source view: visual requires original raster receipt not just identical pixel hash", async () => {
  const f = await setup();
  for (
    const key of [
      "upload_attempt_id",
      "raster_receipt_sha256",
      "raster_sha256",
      "visual_payload_sha256",
    ] as const
  ) {
    const c: any = clone(f.visualCitation);
    c.locator[key] = key.endsWith("sha256") ? "f".repeat(64) : id(999);
    const result = await resolve(f.input(c), f.ports);
    assert(result.state === "changed");
    assert(result.citation === null && result.raster === null);
    await rejects(() => copyPNG(result));
  }
});
Deno.test("source view: independent image locator permits only versioned null OCR pin and exact image receipt", async () => {
  const f = await setup({ independentImage: true });
  assert(f.visualCitation.locator.visual_payload_sha256 === null);
  equal(
    f.visualCitation.locator.locator_schema_version,
    "ecos-owner-raster-source-locator/2.2",
  );
  const result = await resolve(f.input(f.visualCitation), f.ports);
  assert(result.state === "current_exact_page_image");
  equal(result.citation, f.visualCitation);
  equal([...copyPNG(result)], [...f.bytes]);

  const changed: any = clone(f.visualCitation);
  changed.locator.image_payload_sha256 = "f".repeat(64);
  const changedResult = await resolve(f.input(changed), f.ports);
  assert(changedResult.state === "changed");
  assert(changedResult.citation === null && changedResult.raster === null);

  const wrongVersion: any = clone(f.visualCitation);
  wrongVersion.locator.locator_schema_version =
    "ecos-owner-raster-source-locator/2.1";
  await rejects(() => resolve(f.input(wrongVersion), f.ports));

  const unversioned: any = clone(f.visualCitation);
  delete unversioned.locator.locator_schema_version;
  await rejects(() => resolve(f.input(unversioned), f.ports));

  const legacy = await setup();
  const legacyNull: any = clone(legacy.visualCitation);
  legacyNull.locator.visual_payload_sha256 = null;
  await rejects(() => resolve(legacy.input(legacyNull), legacy.ports));
  equal(legacy.calls, []);
});
Deno.test("source view: malformed/legacy/cross-scope citation rejects before any RPC", async () => {
  const f = await setup();
  const cases: any[] = [
    f.input(f.native, "ecos-source-answer/2.0"),
    f.input(f.native, ["ecos-owner-source-answer/2.1"]),
    f.input(f.native, { value: "ecos-owner-source-answer/2.2" }),
    f.input({ ...f.native, selected: false }),
    f.input({ ...f.visualCitation, quote: "fabricated pixel quote" }),
    f.input({ ...f.native, job_id: id(3) }),
    f.input({ ...f.native, source_id: "other" }),
    f.input({
      ...f.native,
      locator: { ...f.native.locator, project_id: id(999) },
    }),
    f.input({
      ...f.native,
      locator: {
        ...f.native.locator,
        coordinate_system: "rotated_display_cropbox_pixels_top_left",
      },
    }),
    f.input({ ...f.native, locator: { ...f.native.locator, text_end: NaN } }),
    f.input({ ...f.native, quote: "x".repeat(65536) }),
    f.input({
      ...f.visualCitation,
      locator: { ...f.visualCitation.locator, pixel_box: [1, 1, 3, 3] },
    }),
  ];
  for (const value of cases) await rejects(() => resolve(value, f.ports));
  equal(f.calls, []);
});
Deno.test("source view: accessor/symbol and caller mutation cannot replace captured citation", async () => {
  const f = await setup();
  const bad = f.input(clone(f.native));
  Object.defineProperty(bad.citation, "unexpected", {
    enumerable: true,
    get() {
      throw Error("secret getter");
    },
  });
  await rejects(() => resolve(bad, f.ports));
  equal(f.calls, []);
  const value = f.input(clone(f.tableCitation));
  f.setHook((_name, _params, wire) => {
    value.citation.quote = "CHANGED";
    return wire;
  });
  const result = await resolve(value, f.ports);
  assert(
    result.state === "current_exact_page_image" &&
      result.citation?.quote === "NOT inspected",
  );
});
Deno.test("source view: unavailable raster retains no image or substitute page metadata", async () => {
  const f = await setup();
  f.setHook((name, _params, raw) =>
    name === "ecos_read_owner_page_raster"
      ? {
        ...raw,
        state: "missing",
        current_upload_attempt_id: null,
        receipt_json: null,
        receipt_sha256: null,
        availability: "unavailable",
      }
      : raw
  );
  const result = await resolve(f.input(), f.ports);
  assert(
    result.state === "unavailable" && result.page === null &&
      result.raster === null,
  );
  assert(!f.calls.some((c) => c.name === "download"));
  await rejects(() => copyPNG(result));
});
Deno.test("source view: unselected index drift and final raster drift reject whole result", async () => {
  for (const channel of ["index", "raster"]) {
    const f = await setup();
    let reads = 0;
    f.setHook((name, _params, raw) => {
      if (
        channel === "index" &&
        name === "ecos_resolve_linked_owner_project_document_indexes" &&
        ++reads > 2
      ) raw.index_epoch_sha256 = "9".repeat(64);
      if (
        channel === "raster" && name === "ecos_read_owner_page_raster" &&
        ++reads > 1
      ) raw.receipt_sha256 = "9".repeat(64);
      return raw;
    });
    await rejects(() => resolve(f.input(), f.ports));
  }
});
Deno.test("source view: corrupt PNG never yields available image", async () => {
  const f = await setup();
  const wrong = f.bytes.slice();
  wrong[20] ^= 255;
  f.setDownload(wrong);
  await rejects(() => resolve(f.input(), f.ports));
});
Deno.test("source view: unrelated old-answer epoch is not whole-answer currentness", async () => {
  const f = await setup();
  f.setHook((name, _params, raw) => {
    if (name === "ecos_list_linked_owner_project_document_inventory") {
      raw.epoch_sha256 = "d".repeat(64);
    }
    if (name === "ecos_resolve_linked_owner_project_document_indexes") {
      raw.inventory_epoch_sha256 = "d".repeat(64);
      raw.index_epoch_sha256 = "e".repeat(64);
    }
    return raw;
  });
  const result = await resolve(f.input(), f.ports);
  assert(
    result.state === "current_exact_page_image" &&
      !result.whole_answer_verified,
  );
  assert(
    result.inventory_epoch_sha256 === "d".repeat(64) &&
      result.index_epoch_sha256 === "e".repeat(64),
  );
});
Deno.test("source view: new raster receipt same page is allowed for text only, never replaces cited visual receipt", async () => {
  const f = await setup(),
    receipt = JSON.parse(f.rasterWire.receipt_json),
    attestation = JSON.parse(receipt.attestation_json);
  const previous = attestation.upload_attempt_id;
  attestation.upload_attempt_id = id(701);
  attestation.expected_previous_upload_attempt_id = previous;
  attestation.object_key = attestation.object_key.replace(previous, id(701));
  receipt.version = 2;
  receipt.previous_upload_attempt_id = previous;
  receipt.attestation_json = JSON.stringify(attestation);
  receipt.attestation_sha256 = await hash(receipt.attestation_json);
  f.rasterWire.current_upload_attempt_id = id(701);
  f.rasterWire.receipt_json = JSON.stringify(receipt);
  f.rasterWire.receipt_sha256 = await hash(f.rasterWire.receipt_json);
  const textResult = await resolve(f.input(), f.ports);
  assert(textResult.state === "current_exact_page_image");
  assert(textResult.raster?.upload_attempt_id === id(701));
  assert(
    textResult.image_relation ===
      "current_image_of_exact_cited_checkpoint_not_old_answer_image_proof",
  );
  const visualResult = await resolve(f.input(f.visualCitation), f.ports);
  assert(visualResult.state === "changed" && visualResult.raster === null);
});
Deno.test("source view: missing cited head never fetches a different page", async () => {
  const f = await setup();
  f.setHook((name, _params, raw) => {
    if (name === "ecos_resolve_linked_owner_project_document_indexes") {
      raw.rows[1].head = null;
    }
    return raw;
  });
  const result = await resolve(f.input(), f.ports);
  assert(
    result.state === "unavailable" && result.page === null &&
      result.raster === null,
  );
  assert(
    !f.calls.some((c) =>
      c.name === "download" || c.name === "ecos_read_owner_page_observations"
    ),
  );
});
Deno.test("source view: cancellation after download and late synchronous callback reject without image", async () => {
  const f = await setup(), aborted = new AbortController();
  await rejects(() =>
    resolve(f.input(), {
      ...f.ports,
      download: async () => {
        aborted.abort();
        return f.bytes;
      },
    }, { signal: aborted.signal })
  );
  let dispatched = 0;
  const now = performance.now.bind(performance), start = now();
  let elapsed = 0;
  Object.defineProperty(performance, "now", {
    value: () => start + elapsed,
    configurable: true,
  });
  try {
    const input = new Proxy(f.input(), {
      ownKeys(target) {
        elapsed = 31;
        return Reflect.ownKeys(target);
      },
    });
    await rejects(() =>
      resolve(input, {
        ...f.ports,
        inventoryRPC: async () => {
          dispatched++;
          return f.f.inventoryWire;
        },
      }, { budgetMs: 10 })
    );
    assert(dispatched === 0);
  } finally {
    Object.defineProperty(performance, "now", {
      value: now,
      configurable: true,
    });
  }
});
Deno.test("source view: caller-owned PNG copies and fake result cannot mutate retained proof", async () => {
  const f = await setup(), result = await resolve(f.input(), f.ports);
  const first = copyPNG(result);
  first.fill(0);
  equal([...copyPNG(result)], [...f.bytes]);
  assert(
    Object.isFrozen(result) && Object.isFrozen(result.citation) &&
      Object.isFrozen(result.citation?.locator),
  );
  await rejects(() => copyPNG({ ...result }));
});
Deno.test("source view: lower-only deadline/pre-cancel and noncooperative RPC are fail closed", async () => {
  const f = await setup();
  for (const budgetMs of [0, 120001, NaN, true, null]) {
    await rejects(() =>
      resolve(f.input(), f.ports, { budgetMs: budgetMs as number })
    );
  }
  const abort = new AbortController();
  abort.abort();
  await rejects(() => resolve(f.input(), f.ports, { signal: abort.signal }));
  equal(f.calls, []);
  let dispatched = 0, received: AbortSignal | undefined;
  await rejects(() =>
    resolve(f.input(), {
      ...f.ports,
      inventoryRPC: (_n, _p, s) => {
        dispatched++;
        received = s;
        return new Promise(() => {});
      },
    }, { budgetMs: 10 })
  );
  assert(dispatched === 1 && received?.aborted);
});
Deno.test("source view: source-view image copy rejects forged or mixed inventory origin", async () => {
  const f = await setup();
  const images = await loadECOSOwnerRasterImages(
    f.f.inventory,
    f.indexes,
    f.selected.pages,
    f.ports.rasterRPC,
    f.ports.indexRPC,
    f.ports.download,
    { signal: new AbortController().signal },
  );
  const copy = copyECOSOwnerRasterImageForSourceView(
    images,
    f.f.inventory,
    f.indexes,
    f.selected.pages[0],
  );
  equal([...copy.pngBytes], [...f.bytes]);
  await rejects(() =>
    copyECOSOwnerRasterImageForSourceView(
      { ...images },
      f.f.inventory,
      f.indexes,
      f.selected.pages[0],
    )
  );
  await rejects(() =>
    copyECOSOwnerRasterImageForSourceView(
      images,
      { ...f.f.inventory },
      f.indexes,
      f.selected.pages[0],
    )
  );
});
