import { getSupabaseClient } from './supabase-client.js';

const invitationTokenPattern = /^[0-9a-f]{64}$/;
const pendingInvitationKey = 'tapago:pending-invitation';

export function createInviteToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashInviteToken(token) {
  if (!invitationTokenPattern.test(token)) throw new Error('Convite inválido.');
  const bytes = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildInvitationUrl(token, origin = globalThis.location?.origin) {
  if (!invitationTokenPattern.test(token)) throw new Error('Convite inválido.');
  if (!origin) throw new Error('Não foi possível identificar o endereço do TáPago.');
  const inviteUrl = new URL('/tapago/', origin);
  inviteUrl.hash = `convite=${token}`;
  return inviteUrl.toString();
}

export function captureInvitationToken(location = globalThis.location, storage = globalThis.sessionStorage, history = globalThis.history) {
  if (!location || !storage || !history) return null;
  const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('convite');
  if (!token || !invitationTokenPattern.test(token)) return null;
  storage.setItem(pendingInvitationKey, token);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return token;
}

export function takePendingInvitation(storage = globalThis.sessionStorage) {
  const token = storage?.getItem(pendingInvitationKey) || null;
  storage?.removeItem(pendingInvitationKey);
  return token && invitationTokenPattern.test(token) ? token : null;
}

export function createInvitationService(client = null, options = {}) {
  const supabase = client || getSupabaseClient();
  const origin = options.origin || globalThis.location?.origin;
  const tokenFactory = options.tokenFactory || createInviteToken;

  async function callRpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return data;
  }

  return {
    async createInvitation(groupId, email, participantId) {
      const token = tokenFactory();
      const tokenHash = await hashInviteToken(token);
      const result = await callRpc('create_group_invitation', {
        p_group_id: groupId,
        p_participant_id: participantId,
        p_invited_email: email.trim(),
        p_token_hash: tokenHash,
      });
      const invitation = Array.isArray(result) ? result[0] : result;
      if (!invitation?.expires_at) throw new Error('O convite não retornou uma data de validade.');
      return { inviteUrl: buildInvitationUrl(token, origin), expiresAt: invitation.expires_at };
    },

    async acceptInvitation(token) {
      return callRpc('accept_group_invitation', { p_token_hash: await hashInviteToken(token) });
    },

    async revokeInvitation(invitationId) {
      return callRpc('revoke_group_invitation', { p_invitation_id: invitationId });
    },

    async revokeMemberLink(groupId, participantId) {
      return callRpc('revoke_member_link', { p_group_id: groupId, p_participant_id: participantId });
    },
  };
}
