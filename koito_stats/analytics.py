"""Compute listening analytics from Koito plays + cached genre metadata.

Everything here is pure computation over in-memory data; no network access.
"""
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import genres as G
from .koito import Artist, Play
from .store import artist_key

DAY = 86400


@dataclass
class Ctx:
    artists: dict[int, Artist]
    plays: list[Play]
    meta: dict[str, dict]
    tz: ZoneInfo
    now: float
    # derived
    local: list[datetime] = field(default_factory=list)
    artist_genres: dict[int, list] = field(default_factory=dict)  # artist_id -> [[genre, w], ...]
    artist_buckets: dict[int, dict] = field(default_factory=dict)  # artist_id -> {bucket: w}
    artist_mbid: dict[int, str | None] = field(default_factory=dict)


def build_ctx(artists, plays, meta, tz_name, now=None) -> Ctx:
    tz = ZoneInfo(tz_name)
    now = now or (plays[-1].ts if plays else 0)
    ctx = Ctx(artists, plays, meta, tz, now)
    ctx.local = [datetime.fromtimestamp(p.ts, tz) for p in plays]
    for aid, a in artists.items():
        m = meta.get(artist_key(a.name, a.mbid))
        gl = m["genres"] if m else []
        ctx.artist_genres[aid] = gl
        ctx.artist_buckets[aid] = G.bucket_weights(gl)
        ctx.artist_mbid[aid] = (m or {}).get("mbid") or a.mbid
    return ctx


# ---------------------------------------------------------------- helpers


def _entropy_eff(counter: Counter) -> float:
    total = sum(counter.values())
    if not total:
        return 0.0
    h = -sum((c / total) * math.log(c / total) for c in counter.values() if c)
    return math.exp(h)


def _share(d: dict, total: float) -> dict:
    return {k: (v / total if total else 0) for k, v in d.items()}


def _primary_genre(ctx: Ctx, aid: int) -> str | None:
    gl = ctx.artist_genres.get(aid) or []
    for g, _ in gl:
        if G.bucket_of(g):
            return g
    return None


def _primary_bucket(ctx: Ctx, aid: int) -> str | None:
    b = ctx.artist_buckets.get(aid)
    return max(b, key=b.get) if b else None


def _artist_ref(ctx: Ctx, aid: int) -> dict:
    a = ctx.artists[aid]
    return {"id": aid, "name": a.name, "genre": _primary_genre(ctx, aid), "bucket": _primary_bucket(ctx, aid)}


def _window(ctx: Ctx, start_ts: float, end_ts: float):
    return [p for p in ctx.plays if start_ts <= p.ts < end_ts]


# ---------------------------------------------------------------- sections


def overview(ctx: Ctx, undated: int) -> dict:
    plays = ctx.plays
    by_year = Counter(d.year for d in ctx.local)
    artists_year = defaultdict(set)
    first_seen = {}
    for p, d in zip(plays, ctx.local):
        artists_year[d.year].add(p.artist_id)
        first_seen.setdefault(p.artist_id, d.year)
    new_by_year = Counter(first_seen.values())
    known = sum(1 for p in plays if ctx.artist_buckets.get(p.artist_id))
    last365 = sum(1 for p in plays if p.ts >= ctx.now - 365 * DAY)
    cur = ctx.local[-1] if ctx.local else None
    return {
        "total_plays": len(plays),
        "undated_plays": undated,
        "artists": len({p.artist_id for p in plays}),
        "first_play": ctx.local[0].date().isoformat() if plays else None,
        "last_play": cur.isoformat() if cur else None,
        "plays_last_365": last365,
        "genre_coverage": round(known / len(plays), 4) if plays else 0,
        "years": [
            {
                "year": y,
                "plays": by_year[y],
                "artists": len(artists_year[y]),
                "new_artists": new_by_year.get(y, 0),
                "partial": cur is not None and y == cur.year,
            }
            for y in sorted(by_year)
        ],
    }


