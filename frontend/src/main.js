import Globe from 'globe.gl';

const statusEl = document.getElementById('status');

const world = Globe()(document.getElementById('globeViz'))
  .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
  .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
  .pointOfView({ lat: 20, lng: 60, altitude: 2.0 });

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

async function refreshGlobe() {
  const [events, ships] = await Promise.all([loadEvents(), loadShips()]);
  const combined = [...events, ...ships];

  world
    .pointsData(combined)
    .pointLat('lat')
    .pointLng('lng')
    .pointColor((d) => (d.type === 'ship' ? '#00e5ff' : '#ff4444'))
    .pointAltitude((d) => (d.type === 'ship' ? 0.015 : 0.01))
    .pointRadius((d) =>
      d.type === 'ship' ? 0.25 : Math.min(0.15 + d.count * 0.02, 0.8)
    )
    .pointLabel((d) =>
      d.type === 'ship'
        ? `<b>🚢 ${d.name}</b><br/>MMSI ${d.mmsi}`
        : `<b>${d.name}</b><br/>${d.count} related articles`
    );

  const eventSourceLabel = events.length && events[0].source === 'live_gdelt' ? 'LIVE' : 'SAMPLE';
  const hormuzCount = ships.filter((s) => s.region === 'hormuz').length;
  const singaporeCount = ships.filter((s) => s.region === 'singapore_strait').length;

  const hormuzNote =
    hormuzCount === 0
      ? 'Hormuz: 0 vessels visible (coverage gaps / AIS "dark shipping" near Iran are common)'
      : `Hormuz: ${hormuzCount} vessels`;

  statusEl.textContent = `${events.length} event clusters (${eventSourceLabel}) · ${hormuzNote} · Singapore Strait: ${singaporeCount} vessels`;
}

refreshGlobe();
setInterval(refreshGlobe, 30 * 1000);