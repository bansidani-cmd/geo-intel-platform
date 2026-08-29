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

# Strait of Hormuz: [[min_lat, min_lon], [max_lat, max_lon]]
# One of the world's most critical oil chokepoints, roughly a fifth of
# global oil consumption passes through here. Traffic here can appear
# sparse on open trackers, partly due to coverage gaps, but also because
# vessels near Iran are known to disable AIS ("go dark") to evade
# sanctions monitoring, a real, well documented OSINT phenomenon.
HORMUZ_BOX = [[24.0, 54.0], [27.5, 58.0]]

# Singapore Strait: one of the busiest shipping lanes on Earth, included
# so the dashboard always has visible live activity even when Hormuz
# traffic is quiet.
SINGAPORE_STRAIT_BOX = [[1.0, 103.5], [1.5, 104.2]]

SUBSCRIBED_BOXES = [HORMUZ_BOX, SINGAPORE_STRAIT_BOX]

# In-memory store of the latest known position per ship (keyed by MMSI,
# the vessel's unique maritime identifier). No database yet, it just
# lives in RAM while the server runs.
ships: dict[str, dict] = {}


async def ais_listener():
    """
    Runs forever in the background, maintaining a live websocket connection
    to aisstream.io and updating the `ships` dict as new position reports
    arrive. If the connection drops, it waits 10 seconds and reconnects
    automatically rather than dying.
    """
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
                print("Connected to AISStream, subscribed to Hormuz + Singapore Strait.")

                async for raw_message in ws:
                    data = json.loads(raw_message)
                    if data.get("MessageType") == "PositionReport":
                        meta = data["MetaData"]
                        mmsi = str(meta["MMSI"])
                        lat, lon = meta["latitude"], meta["longitude"]
                        region = "hormuz" if lon < 90 else "singapore_strait"
                        ships[mmsi] = {
                            "mmsi": mmsi,
                            "name": (meta.get("ShipName") or "Unknown vessel").strip(),
                            "lat": lat,
                            "lon": lon,
                            "region": region,
                        }
        except Exception as e:
            print(f"AIS connection error ({e}), retrying in 10s...")
            await asyncio.sleep(10)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(ais_listener())
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
        # Deliberately broad: GDELT is a free, single-maintainer service
        # and has proven unreliable all session (timeouts, outright
        # outages, and now malformed responses). Whatever goes wrong,
        # this endpoint must never crash, it should just fall back.
        print(f"GDELT request failed ({type(e).__name__}: {e}), using fallback data.")
        fallback = dict(SAMPLE_EVENTS_GEOJSON)
        fallback["source"] = "local_fallback"
        fallback["note"] = "GDELT unreachable right now, showing sample data instead."
        return fallback


@app.get("/api/ships")
async def get_ships():
    return {"ships": list(ships.values()), "count": len(ships)}


@app.get("/")
async def root():
    return {"status": "ok", "message": "Geo-Intel Platform backend running"}