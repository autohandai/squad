import { useState } from "react";

import { Button } from "@/components/ui/button";
import { paymentLine } from "@/lib/vault";

/**
 * A member wants to pay. One divider row with the decision: Approve with a
 * saved card, I'll pay myself, or Decline. The decision is persisted by the
 * bridge and the member's next turn is told the outcome with the card's id
 * and masked hint only. Same grammar as channel proposals (ADR-0075).
 */
export function PaymentApprovalCard({ request, member, cards = [], onDecide, copy = {} }) {
  const [cardId, setCardId] = useState(cards[0]?.id || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const name = member?.name || "A member";
  const selected = cards.find((card) => card.id === cardId) || cards[0] || null;

  async function decide(decision) {
    if (busy) return;
    setBusy(decision);
    setError("");
    try {
      await onDecide(request.id, { decision, itemId: decision === "approve" ? selected?.id || "" : "" });
    } catch (failure) {
      setError(failure?.message || "Could not save this decision. Try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mx-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-4 text-sm" data-testid="payment-approval" role="group" aria-label={`${name} wants to pay ${paymentLine(request)}`}>
      <div className="min-w-0">
        <p><strong>{name}</strong> {copy.vaultWantsToPay || "wants to pay"} <strong>{paymentLine(request)}</strong>{request.request?.site ? <span className="text-muted-foreground"> · {request.request.site}</span> : null}</p>
        {request.request?.reason ? <p className="text-muted-foreground">{request.request.reason}</p> : null}
        {cards.length > 1 ? (
          <label className="mt-1 block text-xs text-muted-foreground">
            {copy.vaultPayWith || "Pay with"}{" "}
            <select className="bg-transparent text-foreground underline-offset-2 focus:outline-none" value={selected?.id || ""} onChange={(event) => setCardId(event.target.value)} aria-label={copy.vaultPayWith || "Pay with"}>
              {cards.map((card) => <option key={card.id} value={card.id}>{card.label} · {card.hint}</option>)}
            </select>
          </label>
        ) : cards.length === 1 ? (
          <p className="text-xs text-muted-foreground">{copy.vaultPayWith || "Pay with"} {selected.label} · {selected.hint}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{copy.vaultNoCard || "No saved card. Add one in Settings → Vault to approve, or pay yourself."}</p>
        )}
        {error ? <p role="alert" className="mt-1 text-sm text-destructive">{error}</p> : null}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => decide("decline")}>{busy === "decline" ? copy.declining || "Declining…" : copy.decline || "Decline"}</Button>
        <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => decide("self")}>{busy === "self" ? copy.saving || "Saving…" : copy.vaultPaySelf || "I'll pay myself"}</Button>
        <Button size="sm" variant="outline" disabled={Boolean(busy) || !selected} onClick={() => decide("approve")}>{busy === "approve" ? copy.saving || "Saving…" : copy.vaultApprove || "Approve"}</Button>
      </div>
    </div>
  );
}
