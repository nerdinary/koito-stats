"""FastAPI app serving the /stats page and its JSON API."""
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config, enrich, koito, sources, store, worker
from .genres import bucket_of, bucket_weights, norm_name

STATIC = Path(__file__).resolve().parent.parent / "static"
BASE = config.BASE_PATH
START_WORKER = True


@asynccontextmanager
async def lifespan(app):
    stop = threading.Event()
    if START_WORKER:
        threading.Thread(target=worker.run_forever, args=(stop,), daemon=True).start()
    else:
        threading.Thread(target=worker.compute_all, daemon=True).start()
    yield
    stop.set()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.mount(f"{BASE}/static", StaticFiles(directory=STATIC), name="static")


def _genres(gl: list, n: int = 3) -> list[str]:
    return [g for g, _ in gl if bucket_of(g)][:n]


@app.get(BASE)
def _redirect():
    return RedirectResponse(f"{BASE}/")


@app.get(f"{BASE}/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.get(f"{BASE}/api/health")
def health():
    return {"ok": True, "computed_at": worker.INDEX.computed_at}


@app.get(f"{BASE}/api/dashboard")
def dashboard():
    con = store.connect()
    try:
        data, _ = store.get_result(con, "dashboard")
    finally:
        con.close()
    if data is None:
        raise HTTPException(503, "Stats are still being computed; try again in a minute.")
    return JSONResponse(data, headers={"Cache-Control": "no-cache"})


@app.get(f"{BASE}/api/search")
def search(q: str = Query(..., min_length=1, max_length=100)):
    idx = worker.INDEX
    nq = norm_name(q)
    hits = [aid for aid, a in idx.artists.items() if idx.plays.get(aid) and nq in norm_name(a.name)]
    hits.sort(key=lambda a: (not norm_name(idx.artists[a].name).startswith(nq), -idx.plays[a]))
    return [{"id": a, "name": idx.artists[a].name, "plays": idx.plays[a]} for a in hits[:12]]


def _bucket(gl: list) -> str | None:
    w = bucket_weights(gl)
    return max(w, key=w.get) if w else None


def _node(idx, aid: int | None, mbid: str | None, name: str | None, meta: dict | None = None) -> dict:
    if aid is not None:
        a = idx.artists[aid]
        gl = idx.genres.get(aid, [])
        return {"id": aid, "mbid": mbid, "name": a.name, "heard": True,
                "plays": idx.plays.get(aid, 0), "plays_12m": idx.plays_12m.get(aid, 0),
                "genres": _genres(gl), "bucket": _bucket(gl)}
    gl = ((meta or {}).get(f"mbid:{mbid}") or {}).get("genres", []) if mbid else []
    return {"id": None, "mbid": mbid, "name": name, "heard": False, "plays": 0, "plays_12m": 0,
            "genres": _genres(gl), "bucket": _bucket(gl)}


@app.get(f"{BASE}/api/explore")
def explore(id: int | None = None, mbid: str | None = None, name: str | None = None, limit: int = Query(18, le=40)):
    idx = worker.INDEX
    if id is None and mbid:
        id = idx.mbid_to_id.get(mbid)
    if id is not None and id not in idx.artists:
        raise HTTPException(404, "unknown artist")
    if id is not None and not mbid:
        con = store.connect()
        try:
            m = store.get_meta_all(con).get(store.artist_key(idx.artists[id].name, idx.artists[id].mbid))
        finally:
            con.close()
        mbid = (m or {}).get("mbid") or idx.artists[id].mbid
    if id is None and not mbid:
        raise HTTPException(400, "need id or mbid")

    center = _node(idx, id, mbid, name)
    con = store.connect()
    try:
        if id is not None:
            tz = ZoneInfo(config.TZ)
            first, last = idx.first_last[id]
            titles = koito.track_titles([t for t, _ in idx.top_tracks.get(id, [])])
            center.update({
                "first": datetime.fromtimestamp(first, tz).date().isoformat(),
                "last": datetime.fromtimestamp(last, tz).date().isoformat(),
                "yearly": sorted(idx.yearly.get(id, {}).items()),
                "top_tracks": [{"title": titles.get(t, "?"), "plays": n} for t, n in idx.top_tracks.get(id, [])],
            })
        elif mbid:
            m = store.get_meta_all(con).get(f"mbid:{mbid}")
            if m is None:
                try:
                    res = sources.mb_artist_genres(mbid)
                except sources.TransientError:
                    res = None
                if res:
                    store.put_meta(con, f"mbid:{mbid}", mbid, res[0], res[1])
                    m = {"genres": res[0]}
            center["genres"] = _genres((m or {}).get("genres", []))
            center["bucket"] = _bucket((m or {}).get("genres", []))

        similar, note = [], None
        if mbid:
            raw = enrich.similar_for(con, mbid)
            meta = store.get_meta_all(con)
            for s in raw[:limit]:
                sid = idx.mbid_to_id.get(s["mbid"]) or idx.name_to_id.get(norm_name(s["name"]))
                node = _node(idx, sid, s["mbid"], s["name"], meta)
                node["score"] = s["score"]
                similar.append(node)
            if not raw:
                note = "ListenBrainz has no similarity data for this artist yet."
        else:
            note = "No MusicBrainz match for this artist, so similar artists aren't available."
    finally:
        con.close()
    return {"center": center, "similar": similar, "note": note}
