// Turn a raw/technical error into a short, specific, human message so the user
// immediately knows whether the problem is their network/proxy, their API key,
// a temporary service blip, or something else — instead of a cryptic string
// like "Error invoking remote method 'resume:generate': Error: fetch failed".

export function friendlyError(err) {
  let msg =
    (err && err.message) ||
    (typeof err === "string" ? err : "") ||
    "Something went wrong. Please try again.";

  // Strip Electron's IPC wrapper and a leading "Error:" so we match on the
  // real provider/network message underneath.
  msg = msg.replace(/^Error invoking remote method '[^']*':\s*/i, "");
  while (/^Error:\s*/i.test(msg)) msg = msg.replace(/^Error:\s*/i, "");
  const low = msg.toLowerCase();

  // No key configured — already actionable, keep as-is.
  if (/no active api key/.test(low)) return msg;

  // Network / proxy: couldn't reach the provider at all.
  if (
    /fetch failed|request was cancelled|request was aborted|econnrefused|enotfound|eai_again|econnreset|socket hang|getaddrinfo|tunnel|proxy|certificate|self[- ]signed|und_err|dns|network/.test(
      low
    )
  ) {
    return "Network / Proxy problem: couldn't reach the AI service. Check your internet connection and your Proxy Settings (host, port, username/password), then try again.";
  }

  // Provider overloaded — transient, retried already but still failing.
  if (/high demand|overload|temporarily unavailable|unavailable|503|service is busy/.test(low)) {
    return "The AI service is busy right now (high demand). This is temporary — wait a few seconds and click Generate again.";
  }

  // Rate limit / quota.
  if (/rate.?limit|too many requests|429|quota|resource has been exhausted/.test(low)) {
    return "Rate limit reached for this API key. Wait a moment, slow down, or switch to a different API key under API Keys.";
  }

  // Auth — bad or wrong-provider key.
  if (
    /api[_ ]?key.*(invalid|not valid)|invalid.*api[_ ]?key|unauthor|forbidden|permission denied|401|403|authentication|api_key_invalid/.test(
      low
    )
  ) {
    return "Your API key was rejected. Open API Keys and check the key value — and make sure it matches the selected provider (Gemini / OpenAI / Anthropic).";
  }

  // Timeout.
  if (/timeout|timed out|deadline/.test(low)) {
    return "The request took too long and timed out. The service may be slow — please try again in a moment.";
  }

  // Otherwise return the cleaned underlying message (already fairly specific,
  // e.g. a provider's own validation text), capped so the toast stays readable.
  return msg.length > 240 ? msg.slice(0, 237) + "…" : msg;
}
