const groupTables = ['groups', 'group_memberships', 'group_participants', 'monthly_contributions', 'payment_notices', 'payment_events', 'public_shares'];

export function subscribeToGroup(client, groupId, onChange, onStatus = () => {}) {
  if (!groupId) throw new Error('Informe o grupo para iniciar a sincronização.');
  const channel = client.channel(`tapago-group:${groupId}`);
  for (const table of groupTables) {
    channel.on('postgres_changes', {
      event: '*', schema: 'public', table, filter: `${table === 'groups' ? 'id' : 'group_id'}=eq.${groupId}`,
    }, (event) => onChange({ table, event }));
  }
  channel.subscribe((state) => {
    if (state === 'SUBSCRIBED') onStatus('connected');
    else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') onStatus('error');
    else if (state === 'CLOSED') onStatus('disconnected');
    else onStatus('connecting');
  });
  return {
    channel,
    unsubscribe: () => client.removeChannel(channel),
  };
}