def genres_by_year(ctx: Ctx) -> dict:
    """Bucket share per year (weighted by each artist's genre distribution), plus trailing 12 months."""
    acc = defaultdict(Counter)
    known = Counter()
    total = Counter()
    for p, d in zip(ctx.plays, ctx.local):
        total[d.year] += 1
        bw = ctx.artist_buckets.get(p.artist_id)
        if not bw:
            continue
        known[d.year] += 1
        for b, w in bw.items():
            acc[d.year][b] += w
    rows = []
    for y in sorted(total):
        rows.append({"period": str(y), "coverage": round(known[y] / total[y], 3) if total[y] else 0,
                     "plays": total[y], "shares": {b: round(v, 4) for b, v in _share(acc[y], known[y]).items()}})
    # trailing 12 months
    t = Counter()
    k = 0
    n = 0
    for p in ctx.plays:
        if p.ts < ctx.now - 365 * DAY:
            continue
        n += 1
        bw = ctx.artist_buckets.get(p.artist_id)
        if bw:
            k += 1
            for b, w in bw.items():
                t[b] += w
    rows.append({"period": "Last 12 mo", "coverage": round(k / n, 3) if n else 0, "plays": n,
                 "shares": {b: round(v, 4) for b, v in _share(t, k).items()}})
    return {"buckets": G.BUCKETS, "rows": rows}


def _fine_shares(ctx: Ctx, plays) -> tuple[Counter, int]:
    acc = Counter()
    known = 0
    for p in plays:
        gl = [(g, w) for g, w in ctx.artist_genres.get(p.artist_id, []) if G.bucket_of(g)]
        if not gl:
            continue
        known += 1
        s = sum(w for _, w in gl)
        for g, w in gl:
            acc[g] += w / s
    return acc, known


def genre_movers(ctx: Ctx) -> dict:
    """Fine-grained genres: last 12 months vs the 3 years before that."""
    recent, rk = _fine_shares(ctx, _window(ctx, ctx.now - 365 * DAY, ctx.now + 1))
    before, bk = _fine_shares(ctx, _window(ctx, ctx.now - 4 * 365 * DAY, ctx.now - 365 * DAY))
    alltime, ak = _fine_shares(ctx, ctx.plays)
    if not rk or not bk:
        return {"rising": [], "falling": [], "new": []}
    rows = []
    for g in set(recent) | set(before):
        r = recent[g] / rk
        b = before[g] / bk
        if max(r, b) < 0.004:
            continue
        rows.append({"genre": g, "bucket": G.bucket_of(g), "recent": round(r, 4), "before": round(b, 4),
                     "delta": round(r - b, 4), "change": round(r / b - 1, 3) if b else None,
                     "alltime": round(alltime[g] / ak, 4) if ak else 0})
    # Rank by relative change: genre weights are split across an artist's tags, so point moves are tiny.
    # Ignore genres too small (< 0.5% in both windows) or moves too small (< 0.1 pt) to mean anything.
    movers = [x for x in rows if x["change"] is not None and x["before"] >= 0.001
              and max(x["recent"], x["before"]) >= 0.005 and abs(x["delta"]) >= 0.001]
    rising = sorted([x for x in movers if x["change"] > 0], key=lambda x: -x["change"])[:8]
    falling = sorted([x for x in movers if x["change"] < 0], key=lambda x: x["change"])[:8]
    new = sorted([x for x in rows if x["recent"] >= 0.005 and x["alltime"] - x["recent"] * rk / ak < 0.0015
                  and x["before"] < 0.001], key=lambda x: -x["recent"])[:8]
    return {"rising": rising, "falling": falling, "new": new,
            "window": {"recent": "last 12 months", "before": "the 3 years before"}}


