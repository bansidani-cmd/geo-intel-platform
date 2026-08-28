import Globe from 'globe.gl';

const statusEl = document.getElementById('status');

const world = Globe()(document.getElementById('globeViz'))
  .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
  .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
  .pointOfView({ lat: 20, lng: 30, altitude: 2.4 });

world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.4;

async function loadEvents() {
  try {
    const res = await fetch('http://localhost:8001/api/events');
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const geojson = await res.json();

    const points = (geojson.features || []).map((f) => ({
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      name: f.properties?.name || 'Unnamed location',
      count: f.properties?.count || 1,
    }));

    world
      .pointsData(points)
      .pointLat('lat')
      .pointLng('lng')
      .pointColor(() => '#ff4444')
      .pointAltitude(0.01)
      .pointRadius((d) => Math.min(0.15 + d.count * 0.02, 0.8))
      .pointLabel((d) => `<b>${d.name}</b><br/>${d.count} related articles`);

    const sourceLabel = geojson.source === 'live_gdelt' ? 'LIVE' : 'SAMPLE DATA';
    statusEl.textContent = `${points.length} event clusters — ${sourceLabel}`;
  } catch (err) {
    statusEl.textContent = 'Could not reach backend. Is uvicorn running on port 8001?';
    console.error(err);
  }
}

loadEvents();
setInterval(loadEvents, 5 * 60 * 1000);