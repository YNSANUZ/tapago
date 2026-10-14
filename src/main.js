import { hasSupabaseConfig, getSupabaseClient } from './supabase-client.js';
import { signInWithGoogle, signOut } from './auth.js';
import { captureInvitationToken, takePendingInvitation, createInvitationService } from './invitations.js';
import { createGroupService, deriveFeeTotals, parseMoneyToCents } from './groups.js';
import { subscribeToGroup } from './realtime.js';
import { clampDueDay, createPeriodsService } from './periods.js';
import { createPublicSummaryService } from './public-summary.js';
import { canConfirmPayments, canManageGroup, canSubmitPaymentNotice, resolveRoute } from './navigation.js';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const monthStart = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
const dateLabel = (value) => {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat('pt-BR').format(date);
};
const monthLabel = (value) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
const cents = (value) => money.format((Number(value) || 0) / 100);
const e = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 10 9-7 9 7M5 9v11h14V9m-9 11v-6h4v6"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8m0-5v5h5m4-1v5l3 2"/></svg>',
  expense: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="m19 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8m1.5 2.1a5 5 0 0 1 3 4.6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m9 18 6-6-6-6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="3"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
};

const demoMode = !hasSupabaseConfig();
const client = demoMode ? null : getSupabaseClient();
const groupsApi = client ? createGroupService(client) : null;
const periodsApi = client ? createPeriodsService(client) : null;
const invitationsApi = client ? createInvitationService(client) : null;
const publicApi = client ? createPublicSummaryService(client) : null;
const regular = ['Bruno', 'Carlos', 'Mariana', 'Rafael', 'Fernanda', 'João', 'Pedro'];
const interns = ['Lucas', 'Ana', 'Gabriel'];
const demoGroups = [
  { id: 'demo-condo', name: 'Taxa do condomínio', group_type: 'fee', description: 'Contribuição mensal para manutenção das áreas comuns.', due_day: 10, pix_key: 'condominio@exemplo.com', role: 'admin' },
  { id: 'demo-work', name: 'Taxa do trabalho', group_type: 'fee', description: 'Contribuição mensal da equipe.', due_day: 25, pix_key: 'equipe@exemplo.com', role: 'participant' },
  { id: 'demo-home', name: 'Contas de casa', group_type: 'household', description: 'Despesas compartilhadas da casa.', role: 'admin' },
  { id: 'demo-expenses', name: 'Meus gastos financeiros', group_type: 'personal', description: 'Acompanhe seus vencimentos mensais.', role: 'admin' },
];
const sampleExpenses = [
  { id: 'rent', name: 'Aluguel', amount_cents: 180000, due_day: 5 },
  { id: 'internet', name: 'Internet', amount_cents: 12000, due_day: 22 },
  { id: 'water', name: 'Água', amount_cents: 9000, due_day: 14 },
  { id: 'energy', name: 'Energia', amount_cents: 21600, due_day: 14 },
  { id: 'credit', name: 'Cartão de crédito', amount_cents: 85000, due_day: 8 },
  { id: 'music', name: 'Spotify', amount_cents: 6600, due_day: 25 },
];
const state = {
  screen: resolveRoute(location.pathname).name,
  publicSlug: resolveRoute(location.pathname).slug || null,
  groups: [], selectedGroupId: null, groupView: null, user: null, profile: null,
  month: monthStart(), year: new Date().getFullYear(), history: [], expenses: [], expenseTemplates: [],
  share: null, realtime: 'connecting', toastTimer: 0, loading: false, demo: demoMode,
  demoPaid: new Set(['Bruno', 'Carlos', 'Mariana', 'Rafael', 'Fernanda', 'João', 'Pedro']), publicLoaded: false, demoExpenses: new Map(),
};
const app = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
let groupSubscription;
let publicSubscription;

