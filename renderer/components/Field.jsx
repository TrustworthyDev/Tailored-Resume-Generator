// A simple labelled text input used throughout the account form.
export default function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        type={type}
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
