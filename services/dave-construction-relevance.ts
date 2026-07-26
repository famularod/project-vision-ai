const BASELINE_OR_SYSTEM_LANGUAGE =
  /first visual baseline|baseline saved|no earlier photo|no prior photo|future comparison|photo captured|photo added for reference|analysis unavailable|unable to determine|no reliable visual change|viewpoint.*changed/i;

const GENERIC_VISUAL_LANGUAGE =
  /\b(?:a |an )?(?:visible|new|newly visible|unidentified) object (?:appears|is visible|was detected)\b/i;

const INCIDENTAL_SCENE_LANGUAGE =
  /\b(?:dog|cat|pet|golden retriever|computer mouse|laptop|keyboard|monitor|desk|table|chair|coffee cup|backpack|personal item)\b/i;

const CONSTRUCTION_LANGUAGE =
  /\b(?:install(?:ed|ing|ation)?|remove(?:d|al|ing)?|demolish(?:ed|ing|ion)?|build(?:ing|t)?|construct(?:ed|ion|ing)?|complete(?:d|ion)?|finish(?:ed|ing)?|start(?:ed|ing)?|progress(?:ed|ing)?|pour(?:ed|ing)?|place(?:d|ment)?|secure(?:d|ing)?|repair(?:ed|ing)?|replace(?:d|ment|ing)?|inspect(?:ed|ion|ing)?|test(?:ed|ing)?|paint(?:ed|ing)?|grade(?:d|ing)?|excavat(?:e|ed|ing|ion)|backfill(?:ed|ing)?|compact(?:ed|ion|ing)?|frame(?:d|ing)?|rough-in|concrete|rebar|formwork|footing|foundation|slab|wall|drywall|stucco|masonry|brick|block|steel|metal mesh|conduit|wire|wiring|electrical|plumbing|mechanical|duct|pipe|drain|roof|ceiling|floor|door|window|canopy|paving|asphalt|curb|sidewalk|trench|utility|equipment|material|scaffold|barricade|guardrail|damage|leak|crack|corrosion|debris|housekeeping|safety|hazard|blocked access|inspection|permit)\b/i;

export function isConstructionRelevantObservation(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, ' ').trim() || '';
  if (!text || BASELINE_OR_SYSTEM_LANGUAGE.test(text)) return false;
  if (CONSTRUCTION_LANGUAGE.test(text)) return true;
  if (GENERIC_VISUAL_LANGUAGE.test(text) || INCIDENTAL_SCENE_LANGUAGE.test(text)) return false;

  return false;
}

export function constructionRelevantObservations(values: readonly string[]) {
  return values.filter(isConstructionRelevantObservation);
}

export function isIncidentalVisualObservation(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, ' ').trim() || '';
  return Boolean(
    text &&
    !CONSTRUCTION_LANGUAGE.test(text) &&
    (GENERIC_VISUAL_LANGUAGE.test(text) || INCIDENTAL_SCENE_LANGUAGE.test(text)),
  );
}
