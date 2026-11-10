"""Read-only access to Koito's SQLite database.

The database is opened with mode=ro, so this module can never modify Koito's data.
"""
import sqlite3
from dataclasses import dataclass

from . import config

# Plays with timestamps before this are bogus (Last.fm imports with no date -> epoch 0).
MIN_VALID_TS = 946684800  # 2000-01-01


@dataclass(slots=True)
class Artist:
    id: int
    name: str
    mbid: str | None


@dataclass(slots=True)
class Play:
    ts: int
    artist_id: int
    track_id: int


def connect() -> sqlite3.Connection:
    uri = f"file:{config.KOITO_DB.resolve()}?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=30)


def load() -> tuple[dict[int, Artist], list[Play], int]:
    """Return (artists by id, valid plays sorted by time, count of undated plays)."""
    con = connect()
    try:
        artists = {
            r[0]: Artist(r[0], r[1], r[2] or None)
            for r in con.execute("SELECT id, name, musicbrainz_id FROM artists_with_name")
        }
        rows = con.execute(
            """
            SELECT l.listened_at, at.artist_id, l.track_id
            FROM listens l
            JOIN artist_tracks at ON at.track_id = l.track_id AND at.is_primary = 1
            ORDER BY l.listened_at
            """
        ).fetchall()
    finally:
        con.close()
    excluded = excluded_names()
    if excluded:
        artists = {i: a for i, a in artists.items() if a.name.strip().casefold() not in excluded}
    plays = [Play(ts, a, t) for ts, a, t in rows if ts >= MIN_VALID_TS and a in artists]
    undated = sum(1 for ts, a, _ in rows if ts < MIN_VALID_TS and a in artists)
    return artists, plays, undated


def excluded_names() -> set[str]:
    try:
        lines = config.EXCLUDE_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return set()
    return {ln.strip().casefold() for ln in lines if ln.strip() and not ln.lstrip().startswith("#")}


def track_titles(track_ids: list[int]) -> dict[int, str]:
    if not track_ids:
        return {}
    con = connect()
    try:
        q = ",".join("?" * len(track_ids))
        return dict(con.execute(f"SELECT id, title FROM tracks_with_title WHERE id IN ({q})", track_ids))
    finally:
        con.close()
