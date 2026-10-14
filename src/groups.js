import { getSupabaseClient } from './supabase-client.js';

export function deriveFeeTotals(participants = []) {
  const totals = participants.reduce((result, participant) => {
    const cents = Number(participant.amountCents ?? participant.amount_cents ?? 0);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Valor em centavos inválido.');
    result.expectedCents += cents;
    result.totalCount += 1;
    if (participant.paid ?? Boolean(participant.paid_at)) {
      result.receivedCents += cents;
      result.paidCount += 1;
    } else result.pendingCents += cents;
    return result;
  }, { expectedCents: 0, receivedCents: 0, pendingCents: 0, paidCount: 0, totalCount: 0 });
  return totals;
}

export function parseMoneyToCents(input) {
  const value = String(input).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(value)) {
    if (/^\d+[,.]\d{3,}$/.test(value)) throw new Error('Informe no máximo dois dígitos de centavos.');
    throw new Error('Valor monetário inválido.');
  }
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Valor monetário inválido.');
  return cents;
}

export function createGroupService(client = getSupabaseClient()) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  return {
    async listMyGroups() {
      const { data, error } = await client.from('group_memberships').select('role,group_id,groups(id,group_type,name,description,due_day,pix_key)').eq('active', true);
      if (error) throw error;
      return (data || []).map(({ groups, role }) => ({ ...groups, role }));
    },
    async getGroup(groupId, monthStart) {
      const [groupResult, participantResult, contributionResult, noticeResult] = await Promise.all([
        client.from('groups').select('id,group_type,name,description,due_day,pix_key,public_shares(slug,enabled)').eq('id', groupId).single(),
        client.from('group_participants').select('id,display_name,linked_user_id,active').eq('group_id', groupId).eq('active', true).order('created_at'),
        client.rpc('ensure_contribution_period', { p_group_id: groupId, p_month_start: monthStart }),
        client.from('payment_notices').select('id,contribution_id,submitted_by,status,submitted_at,resolved_at,resolved_by').eq('group_id', groupId).order('submitted_at', { ascending: false }),
      ]);
      for (const result of [groupResult, participantResult, contributionResult, noticeResult]) if (result.error) throw result.error;
      const { data: contributions, error: contributionsError } = await client.from('monthly_contributions').select('id,participant_id,month_start,amount_cents,confirmed_amount_cents,paid_at,confirmed_by').eq('group_id', groupId).eq('month_start', monthStart);
      if (contributionsError) throw contributionsError;
      const linkedUsers = (participantResult.data || []).map((row) => row.linked_user_id).filter(Boolean);
      let profilesByUser = new Map();
      if (linkedUsers.length) {
        const { data: profiles, error: profileError } = await client.from('profiles').select('user_id,display_name,avatar_url').in('user_id', linkedUsers);
        if (profileError) throw profileError;
        profilesByUser = new Map((profiles || []).map((row) => [row.user_id, row]));
      }
      const contributionByParticipant = new Map((contributions || []).map((row) => [row.participant_id, row]));
      const noticesByContribution = new Map();
      for (const notice of noticeResult.data || []) if (!noticesByContribution.has(notice.contribution_id)) noticesByContribution.set(notice.contribution_id, notice);
      const participants = (participantResult.data || []).map((participant) => {
        const contribution = contributionByParticipant.get(participant.id);
        return { ...participant, profile: participant.linked_user_id ? profilesByUser.get(participant.linked_user_id) || null : null, ...contribution, amountCents: contribution?.amount_cents ?? 0, paid: Boolean(contribution?.paid_at), paymentNotice: contribution ? noticesByContribution.get(contribution.id) || null : null };
      });
      return { group: groupResult.data, participants, totals: deriveFeeTotals(participants), monthStart };
    },
    updateContributionAmount(groupId, participantId, monthStart, amountCents) {
      return rpc('update_contribution_amount', { p_group_id: groupId, p_participant_id: participantId, p_month_start: monthStart, p_amount_cents: amountCents });
    },
    submitPaymentNotice(groupId, monthStart) {
      return rpc('submit_payment_notice', { p_group_id: groupId, p_month_start: monthStart });
    },
    confirmContribution(contributionId) {
      return rpc('confirm_contribution', { p_contribution_id: contributionId });
    },
    resolvePaymentNotice(noticeId, resolution) {
      return rpc('resolve_payment_notice', { p_notice_id: noticeId, p_resolution: resolution });
    },
  };
}
