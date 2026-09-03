import asyncio
import json
import math
import os
import time
from contextlib import asynccontextmanager
import xml.etree.ElementTree as ET


from datetime import datetime, timezone
from urllib.parse import quote

import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from solar_system import get_solar_system

from mission_trajectories import (
    HISTORICAL_MISSIONS,
    get_mission_trajectory,
    interpolate_trajectory_position,
) 

from mission_engine import (
    get_mission_state,
    datetime_to_julian_date,
)

from sample_events import SAMPLE_EVENTS_GEOJSON

load_dotenv()

AISSTREAM_API_KEY = os.getenv("AISSTREAM_API_KEY")
OPENSKY_CLIENT_ID = os.getenv("OPENSKY_CLIENT_ID")
OPENSKY_CLIENT_SECRET = os.getenv("OPENSKY_CLIENT_SECRET")
OPENSKY_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/"
    "protocol/openid-connect/token"
)
GDELT_GEO_URL = "https://api.gdeltproject.org/api/v2/geo/geo"
OPENSKY_URL = "https://opensky-network.org/api/states/all"
ADSB_URL_TEMPLATE = "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}"
ADSBFI_URL_TEMPLATE = "https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{radius_nm}"
USGS_QUAKES_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP"
EMSC_URL = "https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=100&orderby=time"
EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&limit=200"
RELIEFWEB_URL = ("https://api.reliefweb.int/v2/disasters")
SPACETRACK_IDENTITY = os.getenv("SPACETRACK_IDENTITY")
SPACETRACK_PASSWORD = os.getenv("SPACETRACK_PASSWORD")

SPACETRACK_LOGIN_URL = "https://www.space-track.org/ajaxauth/login"

SPACETRACK_QUERY_URL = (
    "https://www.space-track.org/basicspacedata/query/"
    "class/gp/"
    "decay_date/null-val/"
    "orderby/NORAD_CAT_ID/"
    "NORAD_CAT_ID/{ids}/"
    "format/json"
)

CELESTRAK_URL_TEMPLATE = "https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle"

# Do NOT poll the huge ACTIVE group.
# CelesTrak explicitly rate-limits large GP downloads.
CELESTRAK_GROUPS = [
    "stations",
    "gps-ops",
    "geo",
    "weather",
    "science",
]

SATNOGS_TLE_URL = "https://db.satnogs.org/api/tle/"

# Cached CelesTrak mirror. Useful when CelesTrak is temporarily blocked.
RETLECTOR_URL_TEMPLATE = "https://retlector.eu/{group}/tle"

TLE_MIRROR_URL_TEMPLATE = (
    "https://tle.ivanstanojevic.me/api/tle/{norad_id}"
)

TLE_MIRROR_SATELLITES = {
    25544: ("ISS (ZARYA)", "stations"),
    48274: ("TIANGONG", "stations"),
    20580: ("HST", "science"),
    25338: ("NOAA 15", "weather"),
    28654: ("NOAA 18", "weather"),
    33591: ("NOAA 19", "weather"),
    25994: ("TERRA", "science"),
    27424: ("AQUA", "science"),
    39084: ("LANDSAT 8", "science"),
    49260: ("LANDSAT 9", "science"),
}

SATELLITE_MAX = 500

LAUNCH_LIBRARY_URL = LAUNCH_LIBRARY_URL = (
    "https://lldev.thespacedevs.com/2.3.0/launches/upcoming/"
    "?limit=100&mode=normal"
)
FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY")
EVENT_REGISTRY_API_KEY = os.getenv("EVENT_REGISTRY_API_KEY")
FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/world/1"

ADSB_HOTSPOTS = [
    {"name": "hormuz", "lat": 26.5, "lon": 56.25, "radius_nm": 250},
    {"name": "singapore_strait", "lat": 1.25, "lon": 103.85, "radius_nm": 250},
    {"name": "dover_strait", "lat": 51.0, "lon": 1.4, "radius_nm": 250},
    {"name": "gibraltar", "lat": 36.0, "lon": -5.3, "radius_nm": 250},
]

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}

SOURCE_HEALTH: dict[str, dict] = {}
EVENT_CACHE = {}
EVENT_CACHE_TTL = 300
CATEGORY_SOURCES = {
    "aircraft": ["adsb_lol", "adsb_fi", "opensky"],
    "ships": ["aisstream"],
    "satellites": ["spacetrack", "celestrak", "satnogs", "retlector", "tle_mirror",],
    "fires": ["firms", "eonet"],
    "earthquakes": ["usgs", "emsc"],
    "events": ["gdelt", "event_registry", "google_news",],
    "launches": ["launch_library"],
    "disasters": ["gdacs"],
}

def mark_health(source: str, ok: bool, error: str | None = None):
    SOURCE_HEALTH[source] = {"ok": ok, "error": error, "last_check": time.time()}

WORLD_BOX = [[-90.0, -180.0], [90.0, 180.0]]
ships: dict[str, dict] = {}
SHIP_STALE_SECONDS = 600

flights: dict[str, dict] = {}
_opensky_token = {"access_token": None, "expires_at": 0}
FLIGHT_STALE_SECONDS = 300

ship_history: dict[str, list[dict]] = {}
flight_history: dict[str, list[dict]] = {}
HISTORY_LIMIT = 40

def push_history(store: dict, key: str, lat: float, lon: float):
    hist = store.setdefault(key, [])
    hist.append({"lat": lat, "lon": lon, "t": time.time()})
    if len(hist) > HISTORY_LIMIT:
        del hist[0]

earthquakes: list[dict] = []
disasters: list[dict] = []
satellite_tles: dict[str, dict] = {}
launches: list[dict] = []
fires: list[dict] = []


