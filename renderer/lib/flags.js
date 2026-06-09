// Country detection from a free-text address, plus real flag icons rendered via
// the `flag-icons` CSS library (works on every platform, unlike flag emoji).

// Country name (and common aliases) -> ISO 3166-1 alpha-2 code.
const COUNTRIES = {
  estonia: "ee", latvia: "lv", lithuania: "lt", finland: "fi", sweden: "se",
  norway: "no", denmark: "dk", iceland: "is", poland: "pl", germany: "de",
  netherlands: "nl", belgium: "be", luxembourg: "lu", france: "fr", spain: "es",
  portugal: "pt", italy: "it", ireland: "ie", "united kingdom": "gb", uk: "gb",
  "great britain": "gb", england: "gb", scotland: "gb", wales: "gb", switzerland: "ch",
  austria: "at", czechia: "cz", "czech republic": "cz", slovakia: "sk", hungary: "hu",
  slovenia: "si", croatia: "hr", serbia: "rs", romania: "ro", bulgaria: "bg",
  greece: "gr", cyprus: "cy", malta: "mt", ukraine: "ua", belarus: "by",
  russia: "ru", turkey: "tr", "türkiye": "tr", georgia: "ge", armenia: "am",
  "united states": "us", "united states of america": "us", usa: "us",
  america: "us", canada: "ca", mexico: "mx", brazil: "br", argentina: "ar",
  chile: "cl", colombia: "co", "united arab emirates": "ae", uae: "ae",
  "saudi arabia": "sa", qatar: "qa", israel: "il", india: "in", pakistan: "pk",
  china: "cn", japan: "jp", "south korea": "kr", korea: "kr", singapore: "sg",
  malaysia: "my", indonesia: "id", philippines: "ph", thailand: "th",
  vietnam: "vn", australia: "au", "new zealand": "nz", "south africa": "za",
  egypt: "eg", nigeria: "ng", kenya: "ke", morocco: "ma",
};

// Resolve a country name or 2-letter code to a lowercase ISO2 code.
function toCode(country) {
  if (!country) return "";
  const c = String(country).trim();
  if (/^[A-Za-z]{2}$/.test(c)) return c.toLowerCase();
  return COUNTRIES[c.toLowerCase()] || "";
}

// A flag icon element for a country name (or ISO2 code); null when unknown.
export function countryFlag(country) {
  const code = toCode(country);
  if (!code) return null;
  return <span className={`fi fi-${code}`} />;
}

// Best-effort country from a free-text address (e.g. "Tallinn, Estonia").
// Prefers the longest country name found.
export function detectCountry(address) {
  if (!address) return "";
  const text = String(address).toLowerCase();
  let best = "";
  let bestLen = 0;
  for (const name of Object.keys(COUNTRIES)) {
    const re = new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
    if (re.test(text) && name.length > bestLen) {
      best = name;
      bestLen = name.length;
    }
  }
  if (!best) return "";
  return best
    .split(" ")
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
