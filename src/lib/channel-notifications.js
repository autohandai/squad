export const CHANNEL_NOTIFICATION_MODES = Object.freeze(['all', 'mentions', 'muted']);
export const DEFAULT_CHANNEL_NOTIFICATIONS = Object.freeze({ channelDefault: 'mentions', channelOverrides: Object.freeze({}) });

export function normalizeChannelNotifications(source = {}) {
  const overrides = source.channelOverrides && typeof source.channelOverrides === 'object' && !Array.isArray(source.channelOverrides) ? source.channelOverrides : {};
  return {
    channelDefault: CHANNEL_NOTIFICATION_MODES.includes(source.channelDefault) ? source.channelDefault : 'mentions',
    channelOverrides: Object.fromEntries(Object.entries(overrides).filter(([id, value]) => id && id.length <= 200 && value && typeof value === 'object' && !Array.isArray(value)).map(([id, value]) => [id, {
      ...(CHANNEL_NOTIFICATION_MODES.includes(value.mode) ? { mode: value.mode } : {}), hidden: value.hidden === true,
    }])),
  };
}

export function channelNotificationPreference(settings, channelId) {
  const overrides = settings?.channelOverrides || {};
  const override = Object.hasOwn(overrides, channelId) ? overrides[channelId] || {} : {};
  const mode = CHANNEL_NOTIFICATION_MODES.includes(override.mode) ? override.mode : null;
  const fallback = CHANNEL_NOTIFICATION_MODES.includes(settings?.channelDefault) ? settings.channelDefault : 'mentions';
  return { mode: mode || fallback, hidden: override.hidden === true, inherited: !mode };
}
