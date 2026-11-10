"""Refresh cycle: read Koito -> enrich -> compute -> publish results + in-memory index."""
import json
import logging
import threading
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from . import analytics, config, enrich, koito, sources, store
from .genres import norm_name

log = logging.getLogger(__name__)
DAY = 86400


@dataclass
class Index:
    """What the explore/search endpoints need, rebuilt on every refresh."""
    artists: dict = field(default_factory=dict)        # id -> Artist
    plays: Counter = field(default_factory=Counter)
    plays_12m: Counter = field(default_factory=Counter)
    yearly: dict = field(default_factory=dict)         # id -> {year: n}
    first_last: dict = field(default_factory=dict)     # id -> (first_ts, last_ts)
    top_tracks: dict = field(default_factory=dict)     # id -> [(track_id, n)]
    mbid_to_id: dict = field(default_factory=dict)
    name_to_id: dict = field(default_factory=dict)
    genres: dict = field(default_factory=dict)         # id -> [[g, w]]
    computed_at: float = 0


INDEX = Index()
_compute_lock = threading.Lock()


def _build_index(ctx: analytics.Ctx) -> Index:
    idx = Index(artists=ctx.artists, computed_at=time.time())
    yearly = defaultdict(Counter)
    tracks = defaultdict(Counter)
    for p, d in zip(ctx.plays, ctx.local):
        idx.plays[p.artist_id] += 1
        if p.ts >= ctx.now - 365 * DAY:
            idx.plays_12m[p.artist_id] += 1
        yearly[p.artist_id][d.year] += 1
        tracks[p.artist_id][p.track_id] += 1
        fl = idx.first_last.get(p.artist_id)
        idx.first_last[p.artist_id] = (fl[0] if fl else p.ts, p.ts)
    idx.yearly = {a: dict(c) for a, c in yearly.items()}
    idx.top_tracks = {a: c.most_common(5) for a, c in tracks.items()}
    for aid in idx.plays:
        mbid = ctx.artist_mbid.get(aid)
        # if two Koito artists share an MBID, keep the more-played one
        if mbid and (mbid not in idx.mbid_to_id or idx.plays[aid] > idx.plays[idx.mbid_to_id[mbid]]):
            idx.mbid_to_id[mbid] = aid
        n = norm_name(ctx.artists[aid].name)
        if n not in idx.name_to_id or idx.plays[aid] > idx.plays[idx.name_to_id[n]]:
            idx.name_to_id[n] = aid
        idx.genres[aid] = ctx.artist_genres.get(aid, [])
    return idx


def compute_all() -> dict:
    global INDEX
    with _compute_lock:
        t0 = time.time()
        con = store.connect()
        artists, plays, undated = koito.load()
        meta = store.get_meta_all(con)
        ctx = analytics.build_ctx(artists, plays, meta, config.TZ, now=time.time())
        similar = {m: json.loads(d) for m, d in con.execute("SELECT mbid, data FROM similar")}
        meta_by_mbid = {k[5:]: v["genres"] for k, v in meta.items() if k.startswith("mbid:")}
        meta_by_mbid.update({v["mbid"]: v["genres"] for v in meta.values() if v.get("mbid")})
        result = analytics.compute(ctx, undated, similar, meta_by_mbid)
        result["generated_at"] = int(time.time())
        store.put_result(con, "dashboard", result)
        INDEX = _build_index(ctx)
        con.close()
        log.info("computed dashboard for %d plays in %.1fs", len(plays), time.time() - t0)
        return result


def refresh_cycle() -> None:
    con = store.connect()
    artists, plays, _ = koito.load()
    ranked = enrich.artists_by_plays(artists, plays)
    n = enrich.enrich_genres(con, ranked, config.ENRICH_BATCH)
    log.info("refresh: fetched genres for %d artists", n)

    meta = store.get_meta_all(con)
    seeds = []
    for a, _ in ranked:
        mbid = (meta.get(store.artist_key(a.name, a.mbid)) or {}).get("mbid") or a.mbid
        if mbid:
            seeds.append(mbid)
        if len(seeds) >= 300:
            break
    enrich.enrich_similar(con, seeds)
    compute_all()

    # genres for recommended (unheard) artists, so the discover list can show them
    data, _ = store.get_result(con, "dashboard")
    missing = [r["mbid"] for r in (data or {}).get("recommendations", []) if f"mbid:{r['mbid']}" not in meta]
    for mbid in missing:
        try:
            res = sources.mb_artist_genres(mbid)
        except sources.TransientError:
            continue
        if res:
            store.put_meta(con, f"mbid:{mbid}", mbid, res[0], res[1])
    if missing:
        compute_all()
    con.close()


def run_forever(stop: threading.Event) -> None:
    try:
        compute_all()  # fast first render from whatever is cached
    except Exception:
        log.exception("initial compute failed")
    while not stop.is_set():
        try:
            refresh_cycle()
        except Exception:
            log.exception("refresh cycle failed")
        stop.wait(config.REFRESH_INTERVAL)
