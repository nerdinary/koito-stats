"""koito-stats' own database: genre/similarity caches and computed results."""
import json
import sqlite3
import threading
import time

from . import config

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS artist_meta (
    key        TEXT PRIMARY KEY,      -- 'mbid:<uuid>' or 'name:<lowercased name>'
    mbid       TEXT,                  -- resolved MusicBrainz id (may come from a name search)
    genres     TEXT NOT NULL,         -- JSON [[genre, weight], ...] weights sum to 1
    source     TEXT NOT NULL,         -- musicbrainz | musicbrainz-tags | lastfm | none
    fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS similar (
    mbid       TEXT PRIMARY KEY,
    data       TEXT NOT NULL,         -- JSON [{mbid, name, score}, ...]
    fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
    key         TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    computed_at INTEGER NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    config.STATS_DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(config.STATS_DB, timeout=30, check_same_thread=False)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


def artist_key(name: str, mbid: str | None) -> str:
    return f"mbid:{mbid}" if mbid else f"name:{name.strip().lower()}"


def get_meta_all(con) -> dict[str, dict]:
    out = {}
    for key, mbid, genres, source, fetched in con.execute("SELECT * FROM artist_meta"):
        out[key] = {"mbid": mbid, "genres": json.loads(genres), "source": source, "fetched_at": fetched}
    return out


def put_meta(con, key: str, mbid: str | None, genres: list, source: str) -> None:
    with _lock:
        con.execute(
            "INSERT OR REPLACE INTO artist_meta VALUES (?,?,?,?,?)",
            (key, mbid, json.dumps(genres), source, int(time.time())),
        )
        con.commit()


def get_similar(con, mbid: str) -> list | None:
    row = con.execute("SELECT data FROM similar WHERE mbid=?", (mbid,)).fetchone()
    return json.loads(row[0]) if row else None


def put_similar(con, mbid: str, data: list) -> None:
    with _lock:
        con.execute("INSERT OR REPLACE INTO similar VALUES (?,?,?)", (mbid, json.dumps(data), int(time.time())))
        con.commit()


def put_result(con, key: str, data) -> None:
    with _lock:
        con.execute(
            "INSERT OR REPLACE INTO results VALUES (?,?,?)",
            (key, json.dumps(data, separators=(",", ":")), int(time.time())),
        )
        con.commit()


def get_result(con, key: str):
    row = con.execute("SELECT data, computed_at FROM results WHERE key=?", (key,)).fetchone()
    return (json.loads(row[0]), row[1]) if row else (None, None)
