import Globe from 'globe.gl';

const statusEl = document.getElementById('status');

const world = Globe()(document.getElementById('globeViz'))
  .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
  .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
  .pointOfView({ lat: 20, lng: 60, altitude: 2.0 })
  .pointsTransitionDuration(14000); // glide to new positions instead of snapping

world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.3;

async function loadEvents() {
  try {
    const res = await fetch('http://localhost:8001/api/events');
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const geojson = await res.json();
    const source = geojson.source;
    return (geojson.features || []).map((f) => ({
      type: 'event',
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      name: f.properties?.name || 'Unnamed location',
      count: f.properties?.count || 1,
      source,
    }));
  } catch (err) {
    console.error('Events fetch failed:', err);
    return [];
  }
}

async function loadShips() {
  try {
    const res = await fetch('http://localhost:8001/api/ships');
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data = await res.json();
    return (data.ships || []).map((s) => ({
      type: 'ship',
      lat: s.lat,
      lng: s.lon,
      name: s.name,
      mmsi: s.mmsi,
      region: s.region,
    }));
  } catch (err) {
    console.error('Ships fetch failed:', err);
    return [];
  }
}

async function loadFlights() {
  try {
    const res = await fetch('http://localhost:8001/api/flights');
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data = await res.json();
    return (data.flights || []).map((f) => ({
      type: 'flight',
      lat: f.lat,
      lng: f.lon,
      name: f.flight,
      alt: f.alt,
      track: f.track,
      region: f.region,
    }));
  } catch (err) {
    console.error('Flights fetch failed:', err);
    return [];
  }
}

function colorFor(d) {
  if (d.type === 'flight') return '#ffcc00';
  if (d.type === 'ship') return '#00e5ff';
  return '#ff4444';
}

function altitudeFor(d) {
  if (d.type === 'flight') return 0.02;
  if (d.type === 'ship') return 0.015;
  return 0.01;
}

function radiusFor(d) {
  if (d.type === 'flight') return 0.18;
  if (d.type === 'ship') return 0.25;
  return Math.min(0.15 + d.count * 0.02, 0.8);
}

function labelFor(d) {
  if (d.type === 'flight') {
    return `<b>✈️ ${d.name}</b><br/>Altitude ${d.alt ?? '?'} ft`;
  }
  if (d.type === 'ship') {
    return `<b>🚢 ${d.name}</b><br/>MMSI ${d.mmsi}`;
  }
  return `<b>${d.name}</b><br/>${d.count} related articles`;
}

async function refreshGlobe() {
  const [events, ships, flightsData] = await Promise.all([
    loadEvents(),
    loadShips(),
    loadFlights(),
  ]);
  const combined = [...events, ...ships, ...flightsData];

  world
    .pointsData(combined)
    .pointLat('lat')
    .pointLng('lng')
    .pointColor(colorFor)
    .pointAltitude(altitudeFor)
    .pointRadius(radiusFor)
    .pointLabel(labelFor);

  const eventSourceLabel = events.length && events[0].source === 'live_gdelt' ? 'LIVE' : 'SAMPLE';
  const hormuzShips = ships.filter((s) => s.region === 'hormuz').length;
  const singaporeShips = ships.filter((s) => s.region === 'singapore_strait').length;

  statusEl.textContent =
    `${events.length} events (${eventSourceLabel}) · ` +
    `${flightsData.length} aircraft live · ` +
    `Hormuz: ${hormuzShips} ships · Singapore: ${singaporeShips} ships`;
}

refreshGlobe();
setInterval(refreshGlobe, 15 * 1000); // faster refresh now that flights change quickly