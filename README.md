# Ogame RU Leaderboard

A static GitHub Pages leaderboard for public OGame RU universe statistics.

## Features

- Daily data refresh through GitHub Actions.
- Player rankings across all open RU universes.
- Tabs for points, economy, fleet, research, military stats, destroyed, lost, and honor points.
- Universe, top size, search, speed, fleet speed, and debris filters.
- Static deployment with no public backend.

## GitHub Pages

The site is deployed by `.github/workflows/deploy-pages.yml`.

The workflow:

- runs on pushes to `main`;
- can be started manually;
- runs once per day at `11:30 UTC`;
- fetches fresh OGame API data;
- builds a static `dist` folder;
- deploys the site to GitHub Pages.

Enable GitHub Pages in:

```text
Settings -> Pages -> Build and deployment -> Source -> GitHub Actions
```

After deployment, the site is available at:

```text
https://zikunow.github.io/stats_ogame_ru/
```

## Data

GitHub Actions generates:

```text
data/ogame-ru.json
```

The repository does not store this generated JSON file. The current version stores only the latest data snapshot during each deployment. Historical score tracking is not implemented yet.
