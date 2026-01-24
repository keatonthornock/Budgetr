# Budgetr — simple PWA for family finances

## Install locally
- Clone this repo, run a static server (or deploy to GitHub Pages).
- Files needed: index.html, styles.css, app.js, manifest.webmanifest, service-worker.js, /icons/*

## Deploy to GitHub Pages
1. Create a public repository and push these files to the `main` branch.
2. In GitHub repo → Settings → Pages: set Source to `main` / `/ (root)`.
3. Wait a minute, then open `https://<your-username>.github.io/<repo>/`.

## Add to iPhone home screen
- Open the site in Safari → Share → Add to Home Screen.

## Data & sharing notes
- All data is stored on-device (IndexedDB). To share between phones: use Export → send the JSON file via AirDrop / iCloud / Dropbox → Import on the other device.
- If you want automatic sync, I can add optional integrations (Firebase / Supabase / GitHub-backed encrypted sync), but that requires a hosted service.

