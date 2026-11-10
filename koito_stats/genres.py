"""Map fine-grained MusicBrainz/Last.fm genres onto a small fixed set of buckets.

Bucket order is also the stacking order and the categorical colour-slot order in the UI,
so keep it stable: colour follows the bucket, never its rank.
"""
import re
import unicodedata

CLASSIC = "Classic & hard rock"
POP = "Pop & soft rock"
ALT = "Alternative & indie"
FOLK = "Folk, country & songwriters"
SOUL = "Blues, soul & R&B"
ELEC = "Electronic & dance"
METAL = "Metal"
JAZZ = "Jazz"
OTHER = "Other"

BUCKETS = [CLASSIC, POP, ALT, FOLK, SOUL, ELEC, METAL, JAZZ, OTHER]

EXACT = {
    # classic & hard rock
    "rock": CLASSIC, "hard rock": CLASSIC, "classic rock": CLASSIC, "blues rock": CLASSIC,
    "psychedelic rock": CLASSIC, "progressive rock": CLASSIC, "progressive": CLASSIC, "art rock": CLASSIC,
    "glam rock": CLASSIC, "southern rock": CLASSIC, "swamp rock": CLASSIC, "heartland rock": CLASSIC,
    "roots rock": CLASSIC, "arena rock": CLASSIC, "aor": CLASSIC, "merseybeat": CLASSIC, "acid rock": CLASSIC,
    "space rock": CLASSIC, "rock and roll": CLASSIC, "rock & roll": CLASSIC, "rockabilly": CLASSIC,
    "boogie rock": CLASSIC, "krautrock": CLASSIC, "instrumental rock": CLASSIC, "garage rock": CLASSIC,
    "symphonic rock": CLASSIC, "funk rock": CLASSIC, "freakbeat": CLASSIC, "mod": CLASSIC, "beat music": CLASSIC,
    "jam band": CLASSIC, "stoner rock": CLASSIC, "surf rock": CLASSIC, "70s": CLASSIC, "60s": CLASSIC,
    "british invasion": CLASSIC, "boogie": CLASSIC,
    # pop & soft rock
    "pop": POP, "pop rock": POP, "soft rock": POP, "dance-pop": POP, "europop": POP, "teen pop": POP,
    "piano rock": POP, "power pop": POP, "psychedelic pop": POP, "art pop": POP, "jazz pop": POP,
    "latin pop": POP, "adult contemporary": POP, "baroque pop": POP, "sunshine pop": POP, "bubblegum": POP,
    "chamber pop": POP, "sophisti-pop": POP, "k-pop": POP, "j-pop": POP, "easy listening": POP,
    "christmas music": POP, "vocal": POP, "80s": POP,
    # alternative & indie
    "alternative rock": ALT, "alternative": ALT, "indie rock": ALT, "indie": ALT, "indie pop": ALT,
    "britpop": ALT, "post-britpop": ALT, "grunge": ALT, "post-grunge": ALT, "punk": ALT, "punk rock": ALT,
    "pop punk": ALT, "post-punk": ALT, "new wave": ALT, "shoegaze": ALT, "dream pop": ALT, "emo": ALT,
    "garage rock revival": ALT, "neo-psychedelia": ALT, "alternative pop": ALT, "rap rock": ALT,
    "post-rock": ALT, "math rock": ALT, "noise rock": ALT, "indie folk": FOLK, "experimental rock": ALT,
    "madchester": ALT, "slowcore": ALT, "lo-fi": ALT, "bedroom pop": ALT, "experimental": ALT,
    # folk, country & songwriters
    "folk": FOLK, "folk rock": FOLK, "singer-songwriter": FOLK, "country": FOLK, "americana": FOLK,
    "acoustic rock": FOLK, "country rock": FOLK, "bluegrass": FOLK, "celtic": FOLK, "contemporary folk": FOLK,
    "folk pop": FOLK, "country pop": FOLK, "contemporary country": FOLK, "country gospel": FOLK,
    "progressive folk": FOLK, "acoustic": FOLK, "alt-country": FOLK, "outlaw country": FOLK, "poetry": FOLK,
    # blues, soul & r&b
    "blues": SOUL, "british blues": SOUL, "electric blues": SOUL, "soul": SOUL, "r&b": SOUL,
    "rhythm and blues": SOUL, "rhythm & blues": SOUL, "british rhythm & blues": SOUL, "contemporary r&b": SOUL,
    "funk": SOUL, "motown": SOUL, "pop soul": SOUL, "neo soul": SOUL, "quiet storm": SOUL, "gospel": SOUL,
    "doo-wop": SOUL, "northern soul": SOUL, "chicago blues": SOUL, "delta blues": SOUL,
    # electronic & dance
    "electronic": ELEC, "electronica": ELEC, "house": ELEC, "techno": ELEC, "disco": ELEC, "nu disco": ELEC,
    "eurodance": ELEC, "electropop": ELEC, "synth-pop": ELEC, "synthpop": ELEC, "trip hop": ELEC,
    "downtempo": ELEC, "ambient": ELEC, "new age": ELEC, "celtic new age": ELEC, "idm": ELEC, "electro": ELEC,
    "trance": ELEC, "dance": ELEC, "club": ELEC, "french house": ELEC, "indietronica": ELEC,
    "alternative dance": ELEC, "electro-disco": ELEC, "euro-disco": ELEC, "hi-nrg": ELEC,
    "bubblegum dance": ELEC, "drum and bass": ELEC, "dubstep": ELEC, "edm": ELEC, "chillout": ELEC,
    "lounge": ELEC, "deep house": ELEC, "progressive house": ELEC, "synthwave": ELEC,
    # metal
    "metal": METAL, "heavy metal": METAL, "glam metal": METAL, "nu metal": METAL, "nwobhm": METAL,
    "alternative metal": METAL, "rap metal": METAL, "funk metal": METAL, "thrash metal": METAL,
    "speed metal": METAL, "power metal": METAL, "progressive metal": METAL,
    # jazz
    "jazz": JAZZ, "smooth jazz": JAZZ, "vocal jazz": JAZZ, "swing": JAZZ, "big band": JAZZ,
    "contemporary jazz": JAZZ, "jazz fusion": JAZZ, "bebop": JAZZ, "cool jazz": JAZZ, "bossa nova": JAZZ,
    "jazz funk": JAZZ, "latin jazz": JAZZ, "hard bop": JAZZ, "jazz-funk": JAZZ,
    # other (real genres, but too small to get their own colour)
    "hip hop": OTHER, "rap": OTHER, "reggae": OTHER, "dub": OTHER, "latin": OTHER, "classical": OTHER,
    "soundtrack": OTHER, "film score": OTHER, "filmi": OTHER, "world": OTHER, "instrumental": OTHER,
    "roots reggae": OTHER, "reggae-pop": OTHER, "ska": OTHER, "opera": OTHER, "bollywood": OTHER,
}

