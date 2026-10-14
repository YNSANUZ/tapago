import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');
const ids = { admin: '11111111-1111-4111-8111-111111111111', member: '22222222-2222-4222-8222-222222222222', outside: '33333333-3333-4333-8333-333333333333', group: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', participant: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
async function asUser(db, id) { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`); }

test('fee payments snapshot cents per month and only admins append confirmations', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}'::jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for (const name of readdirSync(migrationsDirectory).filter((entry) => entry.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(migrationsDirectory, name), 'utf8'));
    await db.exec(`INSERT INTO auth.users (id,email,email_confirmed_at) VALUES ('${ids.admin}','admin@example.test',now()),('${ids.member}','member@example.test',now()),('${ids.outside}','outside@example.test',now());
      INSERT INTO public.groups(id,group_type,name,created_by) VALUES ('${ids.group}','fee','Taxa','${ids.admin}');
      INSERT INTO public.group_memberships(group_id,user_id,role) VALUES ('${ids.group}','${ids.admin}','admin'),('${ids.group}','${ids.member}','participant');
      INSERT INTO public.group_participants(id,group_id,display_name,amount_cents,linked_user_id) VALUES ('${ids.participant}','${ids.group}','Bia',5000,'${ids.member}');`);
    await asUser(db, ids.admin);
    await db.query("SELECT public.ensure_contribution_period($1,'2026-10-01')", [ids.group]);
    const first = await db.query("SELECT id FROM public.monthly_contributions WHERE group_id=$1 AND participant_id=$2 AND month_start='2026-10-01'", [ids.group, ids.participant]);
    assert.ok(first.rows[0].id);
    await db.query('SELECT public.update_contribution_amount($1,$2,\'2026-10-01\',5500)', [ids.group, ids.participant]);
    const current = await db.query('SELECT amount_cents FROM public.monthly_contributions WHERE id=$1', [first.rows[0].id]);
    assert.equal(current.rows[0].amount_cents, 5500);
    await asUser(db, ids.member);
    const notice = await db.query("SELECT public.submit_payment_notice($1,'2026-10-01') AS id", [ids.group]);
    assert.ok(notice.rows[0].id);
    const duplicate = await db.query("SELECT public.submit_payment_notice($1,'2026-10-01') AS id", [ids.group]);
    assert.equal(duplicate.rows[0].id, notice.rows[0].id);
    await assert.rejects(db.query('SELECT public.confirm_contribution($1)', [first.rows[0].id]), (error) => error.code === '42501');
    await asUser(db, ids.admin);
    await db.query('SELECT public.resolve_payment_notice($1,\'confirmed\')', [notice.rows[0].id]);
    const events = await db.query('SELECT amount_cents,actor_id,event_type FROM public.payment_events WHERE contribution_id=$1', [first.rows[0].id]);
    assert.deepEqual(events.rows, [{ amount_cents: 5500, actor_id: ids.admin, event_type: 'confirmed' }]);
    await db.query('SELECT public.update_contribution_amount($1,$2,\'2026-11-01\',6000)', [ids.group, ids.participant]);
    const futureAmount = await db.query("SELECT amount_cents FROM public.participant_amount_versions WHERE participant_id=$1 AND effective_month='2026-11-01'", [ids.participant]);
    assert.equal(futureAmount.rows[0].amount_cents, 6000);
    const history = await db.query('SELECT amount_cents,paid_at,confirmed_by FROM public.monthly_contributions WHERE id=$1', [first.rows[0].id]);
    assert.equal(history.rows[0].amount_cents, 5500);
    assert.ok(history.rows[0].paid_at);
    await assert.rejects(db.query('DELETE FROM public.payment_events'), (error) => error.code === '42501');
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO public.group_participants(id,group_id,display_name,amount_cents) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',$1,'Duda',5000)", [ids.group]);
    await db.query("SELECT public.ensure_contribution_period($1,'2026-10-01')", [ids.group]);
    const direct = await db.query("SELECT id FROM public.monthly_contributions WHERE participant_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND month_start='2026-10-01'");
    await db.query('SELECT public.confirm_contribution($1)', [direct.rows[0].id]);
    const directStatus = await db.query('SELECT paid_at,confirmed_by FROM public.monthly_contributions WHERE id=$1', [direct.rows[0].id]);
    assert.ok(directStatus.rows[0].paid_at);
    assert.equal(directStatus.rows[0].confirmed_by, ids.admin);
    await t.test('outsider cannot ensure or inspect a group period', async () => {
      await asUser(db, ids.outside);
      await assert.rejects(db.query("SELECT public.ensure_contribution_period($1,'2026-12-01')", [ids.group]), (error) => error.code === '42501');
      assert.deepEqual((await db.query('SELECT id FROM public.monthly_contributions')).rows, []);
    });
  } finally { await db.close(); }
});
