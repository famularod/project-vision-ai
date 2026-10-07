#!/usr/bin/env node

/**
 * A stand-in for the Ask ECOS runtime checkout, for the offline contract
 * tests only (Build 231 E1 item 7). Those tests check HOW release evidence
 * is bound to the checkout ECOS_RUNTIME_REPO names: they need files to hash,
 * not the answering code. They used to read the folder next to this
 * repository (../runtime, the archived runtime), so they failed in any clone
 * without that neighbour, GitHub's runner included. Nothing here is, or
 * describes, the live service.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RUNTIME_CONTRACT_FILES } = require('./ecos-ask-live-acceptance-lib');

const STAND_IN_PACKAGE_SHA256 = '5'.repeat(64);

function write(root, relativePath, contents) {
  fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  fs.writeFileSync(path.join(root, relativePath), contents);
}

/** A temporary folder laid out as the runtime checkout is, pinning STAND_IN_PACKAGE_SHA256. */
function createStandInRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-stand-in-runtime-'));
  for (const relativePath of RUNTIME_CONTRACT_FILES) {
    write(root, relativePath, `// stand-in for ${relativePath}; not the answering code\n`);
  }
  write(
    root,
    RUNTIME_CONTRACT_FILES[0],
    `serveECOSAgentCustomerGateway({\n  expectedPackageSha256: "${STAND_IN_PACKAGE_SHA256}",\n});\n`,
  );
  write(root, 'supabase/functions/_shared/stand-in-rule.ts', 'export const standIn = true;\n');
  return root;
}

/** Points ECOS_RUNTIME_REPO at a new stand-in until restore() is called. */
function useStandInRuntime() {
  const root = createStandInRuntime();
  const previous = process.env.ECOS_RUNTIME_REPO;
  process.env.ECOS_RUNTIME_REPO = root;
  return {
    root,
    restore() {
      if (previous === undefined) delete process.env.ECOS_RUNTIME_REPO;
      else process.env.ECOS_RUNTIME_REPO = previous;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

module.exports = { STAND_IN_PACKAGE_SHA256, createStandInRuntime, useStandInRuntime, writeStandInFile: write };
