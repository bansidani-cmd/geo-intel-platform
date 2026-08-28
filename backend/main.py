from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import httpx
from sample_events import SAMPLE_EVENTS_GEOJSON

app = FastAPI(title="Geo-Intel Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GDELT_GEO_URL = "https://api.gdeltproject.org/api/v2/geo/geo"


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
    except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.HTTPStatusError):
        fallback = dict(SAMPLE_EVENTS_GEOJSON)
        fallback["source"] = "local_fallback"
        fallback["note"] = "GDELT unreachable right now, showing sample data instead."
        return fallback


@app.get("/")
async def root():
    return {"status": "ok", "message": "Geo-Intel Platform backend running"}