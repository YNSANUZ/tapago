import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');

test('Postgres RLS limits group data to active members and admins', async (t) => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);

    const migrations = existsSync(migrationsDirectory)
      ? readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort()
      : [];
    assert.ok(migrations.some((name) => name.startsWith('0001_core')), 'core group schema and RLS migration must exist');
    for (const migration of migrations) {
      await database.exec(readFileSync(path.join(migrationsDirectory, migration), 'utf8'));
    }

    const admin = '11111111-1111-4111-8111-111111111111';
    const member = '22222222-2222-4222-8222-222222222222';
    const outsider = '33333333-3333-4333-8333-333333333333';
    const group = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await database.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('${admin}', 'admin@example.test', '{"full_name":"Admin"}'),
        ('${member}', 'member@example.test', '{"full_name":"Membro"}'),
        ('${outsider}', 'outside@example.test', '{"full_name":"Fora"}');
      INSERT INTO groups (id, group_type, name, created_by) VALUES
        ('${group}', 'fee', 'Taxa de teste', '${admin}');
      INSERT INTO group_memberships (group_id, user_id, role, active) VALUES
        ('${group}', '${admin}', 'admin', true), ('${group}', '${member}', 'participant', true);
      INSERT INTO group_participants (id, group_id, display_name, amount_cents, linked_user_id) VALUES
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${group}', 'Membro', 5000, '${member}');
    `);

    await t.test('active member can read their group and its participant rows', async () => {
      await database.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${member}', false); SET ROLE authenticated;`);
      const groups = await database.query('SELECT name FROM groups');
      const participants = await database.query('SELECT display_name FROM group_participants');
      assert.deepEqual(groups.rows, [{ name: 'Taxa de teste' }]);
      assert.deepEqual(participants.rows, [{ display_name: 'Membro' }]);
    });

    await t.test('administrator can update group settings', async () => {
      await database.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${admin}', false); SET ROLE authenticated;`);
      const update = await database.query("UPDATE groups SET name = 'Taxa atualizada' RETURNING name");
      assert.deepEqual(update.rows, [{ name: 'Taxa atualizada' }]);
    });

    await t.test('new group creation adds the creator as administrator atomically', async () => {
      const created = await database.query("SELECT public.create_group('fee', 'Nova taxa', '', 10::smallint, null) AS id");
      const membership = await database.query("SELECT role FROM group_memberships WHERE group_id = $1 AND user_id = $2", [created.rows[0].id, admin]);
      assert.deepEqual(membership.rows, [{ role: 'admin' }]);
    });

    await t.test('admin cannot directly link a participant without a verified invitation', async () => {
      await assert.rejects(
        database.query('UPDATE group_participants SET linked_user_id = $1 WHERE id = $2', [outsider, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']),
        (error) => error.code === '42501',
      );
    });

    await t.test('admin cannot directly grant group membership without invitation acceptance', async () => {
      await assert.rejects(
        database.query('INSERT INTO group_memberships (group_id, user_id, role) VALUES ($1, $2, $3)', [group, outsider, 'participant']),
        (error) => error.code === '42501',
      );
    });

    await t.test('non-member cannot read or update the group', async () => {
      await database.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${outsider}', false); SET ROLE authenticated;`);
      const groups = await database.query('SELECT id FROM groups');
      const update = await database.query("UPDATE groups SET name = 'Invadido' RETURNING id");
      assert.deepEqual(groups.rows, []);
      assert.deepEqual(update.rows, []);
    });

    await t.test('participant cannot edit group settings', async () => {
      await database.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${member}', false); SET ROLE authenticated;`);
      const update = await database.query("UPDATE groups SET name = 'Alterado' RETURNING id");
      assert.deepEqual(update.rows, []);
    });

    await t.test('anonymous visitor cannot read private group rows', async () => {
      await database.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE anon;");
      await assert.rejects(database.query('SELECT id FROM groups'), (error) => error.code === '42501');
    });
  } finally {
    await database.close();
  }
});