function notify(message) {
  window.clearTimeout(state.toastTimer);
  toastNode.textContent = message;
  toastNode.classList.add('show');
  state.toastTimer = window.setTimeout(() => toastNode.classList.remove('show'), 2600);
}
function openDialog(title, body) {
  document.querySelector('.tapago-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'tapago-dialog';
  dialog.innerHTML = `<div class="dialog-head"><h2>${e(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div>${body}`;
  app.append(dialog);
  dialog.addEventListener('cancel', () => dialog.remove(), { once: true });
  dialog.showModal();
}
function closeDialog() { document.querySelector('.tapago-dialog')?.close(); }
function groupTypeLabel(type) { return ({ fee: 'Taxa', household: 'Contas da casa', personal: 'Gastos pessoais', other: 'Outra lista' })[type] || 'Grupo'; }
function topbar(action = 'groups') { return `<header class="topbar"><button class="brand" data-action="${action}" aria-label="Ir para o início">tapago.</button><span class="eyebrow">${state.demo ? 'Prévia sem sincronização' : ''}</span></header>`; }
function formField(name, label, { type = 'text', value = '', required = true, hint = '', min, max } = {}) {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${e(value)}" ${required ? 'required' : ''} ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}>${hint ? `<small class="field-hint">${hint}</small>` : ''}</div>`;
}
function bottomNav(active = 'groups') {
  return `<nav class="bottom-nav" aria-label="Navegação principal">${[
    ['groups', 'Grupos', icons.home], ['history', 'Histórico', icons.history], ['expenses', 'Gastos', icons.expense], ['settings', 'Ajustes', icons.settings],
  ].map(([key, label, svg]) => `<button class="bottom-nav-item ${active === key ? 'active' : ''}" data-action="tab" data-tab="${key}">${svg}<span>${label}</span></button>`).join('')}</nav>`;
}
function shell(content, activeTab = 'groups') { app.innerHTML = `${content}${!state.publicSlug && state.screen !== 'login' ? bottomNav(activeTab) : ''}`; }
function demoGroupData(group) {
  if (group.group_type === 'fee') {
    const all = [...regular.map((name) => ({ id: `r-${name}`, name, amountCents: 5000 })), ...interns.map((name) => ({ id: `i-${name}`, name, amountCents: 3000 }))];
    return { group, participants: all.map((person) => ({ ...person, contributionId: person.id, paid: state.demoPaid.has(person.name), paid_at: state.demoPaid.has(person.name) ? new Date().toISOString() : null, linked_user_id: null, profile: null, paymentNotice: null })), totals: deriveFeeTotals(all.map((person) => ({ ...person, paid: state.demoPaid.has(person.name) }))) };
  }
  return { group };
}
function renderLogin() {
  shell(`${topbar()}<main class="login-wrap"><div class="login-copy"><div class="brand login-brand">tapago.</div><h1>Contas em dia, todo mundo por dentro.</h1><p class="intro">Acompanhe taxas de grupos e seus gastos financeiros em um só lugar.</p><div class="login-actions"><button class="button button-primary button-full" data-action="google">${icons.user} Entrar com Google</button><button class="button button-full" data-action="explore">Explorar prévia</button></div><p class="demo-note">${state.demo ? 'A prévia usa dados fictícios e não salva alterações. O login compartilhado será ativado após conectar o backend.' : 'Entre com Google para ver seus grupos e acompanhar atualizações.'}</p></div></main>`);
}
function renderGroups() {
  const buckets = ['fee', 'household', 'personal', 'other'];
  const rows = buckets.flatMap((type) => {
    const items = state.groups.filter((group) => group.group_type === type);
    return items.map((group) => `<button class="group-row group-row-button" data-action="open-group" data-id="${e(group.id)}"><span class="group-glyph">${type === 'personal' ? icons.expense : type === 'household' ? icons.home : icons.people}</span><span><span class="group-name">${e(group.name)}</span><span class="group-detail">${e(group.role === 'admin' ? 'Administrador' : 'Participante')}${type === 'fee' ? ` · ${cents(group.amount_cents || 5000)}/mês` : ''}</span></span><span class="group-chevron">${icons.chevron}</span></button>`);
  }).join('');
  const firstAccess = state.groups.length === 0 && !state.demo;
  shell(`${topbar()}<main>${state.user ? `<p class="eyebrow">Olá, ${e(state.profile?.display_name || state.user.user_metadata?.full_name || 'bem-vindo')}</p>` : ''}<h1>${firstAccess ? 'Boas-vindas ao TáPago' : 'Meus grupos'}</h1><p class="intro">Taxas e contas compartilhadas, sempre atualizadas.</p><div class="group-list">${rows || '<p class="empty-state">Você ainda não participa de nenhum grupo.</p>'}</div><button class="button button-full add-group-row" data-action="create">＋ ${firstAccess ? 'Criar minha primeira lista' : 'Criar novo grupo'}</button></main>`, 'groups');
}
function renderCreateGroup() {
  shell(`${topbar()}<main><button class="back-link" data-action="groups">‹ Meus grupos</button><h1>Criar novo grupo</h1><p class="intro">Escolha o tipo de lista e convide as pessoas depois.</p><form class="form-stack" id="create-group-form"><div class="field"><label for="group-type">Tipo de grupo</label><select id="group-type" name="group_type"><option value="fee">Taxa compartilhada</option><option value="household">Contas de casa</option><option value="personal">Meus gastos financeiros</option><option value="other">Outra lista</option></select></div>${formField('group-name', 'Nome do grupo')}${formField('group-description', 'Descrição curta', { required: false })}<div id="fee-fields">${formField('due-day', 'Dia de vencimento', { type: 'number', value: '10', min: 1, max: 31 })}${formField('pix-key', 'Chave PIX', { required: false })}</div><p class="form-error" id="form-error"></p><button class="button button-primary" type="submit">Criar lista</button></form></main>`, 'groups');
}
function renderTotals(totals) {
  return `<div class="totals-row"><div><span class="total-label">Previsto</span><strong class="total-value">${cents(totals.expectedCents)}</strong></div><div><span class="total-label">Recebido</span><strong class="total-value tone-paid">${cents(totals.receivedCents)}</strong></div><div><span class="total-label">Pendente</span><strong class="total-value tone-pending">${cents(totals.pendingCents)}</strong></div></div>`;
}
function renderFeeDetail(view) {
  const group = view.group;
  const admin = canManageGroup({ role: group.role });
  const totals = view.totals || deriveFeeTotals(view.participants || []);
  const paidPercent = totals.totalCount ? totals.paidCount / totals.totalCount * 100 : 0;
  const members = (view.participants || []).map((person) => {
    const name = person.display_name || person.name;
    const isPaid = Boolean(person.paid_at || person.paid);
    const photo = person.profile?.avatar_url ? `<img src="${e(person.profile.avatar_url)}" alt="" referrerpolicy="no-referrer">` : icons.user;
    const linked = Boolean(person.linked_user_id || person.linked);
    return `<div class="participant-row"><span class="avatar ${linked && person.profile?.avatar_url ? 'avatar-photo' : ''}">${photo}</span><span><button class="participant-name ${isPaid ? 'tone-paid' : 'tone-pending'}" data-action="${admin ? 'participant' : 'noop'}" data-id="${e(person.id)}">${e(name)}</button>${person.paymentNotice?.status === 'pending' ? '<small class="participant-meta tone-today">Avisou que pagou</small>' : ''}</span>${admin && !isPaid ? `<button class="participant-amount editable ${isPaid ? 'tone-paid' : 'tone-pending'}" data-action="edit-amount" data-id="${e(person.id)}" aria-label="Editar valor de ${e(name)}">${cents(person.amountCents ?? person.amount_cents)}</button>` : `<span class="participant-amount ${isPaid ? 'tone-paid' : 'tone-pending'}">${cents(person.amountCents ?? person.amount_cents)}</span>`}${isPaid ? `<span class="status-mark tone-paid" title="Pago">✓</span>` : admin && person.contributionId ? `<button class="status-mark tone-pending" title="Confirmar pagamento" data-action="confirm-payment" data-id="${e(person.contributionId)}">○</button>` : `<span class="status-dot tone-pending" title="Pendente"></span>`}</div>`;
  }).join('');
  const own = view.participants?.find((person) => person.linked_user_id && person.linked_user_id === state.user?.id);
  const shareLine = admin ? `<div class="divider"></div><button class="history-link" data-action="share">${view.share?.enabled ? 'Copiar link público' : 'Criar link público de acompanhamento'}</button>${view.share?.enabled ? `<button class="text-button" data-action="revoke-share">Revogar link</button>` : ''}` : '';
  const adminRows = view.participants?.filter((person) => person.paymentNotice?.status === 'pending') || [];
  shell(`${topbar()}<main><button class="back-link" data-action="groups">‹ Meus grupos</button><h1>${e(group.name)}</h1>${group.description ? `<p class="group-description">${e(group.description)}</p>` : ''}<p class="due-line">◷ Vencimento: dia ${e(group.due_day || '—')}</p>${group.pix_key ? `<div class="pix-box"><span><small class="pix-caption">Chave PIX</small><span class="pix-value">${e(group.pix_key)}</span></span><button class="button button-quiet" data-action="copy" data-copy="${e(group.pix_key)}">${icons.copy} Copiar</button></div>` : ''}<div class="progress-header"><strong>Progresso do mês</strong><span class="subtle">${totals.paidCount} de ${totals.totalCount} pagos</span></div><div class="progress-track"><div class="progress-fill" style="width:${paidPercent}%"></div></div><div class="progress-ends"><span class="tone-paid">${cents(totals.receivedCents)} recebidos</span><span class="tone-pending">${cents(totals.pendingCents)} pendentes</span></div>${renderTotals(totals)}<div class="section-title"><h2>Participantes</h2><span class="eyebrow">${e(monthLabel(state.month))}</span></div><div class="participant-list">${members || '<p class="empty-state">Adicione participantes para começar.</p>'}</div>${admin ? `<div class="admin-actions"><button class="button button-quiet" data-action="add-participant">＋ Adicionar participante</button>${adminRows.map((person) => `<button class="button button-quiet" data-action="resolve-notice" data-id="${e(person.paymentNotice.id)}">Confirmar ${e(person.display_name || person.name)}</button>`).join('')}</div>` : own && !own.paid_at ? `<div class="member-actions"><button class="button button-primary button-full" data-action="notice">Já paguei</button><small class="subtle">O administrador confirma o pagamento.</small></div>` : ''}<button class="history-link" data-action="history" data-id="${e(group.id)}">${icons.history} Histórico mensal</button>${shareLine}<p class="linked-hint"><span class="avatar">${icons.user}</span> ${state.demo ? 'Dados fictícios para visualização do protótipo.' : `Sincronização: ${e(state.realtime)}`}</p></main>`, 'groups');
}
function expenseStatus(item) {
  if (item.status === 'paid') return ['paid', 'Pago'];
  const today = new Date();
  const due = new Date(`${item.due_date || clampDueDay(today.getFullYear(), today.getMonth() + 1, item.due_day)}T00:00:00`);
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dueKey = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  if (todayKey === dueKey) return ['today', 'Vence hoje'];
  if (todayKey > dueKey) return ['overdue', 'Vencido'];
  return ['pending', 'Pendente'];
}
function renderBills(group) {
  const items = state.expenses;
  const admin = canManageGroup({ role: group.role });
  const rows = items.map((item) => {
    const [tone, label] = expenseStatus(item);
    return `<div class="bill-row"><span class="bill-status tone-${tone}">${tone === 'paid' ? '✓' : tone === 'today' ? '◷' : tone === 'overdue' ? '!' : '●'}</span><span><span class="bill-name">${e(item.name || item.expense_templates?.name)}</span><small class="bill-caption tone-${tone}">${label}${item.due_date ? ` · vence ${dateLabel(item.due_date)}` : ''}</small></span><span class="bill-amount tone-${tone}">${cents(item.amount_cents)}</span>${admin && item.status === 'pending' ? `<button class="text-button" data-action="confirm-expense" data-id="${e(item.id)}">Marcar pago</button>` : ''}</div>`;
  }).join('');
  const footer = admin ? `<div class="bill-footer"><span>O próximo mês cria um novo vencimento pendente.</span><button class="button button-quiet" data-action="add-expense">＋ Adicionar</button></div>` : '<div class="bill-footer">Somente o administrador pode editar e confirmar.</div>';
  return `${topbar()}<main><button class="back-link" data-action="groups">‹ Meus grupos</button><h1>${e(group.name)}</h1><p class="eyebrow">${e(monthLabel(state.month))}</p><div class="divider"></div><div class="bill-list">${rows || '<p class="empty-state">Nenhuma despesa cadastrada.</p>'}</div>${footer}<button class="history-link" data-action="expense-history">Histórico mensal</button>${admin ? '' : ''}</main>`;
}
function renderHistory() {
  const feeGroups = state.groups.filter((group) => group.group_type === 'fee');
  const selected = feeGroups.find((group) => group.id === state.selectedGroupId) || feeGroups[0];
  const months = state.history || [];
  const content = months.map((month) => `<section class="history-month"><div class="section-title"><h2>${e(monthLabel(month.monthStart))}</h2><span class="subtle">${cents(month.receivedCents)} recebidos</span></div>${renderTotals({ expectedCents: month.expectedCents, receivedCents: month.receivedCents, pendingCents: month.pendingCents })}<div class="participant-list">${month.items.map((item) => `<div class="history-entry"><span class="avatar">${icons.user}</span><span><strong>${e(item.participantName)}</strong><small>${item.paid_at ? `Confirmado ${dateLabel(item.paid_at)}${item.events?.[0]?.actor?.display_name ? ` por ${e(item.events[0].actor.display_name)}` : ''}` : 'Pendente'}</small></span><span class="${item.paid_at ? 'tone-paid' : 'tone-pending'}">${cents(item.paid_at ? item.confirmed_amount_cents : item.amount_cents)}</span></div>`).join('')}</div></section>`).join('');
  shell(`${topbar()}<main><h1>Histórico mensal</h1><p class="intro">Valores e confirmações guardados por mês.</p><div class="field"><label for="history-group">Grupo</label><select id="history-group">${feeGroups.map((group) => `<option value="${e(group.id)}" ${selected?.id === group.id ? 'selected' : ''}>${e(group.name)}</option>`).join('')}</select></div><div class="history-year-bar"><button class="history-year-arrow" data-action="year" data-delta="-1">‹</button><strong>${state.year}</strong><button class="history-year-arrow" data-action="year" data-delta="1">›</button></div>${content || '<p class="empty-state">O histórico aparecerá quando houver períodos registrados.</p>'}</main>`, 'history');
}
function renderExpenseHistory() {
  const entries = state.expenses;
  shell(`${topbar()}<main><button class="back-link" data-action="open-group" data-id="${e(state.selectedGroupId)}">‹ Voltar para a lista</button><h1>Histórico mensal</h1>${entries.map((item) => `<div class="history-entry"><span class="avatar">${icons.expense}</span><span><strong>${e(item.expense_templates?.name || item.name)}</strong><small>${e(item.month_start ? monthLabel(item.month_start) : monthLabel(state.month))} · ${item.status === 'paid' ? `pago em ${item.paid_at ? dateLabel(item.paid_at) : 'neste mês'}` : 'pendente'}</small></span><span class="${item.status === 'paid' ? 'tone-paid' : 'tone-pending'}">${cents(item.amount_cents)}</span></div>`).join('') || '<p class="empty-state">Ainda não há meses anteriores.</p>'}</main>`, 'history');
}
function renderSettings() {
  shell(`${topbar()}<main><h1>Configurações</h1><p class="intro">Sua conta e preferências do TáPago.</p><div class="settings-list"><div class="settings-row"><span>Conta Google</span><small>${e(state.user?.email || 'Prévia sem login')}</small></div><div class="settings-row"><span>Sincronização em tempo real</span><small>${e(state.demo ? 'Backend ainda não configurado' : state.realtime)}</small></div><div class="settings-row"><span>Valores</span><small>Centavos · R$</small></div></div>${state.user ? '<button class="button button-danger" data-action="logout">Sair da conta</button>' : '<button class="button" data-action="google">Conectar Google</button>'}<p class="settings-note">${state.demo ? 'Esta prévia usa dados fictícios em memória. Nenhum valor é enviado ou sincronizado.' : 'Somente membros autorizados conseguem ver os detalhes dos grupos.'}</p></main>`, 'settings');
}
function renderPublic(summary) {
  if (!summary) { shell(`${topbar('public-home')}<main class="public-main"><h1>Link indisponível</h1><p class="intro">Este link foi revogado ou não existe.</p></main>`); return; }
  const percent = summary.total_count ? Number(summary.paid_count) / Number(summary.total_count) * 100 : 0;
  shell(`<main class="public-main">${topbar('public-home')}<span class="eyebrow">Visualização pública</span><h1>${e(summary.group_name)}</h1><p class="intro">${e(summary.description || 'Acompanhe a evolução desta contribuição.')}</p><p class="due-line">Vencimento mensal${summary.due_day ? `: dia ${summary.due_day}` : ''}</p>${summary.pix_key ? `<div class="pix-box"><span><small class="pix-caption">Chave PIX</small><span class="pix-value">${e(summary.pix_key)}</span></span><button class="button button-quiet" data-action="copy" data-copy="${e(summary.pix_key)}">${icons.copy} Copiar</button></div>` : ''}<div class="public-live"><span class="public-live-dot"></span><div><strong>Atualização ao vivo</strong><small class="public-connection">${e(state.realtime === 'connected' ? 'Conectado' : 'Atualizado ' + new Date().toLocaleTimeString('pt-BR'))}</small></div></div><div class="progress-header"><strong>Progresso do mês</strong><span class="subtle">${Number(summary.paid_count)} de ${Number(summary.total_count)} pagos</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div><div class="progress-ends"><span class="tone-paid">${cents(summary.received_cents)} recebidos</span><span class="tone-pending">${cents(summary.pending_cents)} pendentes</span></div><div class="public-totals"><div><span>Previsto</span><strong>${cents(summary.expected_cents)}</strong></div><div><span>Recebido</span><strong class="tone-paid">${cents(summary.received_cents)}</strong></div><div><span>Restante</span><strong class="tone-pending">${cents(summary.pending_cents)}</strong></div></div><p class="public-privacy-note">Resumo do grupo. Os nomes e valores individuais ficam visíveis apenas para integrantes.</p></main>`);
}
function render() {
  if (state.publicSlug) { if (state.publicLoaded) renderPublic(state.publicSummary); else shell(`${topbar('public-home')}<main class="public-main"><h1>Carregando…</h1></main>`); return; }
  if (state.screen === 'not-found') return shell(`${topbar('public-home')}<main><h1>Link indisponível</h1><p class="intro">O endereço informado não é válido.</p></main>`);
  if (state.screen === 'login' || (!state.user && !state.demo && state.screen !== 'login')) return renderLogin();
  if (state.screen === 'groups') return renderGroups();
  if (state.screen === 'create') return renderCreateGroup();
  if (state.screen === 'detail') {
    if (!state.groupView) return shell(`${topbar()}<main><p>Carregando grupo…</p></main>`);
    if (state.groupView.group.group_type === 'fee') return renderFeeDetail(state.groupView);
    return shell(renderBills(state.groupView.group), 'expenses');
  }
  if (state.screen === 'history') return renderHistory();
  if (state.screen === 'expense-history') return renderExpenseHistory();
  return renderSettings();
}

async function refreshGroups() {
  if (state.demo) { state.groups = demoGroups; return; }
  if (!state.user) { state.groups = []; return; }
  state.groups = await groupsApi.listMyGroups();
}
async function openGroup(id) {
  state.selectedGroupId = id;
  state.groupView = null;
  state.screen = 'detail';
  if (groupSubscription) await groupSubscription.unsubscribe(); groupSubscription = null;
  render();
  const group = state.groups.find((item) => item.id === id);
  if (!group) return;
  if (state.demo) {
    if (groupTypeFee(group)) state.groupView = demoGroupData(group);
    else {
      if (!state.demoExpenses.has(group.id)) state.demoExpenses.set(group.id, sampleExpenses.map((item, index) => ({ ...item, status: index < 2 ? 'paid' : 'pending', due_date: clampDueDay(new Date().getFullYear(), new Date().getMonth() + 1, item.due_day), id: `${group.id}-${item.id}` })));
      state.expenses = state.demoExpenses.get(group.id);
      state.groupView = { group };
    }
    render();
    return;
  }
  try {
    if (group.group_type === 'fee') {
      state.groupView = await groupsApi.getGroup(id, state.month);
      const { data: shares, error } = await client.from('public_shares').select('slug,enabled,include_pix').eq('group_id', id).maybeSingle();
      if (!error) state.groupView.share = shares;
      groupSubscription = subscribeToGroup(client, id, () => openGroup(id).catch(showError), (status) => { state.realtime = status; render(); });
    } else {
      if (canManageGroup({ role: group.role })) await periodsApi.ensureCurrentExpenseOccurrences(id);
      const [{ data: templates, error: templateError }, { data: occurrences, error: occurrenceError }] = await Promise.all([
        client.from('expense_templates').select('id,name,amount_cents,due_day,active').eq('group_id', id).eq('active', true).order('due_day'),
        client.from('expense_occurrences').select('id,expense_id,month_start,due_date,amount_cents,status,paid_at,confirmed_by').eq('month_start', state.month),
      ]);
      if (templateError) throw templateError;
      if (occurrenceError) throw occurrenceError;
      state.expenseTemplates = templates || [];
      const occurrenceByExpense = new Map((occurrences || []).map((row) => [row.expense_id, row]));
      state.expenses = state.expenseTemplates.map((item) => ({ ...item, ...(occurrenceByExpense.get(item.id) || {}), status: occurrenceByExpense.get(item.id)?.status || 'pending', amount_cents: occurrenceByExpense.get(item.id)?.amount_cents ?? item.amount_cents }));
      state.groupView = { group };
      groupSubscription = subscribeToGroup(client, id, () => openGroup(id).catch(showError), (status) => { state.realtime = status; render(); });
    }
    render();
  } catch (error) { showError(error); }
}
function groupTypeFee(group) { return group.group_type === 'fee'; }
async function showError(error) { console.error(error); notify(error?.message || 'Algo deu errado. Tente novamente.'); }
function go(screen) { state.screen = screen; state.groupView = null; render(); }
async function openHistory(groupId = null) {
  const group = state.groups.find((item) => item.id === groupId) || state.groups.find((item) => item.group_type === 'fee');
  state.selectedGroupId = group?.id || null;
  state.screen = 'history'; state.history = []; render();
  if (state.demo && group) {
    const names = [...regular.map((name) => ({ name, amount_cents: 5000 })), ...interns.map((name) => ({ name, amount_cents: 3000 }))];
    const monthData = [
      { monthStart: `${state.year}-09-01`, paid: ['Bruno', 'Carlos', 'Mariana', 'Fernanda', 'Lucas', 'Ana'] },
      { monthStart: `${state.year}-08-01`, paid: ['Bruno', 'Rafael', 'Fernanda', 'João', 'Lucas'] },
    ];
    state.history = monthData.map(({ monthStart: key, paid }) => {
      const rows = names.map((person) => ({
        participantName: person.name, amount_cents: person.amount_cents,
        confirmed_amount_cents: person.amount_cents,
        paid_at: paid.includes(person.name) ? `${key.slice(0, 7)}-${person.name === 'Bruno' ? '02' : '06'}T12:00:00` : null,
        events: paid.includes(person.name) ? [{ actor: { display_name: 'Mariana' } }] : [],
      }));
      const totals = { expectedCents: rows.reduce((sum, row) => sum + row.amount_cents, 0), receivedCents: rows.filter((row) => row.paid_at).reduce((sum, row) => sum + row.confirmed_amount_cents, 0) };
      return { monthStart: key, items: rows, ...totals, pendingCents: totals.expectedCents - totals.receivedCents };
    });
    render();
  } else if (!state.demo && group) {
    try { state.history = await periodsApi.getMonthlyHistory(group.id, state.year); render(); }
    catch (error) { showError(error); }
  }
}
async function loadPublic() {
  if (state.demo) { state.publicLoaded = true; state.publicSummary = null; render(); return; }
  if (publicSubscription) { await publicSubscription.unsubscribe(); publicSubscription = null; }
  render();
  try {
    state.publicSummary = await publicApi.getPublicSummary(state.publicSlug);
    state.publicLoaded = true;
    render();
    if (state.publicSummary) publicSubscription = publicApi.subscribe(state.publicSlug, async () => {
      state.publicSummary = await publicApi.getPublicSummary(state.publicSlug);
      render();
    }, (status) => { state.realtime = status; render(); });
  } catch (error) { showError(error); }
}
async function initialize() {
  if (state.publicSlug) { await loadPublic(); return; }
  if (state.demo) { state.groups = demoGroups; if (state.screen === 'not-found') { render(); return; } state.screen = 'login'; render(); return; }
  const { data: { session } } = await client.auth.getSession();
  state.user = session?.user || null;
  if (state.user) {
    const { data } = await client.from('profiles').select('display_name,avatar_url').eq('user_id', state.user.id).maybeSingle();
    state.profile = data;
    const token = takePendingInvitation();
    if (token) await invitationsApi.acceptInvitation(token);
    await refreshGroups(); state.screen = 'groups';
  }
  render();
  client.auth.onAuthStateChange((_event, sessionNow) => {
    state.user = sessionNow?.user || null;
    window.setTimeout(async () => {
      if (state.user) { await refreshGroups(); state.screen = 'groups'; }
      else { state.groups = []; state.screen = 'login'; }
      render();
    }, 0);
  });
}

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === 'create-group-form') {
      const data = new FormData(form);
      const type = String(data.get('group_type'));
      if (state.demo) {
        const group = { id: `demo-${crypto.randomUUID()}`, name: String(data.get('group-name')), group_type: type, description: String(data.get('group-description') || ''), due_day: Number(data.get('due-day')) || null, pix_key: String(data.get('pix-key') || ''), role: 'admin' };
        state.groups.push(group); notify('Prévia criada apenas nesta sessão.'); await openGroup(group.id); return;
      }
      const id = await groupsApi.createGroup({ type, name: String(data.get('group-name')), description: String(data.get('group-description') || ''), dueDay: Number(data.get('due-day')) || null, pixKey: String(data.get('pix-key') || '') });
      await refreshGroups(); await openGroup(id); return;
    }
    if (form.id === 'add-participant-form') {
      const data = new FormData(form);
      const name = String(data.get('name'));
      const amountCents = parseMoneyToCents(data.get('amount'));
      if (state.demo) { state.groupView.participants.push({ id: `demo-${crypto.randomUUID()}`, name, amountCents, paid: false }); state.groupView.totals = deriveFeeTotals(state.groupView.participants); notify('Participante incluído na prévia.'); render(); return; }
      await groupsApi.addParticipant(state.selectedGroupId, name, amountCents); await openGroup(state.selectedGroupId); return;
    }
    if (form.id === 'add-expense-form') {
      const data = new FormData(form);
      if (state.demo) { state.expenses.push({ id: crypto.randomUUID(), name: String(data.get('name')), amount_cents: parseMoneyToCents(data.get('amount')), due_day: Number(data.get('due_day')), status: 'pending' }); notify('Despesa incluída nesta prévia.'); render(); return; }
      await groupsApi.addExpenseTemplate(state.selectedGroupId, { name: String(data.get('name')), amountCents: parseMoneyToCents(data.get('amount')), dueDay: Number(data.get('due_day')) }); await openGroup(state.selectedGroupId); return;
    }
    if (form.id === 'invite-form') {
      const data = new FormData(form);
      const invite = await invitationsApi.createInvitation(state.selectedGroupId, String(data.get('email')), form.dataset.participantId);
      await navigator.clipboard.writeText(invite.inviteUrl);
      notify('Convite individual copiado. Envie para o e-mail informado.');
      closeDialog();
      return;
    }
    if (form.id === 'edit-amount-form') {
      const data = new FormData(form);
      const nextCents = parseMoneyToCents(data.get('amount'));
      if (state.demo) {
        const participant = state.groupView.participants.find((person) => person.id === form.dataset.participantId);
        participant.amountCents = nextCents; state.groupView.totals = deriveFeeTotals(state.groupView.participants); notify('Valor atualizado nesta prévia.'); render(); return;
      }
      await groupsApi.updateContributionAmount(state.selectedGroupId, form.dataset.participantId, state.month, nextCents);
      await openGroup(state.selectedGroupId); return;
    }
    if (form.id === 'revoke-link-form') {
      await invitationsApi.revokeMemberLink(state.selectedGroupId, form.dataset.participantId);
      await openGroup(state.selectedGroupId); return;
    }
  } catch (error) { const target = form.querySelector('.form-error'); if (target) target.textContent = error.message; else showError(error); }
});

