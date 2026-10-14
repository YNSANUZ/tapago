import assert from 'node:assert/strict';
import test from 'node:test';

const invitations = await import('../src/invitations.js').catch(() => ({}));

test('invite fragment is removed from the URL and held only for the login session', () => {
  assert.equal(typeof invitations.captureInvitationToken, 'function');
  const token = '9'.repeat(64);
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) || null,
    removeItem: (key) => values.delete(key),
  };
  const replaced = [];
  const captured = invitations.captureInvitationToken(
    { hash: `#convite=${token}`, pathname: '/tapago/', search: '?origem=convite' },
    storage,
    { replaceState: (...args) => replaced.push(args) },
  );
  assert.equal(captured, token);
  assert.deepEqual(replaced, [[null, '', '/tapago/?origem=convite']]);
  assert.equal(values.get('tapago:pending-invitation'), token);
});

test('pending invite token can be consumed only once', () => {
  assert.equal(typeof invitations.takePendingInvitation, 'function');
  const values = new Map([['tapago:pending-invitation', '9'.repeat(64)]]);
  const storage = {
    getItem: (key) => values.get(key) || null,
    removeItem: (key) => values.delete(key),
  };
  assert.equal(invitations.takePendingInvitation(storage), '9'.repeat(64));
  assert.equal(invitations.takePendingInvitation(storage), null);
});
