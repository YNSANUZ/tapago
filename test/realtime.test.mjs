import assert from 'node:assert/strict';
import test from 'node:test';

const realtime = await import('../src/realtime.js').catch(() => ({}));

test('group realtime listens only to that group and notifies consumers to reload saved data', async () => {
  assert.equal(typeof realtime.subscribeToGroup, 'function');
  const subscriptions = [];
  let subscribed;
  let removed = false;
  const channel = {
    on(type, filter, callback) {
      subscriptions.push({ type, filter });
      if (filter.table === 'monthly_contributions') callback({ new: { group_id: 'group-a' } });
      return this;
    },
    subscribe(callback) { subscribed = callback; return this; },
  };
  const client = {
    channel: (name) => { assert.equal(name, 'tapago-group:group-a'); return channel; },
    removeChannel: async (candidate) => { assert.equal(candidate, channel); removed = true; },
  };
  let changes = 0;
  let status = '';
  const subscription = realtime.subscribeToGroup(client, 'group-a', () => { changes += 1; }, (value) => { status = value; });
  assert.equal(changes, 1);
  assert.ok(subscriptions.some(({ filter }) => filter.table === 'monthly_contributions' && filter.filter === 'group_id=eq.group-a'));
  assert.ok(subscriptions.some(({ filter }) => filter.table === 'payment_notices' && filter.filter === 'group_id=eq.group-a'));
  subscribed('SUBSCRIBED');
  assert.equal(status, 'connected');
  await subscription.unsubscribe();
  assert.equal(removed, true);
});
