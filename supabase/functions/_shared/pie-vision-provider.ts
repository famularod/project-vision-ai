import {
  PIE_PHOTO_PAIR_RESPONSE_SCHEMA,
  PIE_PHOTO_PAIR_SCHEMA_VERSION,
  PIE_SINGLE_PHOTO_RESPONSE_SCHEMA,
  PIE_SINGLE_PHOTO_SCHEMA_VERSION,
} from './pie-photo-comparison-schema.ts';
import { PIE_PHOTO_ANALYSIS_CONTRACT } from './pie-photo-analysis-contract.ts';

export type VisionMode = 'single_photo' | 'photo_pair';
export type ProviderStatus = 'succeeded' | 'degraded' | 'failed' | 'blocked';

export type VisionImageInput = {
  evidenceId: string;
  contentHash: string;
  mimeType: string;
  signedUrl?: string;
  storagePath?: string;
  sizeBytes?: number | null;
  transport: 'signed_url';
};

export type ProviderRunContext = {
  mode: VisionMode;
  organizationId: string;
  projectId: string;
  requestId: string;
  promptVersion: string;
  policyVersion: string;
  timeoutMs: number;
  maxRetries: number;
  projectName: string | null;
  areaName: string | null;
  fieldNotes: string | null;
};

export type ProviderResult = {
  status: ProviderStatus;
  providerName: string | null;
  modelName: string | null;
  modelVersion: string | null;
  normalized: Record<string, unknown> | null;
  rawResponse: Record<string, unknown> | null;
  usage: Record<string, unknown>;
  latencyMs: number;
  attempts: number;
  error: string | null;
};

export interface VisionProvider {
  name: string;
  analyzeSinglePhoto(context: ProviderRunContext, image: VisionImageInput): Promise<ProviderResult>;
  comparePhotoPair(context: ProviderRunContext, baseline: VisionImageInput, current: VisionImageInput): Promise<ProviderResult>;
}

export function buildVisionProvider(): VisionProvider {
  const providerName = Deno.env.get('PIE_VISION_PROVIDER') ?? 'none';
  if (providerName === 'openai') return new OpenAIVisionProvider();
  return new DegradedVisionProvider(providerName);
}

class DegradedVisionProvider implements VisionProvider {
  constructor(public readonly name: string) {}

  async analyzeSinglePhoto(context: ProviderRunContext): Promise<ProviderResult> {
    return degradedResult(context, this.name, 'PIE_VISION_PROVIDER is not configured for raw-pixel analysis');
  }

  async comparePhotoPair(context: ProviderRunContext): Promise<ProviderResult> {
    return degradedResult(context, this.name, 'PIE_VISION_PROVIDER is not configured for raw-pixel comparison');
  }
}

class OpenAIVisionProvider implements VisionProvider {
  readonly name = 'openai';

  async analyzeSinglePhoto(context: ProviderRunContext, image: VisionImageInput): Promise<ProviderResult> {
    return callWithRetries(context, async () => {
      const prompt = [
        'Analyze this construction/project photo as visual evidence only.',
        `Return the strict single-photo JSON schema version ${PIE_SINGLE_PHOTO_SCHEMA_VERSION}. Do not return markdown.`,
        `Contract ${PIE_PHOTO_ANALYSIS_CONTRACT.contractVersion}. Prompt ${context.promptVersion}.`,
        'Always include limitations as an array. Use [] only when no material limitation applies.',
        'Do not claim hidden work, compliance, causation, blame, inspection outcome, or exact percentage.',
        buildContextLine(context),
        `Evidence ID: ${image.evidenceId}. Content hash: ${image.contentHash}. Policy: ${context.policyVersion}.`,
      ].join('\n');
      return callOpenAI(context, [{ image, prompt }]);
    });
  }

