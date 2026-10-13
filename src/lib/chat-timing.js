// Chat progress renews the silence window, but every turn remains bounded.
export const CHAT_TURN_CEILING_MS = 45 * 60 * 1000;
export const CHAT_STREAM_CEILING_MS = CHAT_TURN_CEILING_MS + 5000;
