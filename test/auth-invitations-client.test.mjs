import assert from 'node:assert/strict';
import test from 'node:test';

const [authModule, invitationsModule] = await Promise.all([
  import('../src/auth.js').catch(() => ({})),
  import('../src/invitations.js').catch(() => ({})),
]);

test('Google sign-in uses the TáPago callback URL', async () => {
  assert.equal(typeof authModule.signInWithGoogle, 'function');
  const calls = [];
  const client = {
    auth: {
      signInWithOAuth: async (options) => { calls.push(options); return { data: {}, error: null }; },
    },
  };
  await authModule.signInWithGoogle(client, 'https://saiunodf.com');
  assert.deepEqual(calls, [{
    provider: 'google',
    options: {
      redirectTo: 'https://saiunodf.com/tapago/',
      queryParams: { prompt: 'select_account' },
    },
  }]);
});

test('invitation links keep the secret token in a removable fragment', async () => {
  assert.equal(typeof invitationsModule.createInviteToken, 'function');
  assert.equal(typeof invitationsModule.hashInviteToken, 'function');
  assert.equal(typeof invitationsModule.buildInvitationUrl, 'function');

  const first = invitationsModule.createInviteToken();
  const second = invitationsModule.createInviteToken();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(await invitationsModule.hashInviteToken('0'.repeat(64)), '60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55');
  const link = new URL(invitationsModule.buildInvitationUrl(first, 'https://saiunodf.com'));
  assert.equal(link.pathname, '/tapago/');
  assert.equal(link.hash, `#convite=${first}`);
});

test('invitation service stores only a token hash and accepts/revokes through secure RPCs', async () => {
  assert.equal(typeof invitationsModule.createInvitationService, 'function');
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'create_group_invitation') return { data: [{ id: 'invite-id', expires_at: '2026-10-21T12:00:00Z' }], error: null };
      return { data: true, error: null };
    },
  };
  const service = invitationsModule.createInvitationService(client, {
    origin: 'https://saiunodf.com',
    tokenFactory: () => '0'.repeat(64),
  });
  const created = await service.createInvitation('group-id', 'ana@example.test', 'participant-id');
  assert.deepEqual(calls[0], {
    name: 'create_group_invitation',
    args: {
      p_group_id: 'group-id',
      p_participant_id: 'participant-id',
      p_invited_email: 'ana@example.test',
      p_token_hash: '60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55',
    },
  });
  assert.equal(new URL(created.inviteUrl).hash, `#convite=${'0'.repeat(64)}`);
  assert.equal(created.expiresAt, '2026-10-21T12:00:00Z');
  await service.acceptInvitation('0'.repeat(64));
  await service.revokeInvitation('invite-id');
  await service.revokeMemberLink('group-id', 'participant-id');
  assert.deepEqual(calls.slice(1).map((call) => call.name), [
    'accept_group_invitation',
    'revoke_group_invitation',
    'revoke_member_link',
  ]);
});
