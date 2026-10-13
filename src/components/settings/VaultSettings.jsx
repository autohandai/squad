import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VAULT_FORM_FIELDS, VAULT_KINDS, vaultKeySourceLabel, vaultKindLabel } from "@/lib/vault";

/**
 * Settings → Vault body: one divider row per saved item with Remove, an
 * add form per kind, and one line saying where the key is held. There is no
 * "show value": values go to the bridge once and never come back.
 * `api(path, options)` is the app's JSON helper.
 */
export function VaultSettings({ api, copy = {} }) {
  const [state, setState] = useState({ items: [], keySource: null, locked: false, error: "", loaded: false, loadError: "" });
  const [adding, setAdding] = useState("");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState("");
  const [formError, setFormError] = useState("");

  const reload = useCallback(async () => {
    try {
      const data = await api("/api/vault");
      setState({ items: data.items || [], keySource: data.keySource || null, locked: Boolean(data.locked), error: data.error || "", loaded: true, loadError: "" });
    } catch (error) {
      setState((current) => ({ ...current, loaded: true, loadError: error?.message || "The vault could not be read from the local bridge." }));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function startAdding(kind) {
    setAdding(kind);
    setLabel("");
    setFields({});
    setFormError("");
  }

  function cancel() {
    setAdding("");
    setFields({});
    setLabel("");
    setFormError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy("add");
    setFormError("");
    try {
      await api("/api/vault/items", { method: "POST", body: JSON.stringify({ kind: adding, label, fields }) });
      // The values leave React state the moment the bridge has them.
      setFields({});
      setLabel("");
      setAdding("");
      await reload();
    } catch (error) {
      setFormError(error?.message || "Could not save this item.");
    } finally {
      setBusy("");
    }
  }

  async function remove(item) {
    if (busy) return;
    setBusy(item.id);
    try {
      await api(`/api/vault/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      await reload();
    } catch (error) {
      setState((current) => ({ ...current, loadError: error?.message || "Could not remove this item." }));
    } finally {
      setBusy("");
    }
  }

  const formFields = adding ? VAULT_FORM_FIELDS[adding] || [] : [];

  return (
    <div data-testid="vault-settings">
      <div className="divide-y divide-border/65">
        <Field orientation="horizontal" className="items-center justify-between gap-6 py-4">
          <FieldContent className="gap-1">
            <FieldTitle>{copy.vaultKey || "Key"}</FieldTitle>
            <FieldDescription role="status">
              {state.locked ? state.error : vaultKeySourceLabel(state.keySource)}
              {" "}{copy.vaultKeyDetail || "Items are sealed with AES-256-GCM. Members see labels and masked hints, never a value."}
            </FieldDescription>
          </FieldContent>
        </Field>
        {state.items.map((item) => (
          <Field key={item.id} orientation="horizontal" className="items-center justify-between gap-6 py-4" data-testid="vault-item">
            <FieldContent className="min-w-0 gap-1">
              <FieldTitle className="truncate">{item.label}</FieldTitle>
              <FieldDescription>{vaultKindLabel(item.kind)} · {item.hint}</FieldDescription>
            </FieldContent>
            <Button type="button" variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => remove(item)}>
              {busy === item.id ? copy.removing || "Removing…" : copy.remove || "Remove"}
            </Button>
          </Field>
        ))}
        {state.loaded && !state.items.length && !state.loadError ? (
          <p className="py-4 text-sm text-muted-foreground">{copy.vaultEmpty || "Nothing saved yet. Add a login, a card or your personal details, or let a member ask for one in the chat."}</p>
        ) : null}
        {state.loadError ? <p role="alert" className="py-4 text-sm text-destructive">{state.loadError}</p> : null}
      </div>

      {adding ? (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3" data-testid="vault-add-form" autoComplete="off">
          <p className="text-sm font-medium">{copy.vaultAdd || "Add"} {vaultKindLabel(adding).toLowerCase()}</p>
          <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
            <Label htmlFor="vault-label" className="text-sm text-muted-foreground">{copy.vaultLabel || "Label"}</Label>
            <Input id="vault-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={copy.vaultLabelPlaceholder || "Optional, for example “Work GitHub”"} maxLength={60} />
            {formFields.map((field) => (
              <FormField key={field.key} field={field} value={fields[field.key] || ""} onChange={(value) => setFields((current) => ({ ...current, [field.key]: value }))} />
            ))}
          </div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={busy === "add"}>{busy === "add" ? copy.saving || "Saving…" : copy.saveToVault || "Save to vault"}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy === "add"} onClick={cancel}>{copy.cancel || "Cancel"}</Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {VAULT_KINDS.map((kind) => (
            <Button key={kind.id} type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" disabled={state.locked} onClick={() => startAdding(kind.id)}>
              {copy.vaultAdd || "Add"} {kind.label.toLowerCase()}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function FormField({ field, value, onChange }) {
  const id = `vault-field-${field.key}`;
  return (
    <>
      <Label htmlFor={id} className="text-sm text-muted-foreground">
        {field.label}{field.optional ? "" : " *"}
      </Label>
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
