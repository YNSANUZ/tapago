const publicSlugPattern = /^[0-9a-f]{24,64}$/;

export function resolveRoute(pathname) {
  const normalized = String(pathname || '/tapago/');
  if (normalized === '/tapago' || normalized === '/tapago/' || normalized === '/') return { name: 'app' };
  const path = normalized.replace(/\/+$/, '') || '/';
  const appPath = path.startsWith('/tapago/') ? path.slice('/tapago/'.length) : path.replace(/^\//, '');
  if (!appPath) return { name: 'app' };
  if (publicSlugPattern.test(appPath)) return { name: 'public', slug: appPath };
  return { name: 'not-found' };
}

export function canManageGroup(membership) { return membership?.role === 'admin'; }
export function canConfirmPayments(membership) { return canManageGroup(membership); }
export function canSubmitPaymentNotice(membership, userId) {
  return membership?.role === 'participant' && Boolean(userId) && membership.linked_user_id === userId;
}
