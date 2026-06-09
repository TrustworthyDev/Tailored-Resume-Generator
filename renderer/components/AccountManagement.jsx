import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { countryFlag } from "../lib/flags";
import AccountForm from "./AccountForm";
import ConfirmModal from "./ConfirmModal";

// One account (person) has one personal info and many work histories.
// Left panel lists all accounts (name + country); right panel edits the
// selected account's personal info and work history.
export default function AccountManagement() {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);

  const load = async (keepSelection = true) => {
    const rows = await api().listAccounts();
    setAccounts(rows || []);
    if (!keepSelection || selectedId == null) {
      if (rows && rows.length) setSelectedId(rows[0].id);
    }
    return rows || [];
  };

  useEffect(() => { load(false); }, []);

  const addAccount = async () => {
    const res = await api().createAccount({ name: "New Account" });
    const rows = await load();
    if (res && res.id) setSelectedId(res.id);
    else if (rows.length) setSelectedId(rows[rows.length - 1].id);
  };

  const askRemove = (id, e) => {
    e.stopPropagation();
    setConfirmId(id);
  };

  const confirmRemove = async () => {
    const id = confirmId;
    setConfirmId(null);
    if (id == null) return;
    await api().deleteAccount(id);
    const rows = await api().listAccounts();
    setAccounts(rows || []);
    if (selectedId === id) setSelectedId(rows && rows.length ? rows[0].id : null);
  };

  const confirmName =
    (accounts.find((a) => a.id === confirmId) || {}).name || "this account";

  // Drag-and-drop ranking
  const onDragStart = (i) => (e) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (i) => (e) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) return;
    setAccounts((arr) => {
      const next = arr.slice();
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(i);
  };
  const onDragEnd = () => {
    setDragIndex(null);
    // Persist the latest order.
    setAccounts((arr) => {
      api().reorderAccounts(arr.map((a) => a.id));
      return arr;
    });
  };

  return (
    <div className="account-layout">
      {/* Accounts list panel */}
      <div className="accounts-panel">
        <div className="accounts-head">
          <span className="panel-title">Accounts</span>
          <button className="btn small primary" onClick={addAccount}>+ Add</button>
        </div>
        <div className="accounts-list">
          {accounts.length === 0 && (
            <p className="muted small" style={{ padding: "8px 4px" }}>
              No accounts yet.
            </p>
          )}
          {accounts.map((a, i) => (
            <div
              key={a.id}
              className={
                (a.id === selectedId ? "account-item active" : "account-item") +
                (dragIndex === i ? " dragging" : "")
              }
              draggable
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDragEnd={onDragEnd}
              onClick={() => setSelectedId(a.id)}
            >
              <span className="drag-grip" title="Drag to reorder">⋮⋮</span>
              <div className="account-meta">
                <strong>
                  {a.name || "(unnamed)"}
                  {a.main_stack ? ` (${a.main_stack})` : ""}
                </strong>
                <span className="muted small">
                  {a.country ? (
                    <>
                      <span className="flag">{countryFlag(a.country)}</span>
                      {a.country}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <button className="x-btn" onClick={(e) => askRemove(a.id, e)} title="Delete">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Selected account detail */}
      <div className="account-detail">
        {selectedId ? (
          <AccountForm
            key={`a-${selectedId}`}
            accountId={selectedId}
            onSaved={() => load()}
          />
        ) : (
          <div className="card">
            <p className="muted">Create an account to get started.</p>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmId != null}
        title="Delete account?"
        message={`"${confirmName}" and its work history will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={confirmRemove}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
