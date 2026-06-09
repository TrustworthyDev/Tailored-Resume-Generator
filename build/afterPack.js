// Embed the app icon into the freshly-built .exe.
//
// We keep electron-builder's `signAndEditExecutable` disabled because its
// version-string editing batch fails on this machine ("Unable to commit
// changes", which also leaves giant RCX*.tmp files behind). Setting just the
// icon with rcedit works, so we do it here — with retries for the antivirus
// lock on the just-written exe, and tmp-file cleanup so failed attempts never
// leave ~180 MB RCX*.tmp copies behind. Non-fatal: a build is never failed
// just because the icon couldn't be stamped.

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function (context) {
  if (context.electronPlatformName !== "win32") return;

  const outDir = context.appOutDir;
  const exe = path.join(outDir, context.packager.appInfo.productFilename + ".exe");
  const rcedit = path.join(__dirname, "rcedit-x64.exe");
  const ico = path.join(__dirname, "icon.ico");

  // Remove rcedit's leftover temp copies (one per failed attempt).
  const cleanupTmp = () => {
    try {
      for (const f of fs.readdirSync(outDir)) {
        if (/^RCX.*\.tmp$/i.test(f)) {
          try { fs.unlinkSync(path.join(outDir, f)); } catch (_) {}
        }
      }
    } catch (_) {}
  };

  if (!fs.existsSync(rcedit) || !fs.existsSync(ico)) {
    console.warn("  ! afterPack: rcedit or icon.ico missing — icon not applied");
    return;
  }

  let applied = false;
  let lastErr;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      execFileSync(rcedit, [exe, "--set-icon", ico], { stdio: "ignore" });
      applied = true;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(2000); // let antivirus release the lock, then retry
    }
  }

  cleanupTmp();

  if (applied) {
    console.log("  • applied app icon to " + path.basename(exe));
  } else {
    console.warn(
      "  ! afterPack: could not set app icon after retries — " +
        (lastErr && lastErr.message)
    );
  }
};
