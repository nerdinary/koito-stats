"""External metadata sources: MusicBrainz (genres), ListenBrainz (similar artists), Last.fm (fallback)."""
import logging
import re
import threading
import time
import unicodedata

import requests

from . import config

log = logging.getLogger(__name__)

_session = requests.Session()
_session.headers["User-Agent"] = config.USER_AGENT

LB_SIMILAR_URL = "https://labs.api.listenbrainz.org/similar-artists/json"
LB_ALGORITHM = "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30"


class _RateLimiter:
    def __init__(self, interval: float):
        self.interval = interval
        self.last = 0.0
        self.lock = threading.Lock()

    def wait(self):
        with self.lock:
            delay = self.last + self.interval - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self.last = time.monotonic()


_mb_limit = _RateLimiter(1.1)
_lb_limit = _RateLimiter(0.5)
_lfm_limit = _RateLimiter(0.25)


class TransientError(Exception):
    """The source couldn't be reached; try again later rather than caching a miss."""


def _get(url: str, params: dict, limiter: _RateLimiter, retries: int = 3):
    """JSON response, None for 404, or TransientError after retries are exhausted."""
    for attempt in range(retries):
        limiter.wait()
        try:
            r = _session.get(url, params=params, timeout=20)
        except requests.RequestException as e:
            log.warning("request failed %s: %s", url, e)
            time.sleep(2 ** attempt)
            continue
        if r.status_code == 404:
            return None
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(5 * (attempt + 1))
            continue
        r.raise_for_status()
        try:
            return r.json()
        except ValueError:
            time.sleep(2 ** attempt)
            continue
    raise TransientError(url)


def _normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _weights(pairs: list[tuple[str, float]], top: int = 6) -> list[list]:
    pairs = sorted([p for p in pairs if p[1] > 0], key=lambda p: -p[1])[:top]
    total = sum(w for _, w in pairs)
    return [[g, round(w / total, 4)] for g, w in pairs] if total else []


def mb_artist_genres(mbid: str) -> tuple[list, str] | None:
    """Return (weighted genres, source) for a MusicBrainz artist, or None if it doesn't exist."""
    d = _get(f"https://musicbrainz.org/ws/2/artist/{mbid}", {"inc": "genres tags", "fmt": "json"}, _mb_limit)
    if d is None:
        return None
    genres = _weights([(g["name"], g.get("count", 1)) for g in d.get("genres", [])])
    if genres:
        return genres, "musicbrainz"
    # Fall back to raw tags; genre bucketing later discards tags that aren't genres.
    tags = _weights([(t["name"], t.get("count", 1)) for t in d.get("tags", [])])
    return tags, "musicbrainz-tags" if tags else "none"


def mb_search_artist(name: str) -> str | None:
    """Find an MBID for an artist name; only accept a confident exact-name match."""
    want = _normalize(name)
    if not want:
        return None
    escaped = re.sub(r'([+\-&|!(){}\[\]^"~*?:\\/])', r"\\\1", name)
    matches = []
    # The quoted field query is precise but misses names with '&' etc.; a plain query catches those.
    for query in (f'artist:"{name}"', escaped):
        d = _get("https://musicbrainz.org/ws/2/artist", {"query": query, "fmt": "json", "limit": 8}, _mb_limit)
        for a in (d or {}).get("artists", []):
            names = [a.get("name", "")] + [al.get("name", "") for al in a.get("aliases", []) or []]
            if a.get("score", 0) >= 90 and any(_normalize(n) == want for n in names):
                matches.append(a)
        if matches:
            break
    if not matches:
        return None
    # Several artists share most names; the well-known one has by far the most community tags.
    best = max(matches, key=lambda a: sum(t.get("count", 1) for t in a.get("tags", []) or []))
    return best["id"]


def lastfm_artist_tags(name: str) -> list | None:
    if not config.LASTFM_API_KEY:
        return None
    d = _get(
        "https://ws.audioscrobbler.com/2.0/",
        {"method": "artist.gettoptags", "artist": name, "api_key": config.LASTFM_API_KEY, "format": "json", "autocorrect": 1},
        _lfm_limit,
    )
    if not d or "toptags" not in d:
        return None
    return _weights([(t["name"].lower(), int(t.get("count", 0))) for t in d["toptags"].get("tag", [])], top=10)


def lb_similar(mbid: str) -> list | None:
    d = _get(LB_SIMILAR_URL, {"artist_mbids": mbid, "algorithm": LB_ALGORITHM}, _lb_limit)
    if d is None:
        return None
    return [{"mbid": x["artist_mbid"], "name": x["name"], "score": x["score"]} for x in d if x.get("artist_mbid")]