async def ais_listener():
    if not AISSTREAM_API_KEY:
        print(
            "WARNING: AISSTREAM_API_KEY not set in .env, "
            "skipping AIS listener."
        )
        return

    while True:
        try:
            async with websockets.connect(
                "wss://stream.aisstream.io/v0/stream"
            ) as ws:
                subscribe_message = {
                    "APIKey": AISSTREAM_API_KEY,
                    "BoundingBoxes": [WORLD_BOX],
                    "FilterMessageTypes": [
                        "PositionReport",
                        "ShipStaticData",
                    ],
                }

                await ws.send(
                    json.dumps(subscribe_message)
                )

                print(
                    "Connected to AISStream, "
                    "subscribed to the WHOLE WORLD."
                )

                mark_health("aisstream", True)

                while True:
                    try:
                        raw_message = await asyncio.wait_for(
                            ws.recv(),
                            timeout=30,
                        )

                    except asyncio.TimeoutError:
                        print(
                            "AIS: no messages in 30s, "
                            "assuming dead connection, "
                            "reconnecting..."
                        )
                        break

                    data = json.loads(raw_message)

                    message_type = data.get("MessageType")

                    meta = data.get("MetaData", {})

                    message = data.get("Message", {})

                    if not meta.get("MMSI"):
                        continue

                    mmsi = str(meta["MMSI"])

                    # Make sure a vessel record exists
                    if mmsi not in ships:
                        ships[mmsi] = {
                            "mmsi": mmsi,
                            "name": "Unknown vessel",
                            "imo": None,
                            "ship_type": None,
                            "destination": None,
                            "eta": None,
                            "draught": None,
                            "lat": None,
                            "lon": None,
                            "speed": None,
                            "course": None,
                            "heading": None,
                            "navigation_status": None,
                            "last_seen": time.time(),
                        }

                    ship = ships[mmsi]

                    # POSITION REPORT # 
                    if message_type == "PositionReport":
                        report = message.get(
                            "PositionReport",
                            {},
                        )

                        ship["lat"] = meta.get("latitude")

                        ship["lon"] = meta.get("longitude")

                        # Speed over ground (knots)
                        ship["speed"] = report.get("Sog")

                        # Course over ground (degrees)
                        ship["course"] = report.get("Cog")

                        # True heading
                        true_heading = report.get("TrueHeading")

                        if (
                            true_heading is not None
                            and true_heading < 360
                        ):
                            ship["heading"] = true_heading
                        else:
                            ship["heading"] = report.get("Cog")

                        # Navigation status
                        ship["navigation_status"] = report.get(
                            "NavigationalStatus"
                        )

                        ship["last_seen"] = time.time()

                        # Keep existing history system
                        if (
                            ship["lat"] is not None
                            and ship["lon"] is not None
                        ):
                            push_history(
                                ship_history,
                                mmsi,
                                ship["lat"],
                                ship["lon"],
                            )

                    # -----------------------------------------
                    # STATIC / VOYAGE DATA
                    # -----------------------------------------
                    elif message_type == "ShipStaticData":
                        static = message.get(
                            "ShipStaticData",
                            {},
                        )

                        # Vessel name
                        name = static.get("Name")

                        if name:
                            ship["name"] = name.strip()

                        # IMO number
                        imo = static.get("ImoNumber")

                        if imo:
                            ship["imo"] = imo

                        # Ship type
                        ship["ship_type"] = static.get("Type")

                        # Destination
                        destination = static.get("Destination")

                        if destination:
                            ship["destination"] = destination.strip()

                        # Draught
                        ship["draught"] = static.get(
                            "MaximumStaticDraught"
                        )

                        # ETA
                        ship["eta"] = static.get("Eta")

                        # AIS metadata can also contain
                        # the vessel name
                        meta_name = meta.get("ShipName")

                        if (
                            meta_name
                            and ship["name"] == "Unknown vessel"
                        ):
                            ship["name"] = meta_name.strip()

                        ship["last_seen"] = time.time()

        except Exception as e:
            mark_health(
                "aisstream",
                False,
                str(e),
            )

            print(
                f"AIS connection error ({e}), "
                "retrying in 10s..."
            )

            await asyncio.sleep(10)

async def reliefweb_events():
    async with httpx.AsyncClient(
        timeout=15,
        headers=BROWSER_HEADERS
    ) as client:

        try:
            resp = await client.get(
                RELIEFWEB_URL,
                params={
                    "appname": "geo-intel-platform",
                    "limit": 100,
                    "profile": "full",
                    "query[value]": (
                        "conflict OR violence OR military "
                        "OR explosion OR protest"
                    ),
                },
            )

            resp.raise_for_status()

            data = resp.json()

            events = []

            for item in data.get("data", []):
                fields = item.get("fields", {})

                country = fields.get("country") or []

                if isinstance(country, list) and country:
                    country_name = country[0].get("name")
                else:
                    country_name = None

                events.append({
                    "id": item.get("id"),
                    "name": fields.get("name"),
                    "date": fields.get("date"),
                    "status": fields.get("status"),
                    "country": country_name,
                    "source": "reliefweb",
                    "url": fields.get("url"),
                })

            mark_health("reliefweb", True)

            return events

        except Exception as e:
            mark_health(
                "reliefweb",
                False,
                str(e)
            )

            print(
                f"ReliefWeb failed "
                f"({type(e).__name__}: {e})"
            )

            return []



async def ais_cleanup():
    while True:
        await asyncio.sleep(60)
        cutoff = time.time() - SHIP_STALE_SECONDS
        stale = [mmsi for mmsi, s in ships.items() if s["last_seen"] < cutoff]
        for mmsi in stale:
            del ships[mmsi]
            ship_history.pop(mmsi, None)
        if stale:
            print(f"AIS cleanup: removed {len(stale)} stale ships, {len(ships)} remain.")


async def get_opensky_token(client: httpx.AsyncClient) -> str | None:
    if not OPENSKY_CLIENT_ID or not OPENSKY_CLIENT_SECRET:
        return None
    if _opensky_token["access_token"] and time.time() < _opensky_token["expires_at"] - 60:
        return _opensky_token["access_token"]
    resp = await client.post(
        OPENSKY_TOKEN_URL,
        data={"grant_type": "client_credentials", "client_id": OPENSKY_CLIENT_ID, "client_secret": OPENSKY_CLIENT_SECRET},
    )
    resp.raise_for_status()
    token_data = resp.json()
    _opensky_token["access_token"] = token_data["access_token"]
    _opensky_token["expires_at"] = time.time() + token_data.get("expires_in", 1800)
    print("OpenSky: refreshed access token.")
    return _opensky_token["access_token"]


