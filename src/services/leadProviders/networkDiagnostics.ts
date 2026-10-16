export type NetworkFailureOrigin = 'application_deadline' | 'fetch_rejection' | 'http_response' | 'response_error';

export interface NetworkDiagnosticContext {
  requestId?: string;
}

export interface NetworkRequestDiagnostics {
  providerId: string;
  upstreamHostname: string;
  requestId?: string;
  deploymentSha?: string;
  requestStartedAt: string;
  responseHeadersReceived: boolean;
  responseHeadersElapsedMs?: number;
  httpStatus?: number;
  responseBodyCompletedElapsedMs?: number;
  elapsedMs: number;
  timeoutFired: boolean;
  failureOrigin?: NetworkFailureOrigin;
  failurePhase?:
    | 'request'
    | 'http_status'
    | 'response_body'
    | 'json_parse'
    | 'result_mapping'
    | 'rate_limit_wait';
  errorName?: string;
  errorCode?: string;
  causeCode?: string;
}

const SAFE_ERROR_NAMES = new Set([
  'AbortError',
  'ConnectTimeoutError',
  'DOMException',
  'Error',
  'FetchError',
  'RequestError',
  'SocketError',
  'TimeoutError',
  'TypeError'
]);

const SAFE_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_RESPONSE_STATUS',
  'UND_ERR_SOCKET'
]);

function readErrorProperty(error: unknown, property: 'name' | 'code' | 'cause'): unknown {
  if (!error || typeof error !== 'object') return undefined;
  try {
    return (error as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
}

function safeErrorName(error: unknown): string | undefined {
  const name = readErrorProperty(error, 'name');
  if (typeof name !== 'string') return undefined;
  return SAFE_ERROR_NAMES.has(name) ? name : 'Other';
}

function safeErrorCode(error: unknown): string | undefined {
  const code = readErrorProperty(error, 'code');
  return typeof code === 'string' && SAFE_ERROR_CODES.has(code) ? code : undefined;
}

export function createNetworkRequestDiagnostics(
  providerId: string,
  endpoint: string,
  context: NetworkDiagnosticContext = {},
  requestStartedAt = new Date(),
  startedAtMs = Date.now()
): NetworkRequestDiagnostics {
  let upstreamHostname = 'unknown';
  try {
    upstreamHostname = new URL(endpoint).hostname;
  } catch {
    upstreamHostname = 'invalid-endpoint';
  }

  const requestId = context.requestId;
  const safeRequestId =
    typeof requestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)
      ? requestId
      : undefined;
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const safeDeploymentSha =
    typeof deploymentSha === 'string' && /^[a-fA-F0-9]{7,40}$/.test(deploymentSha)
      ? deploymentSha
      : undefined;

  return {
    providerId,
    upstreamHostname,
    ...(safeRequestId ? { requestId: safeRequestId } : {}),
    ...(safeDeploymentSha ? { deploymentSha: safeDeploymentSha } : {}),
    requestStartedAt: requestStartedAt.toISOString(),
    responseHeadersReceived: false,
    elapsedMs: Math.max(0, Date.now() - startedAtMs),
    timeoutFired: false
  };
}

export function classifyNetworkError(
  error: unknown
): Pick<NetworkRequestDiagnostics, 'errorName' | 'errorCode' | 'causeCode'> {
  const errorName = safeErrorName(error);
  const errorCode = safeErrorCode(error);
  let cause = readErrorProperty(error, 'cause');
  let causeCode: string | undefined;
  for (let depth = 0; depth < 4 && cause; depth++) {
    causeCode = safeErrorCode(cause);
    if (causeCode) break;
    cause = readErrorProperty(cause, 'cause');
  }
  return {
    ...(errorName ? { errorName } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(causeCode ? { causeCode } : {})
  };
}

export function createSanitizedNetworkFailure(
  diagnostics: Partial<NetworkRequestDiagnostics>,
  error: unknown,
  failureOrigin: NetworkFailureOrigin,
  timeoutFired: boolean,
  startedAtMs: number
): Partial<NetworkRequestDiagnostics> {
  return {
    ...diagnostics,
    ...classifyNetworkError(error),
    failureOrigin,
    timeoutFired,
    elapsedMs: Math.max(0, Date.now() - startedAtMs)
  };
}
