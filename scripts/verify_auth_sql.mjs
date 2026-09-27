import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE service_role;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE TABLE public.user_accounts (
      id UUID PRIMARY KEY, login_id TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL, recovery_code_hash TEXT NOT NULL, status TEXT NOT NULL,
      failed_recovery_attempts INT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ
    );
    CREATE TABLE public.user_sessions (
      token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES public.user_accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ
    );
    CREATE TABLE public.rooms(id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE public.participants(room_id TEXT NOT NULL, user_id TEXT NOT NULL,
      hidden_at TIMESTAMPTZ, PRIMARY KEY(room_id, user_id));
    CREATE TABLE public.room_voter_registrations(room_id TEXT NOT NULL, user_id TEXT NOT NULL,
      hidden_at TIMESTAMPTZ, status TEXT NOT NULL, PRIMARY KEY(room_id, user_id));
  `);
  const migration = await fs.readFile(new URL('../supabase/migrations/20260927142754_atomic_account_recovery_v17.sql', import.meta.url), 'utf8');
  await db.exec(migration);

  const firstId = '00000000-0000-4000-8000-000000000001';
  const secondId = '00000000-0000-4000-8000-000000000002';
  await db.query(`INSERT INTO public.user_accounts
    (id, login_id, password_hash, nickname, recovery_code_hash, status)
    VALUES ($1, 'first', 'old-pass', '첫째', 'old-code', 'ACTIVE'),
           ($2, 'second', 'old-pass', '둘째', 'second-code', 'ACTIVE')`, [firstId, secondId]);
  await db.query(`INSERT INTO public.user_sessions(token_hash, user_id, expires_at)
    VALUES ('old-token', $1, NOW() + INTERVAL '1 day'),
           ('second-token', $2, NOW() + INTERVAL '1 day')`, [firstId, secondId]);

  const params = [['old-code'], 'new-pass', 'new-code', 'new-token', new Date(Date.now() + 86_400_000)];
  const { rows } = await db.query('SELECT public.recover_user_account_with_session_v17($1,$2,$3,$4,$5) AS result', params);
  assert.equal(rows[0].result.loginId, 'first');
  const result = await db.query(`SELECT recovery_code_hash FROM public.user_accounts WHERE id = $1`, [firstId]);
  assert.equal(result.rows[0].recovery_code_hash, 'new-code');
  const sessions = await db.query(`SELECT token_hash FROM public.user_sessions WHERE user_id = $1`, [firstId]);
  assert.deepEqual(sessions.rows.map(row => row.token_hash), ['new-token']);
  await assert.rejects(db.query('SELECT public.recover_user_account_with_session_v17($1,$2,$3,$4,$5)',
    [['old-code'], 'replay-pass', 'replay-code', 'replay-token', new Date(Date.now() + 86_400_000)]));

  await db.exec(`
    CREATE FUNCTION public.reject_session_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated session failure'; END; $$;
    CREATE TRIGGER reject_session_insert BEFORE INSERT ON public.user_sessions
      FOR EACH ROW EXECUTE FUNCTION public.reject_session_insert();
  `);
  await assert.rejects(db.query('SELECT public.recover_user_account_with_session_v17($1,$2,$3,$4,$5)',
    [['second-code'], 'new-pass', 'discarded-code', 'replacement-token', new Date(Date.now() + 86_400_000)]));
  const rolledBack = await db.query(`SELECT account.recovery_code_hash, session.token_hash
    FROM public.user_accounts account JOIN public.user_sessions session ON session.user_id = account.id
    WHERE account.id = $1`, [secondId]);
  assert.deepEqual(rolledBack.rows, [{ recovery_code_hash: 'second-code', token_hash: 'second-token' }]);

  const privileges = await db.query(`SELECT has_function_privilege('anon',
    'public.recover_user_account_with_session_v17(text[],text,text,text,timestamptz)', 'EXECUTE') AS anon,
    has_function_privilege('service_role',
    'public.recover_user_account_with_session_v17(text[],text,text,text,timestamptz)', 'EXECUTE') AS service`);
  assert.deepEqual(privileges.rows[0], { anon: false, service: true });
  await db.exec(`INSERT INTO public.rooms VALUES ('room-test', 'IDEA_SUBMISSION');
    INSERT INTO public.participants(room_id,user_id) VALUES ('room-test','first');`);
  const archive = await db.query(`SELECT public.set_room_archive_v12('room-test', 'first', true) AS result`);
  assert.equal(archive.rows[0].result.archived, true);
  const archived = await db.query(`SELECT hidden_at IS NOT NULL AS archived FROM public.participants WHERE user_id='first'`);
  assert.equal(archived.rows[0].archived, true);
  console.log('PASS: actual PostgreSQL migration, code replay, transaction rollback, RPC privileges and active-room archive');
} finally {
  await db.close();
}