def novelty_and_diversity(ctx: Ctx) -> list[dict]:
    first_ts = {}
    for p in ctx.plays:
        first_ts.setdefault(p.artist_id, p.ts)
    by_year = defaultdict(Counter)
    new_plays = Counter()
    for p, d in zip(ctx.plays, ctx.local):
        by_year[d.year][p.artist_id] += 1
        # "new" = artist first heard within the previous 365 days of this play
        if p.ts - first_ts[p.artist_id] <= 365 * DAY:
            new_plays[d.year] += 1
    out = []
    first_year = ctx.local[0].year if ctx.local else None
    for y in sorted(by_year):
        c = by_year[y]
        total = sum(c.values())
        top10 = sum(n for _, n in c.most_common(10))
        gc = Counter()
        for aid, n in c.items():
            for b, w in ctx.artist_buckets.get(aid, {}).items():
                gc[b] += n * w
        out.append({
            "year": y,
            "plays": total,
            # the first year of history: everything is "new", so not meaningful
            "new_share": None if y == first_year else round(new_plays[y] / total, 4),
            "effective_artists": round(_entropy_eff(c), 1),
            "top10_share": round(top10 / total, 4),
            "effective_buckets": round(_entropy_eff(gc), 2),
        })
    return out


def heatmap(ctx: Ctx) -> dict:
    def grid(since):
        g = [[0] * 24 for _ in range(7)]
        for p, d in zip(ctx.plays, ctx.local):
            if p.ts >= since:
                g[d.weekday()][d.hour] += 1
        return g

    return {"all": grid(0), "last12": grid(ctx.now - 365 * DAY), "tz": str(ctx.tz)}


def _monthly(ctx: Ctx):
    """artist -> {YYYY-MM: plays}, and month totals."""
    per = defaultdict(Counter)
    tot = Counter()
    for p, d in zip(ctx.plays, ctx.local):
        m = f"{d.year:04d}-{d.month:02d}"
        per[p.artist_id][m] += 1
        tot[m] += 1
    return per, tot