  async comparePhotoPair(context: ProviderRunContext, baseline: VisionImageInput, current: VisionImageInput): Promise<ProviderResult> {
    return callWithRetries(context, async () => {
      const prompt = [
        'Compare these two project photos using raw pixels. The first image is the baseline; the second is current.',
        `Return the strict paired-photo JSON schema version ${PIE_PHOTO_PAIR_SCHEMA_VERSION}. Do not return markdown.`,
        `Contract ${PIE_PHOTO_ANALYSIS_CONTRACT.contractVersion}. Prompt ${context.promptVersion}.`,
        'Always include limitations as an array. Use [] when no material limitation applies; otherwise list each concrete limitation.',
        'Inventory the baseline and current image independently, then reconcile shared, added, removed, moved, occluding, revealed, material-change, concern, and uncertain findings.',
        'Each finding must use the structured finding schema. Observations must contain only directly visible evidence. Interpretations must remain separate and qualified.',
        'For every object addition/removal, defect, safety concern, installed equipment, material change, damage, obstruction, or work-area finding, include the raw visible object/change name and a concrete location phrase when visible.',
        'Location phrases should describe image position, nearby subject, and surface/area when visible, such as right side of desk, front-right tabletop, beside laptop on right, near the right-hand edge, or lower-right portion of image.',
        'Write plainLanguageSummary as 1-3 full sentences a non-technical construction project manager could read and immediately act on without looking at the photos. State specifically what is different now versus the baseline - material, color, installation state, or condition - not just an object label. Example: "The left wall now has primed white drywall installed where bare wood stud framing was visible in the baseline photo." Not: "Drywall appears."',
        'For every finding description, write a full descriptive phrase, not a single-word label. Include material, color, condition, foreground/background position, and occlusion relationship only when directly visible.',
        'Comparability must be strong, probable, weak, or not_comparable.',
        'Comparability measures whether the shared physical scene or subject can be reliably compared; it does not require identical camera position.',
        'Allow strong when the same subject is highly certain, stable visual anchors align, the relevant change is clearly visible, and viewpoint/framing differences do not materially limit the conclusion.',
        'alignmentConfidence reflects how precisely the baseline and current photos can be spatially aligned to compare the same physical area. Use high when framing, distance, and angle are close enough that shared reference points clearly line up. Use medium when there are minor viewpoint, distance, or framing differences but the same physical area can still be reliably compared. Use low only when viewpoint, distance, or framing differ enough - or too few shared reference points exist - that you cannot confidently confirm you are looking at the same physical location. Do not default to low simply because the two photos are not pixel-identical.',
        'changeDetectionConfidence reflects how confident you are that visible differences represent real physical changes rather than lighting, shadow, exposure, or angle artifacts. Use high when differences are clearly physical and not explained by lighting or angle. Use medium when most differences appear physical but some ambiguity from lighting or angle exists. Use low only when lighting, shadows, exposure, or angle differences make it genuinely hard to tell what changed physically versus what is a capture artifact.',
        'Set lightingComparabilityImpact and obstructionComparabilityImpact independently to none, minor, or limiting. Use none when no relevant difference exists. Use minor when a difference is visible but the relevant physical area remains reliably comparable. Use limiting only when lighting or obstruction materially reduces confidence in comparing the relevant physical area.',
        'Do not mark an impact limiting merely because words such as shadow, glare, occluded, or obstructed describe a visible condition. The impact classification must reflect whether that condition actually limits reliable comparison of the relevant area.',
        'Classify differences as camera_or_capture_change, physical_scene_change, uncertain_change, or mixed_change. Do not treat perspective, distance, framing, exposure, lighting, rotation, or obstruction changes as project progress.',
        'Conclusion must be progress_visible, partial_progress_visible, no_material_visible_change, possible_regression, or unable_to_determine.',
        buildContextLine(context),
        'Visible scene changes are not project progress unless linked to the project/area/field-notes context above. If that context is insufficient to judge scope, say so in limitations rather than guessing.',
        `Baseline evidence: ${baseline.evidenceId} hash ${baseline.contentHash}. Current evidence: ${current.evidenceId} hash ${current.contentHash}. Policy: ${context.policyVersion}.`,
      ].join('\n');
      return callOpenAI(context, [{ image: baseline, prompt }, { image: current, prompt: 'Current image for comparison.' }]);
    });
  }
}

function buildContextLine(context: ProviderRunContext): string {
  return `Project: ${context.projectName || 'unspecified'}. Area: ${context.areaName || 'unspecified'}. Field notes for this update: ${context.fieldNotes || 'none provided'}.`;
}