app.addEventListener('change', async (event) => {
  if (event.target.id === 'group-type') {
    const fee = app.querySelector('#fee-fields');
    if (fee) { fee.hidden = !['fee', 'household'].includes(event.target.value); fee.querySelectorAll('input').forEach((input) => { input.disabled = fee.hidden; }); }
  }
  if (event.target.id === 'history-group') await openHistory(event.target.value);
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === 'groups' || action === 'public-home') { if (action === 'public-home') history.pushState({}, '', '/tapago/'); state.publicSlug = null; state.publicLoaded = false; state.screen = state.user || state.demo ? 'groups' : 'login'; await refreshGroups(); render(); }
    else if (action === 'google') { if (state.demo) notify('O backend ainda não está configurado. Use a prévia.'); else await signInWithGoogle(client); }
    else if (action === 'explore') { state.screen = 'groups'; render(); }
    else if (action === 'create') go('create');
    else if (action === 'open-group') await openGroup(id);
    else if (action === 'tab') {
      if (button.dataset.tab === 'history') await openHistory();
      else if (button.dataset.tab === 'expenses') { const personal = state.groups.find((group) => group.group_type === 'personal') || state.groups.find((group) => group.group_type === 'household'); if (personal) await openGroup(personal.id); else go('groups'); }
      else go(button.dataset.tab === 'groups' ? 'groups' : 'settings');
    }
    else if (action === 'history') await openHistory(id);
    else if (action === 'year') { state.year += Number(button.dataset.delta); await openHistory(state.selectedGroupId); }
    else if (action === 'settings') go('settings');
    else if (action === 'logout') { if (!state.demo) await signOut(client); }
    else if (action === 'copy') { await navigator.clipboard.writeText(button.dataset.copy); notify('Copiado.'); }
    else if (action === 'close-dialog') closeDialog();
    else if (action === 'add-participant') {
      openDialog('Adicionar participante', `<form class="form-stack" id="add-participant-form">${formField('name', 'Nome')}${formField('amount', 'Valor individual', { hint: 'Informe em reais, por exemplo 50,00.' })}<p class="form-error"></p><button class="button button-primary" type="submit">Adicionar</button></form>`);
    }
    else if (action === 'notice') {
      if (state.demo) { notify('Aviso fictício enviado ao administrador.'); return; }
      await groupsApi.submitPaymentNotice(state.selectedGroupId, state.month); notify('Aviso de pagamento enviado.'); await openGroup(state.selectedGroupId);
    }
    else if (action === 'resolve-notice') { await groupsApi.resolvePaymentNotice(id, 'confirmed'); await openGroup(state.selectedGroupId); }
    else if (action === 'confirm-payment') {
      if (state.demo) {
        const person = state.groupView.participants.find((item) => item.contributionId === id);
        person.paid = true; person.paid_at = new Date().toISOString(); state.demoPaid.add(person.name);
        state.groupView.totals = deriveFeeTotals(state.groupView.participants); render();
      } else { await groupsApi.confirmContribution(id); await openGroup(state.selectedGroupId); }
    }
    else if (action === 'edit-amount') {
      const person = state.groupView.participants.find((item) => item.id === id);
      const value = ((person.amountCents ?? person.amount_cents) / 100).toFixed(2).replace('.', ',');
      openDialog(`Editar valor de ${person.display_name || person.name}`, `<form class="form-stack" id="edit-amount-form" data-participant-id="${e(id)}">${formField('amount', 'Valor mensal', { value, hint: 'A edição vale para este período pendente.' })}<p class="form-error"></p><button class="button button-primary" type="submit">Salvar valor</button></form>`);
    }
    else if (action === 'participant') {
      const person = state.groupView.participants.find((item) => item.id === id);
      if (!person) return;
      if (person.linked_user_id) {
        openDialog('Revogar conexão Google?', `<p class="dialog-copy">${e(person.display_name)} deixará de acessar este grupo. Os registros anteriores continuarão no histórico.</p><form class="form-stack" id="revoke-link-form" data-participant-id="${e(id)}"><button class="button button-danger" type="submit">Revogar conexão</button></form>`);
      } else {
        openDialog(`Conectar perfil de ${person.display_name || person.name}`, `<p class="dialog-copy">O convite funciona somente para o e-mail Google informado. Não há vínculo por nome.</p><form class="form-stack" id="invite-form" data-participant-id="${e(id)}">${formField('email', 'E-mail da conta Google', { type: 'email' })}<p class="form-error"></p><button class="button button-primary" type="submit">Criar convite individual</button></form>`);
      }
    }
    else if (action === 'share') {
      if (state.demo) { notify('A prévia não publica links de grupo.'); return; }
      const result = await publicApi.setPublicShare(state.selectedGroupId, true, false);
      state.groupView.share = { slug: result.slug, enabled: true, include_pix: false };
      await navigator.clipboard.writeText(result.url); notify('Link público copiado.'); render();
    }
    else if (action === 'revoke-share') {
      await publicApi.setPublicShare(state.selectedGroupId, false, false); state.groupView.share = null; notify('Link público revogado.'); render();
    }
    else if (action === 'add-expense') {
      openDialog('Adicionar despesa', `<form class="form-stack" id="add-expense-form">${formField('name', 'Nome da despesa')}${formField('amount', 'Valor mensal', { hint: 'Informe em reais, por exemplo 216,00.' })}${formField('due_day', 'Dia de vencimento', { type: 'number', value: '10', min: 1, max: 31 })}<p class="form-error"></p><button class="button button-primary" type="submit">Adicionar despesa</button></form>`);
    }
    else if (action === 'confirm-expense') { if (!state.demo) await periodsApi.confirmExpenseOccurrence(id); else { const row = state.expenses.find((item) => item.id === id); if (row) row.status = 'paid'; } await openGroup(state.selectedGroupId); }
    else if (action === 'expense-history') { if (!state.demo) state.expenses = await periodsApi.getExpenseHistory(state.selectedGroupId); state.screen = 'expense-history'; render(); }
  } catch (error) { await showError(error); }
});

window.addEventListener('popstate', () => { const route = resolveRoute(location.pathname); state.publicSlug = route.slug || null; state.publicSummary = null; state.publicLoaded = false; if (state.publicSlug) loadPublic(); else { state.screen = state.user || state.demo ? 'groups' : 'login'; render(); } });

captureInvitationToken();
initialize().catch(showError);
