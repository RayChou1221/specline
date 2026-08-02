import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeBridgeRequest,
  startBridgeServer,
} from '../../../lib/diagram/http-server.mjs';

test('all bridge endpoint families require token, session, peer, and origin', () => {
  const trustedOrigin = 'http://127.0.0.1:4000';
  for (const endpoint of ['state', 'sync', 'history', 'restore', 'preview', 'export']) {
    const request = {
      url: `/api/sessions/session-a/${endpoint}`,
      headers: { origin: trustedOrigin, authorization: 'Bearer secret-a' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    assert.equal(authorizeBridgeRequest(request, {
      sessionId: 'session-a',
      token: 'secret-a',
      trustedOrigin,
    }).endpoint, endpoint);
  }

  const base = {
    url: '/api/sessions/session-a/state',
    headers: { origin: trustedOrigin, authorization: 'Bearer wrong' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.throws(() => authorizeBridgeRequest(base, {
    sessionId: 'session-a',
    token: 'secret-a',
    trustedOrigin,
  }), { code: 'UNAUTHORIZED' });
  assert.throws(() => authorizeBridgeRequest({
    ...base,
    headers: { origin: 'http://127.0.0.1:4999', authorization: 'Bearer secret-a' },
  }, {
    sessionId: 'session-a',
    token: 'secret-a',
    trustedOrigin,
  }), { code: 'UNTRUSTED_ORIGIN' });
  assert.throws(() => authorizeBridgeRequest({
    ...base,
    url: '/api/sessions/session-b/state',
    headers: { origin: trustedOrigin, authorization: 'Bearer secret-a' },
  }, {
    sessionId: 'session-a',
    token: 'secret-a',
    trustedOrigin,
  }), { code: 'SESSION_MISMATCH' });
  assert.throws(() => authorizeBridgeRequest({
    ...base,
    headers: { origin: trustedOrigin, authorization: 'Bearer secret-a' },
    socket: { remoteAddress: '10.0.0.8' },
  }, {
    sessionId: 'session-a',
    token: 'secret-a',
    trustedOrigin,
  }), { code: 'REMOTE_ACCESS_BLOCKED' });
});


test('cookie-authenticated same-origin GET accepts browser fetch metadata but mutations require Origin', () => {
  const trustedOrigin='http://127.0.0.1:4000';const cookie='specline-diagram=secret-a';
  const safe={url:'/api/sessions/session-a/state',method:'GET',headers:{host:'127.0.0.1:4000',cookie,'sec-fetch-site':'same-origin','sec-fetch-mode':'cors'},socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(authorizeBridgeRequest(safe,{sessionId:'session-a',token:'secret-a',trustedOrigin}).endpoint,'state');
  for(const request of [{...safe,headers:{...safe.headers,host:'127.0.0.1:4001'}},{...safe,headers:{...safe.headers,'sec-fetch-site':'cross-site'}},{...safe,method:'PUT'}])assert.throws(()=>authorizeBridgeRequest(request,{sessionId:'session-a',token:'secret-a',trustedOrigin}),{code:'UNTRUSTED_ORIGIN'});
});

test('HTTP bridge does not return or accept unauthenticated state', async () => {
  const bridge = await startBridgeServer({
    sessionId: 'session-a',
    token: 'secret-a',
    handlers: { state: async () => ({ sessionId: 'session-a', revision: 3, dirty: false }) },
  });
  const endpoint = `${bridge.origin}/api/sessions/session-a/state`;
  const unauthorized = await fetch(endpoint, { headers: { origin: bridge.origin } });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(endpoint, {
    headers: {
      origin: bridge.origin,
      authorization: 'Bearer secret-a',
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sessionId: 'session-a',
    revision: 3,
    dirty: false,
  });
  await bridge.close();
});
