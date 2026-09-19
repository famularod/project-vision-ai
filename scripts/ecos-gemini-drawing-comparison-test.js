const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/ecos-analyze-drawing-page/index.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'scripts/ecos-gemini-drawing-comparison.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const clientFiles = [
  fs.readFileSync(path.join(root, 'App.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, 'services/ECOSDrawingPageAnalysis.ts'), 'utf8'),
].join('\n');

assert(edge.includes("type DrawingVisionProvider = 'openai' | 'gemini'"));
assert(edge.includes("Deno.env.get('ECOS_DRAWING_VISION_PROVIDER')"));
assert(edge.includes("requiredEnv('ECOS_GEMINI_API_KEY')"));
assert(edge.includes('generativelanguage.googleapis.com/v1beta/models/'));
assert(edge.includes("'x-goog-api-key': ecosGeminiKey()"));
assert(edge.includes('responseFormat: {'));
assert(edge.includes("mimeType: 'APPLICATION_JSON'"));
assert(edge.includes('schema: geminiResponseSchema(schema)'));
assert(edge.includes("key === 'maxLength'") && edge.includes("key === 'additionalProperties'"));
assert(edge.includes("event: 'ecos_gemini_schema_fallback'"));
assert(edge.includes("responseMimeType: 'application/json'"));
assert(edge.includes("visionProvider === 'gemini'"));
assert(edge.includes('body.comparisonMode === true'));
assert(edge.includes('extractGeminiOutputText'));
assert(edge.includes('runVisualAssurance'));
assert(edge.includes('visionProvider,'));
assert(edge.includes('drawingAssuranceProvider'));
assert(edge.includes("visionProvider === 'gemini' ? 'openai'"));
assert(edge.includes('drawingCapacityFallbackCandidates'));
assert(edge.includes("'gemini-3.5-flash'"));
assert(edge.includes("'ecos_drawing_page_provider_fallback_completed'"));
assert(edge.includes("reason: 'rate_limited'"));
assert(edge.includes('providerFallback'));
assert(edge.includes('parseECOSStructuredObjectText'));
assert(edge.includes('drawingInvalidOutputFallbackCandidate'));
assert(edge.includes("'ecos_drawing_page_invalid_output_fallback_completed'"));
assert(edge.includes("event: 'ecos_drawing_page_invalid_output_rejected'"));

assert(runner.includes('comparisonMode: true'));
assert(runner.includes("visionProvider: 'gemini'"));
assert(runner.includes("persistenceMode: 'read_only_no_index_writes'"));
assert(!/\.(?:insert|upsert|delete)\s*\(/.test(runner));
assert(!/admin\.from\([\s\S]{0,240}?\)\s*\.update\s*\(/.test(runner));
assert(!runner.includes("rpc('ecos_commit_verified_index_job'"));
assert(runner.includes('A-1.1') && runner.includes('A-1.6') && runner.includes('A-1.13'));

assert(envExample.includes('ECOS_GEMINI_API_KEY'));
assert(envExample.includes('ECOS_GEMINI_DRAWING_FALLBACK_MODEL=gemini-3.5-flash'));
assert(envExample.includes('ECOS_DRAWING_CAPACITY_FALLBACK_PROVIDER=openai'));
assert(!envExample.includes('EXPO_PUBLIC_ECOS_GEMINI_API_KEY'));
assert(!clientFiles.includes('ECOS_GEMINI_API_KEY'));

console.log('PASS: Gemini vision remains server-side and the benchmark cannot write to the production index.');
console.log('PASS: The benchmark checks the three known Architectural hazardous-material evidence sheets.');