async def adsb_hotspot_poller(url_template: str, source_name: str):
    async with httpx.AsyncClient(timeout=10, headers=BROWSER_HEADERS) as client:
        while True:
            for region in ADSB_HOTSPOTS:
                try:
                    url = url_template.format(lat=region["lat"], lon=region["lon"], radius_nm=region["radius_nm"])
                    resp = await client.get(url)
                    resp.raise_for_status()
                    data = resp.json()
                    for ac in data.get("ac", []):
                        if ac.get("lat") is None or ac.get("lon") is None:
                            continue
                        flights[ac["hex"]] = {
                            "icao24": ac["hex"],
                            "flight": (ac.get("flight") or "Unknown").strip(),
                            "lat": ac["lat"],
                            "lon": ac["lon"],
                            "alt": ac.get("alt_baro"),
                            "heading": ac.get("track"),
                            "last_seen": time.time(),
                            "nic": ac.get("nic"),
                            "nac_p": ac.get("nac_p"),
                            "rc": ac.get("rc"),
                            "source": source_name,
                            "region": region["name"],
                        }
                        push_history(flight_history, ac["hex"], ac["lat"], ac["lon"])
                except Exception as e:
                    mark_health(source_name, False, str(e))
                    print(f"{source_name} hotspot poll failed for {region['name']} ({type(e).__name__}: {e}), skipping.")
                await asyncio.sleep(3)
            await asyncio.sleep(15)


