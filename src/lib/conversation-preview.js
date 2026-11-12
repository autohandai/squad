/** A bounded preview of retained conversation data, never a generated status. */
export function conversationPreview(messages, { fallback = '', locale = 'en', you = 'You' } = {}) {
  const message = Array.isArray(messages) ? messages.findLast(item => item && item.status !== 'deleted' && (item.body || item.attachments?.length)) : null;
  const at = Date.parse(message?.startedAt || message?.createdAt || message?.completedAt || '');
  const body = String(message?.body || '').slice(0, 512)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const text = body || (message?.attachments?.length ? 'Attachment' : fallback);
  let time = message?.time || '';
  if (Number.isFinite(at)) {
    const date = new Date(at), today = new Date();
    const options = date.toDateString() === today.toDateString() ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' };
    time = new Intl.DateTimeFormat(locale, options).format(date);
  }
  return { text: message?.role === 'user' && text ? `${you}: ${text}` : text, time, at: Number.isFinite(at) ? at : 0,
    dateTime: Number.isFinite(at) ? new Date(at).toISOString() : undefined };
}
