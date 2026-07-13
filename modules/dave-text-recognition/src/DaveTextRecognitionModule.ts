import { requireOptionalNativeModule } from 'expo-modules-core';

export type DaveRecognizedText = {
  text: string;
  lines: string[];
  averageConfidence: number;
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