def _month_range(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    ly, lm = map(int, last.split("-"))
    out = []
    while (y, m) <= (ly, lm):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def obsessions(ctx: Ctx, per, tot) -> list[dict]:
    """Episodes of consecutive months where one artist dominated your listening."""
    if not tot:
        return []
    months = _month_range(min(tot), max(tot))
    idx = {m: i for i, m in enumerate(months)}
    episodes = []
    for aid, mc in per.items():
        def is_hot(m, n):
            if n < 15:
                return False
            share = n / tot[m]
            if share >= 0.12:
                return True
            i = idx[m]
            usual = sum(mc.get(months[j], 0) for j in range(max(0, i - 12), i)) / 12
            return share >= 0.05 and n >= 3 * max(usual, 3)

        hot = sorted(m for m, n in mc.items() if is_hot(m, n))
        if not hot:
            continue
        # group consecutive months (allow a 1-month gap)
        groups, cur = [], [hot[0]]
        for m in hot[1:]:
            if idx[m] - idx[cur[-1]] <= 2:
                cur.append(m)
            else:
                groups.append(cur)
                cur = [m]
        groups.append(cur)
        for g in groups:
            s, e = idx[g[0]], idx[g[-1]]
            plays = sum(mc.get(months[i], 0) for i in range(s, e + 1))
            span = e - s + 1
            peak_m = max(g, key=lambda m: mc[m] / tot[m])
            after = [mc.get(months[i], 0) for i in range(e + 1, min(e + 13, len(months)))]
            before = [mc.get(months[i], 0) for i in range(max(0, s - 12), s)]
            spark_lo, spark_hi = max(0, s - 6), min(len(months), e + 13)
            episodes.append({
                **_artist_ref(ctx, aid),
                "start": g[0], "end": g[-1], "months": span, "plays": plays,
                "peak_month": peak_m, "peak_share": round(mc[peak_m] / tot[peak_m], 3),
                "before_monthly": round(sum(before) / 12, 1),
                "during_monthly": round(plays / span, 1),
                # None when the episode is too recent to judge
                "after_monthly": round(sum(after) / len(after), 1) if len(after) >= 6 else None,
                "spark": {"start": months[spark_lo], "values": [mc.get(months[i], 0) for i in range(spark_lo, spark_hi)]},
            })
    episodes.sort(key=lambda x: x["start"], reverse=True)
    return episodes


def comebacks(ctx: Ctx) -> list[dict]:
    """Artists you returned to after 2+ years of silence."""
    by_artist = defaultdict(list)
    for p in ctx.plays:
        by_artist[p.artist_id].append(p.ts)
    out = []
    for aid, ts in by_artist.items():
        if len(ts) < 40:
            continue
        for i in range(1, len(ts)):
            gap = ts[i] - ts[i - 1]
            if gap < 730 * DAY or i < 25:
                continue
            after = [t for t in ts[i:] if t - ts[i] <= 90 * DAY]
            if len(after) < 8:
                continue
            ret = datetime.fromtimestamp(ts[i], ctx.tz)
            out.append({
                **_artist_ref(ctx, aid),
                "returned": ret.date().isoformat(),
                "gap_years": round(gap / (365.25 * DAY), 1),
                "plays_before": i,
                "plays_first_90d": len(after),
                "last_before": datetime.fromtimestamp(ts[i - 1], ctx.tz).date().isoformat(),
            })
    out.sort(key=lambda x: x["returned"], reverse=True)
    return out


def top_artists(ctx: Ctx, since: float, limit: int = 60) -> list[dict]:
    c = Counter(p.artist_id for p in ctx.plays if p.ts >= since)
    return [{**_artist_ref(ctx, aid), "plays": n} for aid, n in c.most_common(limit)]


def rising_artists(ctx: Ctx) -> list[dict]:
    recent = Counter(p.artist_id for p in ctx.plays if p.ts >= ctx.now - 90 * DAY)
    prior = Counter(p.artist_id for p in ctx.plays if ctx.now - 455 * DAY <= p.ts < ctx.now - 90 * DAY)
    rtot = sum(recent.values()) or 1
    ptot = sum(prior.values()) or 1
    rows = []
    for aid, n in recent.items():
        if n < 10:
            continue
        rs, ps = n / rtot, prior[aid] / ptot
        rows.append({**_artist_ref(ctx, aid), "recent_plays": n, "prior_plays": prior[aid],
                     "recent_share": round(rs, 4), "prior_share": round(ps, 4), "lift": round(rs - ps, 4)})
    return sorted(rows, key=lambda x: -x["lift"])[:12]


def recommendations(ctx: Ctx, similar: dict[str, list], meta_by_mbid: dict[str, list], limit: int = 40) -> list[dict]:
    """Unheard artists that are similar to many of your most-played (and recently played) artists."""
    alltime = Counter(p.artist_id for p in ctx.plays)
    recent = Counter(p.artist_id for p in ctx.plays if p.ts >= ctx.now - 365 * DAY)
    amax = max(alltime.values(), default=1)
    rmax = max(recent.values(), default=1)
    weight = {aid: 0.4 * math.sqrt(alltime[aid] / amax) + 0.6 * math.sqrt(recent.get(aid, 0) / rmax) for aid in alltime}
    heard_mbids = {m for m in ctx.artist_mbid.values() if m}
    heard_names = {G.norm_name(a.name) for a in ctx.artists.values()}
    seeds, seen = [], set()
    # duplicate Koito artists (e.g. differing apostrophes) share an MBID; count each MBID once
    for aid in sorted((a for a in weight if ctx.artist_mbid.get(a) in similar), key=lambda a: -weight[a]):
        if ctx.artist_mbid[aid] not in seen:
            seen.add(ctx.artist_mbid[aid])
            seeds.append(aid)
    seeds = seeds[:150]

    score = Counter()
    because = defaultdict(list)
    names = {}
    for aid in seeds:
        lst = similar[ctx.artist_mbid[aid]]
        for rank, s in enumerate(lst[:60]):
            if s["mbid"] in heard_mbids or G.norm_name(s["name"]) in heard_names:
                continue
            contrib = weight[aid] / math.sqrt(rank + 1)
            score[s["mbid"]] += contrib
            because[s["mbid"]].append((contrib, aid))
            names[s["mbid"]] = s["name"]
    out = []
    for mbid, sc in score.most_common(limit):
        bc = sorted(because[mbid], reverse=True)[:3]
        gl = meta_by_mbid.get(mbid) or []
        out.append({
            "mbid": mbid, "name": names[mbid], "score": round(sc, 3),
            "genres": [g for g, _ in gl if G.bucket_of(g)][:3],
            "bucket": (lambda w: max(w, key=w.get) if w else None)(G.bucket_weights(gl)),
            "because": [_artist_ref(ctx, aid) for _, aid in bc],
            "seed_count": len(because[mbid]),
        })
    return out


# ---------------------------------------------------------------- insights
_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _month_name(iso: str) -> str:
    """'2026-10' or '2026-10-03' -> 'October 2026'."""
    y, m = iso[:4], int(iso[5:7])
    return f"{_MONTHS[m - 1]} {y}"



def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def insights(ov, gby, movers, nd, heat, obs, cbs, rising) -> list[dict]:
    """Plain-language observations derived from the computed sections."""
    out = []
    years = [y for y in ov["years"] if not y["partial"]]

    # Volume change
    if len(years) >= 2 and ov["years"][-1]["partial"]:
        last_full = years[-1]
        out.append({"kind": "volume", "text": f"You've logged {ov['plays_last_365']:,} plays in the last 12 months, versus {last_full['plays']:,} in {last_full['year']}.",
                    "fig": {"value": ov["plays_last_365"], "prev": last_full["plays"], "prev_year": last_full["year"]}})

    # Biggest bucket shift: last 12 months vs your first 3 years
    rows = gby["rows"]
    if len(rows) >= 5:
        early = Counter()
        for r in rows[:3]:
            for b, v in r["shares"].items():
                early[b] += v / 3
        recent = rows[-1]["shares"]
        deltas = sorted(((recent.get(b, 0) - early.get(b, 0), b) for b in set(early) | set(recent)))
        (dn, bdn), (up, bup) = deltas[0], deltas[-1]
        span = f"{rows[0]['period']}–{rows[2]['period']}"
        if up > 0.03:
            out.append({"kind": "genre", "text": f"{bup} has grown from {_pct(early.get(bup, 0))} of your listening in {span} to {_pct(recent.get(bup, 0))} over the last 12 months.",
                        "fig": {"bucket": bup, "from": round(early.get(bup, 0), 4), "to": round(recent.get(bup, 0), 4), "span": span}})
        if dn < -0.03:
            out.append({"kind": "genre", "text": f"{bdn} has shrunk from {_pct(early.get(bdn, 0))} in {span} to {_pct(recent.get(bdn, 0))} now.",
                        "fig": {"bucket": bdn, "from": round(early.get(bdn, 0), 4), "to": round(recent.get(bdn, 0), 4), "span": span}})

    if movers["rising"] and movers["rising"][0]["delta"] >= 0.01:
        g = movers["rising"][0]
        out.append({"kind": "genre", "text": f"Fastest-rising genre: {g['genre']}, now {g['recent'] * 100:.1f}% of your plays, up from {g['before'] * 100:.1f}% in the 3 years before.",
                    "fig": {"bucket": g["bucket"], "from": g["before"], "to": g["recent"], "span": "3 years before"}})
    if movers["new"]:
        names = ", ".join(x["genre"] for x in movers["new"][:3])
        out.append({"kind": "newgenres", "text": f"New territory this year: {names}, genres you'd barely touched before.",
                    "fig": {"genres": [{"genre": x["genre"], "bucket": x["bucket"], "share": x["recent"]} for x in movers["new"][:3]]}})

    # Diversity trend
    full = [r for r in nd if r["year"] in {y["year"] for y in years}]
    if len(full) >= 6:
        a, b = full[-6], full[-1]
        if b["effective_artists"] > a["effective_artists"] * 1.15:
            out.append({"kind": "diversity", "text": f"Your listening is more spread out than it was: in {b['year']} it was as varied as {round(b['effective_artists'])} equally-played artists, up from {round(a['effective_artists'])} in {a['year']}.",
                        "fig": {"value": round(b["effective_artists"]), "year": b["year"], "from_year": a["year"]}})
        elif b["effective_artists"] < a["effective_artists"] * 0.85:
            out.append({"kind": "diversity", "text": f"Your listening has narrowed: in {b['year']} it was as varied as {round(b['effective_artists'])} equally-played artists, down from {round(a['effective_artists'])} in {a['year']}.",
                        "fig": {"value": round(b["effective_artists"]), "year": b["year"], "from_year": a["year"]}})
    if full:
        ns = [r for r in full if r["new_share"] is not None]
        if ns:
            hi = max(ns, key=lambda r: r["new_share"])
            out.append({"kind": "novelty", "text": f"{hi['year']} was your most exploratory year: {_pct(hi['new_share'])} of plays were artists you'd found in the previous 12 months.",
                        "fig": {"year": hi["year"], "value": hi["new_share"]}})

    # Rhythm
    g = heat["last12"]
    tot = sum(map(sum, g))
    if tot:
        days = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
        dsum = [sum(r) for r in g]
        hsum = [sum(g[d][h] for d in range(7)) for h in range(24)]
        pd, ph = max(range(7), key=dsum.__getitem__), max(range(24), key=hsum.__getitem__)
        out.append({"kind": "rhythm", "text": f"Over the last year you listen most on {days[pd]}, and your peak hour is {ph % 12 or 12}{'am' if ph < 12 else 'pm'}.",
                    "fig": {"day": pd, "hour": ph, "days": dsum, "hours": hsum}})

    if obs:
        o = obs[0]
        out.append({"kind": "obsession", "text": f"Most recent obsession: {o['name']} in {_month_name(o['start'])}, {o['plays']} plays, peaking at {_pct(o['peak_share'])} of everything you played that month.",
                    "fig": {"id": o["id"], "name": o["name"], "bucket": o.get("bucket"), "plays": o["plays"]}})
    if cbs:
        c = cbs[0]
        out.append({"kind": "comeback", "text": f"Latest comeback: {c['name']}, back in {_month_name(c['returned'])} after {c['gap_years']} years away.",
                    "fig": {"id": c["id"], "name": c["name"], "bucket": c.get("bucket"), "gap_years": c["gap_years"],
                            "last_before": c["last_before"], "returned": c["returned"], "plays_before": c["plays_before"]}})
    if rising:
        r = rising[0]
        out.append({"kind": "rising", "text": f"On the rise: {r['name']}, with {r['recent_plays']} plays in the last 90 days.",
                    "fig": {"id": r["id"], "name": r["name"], "bucket": r.get("bucket"), "plays": r["recent_plays"],
                            "from": r["prior_share"], "to": r["recent_share"]}})
    return out


def compute(ctx: Ctx, undated: int, similar: dict, meta_by_mbid: dict) -> dict:
    per, tot = _monthly(ctx)
    ov = overview(ctx, undated)
    gby = genres_by_year(ctx)
    mv = genre_movers(ctx)
    nd = novelty_and_diversity(ctx)
    hm = heatmap(ctx)
    ob = obsessions(ctx, per, tot)
    cb = comebacks(ctx)
    ri = rising_artists(ctx)
    return {
        "overview": ov,
        "genres_by_year": gby,
        "genre_movers": mv,
        "novelty_diversity": nd,
        "heatmap": hm,
        "obsessions": ob[:30],
        "comebacks": cb[:20],
        "rising": ri,
        "top_all": top_artists(ctx, 0),
        "top_12m": top_artists(ctx, ctx.now - 365 * DAY),
        "recommendations": recommendations(ctx, similar, meta_by_mbid),
        "insights": insights(ov, gby, mv, nd, hm, ob, cb, ri),
        "bucket_colors": G.BUCKETS,
    }