async def flight_poller():
    async with httpx.AsyncClient(timeout=20, headers=BROWSER_HEADERS) as client:
        while True:
            try:
                token = await get_opensky_token(client)
                headers = {"Authorization": f"Bearer {token}"} if token else {}
                resp = await client.get(OPENSKY_URL, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                states = data.get("states") or []
                new_flights = {}
                for s in states:
                    icao24, callsign, lon, lat = s[0], s[1], s[5], s[6]
                    if lat is None or lon is None:
                        continue
                    new_flights[icao24] = {
                        "icao24": icao24, "flight": (callsign or "Unknown").strip(),
                        "lat": lat, "lon": lon, "alt": s[7], "heading": s[10],
                        "last_seen": time.time(), "nic": None, "nac_p": None, "rc": None,
                        "source": "opensky", "region": None,
                    }
                added = 0
                for icao24, new_rec in new_flights.items():
                    existing = flights.get(icao24)
                    if existing and existing.get("source") in ("adsb_lol", "adsb_fi"):
                        continue
                    flights[icao24] = new_rec
                    push_history(flight_history, icao24, new_rec["lat"], new_rec["lon"])
                    added += 1
                mode = "authenticated" if token else "anonymous"
                mark_health("opensky", True)
                print(f"OpenSky global poll ({mode}): added/refreshed {added} aircraft, {len(flights)} total tracked.")
            except Exception as e:
                mark_health("opensky", False, str(e))
                print(f"OpenSky poll failed ({type(e).__name__}: {e}), keeping previous data.")
            interval = 120 if OPENSKY_CLIENT_ID else 900
            await asyncio.sleep(interval)


async def satellite_tle_poller():
    """
    Primary satellite catalogue.

    CelesTrak is used for manageable groups only.
    We intentionally do NOT download the huge ACTIVE group.
    """

    async with httpx.AsyncClient(
        timeout=20,
        headers=BROWSER_HEADERS
    ) as client:

        while True:
            for group in CELESTRAK_GROUPS:
                try:
                    resp = await client.get(
                        CELESTRAK_URL_TEMPLATE.format(
                            group=group
                        )
                    )

                    resp.raise_for_status()

                    lines = [
                        line.strip()
                        for line in resp.text.splitlines()
                        if line.strip()
                    ]

                    count = 0

                    for i in range(0, len(lines) - 2, 3):
                        name = lines[i]
                        line1 = lines[i + 1]
                        line2 = lines[i + 2]

                        if not line1.startswith("1 ") or not line2.startswith("2 "):
                            continue

                        satellite_tles[name] = {
                            "name": name,
                            "line1": line1,
                            "line2": line2,
                            "group": group,
                            "source": "celestrak",
                            "updated": time.time(),
                        }

                        count += 1

                    mark_health("celestrak", True)

                    print(
                        f"CelesTrak '{group}': loaded "
                        f"{count} satellites."
                    )

                except Exception as e:
                    mark_health(
                        "celestrak",
                        False,
                        str(e)
                    )

                    print(
                        f"CelesTrak '{group}' failed "
                        f"({type(e).__name__}: {e}), skipping."
                    )

            # CelesTrak GP data should not be hammered.
            # Six hours is comfortably within its update cycle.
            await asyncio.sleep(6 * 3600)


async def tle_mirror_poller():
    """
    Fallback satellite source.

    Uses:
      1. SatNOGS DB
      2. Individual TLE mirror records
      3. ReTLEctor cached CelesTrak data
    """

    async with httpx.AsyncClient(
        timeout=20,
        headers=BROWSER_HEADERS
    ) as client:

        while True:

            # ---------------------------------------------------------
            # 1. SATNOGS DB
            # ---------------------------------------------------------

            try:
                resp = await client.get(
                    SATNOGS_TLE_URL,
                    params={
                        "limit": 1000,
                        "format": "json",
                    },
                )

                resp.raise_for_status()
                data = resp.json()

                loaded = 0

                # SatNOGS may return a paginated object or a list.
                records = (
                    data.get("results", [])
                    if isinstance(data, dict)
                    else data
                )

                for item in records:

                    sat_id = item.get("sat_id")
                    norad_id = item.get("norad_cat_id")

                    line1 = item.get("tle1")
                    line2 = item.get("tle2")

                    if not line1 or not line2:
                        line1 = item.get("line1")
                        line2 = item.get("line2")

                    if not line1 or not line2:
                        continue

                    name = (
                        item.get("name")
                        or item.get("satellite", {}).get("name")
                        or f"NORAD {norad_id or sat_id}"
                    )

                    satellite_tles[name] = {
                        "name": name,
                        "line1": line1.strip(),
                        "line2": line2.strip(),
                        "group": "satnogs",
                        "source": "satnogs",
                        "norad_id": norad_id,
                        "updated": time.time(),
                    }

                    loaded += 1

                mark_health("satnogs", True)

                print(
                    f"SatNOGS: loaded {loaded} satellite TLE records."
                )

            except Exception as e:

                mark_health(
                    "satnogs",
                    False,
                    str(e)
                )

                print(
                    f"SatNOGS TLE poll failed "
                    f"({type(e).__name__}: {e})"
                )

            # ---------------------------------------------------------
            # 2. INDIVIDUAL TLE MIRROR
            # ---------------------------------------------------------

            mirror_loaded = 0

            for norad_id, (name, group) in TLE_MIRROR_SATELLITES.items():

                try:
                    resp = await client.get(
                        TLE_MIRROR_URL_TEMPLATE.format(
                            norad_id=norad_id
                        )
                    )

                    resp.raise_for_status()

                    data = resp.json()

                    sat_name = data.get("name", name)

                    line1 = data.get("line1")
                    line2 = data.get("line2")

                    if not line1 or not line2:
                        continue

                    satellite_tles[sat_name] = {
                        "name": sat_name,
                        "line1": line1,
                        "line2": line2,
                        "group": group,
                        "source": "tle_mirror",
                        "norad_id": norad_id,
                        "updated": time.time(),
                    }

                    mirror_loaded += 1

                except Exception as e:

                    mark_health(
                        "tle_mirror",
                        False,
                        str(e)
                    )

                    print(
                        f"TLE mirror failed for NORAD {norad_id} "
                        f"({type(e).__name__}: {e})"
                    )

                await asyncio.sleep(0.5)

            if mirror_loaded:
                mark_health("tle_mirror", True)

                print(
                    f"TLE mirror: loaded {mirror_loaded} "
                    f"individual satellite records."
                )

            # ---------------------------------------------------------
            # 3. RETLECTOR CACHED CELESTRAK FALLBACK
            # ---------------------------------------------------------

            retlector_loaded = 0

            for group in ["active", "stations", "visual"]:
                try:
                    resp = await client.get(
                        RETLECTOR_URL_TEMPLATE.format(
                            group=group
                        )
                    )

                    resp.raise_for_status()

                    lines = [
                        line.strip()
                        for line in resp.text.splitlines()
                        if line.strip()
                    ]

                    for i in range(0, len(lines) - 2, 3):

                        name = lines[i]
                        line1 = lines[i + 1]
                        line2 = lines[i + 2]

                        if not line1.startswith("1 ") or not line2.startswith("2 "):
                            continue

                        # Don't overwrite fresher CelesTrak/SatNOGS data.
                        if name in satellite_tles:
                            continue

                        satellite_tles[name] = {
                            "name": name,
                            "line1": line1,
                            "line2": line2,
                            "group": group,
                            "source": "retlector",
                            "updated": time.time(),
                        }

                        retlector_loaded += 1

                except Exception as e:

                    mark_health(
                        "retlector",
                        False,
                        str(e)
                    )

                    print(
                        f"ReTLEctor '{group}' failed "
                        f"({type(e).__name__}: {e})"
                    )

            if retlector_loaded:
                mark_health("retlector", True)

                print(
                    f"ReTLEctor: added {retlector_loaded} "
                    f"cached fallback satellites."
                )

            # Six-hour cycle.
            await asyncio.sleep(6 * 3600)


async def launch_poller():
    async with httpx.AsyncClient(
        timeout=15,
        headers=BROWSER_HEADERS,
    ) as client:

        while True:
            try:
                new_launches = []

                next_url = LAUNCH_LIBRARY_URL

                for _ in range(5):
                    if not next_url:
                        break

                    resp = await client.get(next_url)
                    resp.raise_for_status()
                    data = resp.json()

                    for launch in data.get("results", []):
                        pad = launch.get("pad") or {}
                        location = pad.get("location") or {}
                        provider = (
                            launch.get("launch_service_provider")
                            or {}
                        )

                        lat = None
                        lon = None

                        try:
                            if pad.get("latitude") is not None:
                                lat = float(pad["latitude"])

                            if pad.get("longitude") is not None:
                                lon = float(pad["longitude"])

                        except (TypeError, ValueError):
                            lat = None
                            lon = None

                        new_launches.append({
                            "id": launch.get("id"),
                            "name": launch.get("name"),
                            "net": launch.get("net"),
                            "status": (
                                launch.get("status") or {}
                            ).get("name"),
                            "pad_name": pad.get("name"),
                            "lat": lat,
                            "lon": lon,
                            "location_name": location.get("name"),
                            "provider": provider.get("name"),
                            "flightclub_url": None,
                        })

                    next_url = data.get("next")

                valid_launches = [
                    launch
                    for launch in new_launches
                    if launch["lat"] is not None
                    and launch["lon"] is not None
                ]

                unique_launches = {}

                for launch in valid_launches:
                    unique_launches[launch["id"]] = launch

                if unique_launches:
                    launches.clear()
                    launches.extend(
                        unique_launches.values()
                    )

                mark_health(
                    "launch_library",
                    True,
                )

                print(
                    f"Launch Library: "
                    f"{len(launches)} global upcoming "
                    f"launches loaded."
                )

            except Exception as e:
                mark_health(
                    "launch_library",
                    False,
                    str(e),
                )

                print(
                    f"Launch Library poll failed "
                    f"({type(e).__name__}: {e}), "
                    f"keeping previous data."
                )

            await asyncio.sleep(300)


async def fires_poller():
    if not FIRMS_MAP_KEY:
        print("WARNING: FIRMS_MAP_KEY not set in .env, skipping fire detections layer.")
        return
    async with httpx.AsyncClient(timeout=20, headers=BROWSER_HEADERS) as client:
        while True:
            try:
                resp = await client.get(FIRMS_URL.format(key=FIRMS_MAP_KEY))
                resp.raise_for_status()
                lines = resp.text.strip().splitlines()
                header = lines[0].split(",")
                lat_i, lon_i, conf_i = header.index("latitude"), header.index("longitude"), header.index("confidence")
                new_fires = []
                for row in lines[1:]:
                    cols = row.split(",")
                    new_fires.append({"lat": float(cols[lat_i]), "lon": float(cols[lon_i]), "confidence": cols[conf_i]})
                fires.clear()
                fires.extend(new_fires)
                mark_health("firms", True)
                print(f"FIRMS: {len(fires)} active fire detections loaded.")
            except Exception as e:
                mark_health("firms", False, str(e))
                print(f"FIRMS poll failed ({type(e).__name__}: {e}), keeping previous data.")
            await asyncio.sleep(3600)


async def spacetrack_poller():
    if not SPACETRACK_IDENTITY or not SPACETRACK_PASSWORD:
        print("WARNING: SPACETRACK_IDENTITY/PASSWORD not set in .env, skipping Space-Track satellite source.")
        return

    async with httpx.AsyncClient(
        timeout=20,
        headers=BROWSER_HEADERS
    ) as client:

        while True:
            try:
                # Login to Space-Track
                login_resp = await client.post(
                    SPACETRACK_LOGIN_URL,
                    data={
                        "identity": SPACETRACK_IDENTITY,
                        "password": SPACETRACK_PASSWORD,
                    },
                )
                login_resp.raise_for_status()

                # Request the satellites we explicitly care about
                ids = ",".join(
                    str(norad_id)
                    for norad_id in TLE_MIRROR_SATELLITES.keys()
                )

                resp = await client.get(
                    SPACETRACK_QUERY_URL.format(ids=ids)
                )
                resp.raise_for_status()

                lines = [
                    line.strip()
                    for line in resp.text.splitlines()
                    if line.strip()
                ]

                loaded = 0

                # Space-Track returns TLE pairs:
                # line 1
                # line 2
                for i in range(0, len(lines) - 1, 2):
                    line1 = lines[i]
                    line2 = lines[i + 1]

                    if not line1.startswith("1 ") or not line2.startswith("2 "):
                        continue

                    try:
                        norad_id = int(line1[2:7])
                    except ValueError:
                        continue

                    default_name, group = TLE_MIRROR_SATELLITES.get(
                        norad_id,
                        (f"NORAD {norad_id}", "other"),
                    )

                    # IMPORTANT:
                    # Space-Track is authoritative for these NORAD IDs.
                    # Overwrite anything supplied by CelesTrak or the mirror.
                    satellite_tles[default_name] = {
                        "name": default_name,
                        "norad_id": norad_id,
                        "line1": line1,
                        "line2": line2,
                        "group": group,
                        "source": "spacetrack",
                    }

                    loaded += 1

                mark_health("spacetrack", True)

                print(
                    f"Space-Track: loaded {loaded} current satellite records "
                    f"and OVERWROTE lower-priority sources."
                )

            except Exception as e:
                mark_health("spacetrack", False, str(e))
                print(
                    f"Space-Track poll failed "
                    f"({type(e).__name__}: {e}), keeping previous data."
                )

            await asyncio.sleep(6 * 3600)
            

async def gdacs_poller():
    async with httpx.AsyncClient(timeout=15, headers=BROWSER_HEADERS) as client:
        while True:
            try:
                resp = await client.get(GDACS_URL)
                resp.raise_for_status()
                data = resp.json()
                new_disasters = []
                for f in data.get("features", []):
                    geom = f.get("geometry", {})
                    coords = geom.get("coordinates")
                    props = f.get("properties", {})
                    if not coords or geom.get("type") != "Point":
                        continue
                    new_disasters.append({
                        "lat": coords[1], "lon": coords[0],
                        "event_type": props.get("eventtype"),
                        "name": props.get("eventname") or props.get("name") or props.get("htmldescription"),
                        "alert_level": props.get("alertlevel"), "country": props.get("country"),
                    })
                disasters.clear()
                disasters.extend(new_disasters)
                mark_health("gdacs", True)
                print(f"GDACS: {len(disasters)} active disaster events loaded.")
            except Exception as e:
                mark_health("gdacs", False, str(e))
                print(f"GDACS poll failed ({type(e).__name__}: {e}), keeping previous data.")
            await asyncio.sleep(900)


async def emsc_poller():
    async with httpx.AsyncClient(timeout=15, headers=BROWSER_HEADERS) as client:
        while True:
            try:
                resp = await client.get(EMSC_URL)
                resp.raise_for_status()
                data = resp.json()
                added = 0
                existing_ids = {q.get("_emsc_id") for q in earthquakes if q.get("_emsc_id")}
                for f in data.get("features", []):
                    props = f.get("properties", {})
                    coords = f.get("geometry", {}).get("coordinates", [])
                    eid = props.get("unid") or props.get("source_id")
                    if not coords or len(coords) < 2 or eid in existing_ids:
                        continue
                    earthquakes.append({
                        "lat": coords[1], "lon": coords[0],
                        "depth_km": coords[2] if len(coords) > 2 else None,
                        "mag": props.get("mag"), "place": props.get("flynn_region") or "Unknown location",
                        "_emsc_id": eid,
                    })
                    added += 1
                mark_health("emsc", True)
                if added:
                    print(f"EMSC: added {added} earthquakes not already in USGS's list.")
            except Exception as e:
                mark_health("emsc", False, str(e))
                print(f"EMSC poll failed ({type(e).__name__}: {e}), keeping previous data.")
            await asyncio.sleep(300)


async def eonet_poller():
    async with httpx.AsyncClient(
        timeout=15,
        headers=BROWSER_HEADERS
    ) as client:

        while True:
            try:
                resp = await client.get(EONET_URL)

                resp.raise_for_status()

                data = resp.json()

                existing = {
                    (
                        f.get("lat"),
                        f.get("lon"),
                        f.get("name"),
                    )
                    for f in fires
                    if f.get("source") == "eonet"
                }

                added = 0

                for event in data.get("events", []):
                    title = event.get("title")

                    for geom in event.get("geometry", []):
                        coords = geom.get("coordinates")

                        if (
                            not coords
                            or len(coords) < 2
                        ):
                            continue

                        record = {
                            "lat": coords[1],
                            "lon": coords[0],
                            "confidence": "eonet",
                            "name": title,
                            "source": "eonet",
                        }

                        key = (
                            record["lat"],
                            record["lon"],
                            record["name"],
                        )

                        if key not in existing:
                            fires.append(record)
                            existing.add(key)
                            added += 1

                mark_health("eonet", True)

                if added:
                    print(
                        f"EONET: added {added} "
                        f"new wildfire detections."
                    )

            except Exception as e:
                mark_health(
                    "eonet",
                    False,
                    str(e)
                )

                print(
                    f"EONET poll failed "
                    f"({type(e).__name__}: {e}), "
                    f"keeping previous data."
                )

            await asyncio.sleep(1800)


async def earthquake_poller():
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                resp = await client.get(USGS_QUAKES_URL)
                resp.raise_for_status()
                data = resp.json()
                new_quakes = []
                for f in data.get("features", []):
                    coords = f["geometry"]["coordinates"]
                    props = f["properties"]
                    new_quakes.append({"lat": coords[1], "lon": coords[0], "depth_km": coords[2], "mag": props.get("mag"), "place": props.get("place")})
                earthquakes.clear()
                earthquakes.extend(new_quakes)
                mark_health("usgs", True)
                print(f"USGS poll: {len(earthquakes)} earthquakes in the last 24h worldwide.")
            except Exception as e:
                mark_health("usgs", False, str(e))
                print(f"USGS poll failed ({type(e).__name__}: {e}), keeping previous data.")
            await asyncio.sleep(300)


async def flight_cleanup():
    while True:
        await asyncio.sleep(60)
        cutoff = time.time() - FLIGHT_STALE_SECONDS
        stale = [k for k, f in flights.items() if f.get("last_seen", 0) < cutoff]
        for k in stale:
            del flights[k]
            flight_history.pop(k, None)
        if stale:
            print(f"Flight cleanup: removed {len(stale)} stale aircraft, {len(flights)} remain.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(ais_listener())
    asyncio.create_task(ais_cleanup())
    asyncio.create_task(flight_poller())
    asyncio.create_task(adsb_hotspot_poller(ADSB_URL_TEMPLATE, "adsb_lol"))
    asyncio.create_task(adsb_hotspot_poller(ADSBFI_URL_TEMPLATE, "adsb_fi"))
    asyncio.create_task(flight_cleanup())
    asyncio.create_task(earthquake_poller())
    asyncio.create_task(emsc_poller())
    asyncio.create_task(satellite_tle_poller())
    asyncio.create_task(tle_mirror_poller())
    asyncio.create_task(spacetrack_poller())
    asyncio.create_task(gdacs_poller())
    asyncio.create_task(launch_poller())
    asyncio.create_task(fires_poller())
    asyncio.create_task(eonet_poller())
    yield


app = FastAPI(title="Geo-Intel Platform API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])

async def get_google_news_events(
    query: str,
    timespan: str = "24h",
):
    """
    Free event/news fallback.

    Google News provides the live article stream.
    We return article metadata in GeoJSON-compatible form.

    Articles without reliable geographic coordinates are skipped
    rather than inventing coordinates.
    """

    articles = []

    async with httpx.AsyncClient(
        timeout=12,
        headers=BROWSER_HEADERS,
        follow_redirects=True,
    ) as client:

        for search_query in EVENT_QUERIES:

            try:
                resp = await client.get(
                    GOOGLE_NEWS_RSS_URL,
                    params={
                        "q": search_query,
                        "hl": "en-AU",
                        "gl": "AU",
                        "ceid": "AU:en",
                    },
                )

                resp.raise_for_status()

                root = ET.fromstring(resp.text)

                for item in root.findall(".//item"):

                    title = item.findtext("title") or ""
                    link = item.findtext("link") or ""
                    pub_date = item.findtext("pubDate") or ""

                    source_node = item.find("source")

                    source_name = (
                        source_node.text
                        if source_node is not None
                        else "Google News"
                    )

                    articles.append({
                        "title": title,
                        "url": link,
                        "source": source_name,
                        "published": pub_date,
                        "query": search_query,
                    })

            except Exception as e:

                mark_health(
                    "google_news",
                    False,
                    str(e),
                )

                print(
                    f"Google News query failed "
                    f"({type(e).__name__}: {e})"
                )

    # Deduplicate
    unique = {}

    for article in articles:
        key = article["url"] or article["title"]

        if key:
            unique[key] = article

    articles = list(unique.values())[:100]

    mark_health("google_news", True)

    return articles


GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search"
EVENT_QUERIES = [
    "conflict",
    "war",
    "military",
    "missile",
    "airstrike",
    "terrorism",
    "protest",
    "election",
    "earthquake",
    "tsunami",
    "volcano",
    "flood",
    "wildfire",
    "cyclone",
    "hurricane",
    "typhoon",
    "disaster",
    "explosion",
    "crash",
    "aviation",
    "maritime",
    "shipping",
    "sanctions",
    "cyberattack",
]


from historical_events import HISTORICAL_EVENTS


@app.get("/api/historical")
async def get_historical(up_to_year: int = Query(default=2026)):
    return {
        "events": [
            e for e in HISTORICAL_EVENTS
            if e["year"] <= up_to_year
        ]
    }


@app.get("/api/events")
async def get_events(
    query: str = Query(
        default="conflict OR military OR sanctions OR protest"
    ),
    timespan: str = Query(default="24h"),
):

    cache_key = f"{query}:{timespan}"

    cached = EVENT_CACHE.get(cache_key)

    if cached:
        if time.time() - cached["timestamp"] < EVENT_CACHE_TTL:
            return cached["data"]

    # ============================================================
    # 1. GDELT
    # ============================================================

    try:

        params = {
            "query": query,
            "format": "geojson",
            "timespan": timespan,
        }

        async with httpx.AsyncClient(
            timeout=8,
            headers=BROWSER_HEADERS,
        ) as client:

            resp = await client.get(
                GDELT_GEO_URL,
                params=params,
            )

            resp.raise_for_status()

            data = resp.json()

            data["source"] = "gdelt"

            mark_health("gdelt", True)

            EVENT_CACHE[cache_key] = {
                "timestamp": time.time(),
                "data": data,
            }

            return data

    except Exception as e:

        mark_health(
            "gdelt",
            False,
            str(e),
        )

        print(
            f"GDELT unavailable "
            f"({type(e).__name__}: {e}), trying alternatives."
        )


    # ============================================================
    # 3. GOOGLE NEWS
    # ============================================================

    news_articles = await get_google_news_events(
        query=query,
        timespan=timespan,
    )

    if news_articles:

        # We return the articles as metadata for now.
        # No fake coordinates.
        data = {
            "type": "FeatureCollecti@app.get(on",
            "features": [],
            "source": "google_news",
            "articles": news_articles,
            "note": (
                "Live news fallback is available, "
                "but articles without verified coordinates "
                "are not plotted."
            ),
        }

        EVENT_CACHE[cache_key] = {
            "timestamp": time.time(),
            "data": data,
        }

        return data

    # ============================================================
    # 4. LOCAL FALLBACK
    # ============================================================

    fallback = dict(SAMPLE_EVENTS_GEOJSON)

    fallback["source"] = "local_fallback"

    fallback["note"] = (
        "Live event providers unavailable; "
        "showing local fallback data."
    )

    EVENT_CACHE[cache_key] = {
        "timestamp": time.time(),
        "data": fallback,
    }

    return fallback


@app.get("/api/solar-system")
async def solar_system_endpoint():
    return await get_solar_system()



@app.get("/api/ships")
async def get_ships():
    return {"ships": list(ships.values()), "count": len(ships)}


@app.get("/api/flights")
async def get_flights():
    return {"flights": list(flights.values()), "count": len(flights)}


@app.get("/api/earthquakes")
async def get_earthquakes():
    return {"earthquakes": earthquakes, "count": len(earthquakes)}


@app.get("/api/chokepoint-risk")
async def get_chokepoint_risk():
    integrity = await get_gps_integrity()
    jam_by_region = {r["region"]: r for r in integrity["regions"]}

    def haversine_km(lat1, lon1, lat2, lon2):
        R = 6371
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
        return 2 * R * math.asin(math.sqrt(a))

    try:
        events_resp = await get_events()
        event_features = events_resp.get("features", [])
    except Exception:
        event_features = []

    results = []
    for hotspot in ADSB_HOTSPOTS:
        name, lat, lon = hotspot["name"], hotspot["lat"], hotspot["lon"]
        jam_score = jam_by_region.get(name, {}).get("jam_score", 0)
        ship_count = sum(
            1
            for s in ships.values()
            if s["lat"] is not None
            and s["lon"] is not None
            and haversine_km(lat, lon, s["lat"], s["lon"]) < 300
        )
        shipping_anomaly_score = 100 if ship_count < 5 else max(0, 100 - ship_count * 10)
        nearby_events = sum(
            1
            for f in event_features
            if f.get("geometry", {}).get("coordinates")
            and haversine_km(
                lat,
                lon,
                f["geometry"]["coordinates"][1],
                f["geometry"]["coordinates"][0],
            )
            < 500
        )
        event_density_score = min(nearby_events * 15, 100)
        composite = round(jam_score * 0.5 + shipping_anomaly_score * 0.2 + event_density_score * 0.3, 1)
        results.append({
            "region": name, "lat": lat, "lon": lon, "composite_risk": composite,
            "components": {
                "jam_score": jam_score, "shipping_anomaly_score": round(shipping_anomaly_score, 1),
                "ship_count_nearby": ship_count, "event_density_score": event_density_score, "nearby_event_count": nearby_events,
            },
        })
    return {"chokepoints": results}



@app.get("/api/gps-integrity")
async def get_gps_integrity():
    DEGRADED_NIC_THRESHOLD = 7
    by_region: dict[str, dict] = {}
    for f in flights.values():
        if f.get("source") not in ("adsb_lol", "adsb_fi") or f.get("region") is None:
            continue
        region = f["region"]
        nic = f.get("nic")
        if nic is None:
            continue
        bucket = by_region.setdefault(region, {"samples": [], "degraded_count": 0})
        bucket["samples"].append(nic)
        if nic < DEGRADED_NIC_THRESHOLD:
            bucket["degraded_count"] += 1

    results = []
    for region_name, bucket in by_region.items():
        n = len(bucket["samples"])
        if n == 0:
            continue
        avg_nic = sum(bucket["samples"]) / n
        pct_degraded = (bucket["degraded_count"] / n) * 100
        region_coords = next((r for r in ADSB_HOTSPOTS if r["name"] == region_name), None)
        results.append({
            "region": region_name, "lat": region_coords["lat"] if region_coords else None,
            "lon": region_coords["lon"] if region_coords else None, "sample_count": n,
            "avg_nic": round(avg_nic, 2), "pct_degraded": round(pct_degraded, 1), "jam_score": round(pct_degraded, 1),
        })
    return {"regions": results}


@app.get("/api/ships/{mmsi}/history")
async def get_ship_history(mmsi: str):
    return {"history": ship_history.get(mmsi, [])}


@app.get("/api/flights/{icao24}/history")
async def get_flight_history(icao24: str):
    return {"history": flight_history.get(icao24, [])}


@app.get("/api/satellites/tle")
async def get_satellite_tles():
    # Higher cap so the frontend receives a much larger satellite set.
    SATELLITE_API_CAP = 2000

    priority_groups = {"stations", "gps-ops", "geo"}

    all_sats = list(satellite_tles.values())

    # Space-Track first
    spacetrack = [
        s for s in all_sats
        if s.get("source") == "spacetrack"
    ]

    # Then important operational groups
    priority = [
        s for s in all_sats
        if s.get("source") != "spacetrack"
        and s.get("group") in priority_groups
    ]

    # Everything else
    rest = [
        s for s in all_sats
        if s.get("source") != "spacetrack"
        and s.get("group") not in priority_groups
    ]

    ordered = spacetrack + priority + rest
    capped = ordered[:SATELLITE_API_CAP]

    return {
        "satellites": capped,
        "count": len(capped),
        "total_available": len(all_sats),
        "api_cap": SATELLITE_API_CAP,
    }


@app.get("/api/launches")
async def get_launches():
    print("API launches count:", len(launches))
    print("API launches object:", id(launches))

    return {
        "launches": launches,
        "count": len(launches),
    }

@app.get("/api/missions")
async def get_historical_missions():
    return {
        "missions": list(HISTORICAL_MISSIONS.values()),
        "count": len(HISTORICAL_MISSIONS),
    }


@app.get("/api/missions/{mission_id}")
async def get_historical_mission(mission_id: str):

    mission = HISTORICAL_MISSIONS.get(mission_id)

    if not mission:
        return {
            "error": "Mission not found",
            "mission_id": mission_id,
        }

    return mission



@app.get("/api/missions/{mission_id}/trajectory")
async def get_mission_trajectory_endpoint(
    mission_id: str,
):
    print(" TRAJECTORY ENDPOINT HIT:", mission_id)

    mission = HISTORICAL_MISSIONS.get(
        mission_id
    )

    if not mission:
        return {
            "available": False,
            "mission_id": mission_id,
            "points": [],
        }

    try:
        trajectory = await get_mission_trajectory(
            mission
        )

        return {
            "available": trajectory["available"],
            "mission_id": mission_id,
            "name": mission["name"],
            "source": trajectory["source"],
            "source_type": trajectory["source_type"],
            "accuracy": trajectory["accuracy"],
            "coordinate_system": (
                "heliocentric ecliptic J2000"
            ),
            "units": {
                "position": "AU"
            },
            "points": trajectory["points"],
        }

    except Exception as e:
        print(
            f"Trajectory fetch failed "
            f"for {mission_id}: {e}"
        )

        return {
            "available": False,
            "mission_id": mission_id,
            "name": mission["name"],
            "source": mission.get(
                "source",
                "Unknown",
            ),
            "source_type": mission.get(
                "source_type",
                "unknown",
            ),
            "accuracy": mission.get(
                "trajectory",
                {}
            ).get(
                "accuracy",
                "unknown",
            ),
            "points": [],
            "error": str(e),
        }


@app.get("/api/missions/{mission_id}/state")
async def get_historical_mission_state(
    mission_id: str,
    time: str,
):
    mission = HISTORICAL_MISSIONS.get(
        mission_id
    )

    if not mission:
        return {
            "error": "Mission not found",
            "mission_id": mission_id,
        }

    try:
        # Get generic mission state
        state = get_mission_state(
            mission,
            time,
        )

        # Convert mission time to Julian Date
        timestamp_jd = datetime_to_julian_date(
            state["time"]
        )

        spacecraft = None

        # Load trajectory when available
        try:
            trajectory = await get_mission_trajectory(
                mission
            )

            points = trajectory.get(
                "points",
                [],
            )

            spacecraft_position = (
                interpolate_trajectory_position(
                    points,
                    timestamp_jd,
                )
            )

            if spacecraft_position:
                spacecraft = {
                    "position": spacecraft_position,
                    "units": "AU",
                }

        except Exception as trajectory_error:
            print(
                f"Trajectory unavailable "
                f"for {mission_id}: "
                f"{trajectory_error}"
            )

        state["spacecraft"] = spacecraft

        return state

    except Exception as e:
        return {
            "error": "Unable to determine mission state",
            "mission_id": mission_id,
            "time": time,
            "details": str(e),
        }

@app.get("/api/launches/{launch_id}/telemetry")
async def get_launch_telemetry(launch_id: str):
    url = (
        "http://api.launchdashboard.space/v2/launches"
        f"?launch_library_2_id={launch_id}"
    )

    try:
        async with httpx.AsyncClient(
            timeout=15,
            headers=BROWSER_HEADERS,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

        return {
            "launch_id": launch_id,
            "raw": data.get("raw", []),
            "analysed": data.get("analysed", []),
            "events": data.get("events", []),
        }

    except Exception as e:
        print(f"Launch telemetry fetch failed: {e}")

        return {
            "launch_id": launch_id,
            "raw": [],
            "analysed": [],
            "events": [],
        }


@app.get("/api/launches/{launch_id}/details")
async def get_launch_details(launch_id: str):
    url = f"https://ll.thespacedevs.com/2.2.0/launch/{launch_id}/"

    try:
        async with httpx.AsyncClient(
            timeout=15,
            headers=BROWSER_HEADERS,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()

        return response.json()

    except Exception as e:
        print(f"Launch details fetch failed: {e}")
        return {
            "error": str(e),
            "launch_id": launch_id,
        }

@app.get("/api/fires")
async def get_fires():
    return {"fires": fires, "count": len(fires)}


@app.get("/api/disasters")
async def get_disasters():
    return {"disasters": disasters, "count": len(disasters)}


@app.get("/api/health")
async def get_health():
    now = time.time()
    categories = {}
    for category, sources in CATEGORY_SOURCES.items():
        source_details = []
        any_live = False
        for src in sources:
            h = SOURCE_HEALTH.get(src)
            if h and h["ok"] and (now - h["last_check"]) < 600:
                any_live = True
                source_details.append({"source": src, "status": "live", "last_check": h["last_check"]})
            elif h:
                source_details.append({"source": src, "status": "down", "error": h.get("error"), "last_check": h["last_check"]})
            else:
                source_details.append({"source": src, "status": "unknown"})
        categories[category] = {"status": "live" if any_live else "down", "sources": source_details}

    categories["gps_integrity"] = {
        "status": "live" if categories["aircraft"]["status"] == "live" else "down",
        "note": "derived from adsb.lol/adsb.fi NIC fields",
    }
    categories["chokepoints"] = {
        "status": "live" if any(categories[c]["status"] == "live" for c in ["gps_integrity", "ships", "events"]) else "down",
        "note": "fusion of jam score, ship density, event density",
    }
    return categories


@app.get("/")
async def root():
    return {"status": "ok", "message": "Geo-Intel Platform backend running"}