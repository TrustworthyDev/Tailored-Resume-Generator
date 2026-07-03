import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ConfirmModal from "./ConfirmModal";
import { MODEL_OPTIONS, PROVIDERS, providerLabel, defaultModel, modelLabel } from "../lib/aiModels";

const EMPTY = { name: "", api_key: "", provider: "gemini", model: defaultModel("gemini") };

function mask(key) {
  if (!key) return "";
  if (key.length <= 6) return "••••••";
  return "••••••••" + key.slice(-4);
}

// `kind` splits keys into two independent groups:
//   "v1" — direct resume generation (Gemini / OpenAI / Anthropic)
//   "v2" — a Gemini key that refines the ChatGPT prompt (Gemini only)
export default function ApiKeys({ kind = "v1" }) {
  const isV2 = kind === "v2";
  const [keys, setKeys] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [editingId, setEditingId] = useState(null); // null = adding a new key
  const [confirmId, setConfirmId] = useState(null);
  const [showKey, setShowKey] = useState(false); // reveal the Key field as text

  const load = async () => {
    const rows = await api().listApiKeys(kind);
    setKeys(rows || []);
    // Show the form automatically when there are no keys yet.
    if (!rows || rows.length === 0) setShowForm(true);
  };

  useEffect(() => { load(); /* reload when switching V1/V2 tab */ }, [kind]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Changing the provider switches the model list to that provider's default.
  const onProvider = (e) => {
    const provider = e.target.value;
    setForm((f) => ({ ...f, provider, model: defaultModel(provider) }));
  };

  const save = async () => {
    setError("");
    const res = editingId
      ? await api().updateApiKey({ ...form, id: editingId })
      : await api().addApiKey({ ...form, kind });
    if (!res.ok) { setError(res.error || "Could not save key."); return; }
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(false);
    load();
  };

  const startAdd = () => {
    setForm(EMPTY);
    setEditingId(null);
    setError("");
    setShowKey(false);
    setShowForm(true);
  };

  const startEdit = (k) => {
    const provider = k.provider || "gemini";
    setForm({
      name: k.name || "",
      api_key: k.api_key || "",
      provider,
      model: k.model || defaultModel(provider),
    });
    setEditingId(k.id);
    setError("");
    setShowKey(false);
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
    setError("");
  };

  const doDelete = async () => {
    const id = confirmId;
    setConfirmId(null);
    if (id == null) return;
    await api().deleteApiKey(id);
    load();
  };

  const setActive = async (id) => {
    await api().setActiveApiKey(id);
    load();
  };

  // Drag-and-drop ranking (mirrors the Accounts list).
  const onDragStart = (i) => (e) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (i) => (e) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) return;
    setKeys((arr) => {
      const next = arr.slice();
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(i);
  };
  const onDragEnd = () => {
    setDragIndex(null);
    setKeys((arr) => {
      api().reorderApiKeys(arr.map((k) => k.id));
      return arr;
    });
  };

  // The add/edit form — rendered at the top when adding, or inline at the row
  // being edited so the editor stays in place.
  const formCard = (
    <div className="subcard">
      <h3 className="modal-title">{editingId ? "Edit API Key" : "Add API Key"}</h3>
      {!isV2 && (
        <label className="field">
          <span className="field-label">Provider</span>
          <select className="input" value={form.provider} onChange={onProvider}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="field-label">Model</span>
        <select className="input" value={form.model} onChange={set("model")}>
          {(MODEL_OPTIONS[form.provider] || []).map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" placeholder="e.g. Personal Gemini key"
          value={form.name} onChange={set("name")} />
      </label>
      <label className="field">
        <span className="field-label">Key</span>
        <div className="input-with-btn">
          <input
            className="input"
            placeholder="API key…"
            type={showKey ? "text" : "password"}
            value={form.api_key}
            onChange={set("api_key")}
          />
          <button
            type="button"
            className="input-eye"
            onClick={() => setShowKey((s) => !s)}
            title={showKey ? "Hide key" : "Show key"}
            aria-label={showKey ? "Hide key" : "Show key"}
          >
            {showKey ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </label>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary" onClick={save}>
          {editingId ? "Update" : "Save"}
        </button>
        {keys.length > 0 && (
          <button className="btn" onClick={cancelForm}>Cancel</button>
        )}
      </div>
    </div>
  );

  return (
    <section className="card">
      <div className="card-head">
        <h2>{isV2 ? "API Keys — V2 (prompt refiner)" : "API Keys — V1 (resume generation)"}</h2>
        <button className="btn primary" onClick={startAdd}>
          + Add New
        </button>
      </div>
      <p className="muted small">
        {isV2
          ? "A Google Gemini key used by Generate V2 to refine the ChatGPT prompt before it's copied. Optional — without an active key, V2 uses the app's built-in prompt."
          : "Keys used by Generate V1 to create resumes directly (Google Gemini, OpenAI, or Anthropic). The active key is used for generation."}
      </p>

      {/* Adding a new key shows the form at the top; editing shows it inline. */}
      {showForm && editingId === null && formCard}

      <div className="list">
        {keys.map((k, i) => (
          showForm && editingId === k.id ? (
            <div key={k.id}>{formCard}</div>
          ) : (
          <div
            className={
              (k.is_active ? "list-item active-row" : "list-item") +
              (dragIndex === i ? " dragging" : "")
            }
            key={k.id}
            draggable
            onDragStart={onDragStart(i)}
            onDragOver={onDragOver(i)}
            onDragEnd={onDragEnd}
          >
            <span className="drag-grip" title="Drag to reorder">⋮⋮</span>
            <div className="instr-info">
              <strong>{k.name || "(unnamed)"}</strong>
              <span className="badge badge-gap">{providerLabel(k.provider)}</span>
              {k.is_active ? <span className="badge live badge-gap">active</span> : null}
              <div className="muted small">{modelLabel(k.provider, k.model)} · {mask(k.api_key)}</div>
            </div>
            <div className="list-actions">
              <button className="btn small" onClick={() => startEdit(k)}>
                Edit
              </button>
              {!k.is_active && (
                <button className="btn small" onClick={() => setActive(k.id)}>
                  Set active
                </button>
              )}
              <button className="btn small danger" onClick={() => setConfirmId(k.id)}>
                Delete
              </button>
            </div>
          </div>
          )
        ))}
      </div>

      <ConfirmModal
        open={confirmId != null}
        title="Delete API key?"
        message={`"${(keys.find((k) => k.id === confirmId) || {}).name || "This key"}" will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirmId(null)}
      />
    </section>
  );
}
