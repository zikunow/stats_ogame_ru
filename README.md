# Ogame RU Leaderboard

A static GitHub Pages leaderboard for public OGame RU universe statistics.

## Features

- Daily data refresh through GitHub Actions.
- Lazy loading of one ranking at a time.
- Player rankings across all open RU universes.
- Tabs for points, economy, fleet, research, military stats, destroyed, lost, and honor points.
- Universe, top size, search, speed, fleet speed, and debris filters.
- Static deployment with no public backend.

## GitHub Pages

The site is deployed by `.github/workflows/deploy-pages.yml`.

The workflow:

- runs on pushes to `main`;
- can be started manually;
- runs once per day at `02:00 UTC`;
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

GitHub Actions stores every daily snapshot in small files:

```text
data/history/index.json
data/history/YYYY-MM-DD/meta.json
data/history/YYYY-MM-DD/stats/0.json
data/history/YYYY-MM-DD/stats/fleet.json
...
```

The browser initially downloads only the metadata and the overall-points ranking. Other rankings are loaded on demand and cached for the rest of the session. Each row already contains its change from the previous available daily snapshot.
