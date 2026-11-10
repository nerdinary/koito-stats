"""Runtime configuration, all from environment variables."""
import os
from pathlib import Path

KOITO_DB = Path(os.environ.get("KOITO_DB", "data/koito.db"))
STATS_DB = Path(os.environ.get("STATS_DB", "data/stats.db"))
BASE_PATH = "/" + os.environ.get("BASE_PATH", "/stats").strip("/")
TZ = os.environ.get("STATS_TZ", "Australia/Sydney")

# Optional list of artist names to leave out entirely (podcasts, audiobooks...), one per line.
EXCLUDE_FILE = Path(os.environ.get("EXCLUDE_FILE", str(STATS_DB.parent / "exclude.txt")))

# How often the background worker refreshes (seconds).
REFRESH_INTERVAL = int(os.environ.get("REFRESH_INTERVAL", "3600"))
# Max artists to enrich per refresh cycle (MusicBrainz allows ~1 req/s).
ENRICH_BATCH = int(os.environ.get("ENRICH_BATCH", "400"))

LASTFM_API_KEY = os.environ.get("LASTFM_API_KEY", "")
# MusicBrainz asks clients to identify themselves; optionally add a contact URL/email.
MB_CONTACT = os.environ.get("MB_CONTACT", "")
USER_AGENT = "koito-stats/0.1" + (f" ( {MB_CONTACT} )" if MB_CONTACT else "")
