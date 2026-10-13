# RGenerator v1

Desktop app to generate tailored resumes (via Gemini) and track job applications.

**Stack:** Electron · Next.js · SQLite (`sql.js`, no native build needed).

## Features
- **Settings** — store an editable Gemini API key (name + key).
- **Personal Info** — name, title, email, phone, address, LinkedIn, portfolio link.
- **Work History** — add/edit/delete any number of roles (role, company, location, duration).
- **Generate Resume** — Gemini builds a Markdown resume from your info; optional job description to tailor it.
- **Tracker** — Start/End buttons control a counting session; shows total applications today.
- **Duplicate detection** — logging the same company + position fires a native OS notification and is blocked.

## Run (development)
```bash
npm install
npm run dev          # Next dev server + Electron with hot reload
```

## Run (production-like)
```bash
npm run start        # builds the Next.js export, then launches Electron
```

## Package an installer
```bash
npm run dist         # electron-builder -> release/
```

## Package a single portable exe
```bash
npm run build:next
npx electron-builder --win portable   # one self-contained .exe -> release/
```

## Data location
A real SQLite file `rgenerator.sqlite` is stored in Electron's `userData` directory
(Windows: `%APPDATA%/RGenerator`). Data from the previous `Careerva` and
`TailorApply` names — the database and the signed-in ChatGPT session — is
migrated automatically on first launch.

## Running several copies at once
Each simultaneous copy needs its own **profile**: one database, one signed-in
ChatGPT session, one set of settings. Two processes cannot share a profile — a
Chromium profile directory takes process-wide locks, so the second copy loses the
ChatGPT login, and the SQLite file is rewritten whole on every change, so
concurrent writers drop each other's rows.

```powershell
RGenerator.exe --profile=P1        # %APPDATA%\RGenerator Profiles\P1
RGenerator.exe --profile=P2        # …\P2
.\build\create-profile-shortcuts.ps1   # desktop shortcuts for P1, P2, P3
```

`RGENERATOR_PROFILE` does the same thing. The unpacked build (`Unpacked`) and the
portable exe (`Portable`) take a profile of their own automatically, so either can
run beside an install without a flag. Launching a profile that is already running
just brings its window forward. The profile name shows in the window title and in
the sidebar.

Per profile you need: a ChatGPT sign-in, and an API key in Settings. Application
history is per profile too — merge it with **Export SQLite** / **Import SQLite** in
Applications. Prefer a separate ChatGPT account and Gemini key per profile if you
run several generations in parallel, or they compete for the same rate limits.

The system clipboard is one slot shared by the whole desktop, so under a profile the
app never writes the prompt there on its own — copies running side by side would
overwrite each other's, and a manual paste would produce whichever finished last.
The prompt is typed into ChatGPT directly, and the reply is read back from
ChatGPT's own API, so no part of a run depends on the clipboard. Use **Copy
prompt** in the ChatGPT tab when you want one on the clipboard by hand.
