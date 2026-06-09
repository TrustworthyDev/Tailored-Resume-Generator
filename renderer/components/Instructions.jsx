import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ConfirmModal from "./ConfirmModal";

const EMPTY = { name: "", body: "" };

export default function Instructions() {
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const load = async () => {
    const rows = await api().listInstructions();
    setItems(rows || []);
    if (!rows || rows.length === 0) setShowForm(true);
  };
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const startAdd = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); };
  const startEdit = (p) => { setForm({ name: p.name || "", body: p.body || "" }); setEditingId(p.id); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditingId(null); setForm(EMPTY); };

  const save = async () => {
    if (editingId) await api().updateInstruction({ ...form, id: editingId });
    else await api().addInstruction(form);
    cancel();
    load();
  };

  const doDelete = async () => {
    const id = confirmId;
    setConfirmId(null);
    if (id == null) return;
    await api().deleteInstruction(id);
    load();
  };
  const setActive = async (id) => { await api().setActiveInstruction(id); load(); };

  const onDragStart = (i) => (e) => { setDragIndex(i); e.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (i) => (e) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) return;
    setItems((arr) => {
      const next = arr.slice();
      const [m] = next.splice(dragIndex, 1);
      next.splice(i, 0, m);
      return next;
    });
    setDragIndex(i);
  };
  const onDragEnd = () => {
    setDragIndex(null);
    setItems((arr) => { api().reorderInstructions(arr.map((p) => p.id)); return arr; });
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Prompts</h2>
        <button className="btn primary" onClick={startAdd}>+ Add New</button>
      </div>
      <p className="muted">
        Saved instruction prompts. The active one (or the one selected on the
        Generate page) is sent to the AI.
      </p>

      {showForm && (
        <div className="subcard">
          <h3 className="modal-title">{editingId ? "Edit Prompt" : "Add Prompt"}</h3>
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" placeholder="e.g. Python Full Stack" value={form.name} onChange={set("name")} />
          </label>
          <label className="field">
            <span className="field-label">Instruction</span>
            <textarea className="textarea" rows={8} placeholder="You are an expert technical resume writer…"
              value={form.body} onChange={set("body")} />
          </label>
          <div className="row">
            <button className="btn primary" onClick={save}>{editingId ? "Update" : "Save"}</button>
            {items.length > 0 && <button className="btn" onClick={cancel}>Cancel</button>}
          </div>
        </div>
      )}

      <div className="list">
        {items.map((p, i) => (
          <div
            className={
              (p.is_active ? "list-item active-row" : "list-item") +
              (dragIndex === i ? " dragging" : "")
            }
            key={p.id}
            draggable
            onDragStart={onDragStart(i)}
            onDragOver={onDragOver(i)}
            onDragEnd={onDragEnd}
          >
            <span className="drag-grip" title="Drag to reorder">⋮⋮</span>
            <div className="instr-info">
              <strong>{p.name || "(untitled)"}</strong>
              {p.is_active ? <span className="badge live badge-gap">active</span> : null}
              <div className="muted small prompt-snippet">{(p.body || "").slice(0, 120)}</div>
            </div>
            <div className="list-actions">
              <button className="btn small" onClick={() => startEdit(p)}>Edit</button>
              {!p.is_active && <button className="btn small" onClick={() => setActive(p.id)}>Set active</button>}
              <button className="btn small danger" onClick={() => setConfirmId(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={confirmId != null}
        title="Delete prompt?"
        message={`"${(items.find((p) => p.id === confirmId) || {}).name || "This prompt"}" will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirmId(null)}
      />
    </section>
  );
}
