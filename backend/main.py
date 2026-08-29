import asyncio
import json
import os
from contextlib import asynccontextmanager

import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from sample_events import SAMPLE_EVENTS_GEOJSON

load_dotenv()

AISSTREAM_API_KEY = os.getenv("AISSTREAM_API_KEY")
GDELT_GEO_URL = "https://api.gdeltproject.org/api/v2/geo/geo"
ADSB_URL_TEMPLATE = "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}

SHIP_REGIONS = [
    {"name": "hormuz", "box": [[24.0, 54.0], [27.5, 58.0]]},
    {"name": "singapore_strait", "box": [[1.0, 103.5], [1.5, 104.2]]},
    {"name": "malacca_strait", "box": [[2.0, 100.5], [6.0, 103.0]]},
    {"name": "bab_el_mandeb", "box": [[11.5, 42.5], [13.5, 44.5]]},
    {"name": "suez_canal", "box": [[29.5, 32.0], [31.5, 33.0]]},
    {"name": "gibraltar", "box": [[35.7, -6.0], [36.3, -4.5]]},
    {"name": "dover_strait", "box": [[50.8, 1.0], [51.2, 1.8]]},
    {"name": "panama_canal", "box": [[8.8, -80.0], [9.4, -79.4]]},
]
SUBSCRIBED_BOXES = [r["box"] for r in SHIP_REGIONS]
ships: dict[str, dict] = {}


def classify_ship_region(lat: float, lon: float) -> str:
    for r in SHIP_REGIONS:
        (lat1, lon1), (lat2, lon2) = r["box"]
        lat_min, lat_max = min(lat1, lat2), max(lat1, lat2)
        lon_min, lon_max = min(lon1, lon2), max(lon1, lon2)
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return r["name"]
    return "other"


FLIGHT_REGIONS = [
    {"name": "hormuz", "lat": 26.5, "lon": 56.25, "radius_nm": 250},
    {"name": "singapore_strait", "lat": 1.25, "lon": 103.85, "radius_nm": 250},
]
flights: dict[str, dict] = {}


async def ais_listener():
    if not AISSTREAM_API_KEY:
        print("WARNING: AISSTREAM_API_KEY not set in .env, skipping AIS listener.")
        return

    while True:
        try:
            async with websockets.connect("wss://stream.aisstream.io/v0/stream") as ws:
                subscribe_message = {
                    "APIKey": AISSTREAM_API_KEY,
                    "BoundingBoxes": SUBSCRIBED_BOXES,
                    "FilterMessageTypes": ["PositionReport"],
                }
                await ws.send(json.dumps(subscribe_message))
                print(f"Connected to AISStream, subscribed to {len(SHIP_REGIONS)} chokepoints.")

                async for raw_message in ws:
                    data = json.loads(raw_message)
                    if data.get("MessageType") == "PositionReport":
                        meta = data["MetaData"]
                        mmsi = str(meta["MMSI"])
                        lat, lon = meta["latitude"], meta["longitude"]
                        ships[mmsi] = {
                            "mmsi": mmsi,
                            "name": (meta.get("ShipName") or "Unknown vessel").strip(),
                            "lat": lat,
                            "lon": lon,
                            "region": classify_ship_region(lat, lon),
                        }
        except Exception as e:
            print(f"AIS connection error ({e}), retrying in 10s...")
            await asyncio.sleep(10)


async def flight_poller():
    async with httpx.AsyncClient(timeout=10, headers=BROWSER_HEADERS) as client:
        while True:
            for region in FLIGHT_REGIONS:
                try:
                    url = ADSB_URL_TEMPLATE.format(
                        lat=region["lat"], lon=region["lon"], radius_nm=region["radius_nm"]
                    )
                    resp = await client.get(url)
                    resp.raise_for_status()
                    data = resp.json()
                    ac_list = data.get("ac", [])
                    print(f"adsb.lol {region['name']}: got {len(ac_list)} aircraft in raw response")
                    for ac in ac_list:
                        if ac.get("lat") is None or ac.get("lon") is None:
                            continue
                        flights[ac["hex"]] = {
                            "hex": ac["hex"],
                            "flight": (ac.get("flight") or "Unknown").strip(),
                            "lat": ac["lat"],
                            "lon": ac["lon"],
                            "alt": ac.get("alt_baro"),
                            "track": ac.get("track"),
                            "region": region["name"],
                        }
                except Exception as e:
                    print(f"adsb.lol poll failed for {region['name']} ({type(e).__name__}: {e}), skipping this round.")
            await asyncio.sleep(15)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(ais_listener())
    asyncio.create_task(flight_poller())
    yield


app = FastAPI(title="Geo-Intel Platform API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/events")
async def get_events(
    query: str = Query(default="conflict OR military OR sanctions OR protest"),
    timespan: str = Query(default="24h"),
):
    params = {"query": query, "format": "geojson", "timespan": timespan}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(GDELT_GEO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
            data["source"] = "live_gdelt"
            return data
    except Exception as e:
        print(f"GDELT request failed ({type(e).__name__}: {e}), using fallback data.")
        fallback = dict(SAMPLE_EVENTS_GEOJSON)
        fallback["source"] = "local_fallback"
        fallback["note"] = "GDELT unreachable right now, showing sample data instead."
        return fallback


@app.get("/api/ships")
async def get_ships():
    return {"ships": list(ships.values()), "count": len(ships)}


@app.get("/api/flights")
async def get_flights():
    return {"flights": list(flights.values()), "count": len(flights)}


@app.get("/")
async def root():
    return {"status": "ok", "message": "Geo-Intel Platform backend running"}