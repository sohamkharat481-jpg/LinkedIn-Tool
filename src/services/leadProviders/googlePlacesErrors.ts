type JsonRecord = Record<string, unknown>;

export interface GooglePlacesFailureDiagnostics {
  googleError: {
    code?: number;
    status?: string;
    message: string;
    details: unknown[];
  };
  permissionDiagnosis: {
    category: string;
    reason?: string;
    action: string;
    consumerProject?: string;
  };
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const redactString = (value: string, apiKey?: string): string => {
  let sanitized = value;
  if (apiKey) sanitized = sanitized.split(apiKey).join('[REDACTED]');
  return sanitized.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED]').slice(0, 2000);
};

const sanitizeGoogleValue = (value: unknown, apiKey?: string, depth = 0): unknown => {
  if (typeof value === 'string') return redactString(value, apiKey);
  if (Array.isArray(value)) {
    return depth >= 6 ? '[TRUNCATED]' : value.map(item => sanitizeGoogleValue(item, apiKey, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    if (depth >= 6) return '[TRUNCATED]';
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([name]) => !/(^key$|api.?key|authorization|access.?token|secret|credential)/i.test(name))
        .map(([name, child]) => [name, sanitizeGoogleValue(child, apiKey, depth + 1)])
    );
  }
  return value;
};

const getReasons = (details: unknown[]): string[] =>
  details.flatMap(detail => {
    const reason = asRecord(detail).reason;
    return typeof reason === 'string' ? [reason] : [];
  });

const getConsumerProject = (details: unknown[]): string | undefined =>
  details
    .map(detail => asRecord(asRecord(detail).metadata).consumer)
    .find((consumer): consumer is string => typeof consumer === 'string');

export const diagnoseGooglePlacesFailure = (
  responseBody: string,
  httpStatus: number,
  apiKey?: string
): GooglePlacesFailureDiagnostics => {
  let parsedBody: unknown = {};
  try {
    parsedBody = JSON.parse(responseBody);
  } catch {
    parsedBody = {};
  }

  const apiError = asRecord(asRecord(parsedBody).error);
  const details = Array.isArray(apiError.details) ? apiError.details : [];
  const safeError = sanitizeGoogleValue(apiError, apiKey) as JsonRecord;
  const safeDetails = Array.isArray(safeError.details) ? safeError.details : [];
  const status = typeof apiError.status === 'string' ? apiError.status : undefined;
  const message =
    typeof apiError.message === 'string'
      ? redactString(apiError.message, apiKey)
      : `Google Places API returned HTTP ${httpStatus}`;
  const reason = getReasons(details)[0];
  const consumerProject = getConsumerProject(details);

  let category = 'permission_denied_unclassified';
  let action =
    'Google denied this request without a specific reason code. Check the audit record at this request time for places.googleapis.com, including methodName, status details (ErrorInfo reason and metadata.consumer/service), and request identity/caller IP. Do not change key restrictions until the record identifies the cause.';

  switch (reason || status) {
    case 'API_KEY_INVALID':
      category = 'invalid_api_key';
      action = 'Google rejected the key supplied by GOOGLE_MAPS_API_KEY. Replace or correct that Vercel environment value; do not expose it in diagnostics.';
      break;
    case 'API_KEY_SERVICE_BLOCKED':
    case 'API_KEY_IP_ADDRESS_BLOCKED':
    case 'API_KEY_HTTP_REFERRER_BLOCKED':
    case 'API_KEY_ANDROID_APP_BLOCKED':
    case 'API_KEY_IOS_APP_BLOCKED':
      category = 'api_key_restriction';
      action = `Google reports ${reason}; inspect the matching API-key restriction for places.googleapis.com. Keep restrictions enabled and adjust only the specific restriction identified.`;
      break;
    case 'SERVICE_DISABLED':
      category = 'api_not_enabled';
      action = `Google reports that Places API is disabled for consumer ${consumerProject || 'not supplied'}. Enable places.googleapis.com in that exact consumer project.`;
      break;
    case 'BILLING_DISABLED':
      category = 'billing_disabled';
      action = `Google reports billing is disabled for consumer ${consumerProject || 'not supplied'}. Check billing on that project.`;
      break;
    case 'CONSUMER_INVALID':
    case 'CONSUMER_SUSPENDED':
      category = 'google_cloud_project';
      action = `Google reports ${reason} for consumer ${consumerProject || 'not supplied'}. Verify that consumer project is the intended, active Google Cloud project.`;
      break;
    case 'IAM_PERMISSION_DENIED':
    case 'ACCESS_TOKEN_SCOPE_INSUFFICIENT':
      category = 'iam_or_service_permission';
      action = `Google reports ${reason}. Check the named principal and required service permission in the Google Cloud audit record.`;
      break;
    default:
      if (status === 'PERMISSION_DENIED') {
        category = 'permission_denied_unclassified';
      }
  }

  return {
    googleError: {
      ...safeError,
      ...(typeof apiError.code === 'number' ? { code: apiError.code } : {}),
      ...(status ? { status } : {}),
      message,
      details: safeDetails
    },
    permissionDiagnosis: {
      category,
      ...(reason ? { reason } : {}),
      action,
      ...(consumerProject ? { consumerProject: redactString(consumerProject, apiKey) } : {})
    }
  };
};

export class GooglePlacesApiError extends Error {
  readonly httpStatus: number;
  readonly diagnostics: GooglePlacesFailureDiagnostics;

  constructor(httpStatus: number, diagnostics: GooglePlacesFailureDiagnostics, message?: string) {
    super(message || diagnostics.permissionDiagnosis.action);
    this.name = 'GooglePlacesApiError';
    this.httpStatus = httpStatus;
    this.diagnostics = diagnostics;
  }
}
