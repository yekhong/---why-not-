import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// A shared PostgREST fixture lets two independent app modules behave like two
// serverless instances. It exercises the actual Supabase client and HTTP routes.
process.env.VERCEL = '1';
process.env.SUPABASE_URL = 'http://127.0.0.1:54391';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
const database = { accounts: [], sessions: [], failRevocation: false };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function account(login, code) {
  const salt = crypto.randomBytes(16);
  return {
    id: crypto.randomUUID(), login_id: login,
    password_hash: `scrypt$${salt.toString('base64url')}$${crypto.scryptSync('Auditpass123', salt, 64).toString('base64url')}`,
    nickname: '테스트', recovery_code_hash: hash(code), status: 'ACTIVE',
    failed_recovery_attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
}
const originalCode = 'RC-ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234';
const failureCode = 'RC-DCBA-4321-DCBA-4321-DCBA-4321-DCBA-4321';
database.accounts.push(account('auditshared', originalCode), account('auditfailure', failureCode));
const nativeFetch = globalThis.fetch;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
globalThis.fetch = async (resource, options = {}) => {
  const url = new URL(typeof resource === 'string' ? resource : resource.url);
  if (url.origin !== process.env.SUPABASE_URL) return nativeFetch(resource, options);
  const path = url.pathname;
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(String(options.body)) : {};
  if (path.endsWith('/user_accounts') && method === 'GET') {
    const login = url.searchParams.get('login_id')?.slice(3);
    const codeHashes = url.searchParams.get('recovery_code_hash');
    const matched = database.accounts.filter(row =>
      login ? row.login_id === login : codeHashes ? codeHashes.includes(row.recovery_code_hash) : false
    );
    return json(matched[0] || null);
  }
  if (path.endsWith('/user_accounts') && method === 'PATCH') {
    const row = database.accounts.find(item => item.id === url.searchParams.get('id')?.slice(3));
    if (row) Object.assign(row, body);
    return json([]);
  }
  if (path.endsWith('/user_sessions') && method === 'POST') {
    database.sessions.push(body);
    return json([], 201);
  }
  if (path.endsWith('/user_sessions') && method === 'DELETE') {
    if (database.failRevocation) return json({ message: 'revocation failed', code: 'XX000' }, 500);
    database.sessions = database.sessions.filter(row => row.user_id !== url.searchParams.get('user_id')?.slice(3));
    return json([]);
  }
  if (path.endsWith('/user_sessions') && method === 'GET') {
    const row = database.sessions.find(item => item.token_hash === url.searchParams.get('token_hash')?.slice(3));
    const parent = database.accounts.find(item => item.id === row?.user_id);
    return json(row ? { user_id: row.user_id, expires_at: row.expires_at,
      user_accounts: { login_id: parent.login_id, nickname: parent.nickname, status: parent.status } } : null);
  }
  if (path.endsWith('/rpc/recover_user_account_with_session_v17') && method === 'POST') {
    const row = database.accounts.find(item => body.p_recovery_code_hashes.includes(item.recovery_code_hash));
    if (!row) return json({ message: 'Invalid recovery code', code: 'P0001' }, 400);
    if (database.failRevocation) return json({ message: 'revocation failed', code: 'XX000' }, 500);
    row.password_hash = body.p_new_password_hash;
    row.recovery_code_hash = body.p_new_recovery_code_hash;
    row.failed_recovery_attempts = 0;
    database.sessions = database.sessions.filter(item => item.user_id !== row.id);
    database.sessions.push({ token_hash: body.p_session_token_hash, user_id: row.id,
      expires_at: body.p_session_expires_at });
    return json({ id: row.id, loginId: row.login_id, nickname: row.nickname });
  }
  throw new Error(`Unhandled mock PostgREST request ${method} ${url}`);
};

const appA = (await import('../server.ts?instance=a')).default;
const appB = (await import('../server.ts?instance=b')).default;
const serverA = appA.listen(0, '127.0.0.1');
const serverB = appB.listen(0, '127.0.0.1');
await Promise.all([serverA, serverB].map(server => new Promise(resolve => server.once('listening', resolve))));
const urlA = `http://127.0.0.1:${serverA.address().port}`;
const urlB = `http://127.0.0.1:${serverB.address().port}`;
async function request(base, path, body, cookie) {
  const response = await nativeFetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

try {
  const loginA = await request(urlA, '/api/auth/login', { loginId: 'auditshared', password: 'Auditpass123' });
  const loginB = await request(urlB, '/api/auth/login', { loginId: 'auditshared', password: 'Auditpass123' });
  assert.equal(loginA.status, 200, JSON.stringify(loginA.data));
  assert.equal(loginB.status, 200, JSON.stringify(loginB.data));
  assert.equal((await request(urlA, '/api/auth/session', undefined, loginA.cookie)).status, 200);
  const recovered = await request(urlB, '/api/auth/recover', { recoveryCode: originalCode, newPassword: 'Newpass123' });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
  assert.equal((await request(urlA, '/api/auth/session', undefined, loginA.cookie)).status, 401,
    'another instance must reject a revoked cached session');
  const replay = await request(urlA, '/api/auth/recover', { recoveryCode: originalCode, newPassword: 'Replaypass123' });
  assert.equal(replay.status, 400, 'another instance must reject the stale recovery code');

  const before = database.accounts.find(item => item.login_id === 'auditfailure').recovery_code_hash;
  database.failRevocation = true;
  const failure = await request(urlA, '/api/auth/recover', { recoveryCode: failureCode, newPassword: 'Newpass123' });
  assert.equal(failure.status, 503);
  assert.equal(database.accounts.find(item => item.login_id === 'auditfailure').recovery_code_hash, before,
    'failed session revocation must roll back recovery code rotation');
  console.log('PASS: cross-instance code replay, revoked session and atomic recovery failure');
} finally {
  globalThis.fetch = nativeFetch;
  serverA.close();
  serverB.close();
}
