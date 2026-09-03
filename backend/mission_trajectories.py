import httpx


HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"


HISTORICAL_MISSIONS = {

    "india-mangalyaan": {
        "id": "india-mangalyaan",
        "name": "Mars Orbiter Mission (Mangalyaan)",
        "country": "India",
        "agency": "ISRO",

        "launch": {
            "date": "2013-11-05",
            "site": "Satish Dhawan Space Centre",
            "body": "Earth",
        },

        "destination": {
            "body": "Mars",
            "type": "planet",
        },

        "phases": [
            {
                "id": "launch",
                "name": "Launch",
                "type": "launch",
                "coordinate_system": "earth-centered",
                "start": "2013-11-05T00:00:00",
                "end": "2013-11-05T23:59:59",
            },
            {
                "id": "earth-orbit-raising",
                "name": "Earth Orbit Raising",
                "type": "earth-orbit",
                "coordinate_system": "earth-centered",
                "start": "2013-11-05T00:00:00",
                "end": "2013-11-30T19:18:59",
            },
            {
                "id": "trans-mars-injection",
                "name": "Trans-Mars Injection",
                "type": "escape",
                "coordinate_system": "earth-to-solar",
                "start": "2013-11-30T19:19:00",
                "end": "2013-12-01T00:00:00",
            },
            {
                "id": "heliocentric-transfer",
                "name": "Heliocentric Transfer",
                "type": "interplanetary",
                "coordinate_system": "heliocentric",
                "start": "2013-12-01T00:00:00",
                "end": "2014-09-24T00:00:00",
            },
            {
                "id": "mars-orbit-insertion",
                "name": "Mars Orbit Insertion",
                "type": "planetary-orbit",
                "coordinate_system": "mars-centered",
                "start": "2014-09-24T00:00:00",
                "end": "2014-09-25T23:59:59",
            },
        ],

        "trajectory": {
            "source": "NASA/JPL Horizons + ISRO",
            "source_type": "spacecraft_ephemeris",
            "accuracy": "historical",
            "horizons_id": "-3",
            "start": "2013-11-30 19:19",
            "stop": "2014-09-25",
            "step": "1 d",
        },

        # Compatibility fields for the existing Horizons loader.
        "date": "2013-11-05",
        "destination_legacy": "Mars",
        "trajectory_type": "interplanetary",
        "source": "NASA/JPL Horizons + ISRO",
        "source_type": "spacecraft_ephemeris",
        "horizons_id": "-3",
        "start": "2013-11-30 19:19",
        "stop": "2014-09-25",
        "step": "1 d",
    },


    "india-chandrayaan-3": {
        "id": "india-chandrayaan-3",
        "name": "Chandrayaan-3",
        "country": "India",
        "agency": "ISRO",

        "launch": {
            "date": "2023-07-14",
            "site": "Satish Dhawan Space Centre",
            "body": "Earth",
        },

        "destination": {
            "body": "Moon",
            "type": "moon",
            "parent": "Earth",
        },

        "phases": [
            {
                "id": "launch",
                "name": "Launch",
                "type": "launch",
                "coordinate_system": "earth-centered",
                "start": "2023-07-14T00:00:00",
                "end": "2023-07-14T23:59:59",
            },
            {
                "id": "earth-orbit",
                "name": "Earth Orbit",
                "type": "earth-orbit",
                "coordinate_system": "earth-centered",
                "start": "2023-07-14T00:00:00",
                "end": "2023-07-14T23:59:59",
            },
            {
                "id": "earth-orbit-raising",
                "name": "Earth Orbit Raising",
                "type": "earth-orbit",
                "coordinate_system": "earth-centered",
                "start": "2023-07-15T00:00:00",
                "end": "2023-08-01T00:00:00",
            },
            {
                "id": "trans-lunar-injection",
                "name": "Trans-Lunar Injection",
                "type": "escape",
                "coordinate_system": "earth-to-moon",
                "start": "2023-08-01T00:00:00",
                "end": "2023-08-02T00:00:00",
            },
            {
                "id": "lunar-transfer",
                "name": "Lunar Transfer",
                "type": "lunar-transfer",
                "coordinate_system": "earth-moon",
                "start": "2023-08-02T00:00:00",
                "end": "2023-08-05T00:00:00",
            },
            {
                "id": "lunar-orbit",
                "name": "Lunar Orbit",
                "type": "lunar-orbit",
                "coordinate_system": "moon-centered",
                "start": "2023-08-05T00:00:00",
                "end": "2023-08-23T00:00:00",
            },
            {
                "id": "landing",
                "name": "Landing",
                "type": "landing",
                "coordinate_system": "body-fixed",
                "start": "2023-08-23T00:00:00",
                "end": "2023-08-23T18:04:00",
            },
            {
                "id": "surface",
                "name": "Surface",
                "type": "surface",
                "coordinate_system": "body-fixed",
                "start": "2023-08-23T18:04:00",
                "end": "2023-08-24T00:00:00",
            },
        ],

        "trajectory": {
            "source": "NASA/JPL Horizons + ISRO",
            "source_type": "spacecraft_ephemeris",
            "accuracy": "historical",
            "horizons_id": "-158",
            "start": "2023-07-14",
            "stop": "2023-08-24",
            "step": "6 h",
        },

        # Compatibility fields for the existing Horizons loader.
        "date": "2023-07-14",
        "destination_legacy": "Moon",
        "trajectory_type": "lunar",
        "source": "NASA/JPL Horizons + ISRO",
        "source_type": "spacecraft_ephemeris",
        "horizons_id": "-158",
        "start": "2023-07-14",
        "stop": "2023-08-24",
        "step": "6 h",
    },
}


