// Whole years between a birth date (YYYY-MM-DD) and today.
// Returns "" when the date is missing or not a sensible birth date.
export function ageFromBirthDate(iso) {
  if (!iso) return "";
  const b = new Date(iso);
  if (isNaN(b.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 130 ? String(age) : "";
}
