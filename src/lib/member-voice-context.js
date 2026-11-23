import { createContext, useContext } from "react";

/** Map(memberId -> kale-tts-1 voice id) for the open squad (ADR-0276). */
export const MemberVoicesContext = createContext(new Map());

export function useMemberVoice(memberId) {
  return useContext(MemberVoicesContext).get(memberId) || "";
}
