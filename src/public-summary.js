import { getSupabaseClient } from './supabase-client.js';

const safeSlugPattern = /^[0-9a-f]{24,64}$/;

export function buildPublicGroupUrl(slug, origin = globalThis.location?.origin) {
  if (!safeSlugPattern.test(String(slug || ''))) throw new Error('Link público inválido.');
  if (!origin) throw new Error('Não foi possível identificar o endereço do TáPago.');
  return new URL(`/tapago/${slug}`, origin).toString();
}

export function subscribeToPublicSummary(client, slug, onUpdate, onStatus = () => {}) {
  if (!safeSlugPattern.test(String(slug || ''))) throw new Error('Link público inválido.');
  const channel = client.channel(`tapago-public:${slug}`, { config: { private: false } })
    .on('broadcast', { event: 'summary_updated' }, (payload) => onUpdate(payload))
    .subscribe((state) => {
      if (state === 'SUBSCRIBED') onStatus('connected');
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') onStatus('error');
      else if (state === 'CLOSED') onStatus('disconnected');
      else onStatus('connecting');
    });
  return { channel, unsubscribe: () => client.removeChannel(channel) };
}

export function createPublicSummaryService(client = getSupabaseClient(), options = {}) {
  const origin = options.origin || globalThis.location?.origin;
  return {
    async getPublicSummary(slug) {
      if (!safeSlugPattern.test(String(slug || ''))) return null;
      const { data, error } = await client.rpc('get_public_group_summary', { p_slug: slug });
      if (error) throw error;
      return Array.isArray(data) ? data[0] || null : data || null;
    },
    async setPublicShare(groupId, enabled, includePix = false) {
      const { data, error } = await client.rpc('set_public_share', {
        p_group_id: groupId, p_enabled: Boolean(enabled), p_include_pix: Boolean(enabled && includePix),
      });
      if (error) throw error;
      return data ? { slug: data, url: buildPublicGroupUrl(data, origin) } : null;
    },
    subscribe(slug, onUpdate, onStatus) {
      return subscribeToPublicSummary(client, slug, onUpdate, onStatus);
    },
  };
}
