"""Fetch genres and similar artists for Koito artists, most-played first, with caching."""
import logging
import time
from collections import Counter

from . import koito, sources, store

log = logging.getLogger(__name__)

RETRY_NONE_AFTER = 14 * 86400


def artists_by_plays(artists, plays) -> list[tuple[koito.Artist, int]]:
    counts = Counter(p.artist_id for p in plays)
    return [(artists[a], n) for a, n in counts.most_common()]


def enrich_genres(con, ranked, limit: int, retry_none: bool = False) -> int:
    meta = store.get_meta_all(con)
    now = time.time()
    done = 0
    for artist, _n in ranked:
        if done >= limit:
            break
        key = store.artist_key(artist.name, artist.mbid)
        m = meta.get(key)
        if m and not (m["source"] == "none" and (retry_none or now - m["fetched_at"] > RETRY_NONE_AFTER)):
            continue
        try:
            mbid, genres, source = resolve_artist(artist)
        except sources.TransientError as e:
            log.warning("skipping %s for now (%s)", artist.name, e)
            continue
        store.put_meta(con, key, mbid, genres, source)
        done += 1
        if done % 25 == 0:
            log.info("genres: %d fetched (latest: %s -> %s)", done, artist.name, genres[:2])
    return done


def resolve_artist(artist) -> tuple[str | None, list, str]:
    """(mbid, genres, source). Koito's MBIDs come from Last.fm and are sometimes a different
    artist with the same name; if that MBID has no genres, try a name search instead."""
    mbid, genres, source = artist.mbid, [], "none"
    if mbid:
        res = sources.mb_artist_genres(mbid)
        if res:
            genres, source = res
    if not genres:
        found = sources.mb_search_artist(artist.name)
        if found and found != mbid:
            res = sources.mb_artist_genres(found)
            if res and res[0]:
                mbid, (genres, source) = found, res
    if not genres:
        lfm = sources.lastfm_artist_tags(artist.name)
        if lfm:
            genres, source = lfm, "lastfm"
    return mbid, genres, source


def similar_for(con, mbid: str, max_age: int = 60 * 86400) -> list:
    row = con.execute("SELECT fetched_at FROM similar WHERE mbid=?", (mbid,)).fetchone()
    if row and time.time() - row[0] < max_age:
        return store.get_similar(con, mbid) or []
    try:
        data = sources.lb_similar(mbid)
    except sources.TransientError:
        data = None
    if data is None:
        return store.get_similar(con, mbid) or []
    store.put_similar(con, mbid, data)
    return data


def enrich_similar(con, seed_mbids: list[str]) -> None:
    for i, mbid in enumerate(seed_mbids):
        similar_for(con, mbid)
        if (i + 1) % 50 == 0:
            log.info("similar: %d/%d seeds", i + 1, len(seed_mbids))
