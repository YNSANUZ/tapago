import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicGroupUrl, createPublicSummaryService } from '../src/public-summary.js';

test('public link service uses only the aggregate RPC and refresh-only public broadcast', async () => {
  const calls = [];
  let statusCallback;
  let broadcastCallback;
  let removed = false;
  const channel = {
    on(type, filter, callback) { assert.equal(type, 'broadcast'); assert.deepEqual(filter, { event: 'summary_updated' }); broadcastCallback = callback; return this; },
    subscribe(callback) { statusCallback = callback; return this; },
  };
  const client = {
    rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'set_public_share' ? 'a'.repeat(64) : [{ expected_cents: 44000 }], error: null }; },
    channel: (topic, options) => { assert.equal(topic, `tapago-public:${'a'.repeat(64)}`); assert.deepEqual(options, { config: { private: false } }); return channel; },
    removeChannel: async (value) => { assert.equal(value, channel); removed = true; },
  };
  const service = createPublicSummaryService(client, { origin: 'https://saiunodf.com' });
  assert.equal((await service.getPublicSummary('a'.repeat(64))).expected_cents, 44000);
  const share = await service.setPublicShare('group-id', true, false);
  assert.equal(share.url, `https://saiunodf.com/tapago/${'a'.repeat(64)}`);
  assert.equal(calls[0].name, 'get_public_group_summary');
  assert.deepEqual(calls[1], { name: 'set_public_share', args: { p_group_id: 'group-id', p_enabled: true, p_include_pix: false } });
  let changes = 0;
  const states = [];
  const sub = service.subscribe('a'.repeat(64), () => { changes += 1; }, (state) => states.push(state));
  broadcastCallback({ payload: { slug: 'a'.repeat(64) } });
  statusCallback('SUBSCRIBED');
  assert.equal(changes, 1);
  assert.deepEqual(states, ['connected']);
  await sub.unsubscribe();
  assert.equal(removed, true);
  assert.throws(() => buildPublicGroupUrl('internal-id', 'https://saiunodf.com'), /inválido/);
});
