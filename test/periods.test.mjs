import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { clampDueDay } from '../src/periods.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');
const ids = { admin:'11111111-1111-4111-8111-111111111111', member:'22222222-2222-4222-8222-222222222222', group:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expense:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
async function asUser(db,id) { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`); }

test('expense periods roll over once per month, clamp due dates, and retain snapshots', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb not null default '{}'::jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for (const name of readdirSync(migrationsDirectory).filter((entry)=>entry.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(migrationsDirectory,name),'utf8'));
    await db.exec(`INSERT INTO auth.users(id,email) VALUES ('${ids.admin}','admin@example.test'),('${ids.member}','member@example.test');
      INSERT INTO public.groups(id,group_type,name,created_by) VALUES ('${ids.group}','personal','Meus gastos','${ids.admin}');
      INSERT INTO public.group_memberships(group_id,user_id,role) VALUES ('${ids.group}','${ids.admin}','admin');
      INSERT INTO public.expense_templates(id,group_id,name,amount_cents,due_day) VALUES ('${ids.expense}','${ids.group}','Aluguel',180000,31);`);
    await asUser(db, ids.admin);
    const initial = await db.query('SELECT * FROM public.ensure_current_expense_occurrences($1)', [ids.group]);
    assert.equal(initial.rows.length, 1);
    const [year, month] = dateString(initial.rows[0].month_start).split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    assert.equal(dateString(initial.rows[0].due_date), `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`);
    await db.query('SELECT public.confirm_expense_occurrence($1)', [initial.rows[0].id]);
    const repeated = await db.query('SELECT * FROM public.ensure_current_expense_occurrences($1)', [ids.group]);
    assert.equal(repeated.rows.length, 1);
    assert.equal(repeated.rows[0].id, initial.rows[0].id);
    await db.query('UPDATE public.expense_templates SET amount_cents=190000 WHERE id=$1', [ids.expense]);
    const snapshot = await db.query('SELECT amount_cents,status,paid_at,confirmed_by FROM public.expense_occurrences WHERE id=$1', [initial.rows[0].id]);
    assert.equal(snapshot.rows[0].amount_cents, 180000);
    assert.equal(snapshot.rows[0].status, 'paid');
    assert.ok(snapshot.rows[0].paid_at);
    assert.equal(snapshot.rows[0].confirmed_by, ids.admin);
    await asUser(db, ids.member);
    await assert.rejects(db.query('SELECT public.ensure_current_expense_occurrences($1)',[ids.group]),(error)=>error.code==='42501');
  } finally { await db.close(); }
});

function dateString(value) { return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10); }

test('due days 29–31 clamp to the last day of shorter months', () => {
  assert.equal(clampDueDay(2025, 2, 29), '2025-02-28');
  assert.equal(clampDueDay(2024, 2, 29), '2024-02-29');
  assert.equal(clampDueDay(2025, 4, 31), '2025-04-30');
});