async def fetch_horizons_trajectory(mission):
    params = {
        "format": "json",
        "COMMAND": f"'{mission['horizons_id']}'",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": "@0",
        "START_TIME": f"'{mission['start']}'",
        "STOP_TIME": f"'{mission['stop']}'",
        "STEP_SIZE": f"'{mission['step']}'",
        "REF_PLANE": "ECLIPTIC",
        "REF_SYSTEM": "ICRF",
        "OUT_UNITS": "AU-D",
        "VEC_TABLE": "1",
        "VEC_CORR": "NONE",
        "CSV_FORMAT": "YES",
        "VEC_LABELS": "NO",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            HORIZONS_URL,
            params=params,
        )

        response.raise_for_status()

        data = response.json()

    # Horizons can return HTTP 200 even when the
    # actual Horizons query failed.
    if data.get("error"):
        raise RuntimeError(
            f"Horizons API error: {data['error']}"
        )

    result = data.get("result", "")

    if not result:
        raise RuntimeError(
            "Horizons returned an empty result."
        )

    # Horizons may put query errors inside the result
    # rather than the top-level JSON error field.
    if "$$SOE" not in result:
        raise RuntimeError(
            "Horizons returned no ephemeris data.\n"
            + result[:3000]
        )

    points = parse_horizons_vectors(result)

    if not points:
        raise RuntimeError(
            "Horizons returned an ephemeris table, "
            "but no position points could be parsed."
        )

    return points


def parse_horizons_vectors(result):
    points = []
    in_data = False

    for raw_line in result.splitlines():
        line = raw_line.strip()

        if line == "$$SOE":
            in_data = True
            continue

        if line == "$$EOE":
            break

        if not in_data or not line:
            continue

        parts = [
            p.strip()
            for p in line.split(",")
        ]

        if len(parts) < 4:
            continue

        try:
            jd = float(parts[0])

            numeric_values = []

            for value in parts[1:]:
                try:
                    numeric_values.append(
                        float(value)
                    )
                except ValueError:
                    continue

            if len(numeric_values) < 3:
                continue

            x = numeric_values[-3]
            y = numeric_values[-2]
            z = numeric_values[-1]

            points.append({
                "jd": jd,
                "x": x,
                "y": y,
                "z": z,
            })

        except (ValueError, IndexError):
            continue

    return points

def get_trajectory_accuracy(mission):
    """
    Return the declared trajectory accuracy for a mission.
    """

    trajectory = mission.get("trajectory", {})

    return {
        "source": trajectory.get(
            "source",
            "Unknown",
        ),
        "source_type": trajectory.get(
            "source_type",
            "unknown",
        ),
        "accuracy": trajectory.get(
            "accuracy",
            "approximate",
        ),
    }


async def get_mission_trajectory(mission):
    """
    Generic trajectory provider.

    The rest of the application calls this function
    instead of calling Horizons directly.

    Provider priority:

    1. Historical spacecraft ephemeris
    2. Published mission trajectory
    3. Orbital elements
    4. Physics reconstruction
    5. Approximate visual trajectory
    """

    trajectory = mission.get(
        "trajectory",
        {}
    )

    source_type = trajectory.get(
        "source_type"
    )

    if source_type == "spacecraft_ephemeris":
        points = await fetch_horizons_trajectory(
            mission
        )

        return {
            "available": True,
            "points": points,
            "source": trajectory.get(
                "source",
                "NASA/JPL Horizons",
            ),
            "source_type": source_type,
            "accuracy": trajectory.get(
                "accuracy",
                "historical",
            ),
        }

    # Future providers will be implemented here.

    raise RuntimeError(
        "No supported trajectory provider "
        f"for mission {mission['id']}"
    )

def interpolate_trajectory_position(points, timestamp_jd):
    """
    Find the spacecraft position at a given Julian Date
    by linearly interpolating between trajectory points.
    """

    if not points:
        return None

    # Before first point
    if timestamp_jd <= points[0]["jd"]:
        return {
            "x": points[0]["x"],
            "y": points[0]["y"],
            "z": points[0]["z"],
        }

    # After last point
    if timestamp_jd >= points[-1]["jd"]:
        return {
            "x": points[-1]["x"],
            "y": points[-1]["y"],
            "z": points[-1]["z"],
        }

    # Find the two surrounding points
    for i in range(len(points) - 1):
        p1 = points[i]
        p2 = points[i + 1]

        if p1["jd"] <= timestamp_jd <= p2["jd"]:

            span = p2["jd"] - p1["jd"]

            if span <= 0:
                return {
                    "x": p1["x"],
                    "y": p1["y"],
                    "z": p1["z"],
                }

            progress = (
                timestamp_jd - p1["jd"]
            ) / span

            return {
                "x": p1["x"] + (
                    p2["x"] - p1["x"]
                ) * progress,

                "y": p1["y"] + (
                    p2["y"] - p1["y"]
                ) * progress,

                "z": p1["z"] + (
                    p2["z"] - p1["z"]
                ) * progress,
            }

    return None

