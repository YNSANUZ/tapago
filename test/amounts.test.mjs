import assert from 'node:assert/strict';
import test from 'node:test';

const groups = await import('../src/groups.js').catch(() => ({}));

test('fee totals use centavos for the 7 regular and 3 intern example', () => {
  assert.equal(typeof groups.deriveFeeTotals, 'function');
  const participants = [
    ...Array.from({ length: 7 }, (_, index) => ({ id: `regular-${index}`, amountCents: 5000, paid: true })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `intern-${index}`, amountCents: 3000, paid: false })),
  ];
  assert.deepEqual(groups.deriveFeeTotals(participants), {
    expectedCents: 44000,
    receivedCents: 35000,
    pendingCents: 9000,
    paidCount: 7,
    totalCount: 10,
  });
});

test('money input parses exact cent values and rejects fractions smaller than a cent', () => {
  assert.equal(typeof groups.parseMoneyToCents, 'function');
  assert.equal(groups.parseMoneyToCents('12,34'), 1234);
  assert.equal(groups.parseMoneyToCents('0.99'), 99);
  assert.throws(() => groups.parseMoneyToCents('12,345'), /centavos/);
  assert.throws(() => groups.parseMoneyToCents('-1,00'), /inválido/);
});
