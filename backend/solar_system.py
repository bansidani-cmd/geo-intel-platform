import asyncio
import time
import httpx
from datetime import datetime, timezone, timedelta


# =========================================================
# JPL HORIZONS
# =========================================================

HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"

# JPL Horizons does not like being hit with many
# simultaneous requests from the same client - keep
# concurrency modest.
HORIZONS_MAX_CONCURRENCY = 2
_horizons_semaphore = asyncio.Semaphore(HORIZONS_MAX_CONCURRENCY)

# Positions barely change minute to minute - cache the
# whole response instead of re-fetching all 10 bodies
# on every page load / refresh.
SOLAR_SYSTEM_CACHE_TTL = 300  # seconds
_solar_system_cache = None
_solar_system_cache_time = 0.0


# =========================================================
# SOLAR SYSTEM BODIES
# =========================================================

SOLAR_SYSTEM_BODIES = {
    "sun": {
        "name": "Sun",
        "command": "10",
        "type": "star",
    },
    "mercury": {
        "name": "Mercury",
        "command": "199",
        "type": "planet",
    },
    "venus": {
        "name": "Venus",
        "command": "299",
        "type": "planet",
    },
    "earth": {
        "name": "Earth",
        "command": "399",
        "type": "planet",
    },
    "moon": {
        "name": "Moon",
        "command": "301",
        "type": "moon",
    },
    "mars": {
        "name": "Mars",
        "command": "499",
        "type": "planet",
    },
    "jupiter": {
        "name": "Jupiter",
        "command": "599",
        "type": "planet",
    },
    "saturn": {
        "name": "Saturn",
        "command": "699",
        "type": "planet",
    },
    "uranus": {
        "name": "Uranus",
        "command": "799",
        "type": "planet",
    },
    "neptune": {
        "name": "Neptune",
        "command": "899",
        "type": "planet",
    },
}


# =========================================================
# GET ONE BODY POSITION
# =========================================================

async def get_body_position(
    command: str,
    epoch: datetime | None = None,
):
    """
    Get a Solar System body's barycentric position
    and velocity from JPL Horizons.

    Position:
        AU

    Velocity:
        km/s

    Reference:
        ICRF / ecliptic
    """

    if epoch is None:
        epoch = datetime.now(timezone.utc)

    # Horizons needs a time span.
    # We request two points one day apart and use
    # the first point.

    stop_time = epoch + timedelta(days=1)

    start_string = epoch.strftime("%Y-%m-%d %H:%M")
    stop_string = stop_time.strftime("%Y-%m-%d %H:%M")

    params = {
        "format": "json",
        "COMMAND": f"'{command}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'VECTORS'",

        # Solar-system barycenter
        "CENTER": "'@0'",

        "START_TIME": f"'{start_string}'",
        "STOP_TIME": f"'{stop_string}'",
        "STEP_SIZE": "'1 d'",

        # AU and days gives us AU/day velocities,
        # but we will primarily use the position.
        "OUT_UNITS": "'AU-D'",

        "REF_PLANE": "'ECLIPTIC'",
        "REF_SYSTEM": "'ICRF'",

        # State vector:
        # X Y Z VX VY VZ
        "VEC_TABLE": "'2'",

        "CSV_FORMAT": "'YES'",
    }

    async with _horizons_semaphore:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                HORIZONS_URL,
                params=params,
            )

            response.raise_for_status()

            data = response.json()

    # Horizons can return an API-level error
    # even when HTTP itself succeeded.

    if "error" in data:
        raise RuntimeError(
            f"Horizons error: {data['error']}"
        )

    result = data.get("result", "")

    if not result:
        raise RuntimeError(
            f"Horizons returned no result for "
            f"body {command}"
        )

    # Horizons vector data lives between
    #
    # $$SOE
    #
    # and
    #
    # $$EOE

    if "$$SOE" not in result:
        raise RuntimeError(
            f"Horizons response contained no "
            f"$$SOE marker for body {command}"
        )

    if "$$EOE" not in result:
        raise RuntimeError(
            f"Horizons response contained no "
            f"$$EOE marker for body {command}"
        )

    vector_section = (
        result
        .split("$$SOE", 1)[1]
        .split("$$EOE", 1)[0]
        .strip()
    )

    lines = [
        line.strip()
        for line in vector_section.splitlines()
        if line.strip()
    ]

    if not lines:
        raise RuntimeError(
            f"No vector lines returned for "
            f"body {command}"
        )

    # -----------------------------------------------------
    # Find the actual CSV vector line.
    #
    # Horizons may include a date/time field followed by:
    #
    # X,Y,Z,VX,VY,VZ
    # -----------------------------------------------------

    vector_line = None

    for line in lines:
        parts = [
            part.strip()
            for part in line.split(",")
        ]

        if len(parts) >= 8:
            try:
                # Expected layout:
                #
                # JD,
                # Calendar Date,
                # X,
                # Y,
                # Z,
                # VX,
                # VY,
                # VZ

                float(parts[2])
                float(parts[3])
                float(parts[4])
                float(parts[5])
                float(parts[6])
                float(parts[7])

                vector_line = parts
                break

            except ValueError:
                continue

    if vector_line is None:
        raise RuntimeError(
            "Could not parse Horizons vector data.\n"
            f"Raw vector section:\n{vector_section}"
        )

    return {
        "x": float(vector_line[2]),
        "y": float(vector_line[3]),
        "z": float(vector_line[4]),
        "vx": float(vector_line[5]),
        "vy": float(vector_line[6]),
        "vz": float(vector_line[7]),
    }


# =========================================================
# GET ONE BODY, WRAPPED SO A FAILURE DOESN'T ABORT THE REST
# =========================================================

async def _get_body_safe(body_id, body, epoch):
    max_retries = 3

    for attempt in range(1, max_retries + 1):
        try:
            position = await get_body_position(
                body["command"],
                epoch,
            )

            print(f"Solar System: loaded {body['name']}")

            return {
                "id": body_id,
                "name": body["name"],
                "type": body["type"],
                "x": position["x"],
                "y": position["y"],
                "z": position["z"],
                "vx": position["vx"],
                "vy": position["vy"],
                "vz": position["vz"],
            }

        except Exception as e:
            print(
                f"Solar System ERROR: {body['name']} "
                f"(attempt {attempt}/{max_retries}) -> {e}"
            )

            if attempt < max_retries:
                await asyncio.sleep(1)

    return None


# =========================================================
# GET ENTIRE SOLAR SYSTEM
# =========================================================

async def get_solar_system():
    global _solar_system_cache, _solar_system_cache_time

    now_ts = time.time()

    if (
        _solar_system_cache is not None
        and now_ts - _solar_system_cache_time < SOLAR_SYSTEM_CACHE_TTL
    ):
        return _solar_system_cache

    now = datetime.now(timezone.utc)

    results = await asyncio.gather(
        *(
            _get_body_safe(body_id, body, now)
            for body_id, body in SOLAR_SYSTEM_BODIES.items()
        )
    )

    bodies = [
        body
        for body in results
        if body is not None
    ]

    response = {
        "timestamp": now.isoformat(),
        "coordinate_system": "ICRF",
        "reference_plane": "ECLIPTIC",
        "units": {
            "position": "AU",
            "velocity": "AU/day",
        },
        "bodies": bodies,
    }

    if len(bodies) == len(SOLAR_SYSTEM_BODIES):
        _solar_system_cache = response
        _solar_system_cache_time = now_ts

    return response