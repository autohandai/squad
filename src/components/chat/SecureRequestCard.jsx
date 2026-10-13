import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VAULT_FORM_FIELDS, vaultKindLabel } from "@/lib/vault";

/**
 * A member asked for a login, card or personal details. The person fills a
 * secure form; the values are posted to the bridge once and cleared from
 * React state. The member later sees only the new item's id and hint.
 * One divider row, no card chrome (DESIGN.md "Agent Chat").
 */
export function SecureRequestCard({ request, member, onSubmit, onDismiss, copy = {} }) {
  const [fields, setFields] = useState({});
  const [label, setLabel] = useState(request.request?.label || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const kind = request.request?.kind || "login";
  const formFields = VAULT_FORM_FIELDS[kind] || [];
  const name = member?.name || "A member";

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy("submit");
    setError("");
    try {
      await onSubmit(request.id, { fields, label });
      setFields({});
    } catch (failure) {
      setError(failure?.message || "Could not save this. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy("dismiss");
    setError("");
    try {
      await onDismiss(request.id);
      setFields({});
    } catch (failure) {
      setError(failure?.message || "Could not decline this request. Try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <form onSubmit={submit} className="mx-6 border-b border-border/60 py-4 text-sm" data-testid="secure-request" autoComplete="off" aria-label={`${name} asks for ${request.request?.label || "a secret"}`}>
      <p>
        <strong>{name}</strong> {copy.vaultAsksFor || "asks for"} <strong>{request.request?.label || vaultKindLabel(kind).toLowerCase()}</strong>
        <span className="text-muted-foreground"> · {vaultKindLabel(kind)}</span>
      </p>
      {request.request?.reason ? <p className="text-muted-foreground">{request.request.reason}</p> : null}
      <p className="text-xs text-muted-foreground">
        {copy.vaultSecureFormNote || "What you type goes straight into your vault on this computer. The member receives only a masked hint."}
        {request.request?.saveToVault === false ? ` ${copy.vaultTaskOnly || "Kept for this task only."}` : ""}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
        <Label htmlFor={`secure-${request.id}-label`} className="text-sm text-muted-foreground">{copy.vaultLabel || "Label"}</Label>
        <Input id={`secure-${request.id}-label`} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} />
        {formFields.map((field) => (
          <SecureField key={field.key} id={`secure-${request.id}-${field.key}`} field={field} value={fields[field.key] || ""} onChange={(value) => setFields((current) => ({ ...current, [field.key]: value }))} />
        ))}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={Boolean(busy)}>{busy === "submit" ? copy.saving || "Saving…" : copy.saveToVault || "Save to vault"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={dismiss}>{busy === "dismiss" ? copy.declining || "Declining…" : copy.decline || "Decline"}</Button>
      </div>
    </form>
  );
}

function SecureField({ id, field, value, onChange }) {
  return (
    <>
      <Label htmlFor={id} className="text-sm text-muted-foreground">{field.label}{field.optional ? "" : " *"}</Label>
      <Input
        id={id}
        type={field.secret ? "password" : "text"}
        inputMode={field.inputMode}
        autoComplete={field.autoComplete || "off"}
        value={value}
        placeholder={field.placeholder}
        required={!field.optional}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}
