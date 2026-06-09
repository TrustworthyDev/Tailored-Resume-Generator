import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ConfirmModal from "./ConfirmModal";

const EMPTY = { name: "", api_key: "", provider: "gemini" };

const PROVIDERS = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic (Claude)" },
];
const providerLabel = (id) =>
  (PROVIDERS.find((p) => p.id === id) || {}).label || "Google Gemini";

function mask(key) {
  if (!key) return "";
  if (key.length <= 6) return "••••••";
  return "••••••••" + key.slice(-4);
}

export default function ApiKeys() {
  const [keys, setKeys] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [editingId, setEditingId] = useState(null); // null = adding a new key
  const [confirmId, setConfirmId] = useState(null);

  const load = async () => {
    const rows = await api().listApiKeys();
    setKeys(rows || []);
    // Show the form automatically when there are no keys yet.
    if (!rows || rows.length === 0) setShowForm(true);
  };

  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setError("");
    const res = editingId
      ? await api().updateApiKey({ ...form, id: editingId })
      : await api().addApiKey(form);
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
    setShowForm(true);
  };

  const startEdit = (k) => {
    setForm({ name: k.name || "", api_key: k.api_key || "", provider: k.provider || "gemini" });
    setEditingId(k.id);
    setError("");
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

  return (
    <section className="card">
      <div className="card-head">
        <h2>API Keys</h2>
        <button className="btn primary" onClick={startAdd}>
          + Add New
        </button>
      </div>

      {showForm && (
        <div className="subcard">
          <h3 className="modal-title">{editingId ? "Edit API Key" : "Add API Key"}</h3>
          <label className="field">
            <span className="field-label">Provider</span>
            <select className="input" value={form.provider} onChange={set("provider")}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
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
            <input className="input" placeholder="API key…" type="password"
              value={form.api_key} onChange={set("api_key")} />
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
      )}

      <div className="list">
        {keys.map((k, i) => (
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
              <div className="muted small">{mask(k.api_key)}</div>
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
