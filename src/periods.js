import { getSupabaseClient } from './supabase-client.js';

export function formatMonthStart(value) {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || String(value).slice(-2) !== '01') throw new Error('O período deve começar no primeiro dia do mês.');
  return String(value);
}

export function clampDueDay(year, monthOneBased, dueDay) {
  if (!Number.isInteger(year) || !Number.isInteger(monthOneBased) || monthOneBased < 1 || monthOneBased > 12 || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('Data de vencimento inválida.');
  const lastDay = new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
  return `${year}-${String(monthOneBased).padStart(2, '0')}-${String(Math.min(dueDay, lastDay)).padStart(2, '0')}`;
}

export function createPeriodsService(client = getSupabaseClient()) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  return {
    ensureCurrentExpenseOccurrences(groupId) {
      return rpc('ensure_current_expense_occurrences', { p_group_id: groupId });
    },
    confirmExpenseOccurrence(occurrenceId) {
      return rpc('confirm_expense_occurrence', { p_occurrence_id: occurrenceId });
    },
    async getMonthlyHistory(groupId, year) {
      if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('Ano inválido.');
      const start = `${year}-01-01`;
      const end = `${year + 1}-01-01`;
      const { data: contributions, error: contributionError } = await client.from('monthly_contributions')
        .select('id,participant_id,month_start,amount_cents,confirmed_amount_cents,paid_at,confirmed_by,group_participants(display_name)')
        .eq('group_id', groupId).gte('month_start', start).lt('month_start', end).order('month_start', { ascending: false });
      if (contributionError) throw contributionError;
      const contributionIds = (contributions || []).map((row) => row.id);
      let events = [];
      if (contributionIds.length) {
        const { data, error } = await client.from('payment_events').select('id,contribution_id,event_type,amount_cents,occurred_at,actor_id').in('contribution_id', contributionIds).order('occurred_at');
        if (error) throw error;
        events = data || [];
      }
      const actors = [...new Set(events.map((event) => event.actor_id))];
      let profiles = new Map();
      if (actors.length) {
        const { data, error } = await client.from('profiles').select('user_id,display_name,avatar_url').in('user_id', actors);
        if (error) throw error;
        profiles = new Map((data || []).map((profile) => [profile.user_id, profile]));
      }
      const eventsByContribution = new Map();
      for (const event of events) {
        const entry = { ...event, actor: profiles.get(event.actor_id) || null };
        eventsByContribution.set(event.contribution_id, [...(eventsByContribution.get(event.contribution_id) || []), entry]);
      }
      const byMonth = new Map();
      for (const row of contributions || []) {
        const month = row.month_start;
        byMonth.set(month, [...(byMonth.get(month) || []), {
          ...row, participantName: row.group_participants?.display_name || 'Participante', events: eventsByContribution.get(row.id) || [],
        }]);
      }
      return [...byMonth.entries()].map(([monthStart, items]) => ({
        monthStart, items,
        expectedCents: items.reduce((sum, item) => sum + item.amount_cents, 0),
        receivedCents: items.reduce((sum, item) => sum + (item.paid_at ? item.confirmed_amount_cents : 0), 0),
        pendingCents: items.reduce((sum, item) => sum + (item.paid_at ? 0 : item.amount_cents), 0),
      }));
    },
    async getExpenseHistory(groupId) {
      const { data, error } = await client.from('expense_occurrences')
        .select('id,month_start,due_date,amount_cents,status,paid_at,confirmed_by,expense_templates!inner(id,group_id,name)')
        .eq('expense_templates.group_id', groupId).order('month_start', { ascending: false }).order('due_date');
      if (error) throw error;
      return data || [];
    },
  };
}
