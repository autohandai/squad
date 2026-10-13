import { useCallback, useEffect, useState } from "react";

import { PaymentApprovalCard } from "@/components/chat/PaymentApprovalCard";
import { SecureRequestCard } from "@/components/chat/SecureRequestCard";

/**
 * Pending vault requests, reconciled from the bridge the way channel
 * proposals are: fetched at boot, refreshed on every `changed` event from
 * /api/vault/events. Returns the list plus the handlers the cards and Needs
 * you use. `api(path, options)` is the app's JSON helper.
 */
export function useVaultRequests(api) {
  const [requests, setRequests] = useState([]);
  const [cards, setCards] = useState([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [pending, vault] = await Promise.all([api("/api/vault/requests?status=pending"), api("/api/vault")]);
      setRequests(Array.isArray(pending?.requests) ? pending.requests : []);
      setCards((vault?.items || []).filter((item) => item.kind === "card"));
      setError("");
    } catch (failure) {
      setError(failure?.message || "Vault requests could not be read from the local bridge.");
    }
  }, [api]);

  useEffect(() => {
    void reload();
    let source;
    try {
      source = new EventSource("/api/vault/events");
      source.addEventListener("changed", () => { void reload(); });
    } catch {
      source = null;
    }
    return () => source?.close();
  }, [reload]);

  const submitSecret = useCallback(async (id, body) => {
    await api(`/api/vault/requests/${encodeURIComponent(id)}/secret`, { method: "POST", body: JSON.stringify(body) });
    await reload();
  }, [api, reload]);

  const dismissSecret = useCallback(async (id) => {
    await api(`/api/vault/requests/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: "{}" });
    await reload();
  }, [api, reload]);

  const decidePayment = useCallback(async (id, body) => {
    await api(`/api/vault/requests/${encodeURIComponent(id)}/payment`, { method: "POST", body: JSON.stringify(body) });
    await reload();
  }, [api, reload]);

  return { requests, cards, error, reload, submitSecret, dismissSecret, decidePayment };
}

/** The pending rows, rendered above the main canvas like channel proposals. */
export function VaultRequests({ vault, members = [], copy = {} }) {
  const pending = (vault?.requests || []).filter((item) => item.status === "pending");
  if (!pending.length) return null;
  return (
    <section aria-label={copy.vaultRequests || "Vault requests"} className="border-b border-border/60">
      {pending.map((request) => {
        const member = members.find((item) => item.id === request.memberId);
        return request.type === "payment"
          ? <PaymentApprovalCard key={request.id} request={request} member={member} cards={vault.cards} onDecide={vault.decidePayment} copy={copy} />
          : <SecureRequestCard key={request.id} request={request} member={member} onSubmit={vault.submitSecret} onDismiss={vault.dismissSecret} copy={copy} />;
      })}
    </section>
  );
}
