import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');
const ids = { admin:'11111111-1111-4111-8111-111111111111', member:'22222222-2222-4222-8222-222222222222', outside:'33333333-3333-4333-8333-333333333333', group:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', participant:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
async function asUser(db,id,role='authenticated') { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id||''}',false); SET ROLE ${role};`); }

test('public share exposes only an enabled aggregate and stops after revocation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb not null default '{}'::jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for (const name of readdirSync(migrationsDirectory).filter((entry)=>entry.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(migrationsDirectory,name),'utf8'));
    await db.exec(`INSERT INTO auth.users(id,email) VALUES ('${ids.admin}','admin@example.test'),('${ids.member}','member@example.test');
      INSERT INTO public.groups(id,group_type,name,description,pix_key,created_by) VALUES ('${ids.group}','fee','Taxa da área de lazer','Atualização mensal','pix@example.test','${ids.admin}');
      INSERT INTO public.group_memberships(group_id,user_id,role) VALUES ('${ids.group}','${ids.admin}','admin'),('${ids.group}','${ids.member}','participant');
      INSERT INTO public.group_participants(id,group_id,display_name,amount_cents,linked_user_id) VALUES ('${ids.participant}','${ids.group}','Nome privado',5000,'${ids.member}');`);
    await asUser(db,ids.admin);
    await db.query("SELECT public.ensure_contribution_period($1,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date)",[ids.group]);
    const set = await db.query('SELECT public.set_public_share($1,true,false) AS slug',[ids.group]);
    assert.ok(set.rows[0].slug);
    await asUser(db,null,'anon');
    const summary = await db.query('SELECT * FROM public.get_public_group_summary($1)',[set.rows[0].slug]);
    assert.deepEqual(Object.keys(summary.rows[0]).sort(),['description','due_day','expected_cents','group_name','include_pix','month_start','paid_count','pending_cents','pix_key','received_cents','slug','total_count']);
    assert.equal(summary.rows[0].expected_cents,5000);
    assert.equal(summary.rows[0].pix_key,null);
    assert.equal('participant_id' in summary.rows[0],false);
    await assert.rejects(db.query('SELECT * FROM public.group_participants'),(error)=>error.code==='42501');
    await asUser(db,ids.admin);
    const withPix = await db.query('SELECT public.set_public_share($1,true,true) AS slug',[ids.group]);
    await asUser(db,null,'anon');
    const pixSummary = await db.query('SELECT * FROM public.get_public_group_summary($1)',[withPix.rows[0].slug]);
    assert.equal(pixSummary.rows[0].pix_key,'pix@example.test');
    await asUser(db,ids.admin);
    await db.query('SELECT public.set_public_share($1,false,false)',[ids.group]);
    await asUser(db,null,'anon');
    assert.deepEqual((await db.query('SELECT * FROM public.get_public_group_summary($1)',[withPix.rows[0].slug])).rows,[]);
  } finally { await db.close(); }
});