async function callWithRetries(
  context: ProviderRunContext,
  operation: () => Promise<Omit<ProviderResult, 'attempts'>>,
): Promise<ProviderResult> {
  let last: Omit<ProviderResult, 'attempts'> | null = null;
  for (let attempt = 1; attempt <= Math.max(1, context.maxRetries); attempt += 1) {
    last = await operation();
    if (last.status === 'succeeded' || last.status === 'blocked') {
      return { ...last, attempts: attempt };
    }
  }
  return { ...(last ?? degradedResult(context, 'openai', 'provider did not return')), attempts: context.maxRetries };
}

async function callOpenAI(
  context: ProviderRunContext,
  inputs: Array<{ image: VisionImageInput; prompt: string }>,
): Promise<Omit<ProviderResult, 'attempts'>> {
  const started = Date.now();
  const apiKey = Deno.env.get('PIE_OPENAI_API_KEY');
  const model = Deno.env.get('PIE_OPENAI_VISION_MODEL') ?? 'gpt-4.1-mini';
  if (!apiKey) {
    return degradedResult(context, 'openai', 'PIE_OPENAI_API_KEY is missing');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('provider_timeout'), context.timeoutMs);
  try {
    const content = [];
    for (const input of inputs) {
      content.push({ type: 'input_text', text: input.prompt });
      if (!input.image.signedUrl) {
        return degradedResult(context, 'openai', `missing signed image URL for evidence ${input.image.evidenceId}`);
      }
      content.push({ type: 'input_image', image_url: input.image.signedUrl });
    }
    console.log(JSON.stringify({
      event: 'pie_vision_provider_request_start',
      providerName: 'openai',
      modelName: model,
      mode: context.mode,
      requestId: context.requestId,
      imageTransport: inputs.map(input => input.image.transport),
      sourceImageByteSizes: inputs.map(input => input.image.sizeBytes ?? null),
    }));
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [{ role: 'user', content }],
        text: context.mode === 'photo_pair'
          ? {
              format: {
                type: 'json_schema',
                name: 'pie_photo_pair_comparison',
                strict: true,
                schema: PIE_PHOTO_PAIR_RESPONSE_SCHEMA,
              },
            }
          : {
              format: {
                type: 'json_schema',
                name: 'pie_single_photo_analysis',
                strict: true,
                schema: PIE_SINGLE_PHOTO_RESPONSE_SCHEMA,
              },
            },
      }),
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    console.log(JSON.stringify({
      event: 'pie_vision_provider_request_end',
      providerName: 'openai',
      modelName: model,
      mode: context.mode,
      requestId: context.requestId,
      status: response.ok ? 'ok' : 'http_error',
      httpStatus: response.status,
      latencyMs,
    }));
    if (!response.ok) {
      return {
        status: 'failed',
        providerName: 'openai',
        modelName: model,
        modelVersion: null,
        normalized: null,
        rawResponse: null,
        usage: {},
        latencyMs,
        error: `provider_http_${response.status}`,
      };
    }
    const payload = await response.json();
    const outputText = payload.output_text ?? payload.output?.[0]?.content?.[0]?.text;
    const parsed = typeof outputText === 'string' ? safeJson(outputText) : null;
    return {
      status: parsed ? 'succeeded' : 'failed',
      providerName: 'openai',
      modelName: model,
      modelVersion: payload.model ?? model,
      normalized: parsed,
      rawResponse: payload,
      usage: payload.usage ?? {},
      latencyMs,
      error: parsed ? null : 'provider_response_not_json',
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      status: error instanceof DOMException && error.name === 'AbortError' ? 'failed' : 'degraded',
      providerName: 'openai',
      modelName: model,
      modelVersion: null,
      normalized: null,
      rawResponse: null,
      usage: {},
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function degradedResult(
  context: ProviderRunContext,
  providerName: string | null,
  error: string,
): ProviderResult {
  return {
    status: 'degraded',
    providerName,
    modelName: null,
    modelVersion: null,
    normalized: null,
    rawResponse: null,
    usage: {},
    latencyMs: 0,
    attempts: 1,
    error: `${error}; request=${context.requestId}`,
  };
}

function safeJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
