# ECOS Document Intelligence

Vitruvius Project Intelligence may use uploaded project documents and drawings only after their source identity, searchable content, project scope, and current-revision authority have been verified.

## User workflow

1. Upload a supported source from the desktop Documents workspace.
2. Assign at least one project and choose the correct category.
3. For a drawing, record drawing number, revision, and issue status.
4. Review the indexing result, searchable-page coverage, confidence, and limitations.
5. Stale protected sources re-index automatically. Google Drive sources also re-index automatically while the current Drive authorization remains active; one user authorization resumes the complete eligible batch when Google requires permission again.
6. Use **Make Current for ECOS** only after the record is ready. Vitruvius supersedes only the prior current revision in the same project, category, and revision family.
7. A trusted source displays **Current and ready for ECOS**. A limited source identifies the exact limitation.

The immutable source file remains in protected project storage. Re-indexing never replaces a valid prior index unless the new extraction finishes successfully.

## Supported search formats

- PDF with embedded text
- Scanned PDF pages processed by local OCR, within page limits
- PNG, JPEG, WebP, GIF, BMP, and TIFF images processed by local OCR
- TXT, CSV, TSV, and JSON text files

DWG, DOC/DOCX, XLS/XLSX, and other unlisted formats may be stored but are not represented as searchable in the upload interface. They must be converted to a supported format before ECOS can answer from them.

## Extraction behavior

- Embedded PDF text is indexed page by page with normalized source coordinates.
- Sparse embedded-text pages are supplemented with OCR, and duplicate lines are removed.
- Rotated pages use displayed-page coordinates so proof snippets align with the rendered page.
- Sheet-number detection favors an explicit `Sheet` label and title-block position.
- Dense construction-note blocks receive a focused high-resolution OCR pass, and narrowly recognized inch-mark errors are normalized before indexing.
- Drawing PDFs also receive an authenticated, bounded page-image analysis pass. Only concise visible facts with page coordinates, evidence text, subject, location, and confidence are added to document intelligence version 1.5; the analyzer may not infer facts that are not visible on the page.
- A failed page-image analysis does not erase valid embedded-text or OCR evidence. The page remains searchable with an explicit visual-analysis limitation and is eligible for a later automatic re-index.
- Same-sheet overall feet-and-inches dimensions can produce a deterministic rectangular plan-footprint calculation. The formula and both source dimensions remain part of the proof.
- Source page count, searchable page count, OCR page count, average confidence, extraction method, source hash, and indexed-source hash are retained.
- Large documents are bounded to protect browser and device performance. Any omitted pages are reported as limitations.

## Retrieval behavior

ECOS Core searches only project-matched documents that are current and ready. Retrieval uses normalized terms, construction vocabulary expansion, phrase and coverage scoring, and explicit cross-sheet references. Document evidence can supplement any relevant Talk question; it is not limited to otherwise unknown questions.

ECOS Assurance independently verifies:

- current revision and revision family;
- exact project scope;
- source-hash and index-hash agreement;
- page, sheet, region, and excerpt existence;
- normalized coordinates;
- extraction confidence;
- critical values such as dimensions, quantities, ratings, and clearances;
- independently calculated square footage, including the exact source dimensions and arithmetic;
- whether a drawing proves design intent versus whether field/as-built evidence proves installation;
- citation identity before an answer or proof snippet is shown.

ECOS Core cannot approve its own proposed evidence. If Assurance cannot verify a citation, the evidence is removed. If no verified evidence remains, Vitruvius says it does not have enough current information.

## Shared production index

`ecos_document_pages` and `ecos_document_chunks` hold the owner-scoped searchable representation. Row-level security requires the authorized owner and a matching owner-visible `reference_documents` source. Index replacement is atomic through `ecos_replace_document_index`; search is owner-scoped through `ecos_search_document_chunks`. Large indexes are intentionally excluded from Realtime broadcasts.

The migration must be deployed before the shared index is available. Until then, source upload remains compatible and the compact operational document record continues to synchronize.

## Acceptance checks

A release is ready for field evaluation only when all of the following pass:

- a real PDF produces the expected page and sheet identity;
- the same question and a paraphrase return the current revision only;
- a superseded revision is never cited;
- an unrelated question is refused;
- presence questions such as whether a canopy has lighting require evidence that matches the subject, location, and requested feature; unrelated task or field-update text is refused;
- internal record identifiers never appear in the user-facing answer text;
- every cited excerpt exists verbatim on the cited page or region;
- proof coordinates are within the page and render the expected area;
- partial OCR and low-confidence limitations are visible;
- project and owner isolation tests pass;
- the migration security contract, focused tests, `npm run check`, and the complete release gate pass.
- the Canopy A question returns the calculated `122'-0" × 52'-0" = 6,344 square feet` plan footprint;
- the 2375 North Lot question distinguishes 6-inch PCC paving, 4-inch walkway concrete, and unverified installed thickness.
