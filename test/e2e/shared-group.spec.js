import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/tapago/');
  await page.getByRole('button', { name: 'Explorar prévia' }).click();
});

test('shows the approved R$ 440 example and bottom navigation', async ({ page }) => {
  await page.getByRole('button', { name: /Taxa do condomínio/ }).click();
  await expect(page.getByText('7 de 10 pagos')).toBeVisible();
  await expect(page.getByText('R$ 440,00')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Histórico', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gastos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajustes', exact: true })).toBeVisible();
});

test('recalculates totals after an administrator edits a pending amount', async ({ page }) => {
  await page.getByRole('button', { name: /Taxa do condomínio/ }).click();
  await page.getByRole('button', { name: 'Editar valor de Lucas' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor mensal').fill('25,00');
  await dialog.getByRole('button', { name: 'Salvar valor' }).click();
  await expect(page.getByText('R$ 435,00')).toBeVisible();
  await expect(page.getByText('R$ 85,00 pendentes')).toBeVisible();
});

test('admin confirmation updates progress and totals', async ({ page }) => {
  await page.getByRole('button', { name: /Taxa do condomínio/ }).click();
  await page.locator('[data-action="confirm-payment"]').first().click();
  await expect(page.getByText('8 de 10 pagos')).toBeVisible();
  await expect(page.getByText('R$ 380,00 recebidos')).toBeVisible();
});

test('history and personal expenses are reachable from the bottom bar', async ({ page }) => {
  await page.getByRole('button', { name: 'Histórico' }).click();
  await expect(page.getByRole('heading', { name: 'setembro de 2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Gastos' }).click();
  await expect(page.getByRole('heading', { name: 'Meus gastos financeiros' })).toBeVisible();
  await expect(page.getByText('Aluguel')).toBeVisible();
  await expect(page.getByText('O próximo mês cria um novo vencimento pendente.')).toBeVisible();
});

test('first-list flow creates a household finance list in the preview', async ({ page }) => {
  await page.getByRole('button', { name: '＋ Criar novo grupo' }).click();
  await page.getByLabel('Tipo de grupo').selectOption('personal');
  await page.getByLabel('Nome do grupo').fill('Minhas despesas');
  await page.getByRole('button', { name: 'Criar lista' }).click();
  await expect(page.getByRole('heading', { name: 'Minhas despesas' })).toBeVisible();
  await expect(page.getByText('O próximo mês cria um novo vencimento pendente.')).toBeVisible();
});
