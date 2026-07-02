# Ogame RU Leaderboard

A static leaderboard dashboard for public OGame RU universe statistics.

## Features

- Daily data refresh through GitHub Actions.
- Player rankings across all open RU universes.
- Tabs for points, economy, fleet, research, military stats, destroyed, lost, and honor points.
- Universe, top size, search, speed, fleet speed, and debris filters.
- Static GitHub Pages deployment with no backend required.

## Local Usage

```powershell
npm.cmd run fetch
npm.cmd start
```

Open:

```text
http://localhost:5173
```

Local settings are stored in `.env`:

```env
PORT=5173
BASE_PATH=
UNIVERSE_LIMIT=0
```

`UNIVERSE_LIMIT=0` means all universes. Use `1` for a quick test run.

## GitHub Pages

The project is ready for GitHub Pages deployment.

The workflow in `.github/workflows/deploy-pages.yml`:

- runs on pushes to `main`;
- can be started manually;
- runs once per day at `11:30 UTC`;
- fetches fresh OGame API data;
- builds a static `dist` folder;
- deploys the site to GitHub Pages.

In the GitHub repository, enable:

```text
Settings -> Pages -> Build and deployment -> Source -> GitHub Actions
```

On GitHub Pages, the manual refresh button is hidden because updates are handled by GitHub Actions.

## Data

Local data is stored in:

```text
data/ogame-ru.json
```

This file is ignored by git. GitHub Actions creates it during deployment.

The current version stores only the latest data snapshot. Historical score tracking is not implemented yet.
