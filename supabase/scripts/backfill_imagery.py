#!/usr/bin/env python3
"""Emit SQL that fills in nba_teams.logo_url and nba_players.headshot_url.

Both come from ESPN's public CDN. Team crests are derivable from the
abbreviation alone; headshots need an ESPN athlete id, which we get by pulling
all 30 public team rosters and matching on the player's name.

Usage:
    # Pass 1 — rosters. Covers the large majority.
    python supabase/scripts/backfill_imagery.py > imagery.sql

    # Pass 2 — anything still uncovered. Feed it the names the first pass
    # missed, one per line, and it resolves each through ESPN's search:
    #   select full_name from nba_players where headshot_url is null;
    python supabase/scripts/backfill_imagery.py --search < missing.txt >> imagery.sql

    # then run imagery.sql against the database

Re-run it after seeding new players — it only writes rows that are still null,
so it is safe to apply repeatedly.

Team rosters alone leave gaps: players who changed teams, and players ESPN
spells differently than we do ("Alexandre Sarr" vs "Alex Sarr"). Anything the
rosters miss is resolved through ESPN's search endpoint, whose `uid` field
carries the athlete id. Names that survive both passes get no headshot and the
app falls back to a monogram, which components/media/PlayerHeadshot.tsx
handles.
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request

# ESPN's slug differs from the league's three-letter code for these two only;
# every other abbreviation works lowercased. Verified by HTTP probe.
ESPN_TEAM_SLUG = {"NOP": "no", "UTA": "utah"}

ABBRS = [
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
    "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
]

ROSTER = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{}/roster"
# The `uid` on a search hit looks like "s:40~l:46~a:3468"; l:46 is the NBA, and
# filtering on it keeps WNBA/college namesakes out.
SEARCH = "https://site.web.api.espn.com/apis/search/v2?limit=10&query={}"
NBA_ATHLETE_UID = re.compile(r"~l:46~a:(\d+)")
HEADSHOT = "https://a.espncdn.com/i/headshots/nba/players/full/{}.png"
LOGO = "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/{}.png"

# Match on letters only, so "Jr.", periods and accents don't break the join.
NON_ALPHA = re.compile(r"[^a-z]")


def norm(name: str) -> str:
    return NON_ALPHA.sub("", (name or "").lower())


def fetch_headshots() -> dict:
    out = {}
    for abbr in ABBRS:
        slug = ESPN_TEAM_SLUG.get(abbr, abbr.lower())
        try:
            with urllib.request.urlopen(ROSTER.format(slug), timeout=25) as resp:
                data = json.load(resp)
        except Exception as exc:  # noqa: BLE001 - one bad team shouldn't abort
            print(f"-- WARNING: roster fetch failed for {abbr}: {exc}", file=sys.stderr)
            continue
        for athlete in data.get("athletes", []):
            href = (athlete.get("headshot") or {}).get("href")
            if href and athlete.get("fullName"):
                out[norm(athlete["fullName"])] = href
        time.sleep(0.15)
    return out


def search_headshot(name: str) -> str | None:
    """Last-resort lookup for a player no roster listed."""
    url = SEARCH.format(urllib.parse.quote(name))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.load(resp)
    except Exception:
        return None
    want = norm(name)
    parts = name.split()
    want_first, want_last = norm(parts[0]), norm(parts[-1])

    nba_hits = []
    for group in data.get("results", []):
        if group.get("type") != "player":
            continue
        for item in group.get("contents", []):
            m = NBA_ATHLETE_UID.search(item.get("uid", "") or "")
            if not m:
                continue
            got = norm(item.get("displayName"))
            if got == want:
                return HEADSHOT.format(m.group(1))
            nba_hits.append((got, m.group(1)))

    # ESPN sometimes shortens a first name ("Alexandre Sarr" -> "Alex Sarr").
    # Accept that only when the surname matches and exactly one hit qualifies,
    # so a wrong face is never written.
    variants = {
        aid for got, aid in nba_hits
        if got.endswith(want_last)
        and (got.startswith(want_first[:3]) or want_first.startswith(got[:3]))
    }
    if len(variants) == 1:
        return HEADSHOT.format(variants.pop())
    return None


def emit_headshot_update(rows: list[tuple[str, str]]) -> None:
    print("update nba_players p")
    print("   set headshot_url = m.url")
    print("  from (values")
    for i, (key, url) in enumerate(rows):
        comma = "," if i < len(rows) - 1 else ""
        print(f"    ('{key}','{url}'){comma}")
    print("  ) as m(nkey, url)")
    # Both sides normalise to letters only, so "Jaren Jackson Jr." and
    # "Jaren Jackson Jr" collapse to the same key.
    print(" where regexp_replace(lower(p.full_name), '[^a-z]', '', 'g') = m.nkey")
    print("   and p.headshot_url is null;")


def search_mode() -> int:
    """Resolve names read from stdin, one per line, via ESPN search."""
    names = [ln.strip() for ln in sys.stdin if ln.strip()]
    if not names:
        print("-- no names on stdin; nothing to do", file=sys.stderr)
        return 0

    found, missing = [], []
    for name in names:
        url = search_headshot(name)
        if url:
            found.append((norm(name), url))
        else:
            missing.append(name)
        time.sleep(0.25)

    print(f"-- search resolved {len(found)}/{len(names)}", file=sys.stderr)
    if missing:
        print(f"-- unresolved (monogram fallback): {', '.join(missing)}", file=sys.stderr)
    if found:
        print()
        print("-- Headshots resolved via ESPN search (players no roster listed).")
        emit_headshot_update(sorted(found))
    return 0


def main() -> int:
    if "--search" in sys.argv:
        return search_mode()

    headshots = fetch_headshots()
    print(f"-- {len(headshots)} headshots collected from ESPN rosters", file=sys.stderr)
    if not headshots:
        print("-- ERROR: no rosters fetched; refusing to emit SQL", file=sys.stderr)
        return 1

    print("-- Generated by supabase/scripts/backfill_imagery.py. Safe to re-run.")
    print()
    print("-- Team crests: derivable from the abbreviation.")
    print("update nba_teams set logo_url =")
    print(f"  '{LOGO.format('')[:-4]}'")
    print("  || case abbreviation")
    for abbr, slug in ESPN_TEAM_SLUG.items():
        print(f"       when '{abbr}' then '{slug}'")
    print("       else lower(abbreviation) end || '.png'")
    print("where logo_url is null;")
    print()

    print("-- Headshots: ESPN athlete id, joined on the letters of the name.")
    emit_headshot_update(sorted(headshots.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
