// What to tell the user after copying a resume path, when that application
// repeats an earlier one for the same account + company + role. Takes the
// result of api().markPathCopied(); returns "" when it isn't a duplicate.
export function duplicateNotice(res) {
  if (!res || !res.ok || !res.duplicates) return "";
  const what = [res.role, res.company ? `at ${res.company}` : ""].filter(Boolean).join(" ");
  const when = res.firstAppliedAt ? new Date(res.firstAppliedAt) : null;
  const date = when && !isNaN(when) ? ` on ${when.toLocaleDateString()}` : "";
  const times = res.duplicates > 1 ? `${res.duplicates} times before` : "before";
  const copied = res.copiedBefore
    ? ` — and a resume path for it was copied ${res.copiedBefore > 1 ? `${res.copiedBefore} times` : "already"}`
    : "";
  return `Duplicate: this account applied to ${what || "this job"} ${times} (first${date})${copied}.`;
}
