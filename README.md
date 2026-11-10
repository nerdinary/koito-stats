# koito-stats

Listening analytics for a [Koito](https://github.com/gabehf/koito) instance, served at `/stats` next to it.

- **Genre shift**: share of plays per genre group per year, plus fine-grained genres rising and fading
- **Explore**: click through similar artists; circle size = your plays, hollow circles = artists you've never played
- **Discover**: unheard artists similar to many of your favourites
- **Trends**: plays per year, novelty, variety, weekday×hour heatmap, obsessions, comebacks, rising artists

It reads Koito's SQLite database **read-only** and never writes to it. Genres come from MusicBrainz
(optionally Last.fm), similar artists from ListenBrainz; both are cached in its own `stats.db`.

## Run locally

```bash
python3 -m venv --without-pip .venv && pip3 --python .venv/bin/python install -r requirements.txt
# copy of Koito's DB at data/koito.db (KOITO_DB to override)
.venv/bin/python -m koito_stats enrich --limit 2500 --similar-seeds 300   # one-off warm-up (~1h)
.venv/bin/python -m koito_stats serve --port 8765                         # http://localhost:8765/stats/
```

## Deploy (next to Koito, behind Caddy)

1. Copy this directory to `~/dkr/koito-stats` on the server (optionally copy `data/stats.db` too, to skip the warm-up).
2. `docker compose up -d --build`
3. Route `/stats` to it in the Caddyfile and reload Caddy:

```
scrobble.example.com {
  encode gzip
  handle /stats* {
    reverse_proxy koito-stats:8000
  }
  handle {
    reverse_proxy koito:4110
  }
}
```

## Configuration (env)

| Variable | Default | |
|---|---|---|
| `KOITO_DB` | `data/koito.db` (`/koito/koito.db` in Docker) | Koito's SQLite file |
| `STATS_DB` | `data/stats.db` (`/data/stats.db` in Docker) | this app's cache |
| `BASE_PATH` | `/stats` | URL prefix |
| `STATS_TZ` | `Australia/Sydney` | timezone for years/hours |
| `REFRESH_INTERVAL` | `3600` | seconds between refreshes |
| `STATS_UID` / `STATS_GID` | `1000` | user the container runs as; set them in `.env` to the owner of `./data` (1001 on the VPS) |
| `ENRICH_BATCH` | `400` | max new artists looked up per refresh |
| `LASTFM_API_KEY` | – | optional genre fallback |
| `MB_CONTACT` | – | optional contact added to the MusicBrainz User-Agent |
