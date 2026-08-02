import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const LOOPBACK_HOST = '127.0.0.1';
const BRIDGE_ENDPOINTS = new Set([
  'state',
  'sync',
  'history',
  'restore',
  'preview',
  'export',
]);
const BRIDGE_METHODS = Object.freeze({
  state: new Set(['GET', 'PUT']),
  sync: new Set(['POST']),
  history: new Set(['GET', 'POST']),
  restore: new Set(['POST']),
  preview: new Set(['GET', 'POST']),
  export: new Set(['POST']),
});

export class BridgeSecurityError extends Error {
  constructor(code, message, statusCode = 403) {
    super(message);
    this.name = 'BridgeSecurityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function equalSecret(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isLoopbackPeer(address) {
  return address === LOOPBACK_HOST || address === `::ffff:${LOOPBACK_HOST}`;
}

function readCookie(request, name) {
  for (const part of String(request?.headers?.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

export function authorizeBridgeRequest(request, {
  sessionId,
  token,
  trustedOrigin,
  cookieName = 'specline-diagram',
} = {}) {
  if (!isLoopbackPeer(request?.socket?.remoteAddress)) {
    throw new BridgeSecurityError('REMOTE_ACCESS_BLOCKED', 'Bridge accepts loopback peers only');
  }

  const url = new URL(request.url, trustedOrigin);
  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/([^/]+)$/);
  if (!match || !BRIDGE_ENDPOINTS.has(match[2])) {
    throw new BridgeSecurityError('BRIDGE_ROUTE_NOT_FOUND', 'Unknown bridge route', 404);
  }
  if (decodeURIComponent(match[1]) !== sessionId) {
    throw new BridgeSecurityError('SESSION_MISMATCH', 'Bridge session does not match', 403);
  }
  const origin=request.headers.origin;
  if (origin !== trustedOrigin) {
    const trusted=new URL(trustedOrigin);
    const safeGet=request.method==='GET' && !origin && request.headers.host===trusted.host &&
      request.headers['sec-fetch-site']==='same-origin' && ['cors','same-origin'].includes(request.headers['sec-fetch-mode']);
    if (!safeGet) throw new BridgeSecurityError('UNTRUSTED_ORIGIN', 'Bridge origin is not trusted', 403);
  }

  const authorization = request.headers.authorization ?? '';
  const prefix = 'Bearer ';
  const presented = authorization.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : readCookie(request, cookieName);
  if (!presented || !equalSecret(presented, token)) {
    throw new BridgeSecurityError('UNAUTHORIZED', 'Bearer authentication required', 401);
  }
  return Object.freeze({ endpoint: match[2], sessionId });
}

async function readJsonBody(request, maxBodyBytes) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      throw new BridgeSecurityError('BODY_TOO_LARGE', 'Bridge request body is too large', 413);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BridgeSecurityError('INVALID_JSON', 'Bridge request body must be JSON', 400);
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

export async function startBridgeServer({
  sessionId,
  token,
  handlers = {},
  uiHandler,
  maxBodyBytes = 4 * 1024 * 1024,
  createHttpServer = createServer,
} = {}) {
  if (!sessionId || !token) {
    throw new BridgeSecurityError('INVALID_BRIDGE_CONFIG', 'sessionId and token are required', 500);
  }

  let trustedOrigin;
  const bootstrapPath = `/sessions/${encodeURIComponent(sessionId)}/bootstrap/${randomBytes(24).toString('base64url')}`;
  let bootstrapAvailable = true;
  const cookieName = 'specline-diagram';
  const server = createHttpServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, trustedOrigin);
      const sessionUiPrefix = `/sessions/${encodeURIComponent(sessionId)}/`;
      if (request.method === 'GET' && requestUrl.pathname === bootstrapPath) {
        if (!isLoopbackPeer(request.socket.remoteAddress)) throw new BridgeSecurityError('REMOTE_ACCESS_BLOCKED', 'Bootstrap accepts loopback peers only');
        if (!bootstrapAvailable) throw new BridgeSecurityError('BOOTSTRAP_ALREADY_USED', 'Bootstrap capability has already been consumed', 410);
        bootstrapAvailable = false;
        response.writeHead(302, {
          location: `${sessionUiPrefix}`,
          'set-cookie': `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/sessions/${encodeURIComponent(sessionId)}/`,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        });
        response.end();
        return;
      }
      if (
        request.method === 'GET' &&
        typeof uiHandler === 'function' &&
        (requestUrl.pathname.startsWith(sessionUiPrefix) ||
          requestUrl.pathname.startsWith('/assets/'))
      ) {
        if (!isLoopbackPeer(request.socket.remoteAddress)) {
          throw new BridgeSecurityError('REMOTE_ACCESS_BLOCKED', 'UI accepts loopback peers only');
        }
        const asset = await uiHandler({ pathname: requestUrl.pathname, sessionId });
        const body = Buffer.isBuffer(asset?.body) ? asset.body : Buffer.from(asset?.body ?? '');
        const isShell=requestUrl.pathname===sessionUiPrefix;
        const isDocument=(asset?.contentType??'').startsWith('text/html') || /\.html?$/i.test(requestUrl.pathname);
        const isDrawioAsset=requestUrl.pathname.startsWith('/assets/') && requestUrl.pathname!=='/assets/specline-bridge.js';
        const frameAncestors=isShell ? "'none'" : isDocument && isDrawioAsset ? "'self'" : "'none'";
        const csp=isDrawioAsset
          ? `default-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors ${frameAncestors}`
          : `default-src 'self'; connect-src 'self'; frame-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${frameAncestors}`;
        response.writeHead(asset?.statusCode ?? 200, {
          'content-type': asset?.contentType ?? 'application/octet-stream',
          'content-length': body.length,
          'content-security-policy': csp,
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control': 'no-store',
        });
        response.end(body);
        return;
      }
      const route = authorizeBridgeRequest(request, { sessionId, token, trustedOrigin, cookieName });
      if (!BRIDGE_METHODS[route.endpoint].has(request.method)) {
        throw new BridgeSecurityError('METHOD_NOT_ALLOWED', 'Bridge method is not allowed', 405);
      }
      const handler = handlers[route.endpoint];
      if (typeof handler !== 'function') {
        throw new BridgeSecurityError('BRIDGE_ROUTE_NOT_FOUND', 'Bridge route is disabled', 404);
      }
      const body = await readJsonBody(request, maxBodyBytes);
      const result = await handler({
        body,
        method: request.method,
        sessionId,
      });
      sendJson(response, 200, result);
    } catch (error) {
      const statusCode = error instanceof BridgeSecurityError ? error.statusCode :
        error?.code === 'REVISION_CONFLICT' ? 409 :
          error?.code === 'SYNC_TIMEOUT' ? 504 : 500;
      sendJson(response, statusCode, {
        ok: false,
        code: error?.code ?? 'BRIDGE_ERROR',
        message: error instanceof BridgeSecurityError ? error.message : 'Bridge request failed',
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
    await new Promise((resolve) => server.close(resolve));
    throw new BridgeSecurityError(
      'REMOTE_ACCESS_BLOCKED',
      'Bridge did not bind the required IPv4 loopback address',
      500,
    );
  }
  trustedOrigin = `http://${LOOPBACK_HOST}:${address.port}`;

  return Object.freeze({
    host: LOOPBACK_HOST,
    port: address.port,
    origin: trustedOrigin,
    uiUrl: `${trustedOrigin}/sessions/${encodeURIComponent(sessionId)}/`,
    bootstrapUrl: `${trustedOrigin}${bootstrapPath}`, 
    uiReady: typeof uiHandler === 'function',
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  });
}