# Ordered keyword fallbacks for genres not in EXACT. First match wins.
KEYWORDS = [
    (r"metal|grindcore|djent|metalcore", METAL),
    (r"jazz|swing|bop\b|bossa", JAZZ),
    (r"hip.?hop|\brap\b|trap\b|grime|drill", OTHER),
    (r"house|techno|trance|electro|edm|disco|dance|synth|ambient|idm|step|drum.?and.?bass|breakbeat|chill", ELEC),
    (r"blues|soul|r&b|rhythm|funk|gospel|motown", SOUL),
    (r"folk|country|americana|bluegrass|songwriter|acoustic|celtic", FOLK),
    (r"punk|indie|alternative|grunge|shoegaze|emo|wave|britpop|post-", ALT),
    (r"pop", POP),
    (r"rock|beat", CLASSIC),
    (r"classical|baroque|orchestra|symphon|opera|score|soundtrack|reggae|ska|latin|world|afro|bollywood|filmi|carnatic|hindustani|qawwali|bhangra|k-?pop", OTHER),
]
_KW = [(re.compile(p), b) for p, b in KEYWORDS]

_cache: dict[str, str | None] = {}


def bucket_of(genre: str) -> str | None:
    """Bucket for a genre, or None if it isn't a recognisable genre (e.g. tags like 'seen live')."""
    g = genre.strip().lower()
    if g in _cache:
        return _cache[g]
    b = EXACT.get(g)
    if b is None:
        for rx, bucket in _KW:
            if rx.search(g):
                b = bucket
                break
    _cache[g] = b
    return b


def bucket_weights(genres: list) -> dict[str, float]:
    """[[genre, weight], ...] -> {bucket: weight} normalised to 1, ignoring non-genre tags."""
    acc: dict[str, float] = {}
    for g, w in genres:
        b = bucket_of(g)
        if b:
            acc[b] = acc.get(b, 0) + w
    total = sum(acc.values())
    return {b: w / total for b, w in acc.items()} if total else {}


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", "and")
    s = re.sub(r"^the\s+", "", s)
    return re.sub(r"[^a-z0-9]", "", s)
