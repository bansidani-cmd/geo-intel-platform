from datetime import datetime, timezone


def datetime_to_julian_date(dt):
    """
    Convert a timezone-aware datetime to Julian Date.
    """

    dt = parse_mission_time(dt)

    year = dt.year
    month = dt.month
    day = (
        dt.day
        + (
            dt.hour
            + (
                dt.minute
                + (
                    dt.second
                    + dt.microsecond / 1_000_000
                ) / 60
            ) / 60
        ) / 24
    )

    if month <= 2:
        year -= 1
        month += 12

    A = year // 100
    B = 2 - A + A // 4

    return (
        int(365.25 * (year + 4716))
        + int(30.6001 * (month + 1))
        + day
        + B
        - 1524.5
    )

def parse_mission_time(value):
    """
    Convert an ISO timestamp into a timezone-aware datetime.
    """

    if isinstance(value, datetime):
        dt = value
    else:
        value = str(value)

        # Support both:
        # 2023-01-01T12:00:00
        # 2023-01-01T12:00:00Z
        dt = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    return dt


def get_mission_phase(mission, timestamp):
    """
    Determine which phase a mission is in at a given time.

    This function is completely mission-agnostic.
    """

    current_time = parse_mission_time(timestamp)

    phases = mission.get("phases", [])

    if not phases:
        return None

    for phase in phases:

        start = parse_mission_time(
            phase["start"]
        )

        end = parse_mission_time(
            phase["end"]
        )

        if start <= current_time <= end:

            duration = (
                end - start
            ).total_seconds()

            elapsed = (
                current_time - start
            ).total_seconds()

            if duration > 0:
                progress = elapsed / duration
            else:
                progress = 1.0

            progress = max(
                0.0,
                min(1.0, progress)
            )

            return {
                "id": phase["id"],
                "name": phase["name"],
                "type": phase["type"],
                "coordinate_system": phase[
                    "coordinate_system"
                ],
                "start": phase["start"],
                "end": phase["end"],
                "progress": progress,
            }

    return None


def get_mission_state(mission, timestamp):
    """
    Return the generic state of a mission at a given time.

    This becomes the foundation for the Journey UI,
    camera transitions and spacecraft positioning.
    """

    current_time = parse_mission_time(timestamp)

    phase = get_mission_phase(
        mission,
        current_time
    )

    return {
        "mission_id": mission["id"],
        "time": current_time.isoformat(),
        "phase": phase,
        "coordinate_system": (
            phase["coordinate_system"]
            if phase
            else None
        ),
    }

if __name__ == "__main__":
    from mission_trajectories import HISTORICAL_MISSIONS

    mission = HISTORICAL_MISSIONS[
        "india-mangalyaan"
    ]

    test_times = [
        "2013-11-05T12:00:00Z",
        "2013-11-20T12:00:00Z",
        "2013-12-15T12:00:00Z",
        "2014-06-01T12:00:00Z",
        "2014-09-25T12:00:00Z",
    ]

    for timestamp in test_times:

        state = get_mission_state(
            mission,
            timestamp
        )

        print()
        print(timestamp)
        print(state)