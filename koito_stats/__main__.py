"""CLI: python -m koito_stats {serve,enrich,compute}"""
import argparse
import logging

from . import config


def main():
    p = argparse.ArgumentParser(prog="koito_stats")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the web server (with background refresh worker)")
    s.add_argument("--host", default="0.0.0.0")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--no-worker", action="store_true")
    e = sub.add_parser("enrich", help="fetch genres/similar artists")
    e.add_argument("--limit", type=int, default=config.ENRICH_BATCH)
    e.add_argument("--similar-seeds", type=int, default=0)
    e.add_argument("--retry-none", action="store_true", help="re-try artists previously found to have no genres")
    sub.add_parser("compute", help="recompute analytics")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.cmd == "serve":
        import uvicorn

        from . import server

        server.START_WORKER = not args.no_worker
        uvicorn.run(server.app, host=args.host, port=args.port, proxy_headers=True)
    elif args.cmd == "enrich":
        from . import enrich, koito, store

        con = store.connect()
        artists, plays, _ = koito.load()
        ranked = enrich.artists_by_plays(artists, plays)
        n = enrich.enrich_genres(con, ranked, args.limit, retry_none=args.retry_none)
        logging.info("genres fetched for %d artists", n)
        if args.similar_seeds:
            meta = store.get_meta_all(con)
            seeds = []
            for a, _ in ranked:
                mbid = (meta.get(store.artist_key(a.name, a.mbid)) or {}).get("mbid") or a.mbid
                if mbid:
                    seeds.append(mbid)
                if len(seeds) >= args.similar_seeds:
                    break
            enrich.enrich_similar(con, seeds)
    elif args.cmd == "compute":
        from . import worker

        worker.compute_all()


if __name__ == "__main__":
    main()
