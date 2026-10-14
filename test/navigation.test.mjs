import assert from 'node:assert/strict';
import test from 'node:test';
import { canConfirmPayments, canManageGroup, canSubmitPaymentNotice, resolveRoute } from '../src/navigation.js';

test('public fee links resolve without authentication and invalid slugs stay on not-found', () => {
  assert.deepEqual(resolveRoute('/tapago/abc123abc123abc123abc123'), { name: 'public', slug: 'abc123abc123abc123abc123' });
  assert.deepEqual(resolveRoute('/tapago/'), { name: 'app' });
  assert.deepEqual(resolveRoute('/tapago/not-a-secret'), { name: 'not-found' });
});

test('administrator and linked participant actions remain separate', () => {
  const admin = { role: 'admin' };
  const member = { role: 'participant', linked_user_id: 'user-id' };
  assert.equal(canManageGroup(admin), true);
  assert.equal(canConfirmPayments(admin), true);
  assert.equal(canSubmitPaymentNotice(admin, 'user-id'), false);
  assert.equal(canManageGroup(member), false);
  assert.equal(canConfirmPayments(member), false);
  assert.equal(canSubmitPaymentNotice(member, 'user-id'), true);
  assert.equal(canSubmitPaymentNotice({ ...member, linked_user_id: null }, 'user-id'), false);
});
