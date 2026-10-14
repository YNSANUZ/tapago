import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  invited: '22222222-2222-4222-8222-222222222222',
  sameName: '33333333-3333-4333-8333-333333333333',
  group: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  participant: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  expiredParticipant: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  revokedParticipant: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

async function asUser(database, userId) {
  await database.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${userId}', false); SET ROLE authenticated;`);
}

test('individual invitations bind profiles only to verified matching Google email', async (t) => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id uuid primary key,
        email text,
        email_confirmed_at timestamptz,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
    for (const name of readdirSync(migrationsDirectory).filter((entry) => entry.endsWith('.sql')).sort()) {
      await database.exec(readFileSync(path.join(migrationsDirectory, name), 'utf8'));
    }

    await database.exec(`
      INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
        ('${ids.admin}', 'admin@example.test', now(), '{"full_name":"Admin"}'),
        ('${ids.invited}', 'ana@example.test', now(), '{"full_name":"Ana","avatar_url":"https://images.example.test/ana.jpg"}'),
        ('${ids.sameName}', 'wrong@example.test', now(), '{"full_name":"Ana"}');
      INSERT INTO public.groups (id, group_type, name, created_by)
        VALUES ('${ids.group}', 'fee', 'Condomínio', '${ids.admin}');
      INSERT INTO public.group_memberships (group_id, user_id, role)
        VALUES ('${ids.group}', '${ids.admin}', 'admin');
      INSERT INTO public.group_participants (id, group_id, display_name, amount_cents)
        VALUES
          ('${ids.participant}', '${ids.group}', 'Ana', 5000),
          ('${ids.expiredParticipant}', '${ids.group}', 'Bruna', 5000),
          ('${ids.revokedParticipant}', '${ids.group}', 'Caio', 5000);
    `);

    const validHash = 'a'.repeat(64);
    await asUser(database, ids.admin);
    const invitation = await database.query(
      'SELECT * FROM public.create_group_invitation($1, $2, $3, $4)',
      [ids.group, ids.participant, ' Ana@Example.Test ', validHash],
    );
    assert.equal(invitation.rows.length, 1);
    const stored = await database.query('SELECT invited_email, token_hash, expires_at FROM public.invitations WHERE id = $1', [invitation.rows[0].id]);
    assert.equal(stored.rows[0].invited_email, 'ana@example.test');
    assert.equal(stored.rows[0].token_hash, validHash);
    assert.ok(new Date(stored.rows[0].expires_at).getTime() > Date.now());

    await t.test('same display name with a different email cannot claim the invitation', async () => {
      await asUser(database, ids.sameName);
      await assert.rejects(
        database.query('SELECT public.accept_group_invitation($1)', [validHash]),
        (error) => error.code === '22023',
      );
      await database.exec('RESET ROLE');
      const participant = await database.query('SELECT linked_user_id FROM public.group_participants WHERE id = $1', [ids.participant]);
      assert.equal(participant.rows[0].linked_user_id, null);
    });

    await t.test('matching normalized verified email links the existing participant and avatar', async () => {
      await asUser(database, ids.invited);
      const accepted = await database.query('SELECT public.accept_group_invitation($1) AS participant_id', [validHash]);
      assert.deepEqual(accepted.rows, [{ participant_id: ids.participant }]);
      const linked = await database.query('SELECT linked_user_id FROM public.group_participants WHERE id = $1', [ids.participant]);
      const membership = await database.query('SELECT role, active FROM public.group_memberships WHERE group_id = $1 AND user_id = $2', [ids.group, ids.invited]);
      const profile = await database.query('SELECT display_name, avatar_url FROM public.profiles WHERE user_id = $1', [ids.invited]);
      assert.equal(linked.rows[0].linked_user_id, ids.invited);
      assert.deepEqual(membership.rows, [{ role: 'participant', active: true }]);
      assert.deepEqual(profile.rows, [{ display_name: 'Ana', avatar_url: 'https://images.example.test/ana.jpg' }]);
    });

    await t.test('accepted token cannot be replayed and already-linked participant cannot be reinvited', async () => {
      await assert.rejects(
        database.query('SELECT public.accept_group_invitation($1)', [validHash]),
        (error) => error.code === '22023',
      );
      await asUser(database, ids.admin);
      await assert.rejects(
        database.query('SELECT * FROM public.create_group_invitation($1, $2, $3, $4)', [ids.group, ids.participant, 'ana@example.test', 'e'.repeat(64)]),
        (error) => error.code === '22023',
      );
    });

    await t.test('admin can revoke the profile link without deleting prior membership history', async () => {
      await database.query('SELECT public.revoke_member_link($1, $2)', [ids.group, ids.participant]);
      const participant = await database.query('SELECT linked_user_id FROM public.group_participants WHERE id = $1', [ids.participant]);
      const membership = await database.query('SELECT active FROM public.group_memberships WHERE group_id = $1 AND user_id = $2', [ids.group, ids.invited]);
      assert.equal(participant.rows[0].linked_user_id, null);
      assert.deepEqual(membership.rows, [{ active: false }]);
    });

    await t.test('expired, revoked, malformed, and non-admin invitations are rejected', async () => {
      const expiredHash = 'b'.repeat(64);
      const revokedHash = 'c'.repeat(64);
      const expired = await database.query(
        'SELECT * FROM public.create_group_invitation($1, $2, $3, $4)',
        [ids.group, ids.expiredParticipant, 'bruna@example.test', expiredHash],
      );
      await database.exec('RESET ROLE');
      await database.query('UPDATE public.invitations SET expires_at = now() - interval \'1 minute\' WHERE id = $1', [expired.rows[0].id]);
      await asUser(database, ids.admin);
      await database.query(
        'SELECT * FROM public.create_group_invitation($1, $2, $3, $4)',
        [ids.group, ids.revokedParticipant, 'caio@example.test', revokedHash],
      );
      await database.query('SELECT public.revoke_group_invitation(id) FROM public.invitations WHERE token_hash = $1', [revokedHash]);
      await asUser(database, ids.invited);
      await assert.rejects(database.query('SELECT public.accept_group_invitation($1)', [expiredHash]), (error) => error.code === '22023');
      await assert.rejects(database.query('SELECT public.accept_group_invitation($1)', [revokedHash]), (error) => error.code === '22023');
      await asUser(database, ids.admin);
      await assert.rejects(
        database.query('SELECT * FROM public.create_group_invitation($1, $2, $3, $4)', [ids.group, ids.expiredParticipant, 'bruna@example.test', 'not-a-hash']),
        (error) => error.code === '22023',
      );
      await asUser(database, ids.sameName);
      await assert.rejects(
        database.query('SELECT * FROM public.create_group_invitation($1, $2, $3, $4)', [ids.group, ids.expiredParticipant, 'bruna@example.test', 'd'.repeat(64)]),
        (error) => error.code === '42501',
      );
    });
  } finally {
    await database.close();
  }
});
