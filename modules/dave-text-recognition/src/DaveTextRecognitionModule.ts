import { requireOptionalNativeModule } from 'expo';

export type DaveRecognizedText = {
  text: string;
  lines: string[];
  averageConfidence: number;
  regions: DaveExtractedTextRegion[];
};

export type DaveExtractedTextRegion = {
  id: string;
  label: string;
  text: string;
  areaNames: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  source: 'embedded_text' | 'ocr';
};

type DaveTextRecognitionNativeModule = {
  recognizeText(imageUri: string): Promise<DaveRecognizedText>;
};

function getNativeModule() {
  return requireOptionalNativeModule<DaveTextRecognitionNativeModule>(
    'DaveTextRecognition',
  );
}

export function isDaveTextRecognitionAvailable() {
  return Boolean(getNativeModule()?.recognizeText);
}

export async function recognizeTextFromImage(imageUri: string) {
  const nativeModule = getNativeModule();

  if (!nativeModule) {
    throw new Error('DAVE text recognition is not included in this app build.');
  }

  return nativeModule.recognizeText(imageUri);
}
