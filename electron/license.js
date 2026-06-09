// Machine-locked license activation.
// A license key is an HMAC-SHA256 signature of this machine's ID using a shared
// secret. The same secret + algorithm lives in the standalone keygen, so a key
// generated for a given Machine ID only validates on that one machine.

const crypto = require("crypto");
const os = require("os");
const { execSync } = require("child_process");

// Shared secret — MUST match the keygen tool. Keep the keygen private.
const SECRET = "Careerva-9f4Qe2$Kx7!pZr3@Lm8#Vn1&Hb6^Wd0-v1";

// A stable per-machine fingerprint (Windows MachineGuid; OS fallback).
function rawMachine() {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { windowsHide: true }
    ).toString();
    const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
    if (m) return m[1];
  } catch (_) {}
  return `${os.hostname()}|${os.platform()}|${os.arch()}`;
}

function machineId() {
  return crypto
    .createHash("sha256")
    .update(rawMachine())
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

function normalize(s) {
  return String(s || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

// The valid key for a given machine id.
function expectedKey(mid) {
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(mid)
    .digest("hex")
    .toUpperCase();
  return sig.slice(0, 20).match(/.{4}/g).join("-"); // e.g. ABCD-EF12-3456-7890-1234
}

function formatId(mid) {
  return mid.match(/.{4}/g).join("-");
}

function validate(key) {
  return normalize(key) === normalize(expectedKey(machineId()));
}

module.exports = { machineId, formatId, validate };
