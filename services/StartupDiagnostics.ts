export type StartupDiagnosticStage =
  | 'app_shell_mounted'
  | 'storage_hydration_started'
  | 'storage_hydration_completed'
  | 'storage_record_isolated'
  | 'identity_resolved'
  | 'organization_resolved'
  | 'project_resolved'
  | 'reality_model_loaded'
  | 'executive_judgment_loaded'
  | 'shared_provider_ready'
  | 'project_truth_persisted'
  | 'project_truth_persistence_failed'
  | 'photo_progress_intelligence_persistence_failed'
  | 'cloud_connection_attempted'
  | 'degraded_mode_entered'
  | 'startup_completed'
  | 'startup_failure'
  | 'error_boundary_caught'
  | 'retry_requested';

export type StartupDiagnosticEvent = {
  stage: StartupDiagnosticStage;
  message: string;
  timestamp: string;
  context?: Record<string, string | number | boolean | null>;
};

const startupDiagnosticEvents: StartupDiagnosticEvent[] = [];

export function logStartupDiagnostic(
  stage: StartupDiagnosticStage,
  message: string,
  context: Record<string, string | number | boolean | null> = {},
) {
  const event: StartupDiagnosticEvent = {
    stage,
    message: sanitizeStartupMessage(message),
    timestamp: new Date().toISOString(),
    context: sanitizeStartupContext(context),
  };
  startupDiagnosticEvents.push(event);
  if (startupDiagnosticEvents.length > 120) {
    startupDiagnosticEvents.splice(0, startupDiagnosticEvents.length - 120);
  }
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[startup]', event.stage, event.message, event.context || {});
  }
}

export function getStartupDiagnostics() {
  return [...startupDiagnosticEvents];
}

export function startupErrorMessage(error: unknown) {
  if (error instanceof Error) return sanitizeStartupMessage(error.message);
  if (typeof error === 'string') return sanitizeStartupMessage(error);
  return 'Unknown startup error.';
}

export function sanitizeStartupMessage(value: string) {
  return value
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[token]')
    .slice(0, 240);
}

function sanitizeStartupContext(
  context: Record<string, string | number | boolean | null>,
) {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      typeof value === 'string' ? sanitizeStartupMessage(value) : value,
    ]),
  );
}
