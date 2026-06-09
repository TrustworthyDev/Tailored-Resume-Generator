# Careerva v1

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

## Data location
A real SQLite file `careerva.sqlite` is stored in Electron's `userData` directory
(Windows: `%APPDATA%/Careerva`). Data from the previous `TailorApply` name is
migrated automatically on first launch.
