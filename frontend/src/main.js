import Globe from 'globe.gl';
import * as THREE from 'three';
import * as satellite from 'satellite.js';

const statusEl = document.getElementById('status');
const panelEl = document.getElementById('infoPanel');
const panelContentEl = document.getElementById('infoPanelContent');

const COLORS = {
  event: 0xff2d78,
  ship: 0x00e5ff,
  flight: 0xffd60a,
  quake: 0xa855f7,
  satellite: 0xfb108e,
  launch: 0xfb923c,
  disaster: 0xf43f5e,
};

const EARTH_RADIUS_KM = 6371;
const MAX_PARTICLES = 20000;
const ANIM_DURATION = 18000;
const MAX_LIST_ROWS = 200;

let satRecs = [];
let satPositions = [];
let particleRecords = [];
let particleCount = 0;
let animStart = performance.now();

let lowVolumeData = {
  events: [],
  quakes: [],
  launches: [],
  disasters: [],
};

let lastJamRegions = [];
let lastChokepointRisk = {};
let selectedId = null;
let allTracks = [];

const layerVisible = {
  event: true,
  ship: true,
  flight: true,
  quake: true,
  satellite: true,
  launch: true,
  disaster: true,
};

const previousById = new Map();

/* =========================================================
   HELPERS
========================================================= */

function getElement(id) {
  return document.getElementById(id);
}

function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function colorToCss(hex) {
  return `#${Number(hex).toString(16).padStart(6, '0')}`;
}

function tintColor(hex) {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

async function fetchJSON(url, fallback) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Fetch failed for ${url}:`, error);
    return fallback;
  }
}

/* =========================================================
   GLOBE
========================================================= */

const globeContainer = getElement('globeViz');

if (!globeContainer) {
  throw new Error('Missing #globeViz element.');
}

const world = Globe()(globeContainer)
  .globeImageUrl(
    '//unpkg.com/three-globe/example/img/earth-night.jpg',
  )
  .pointOfView({
    lat: 20,
    lng: 30,
    altitude: 2.5,
  });

world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.25;
world.scene().background = new THREE.Color(0x000000);

/* =========================================================
   STARFIELD
========================================================= */

function addStarfield() {
  const starCount = 3000;
  const starPositions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i += 1) {
    const radius = 4000 + Math.random() * 3000;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    starPositions[i * 3] =
      radius * Math.sin(phi) * Math.cos(theta);

    starPositions[i * 3 + 1] =
      radius * Math.sin(phi) * Math.sin(theta);

    starPositions[i * 3 + 2] =
      radius * Math.cos(phi);
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(starPositions, 3),
  );

  const material = new THREE.PointsMaterial({
    color: 0x88aacc,
    size: 1.0,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.45,
  });

  world.scene().add(
    new THREE.Points(geometry, material),
  );
}

addStarfield();

/* =========================================================
   PARTICLE SYSTEM
   AIRCRAFT + SHIPS
========================================================= */

const particlePositions =
  new Float32Array(MAX_PARTICLES * 3);

const particleColors =
  new Float32Array(MAX_PARTICLES * 3);

const particleSizes =
  new Float32Array(MAX_PARTICLES);

const startPositions =
  new Float32Array(MAX_PARTICLES * 3);

const targetPositions =
  new Float32Array(MAX_PARTICLES * 3);

const particleGeometry =
  new THREE.BufferGeometry();

particleGeometry.setAttribute(
  'position',
  new THREE.BufferAttribute(
    particlePositions,
    3,
  ),
);

particleGeometry.setAttribute(
  'color',
  new THREE.BufferAttribute(
    particleColors,
    3,
  ),
);

particleGeometry.setAttribute(
  'size',
  new THREE.BufferAttribute(
    particleSizes,
    1,
  ),
);

particleGeometry.setDrawRange(0, 0);

const particleMaterial =
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexColors: true,

    vertexShader: `
      attribute float size;
      varying vec3 vColor;

      void main() {
        vColor = color;

        vec4 mvPosition =
          modelViewMatrix *
          vec4(position, 1.0);

        gl_PointSize =
          size *
          (280.0 / -mvPosition.z);

        gl_Position =
          projectionMatrix *
          mvPosition;
      }
    `,

    fragmentShader: `
      varying vec3 vColor;

      void main() {
        vec2 uv =
          gl_PointCoord -
          vec2(0.5);

        float dist =
          length(uv);

        float core =
          smoothstep(
            0.5,
            0.32,
            dist
          );

        float glow =
          smoothstep(
            0.5,
            0.0,
            dist
          ) * 0.35;

        float alpha =
          core + glow;

        if (alpha < 0.03) {
          discard;
        }

        gl_FragColor =
          vec4(
            vColor,
            alpha
          );
      }
    `,
  });

const particleSystem =
  new THREE.Points(
    particleGeometry,
    particleMaterial,
  );

world.scene().add(particleSystem);

/* =========================================================
   LAYER VISIBILITY
========================================================= */

function applyVisibility() {
  for (
    let i = 0;
    i < particleCount;
    i += 1
  ) {
    const record =
      particleRecords[i];

    if (!record) {
      particleSizes[i] = 0;
      continue;
    }

    const visible =
      layerVisible[record.type] !== false;

    particleSizes[i] = visible
      ? record.baseSize *
        (record.id === selectedId ? 1.8 : 1)
      : 0;
  }

  particleGeometry
    .attributes
    .size
    .needsUpdate = true;
}

const legendInputs =
  document.querySelectorAll(
    '#legend input[type="checkbox"]',
  );

legendInputs.forEach((element) => {
  element.addEventListener(
    'change',
    () => {
      const layer =
        element.dataset.layer;

      if (
        layer &&
        Object.prototype.hasOwnProperty.call(
          layerVisible,
          layer,
        )
      ) {
        layerVisible[layer] =
          element.checked;
      }

      applyVisibility();
      renderLowVolumeLayer();
      renderCustomLayer();
      renderTrackList();
    },
  );
});

/* =========================================================
   DATA REFRESH
========================================================= */

async function refreshData() {
  const [
    eventsGeo,
    shipsData,
    flightsData,
    quakesData,
    jamRegions,
    launches,
    chokepointRisk,
    disasters,
  ] = await Promise.all([
    fetchJSON(
      'http://localhost:8001/api/events',
      {
        features: [],
        source: 'local_fallback',
      },
    ),

    fetchJSON(
      'http://localhost:8001/api/ships',
      {
        ships: [],
      },
    ),

    fetchJSON(
      'http://localhost:8001/api/flights',
      {
        flights: [],
      },
    ),

    fetchJSON(
      'http://localhost:8001/api/earthquakes',
      {
        earthquakes: [],
      },
    ),

    loadGpsIntegrity(),
    loadLaunches(),
    loadChokepointRisk(),
    loadDisasters(),
  ]);

  /* -------------------------------------------------------
     EVENTS
  ------------------------------------------------------- */

  const events =
    (eventsGeo.features || [])
      .map((feature, index) => {
        const coordinates =
          feature.geometry &&
          feature.geometry.coordinates;

        if (
          !coordinates ||
          coordinates.length < 2
        ) {
          return null;
        }

        const lng =
          safeNumber(coordinates[0]);

        const lat =
          safeNumber(coordinates[1]);

        if (
          lat === null ||
          lng === null
        ) {
          return null;
        }

        return {
          id: `event-${index}`,
          type: 'event',
          lat,
          lng,
          name:
            feature.properties?.name ||
            'Unnamed location',
          count:
            feature.properties?.count || 1,
          source:
            eventsGeo.source,
        };
      })
      .filter(Boolean);

  /* -------------------------------------------------------
     EARTHQUAKES
  ------------------------------------------------------- */

  const quakes =
    (quakesData.earthquakes || [])
      .map((quake, index) => ({
        id: `quake-${index}`,
        type: 'quake',
        lat: safeNumber(quake.lat),
        lng: safeNumber(quake.lon),
        name:
          quake.place ||
          'Unknown location',
        mag: quake.mag,
        depth: quake.depth_km,
      }))
      .filter(
        (quake) =>
          quake.lat !== null &&
          quake.lng !== null,
      );

  /* -------------------------------------------------------
     SHIPS
  ------------------------------------------------------- */

  const ships =
    (shipsData.ships || [])
      .map((ship) => ({
        id: `ship-${ship.mmsi}`,
        type: 'ship',
        lat: safeNumber(ship.lat),
        lng: safeNumber(ship.lon),
        name: ship.name,
        mmsi: ship.mmsi,
        heading: ship.heading,
      }))
      .filter(
        (ship) =>
          ship.lat !== null &&
          ship.lng !== null,
      );

  /* -------------------------------------------------------
     FLIGHTS
  ------------------------------------------------------- */

  const flights =
    (flightsData.flights || [])
      .map((flight) => ({
        id: `flight-${flight.icao24}`,
        type: 'flight',
        lat: safeNumber(flight.lat),
        lng: safeNumber(flight.lon),
        name: flight.flight,
        icao24: flight.icao24,
        alt: flight.alt,
        heading: flight.heading,
      }))
      .filter(
        (flight) =>
          flight.lat !== null &&
          flight.lng !== null,
      );

  updateParticles([
    ...ships,
    ...flights,
  ]);

  lowVolumeData = {
    events,
    quakes,
    launches,
    disasters,
  };

  lastJamRegions =
    Array.isArray(jamRegions)
      ? jamRegions
      : [];

  lastChokepointRisk =
    Object.fromEntries(
      (
        Array.isArray(chokepointRisk)
          ? chokepointRisk
          : []
      ).map(
        (item) => [
          item.region,
          item,
        ],
      ),
    );

  renderLowVolumeLayer();
  renderJamLabels(lastJamRegions);
  renderCustomLayer();
  updateAllTracks();
  renderTrackList();

  const eventSourceLabel =
    eventsGeo.source === 'live_gdelt'
      ? 'LIVE'
      : 'SAMPLE';

  const jamNote =
    lastJamRegions.length > 0
      ? `${lastJamRegions.length} regions analyzed for GPS interference`
      : 'GPS integrity data unavailable right now';

  if (statusEl) {
    statusEl.textContent =
      `${events.length} events (${eventSourceLabel}) · ` +
      `${flights.length} aircraft worldwide · ` +
      `${ships.length} ships worldwide · ` +
      `${quakes.length} earthquakes (24h) · ` +
      `${satPositions.length} satellites · ` +
      jamNote;
  }
}

/* =========================================================
   PARTICLE UPDATE
========================================================= */

function updateParticles(records) {
  const count =
    Math.min(
      records.length,
      MAX_PARTICLES,
    );

  const now =
    performance.now();

  const elapsed =
    Math.min(
      (now - animStart) /
        ANIM_DURATION,
      1,
    );

  const newRecords = [];

  for (
    let i = 0;
    i < count;
    i += 1
  ) {
    const record =
      records[i];

    const coords =
      world.getCoords(
        record.lat,
        record.lng,
        0.01,
      );

    const previous =
      previousById.get(
        record.id,
      );

    let startX;
    let startY;
    let startZ;

    if (previous) {
      startX =
        previous.start.x +
        (
          previous.target.x -
          previous.start.x
        ) *
          elapsed;

      startY =
        previous.start.y +
        (
          previous.target.y -
          previous.start.y
        ) *
          elapsed;

      startZ =
        previous.start.z +
        (
          previous.target.z -
          previous.start.z
        ) *
          elapsed;
    } else {
      startX = coords.x;
      startY = coords.y;
      startZ = coords.z;
    }

    const baseSize = 3.2;

    const newRecord = {
      ...record,
      baseSize,

      start: {
        x: startX,
        y: startY,
        z: startZ,
      },

      target: {
        x: coords.x,
        y: coords.y,
        z: coords.z,
      },
    };

    newRecords.push(
      newRecord,
    );

    startPositions[i * 3] =
      startX;

    startPositions[i * 3 + 1] =
      startY;

    startPositions[i * 3 + 2] =
      startZ;

    targetPositions[i * 3] =
      coords.x;

    targetPositions[i * 3 + 1] =
      coords.y;

    targetPositions[i * 3 + 2] =
      coords.z;

    const colorHex =
      record.id === selectedId
        ? 0xffffff
        : COLORS[record.type] ||
          COLORS.satellite;

    const [
      red,
      green,
      blue,
    ] =
      tintColor(colorHex);

    particleColors[i * 3] =
      red;

    particleColors[i * 3 + 1] =
      green;

    particleColors[i * 3 + 2] =
      blue;

    particleSizes[i] =
      layerVisible[record.type] !== false
        ? baseSize *
          (
            record.id === selectedId
              ? 1.8
              : 1
          )
        : 0;
  }

  particleRecords =
    newRecords;

  particleCount =
    count;

  particleGeometry.setDrawRange(
    0,
    count,
  );

  particleGeometry
    .attributes
    .color
    .needsUpdate = true;

  particleGeometry
    .attributes
    .size
    .needsUpdate = true;

  previousById.clear();

  newRecords.forEach(
    (record) => {
      previousById.set(
        record.id,
        record,
      );
    },
  );

  animStart = now;
}

/* =========================================================
   PARTICLE HIGHLIGHT
========================================================= */

function reapplyParticleHighlight() {
  for (
    let i = 0;
    i < particleCount;
    i += 1
  ) {
    const record =
      particleRecords[i];

    if (!record) {
      continue;
    }

    const colorHex =
      record.id === selectedId
        ? 0xffffff
        : COLORS[record.type] ||
          COLORS.satellite;

    const [
      red,
      green,
      blue,
    ] =
      tintColor(colorHex);

    particleColors[i * 3] =
      red;

    particleColors[i * 3 + 1] =
      green;

    particleColors[i * 3 + 2] =
      blue;

    particleSizes[i] =
      layerVisible[record.type] !== false
        ? record.baseSize *
          (
            record.id === selectedId
              ? 1.8
              : 1
          )
        : 0;
  }

  particleGeometry
    .attributes
    .color
    .needsUpdate = true;

  particleGeometry
    .attributes
    .size
    .needsUpdate = true;
}

/* =========================================================
   PARTICLE ANIMATION
========================================================= */

function animateParticles() {
  requestAnimationFrame(
    animateParticles,
  );

  if (particleCount === 0) {
    return;
  }

  const time =
    Math.min(
      (
        performance.now() -
        animStart
      ) /
        ANIM_DURATION,
      1,
    );

  const eased =
    time < 1
      ? 1 -
        Math.pow(
          1 - time,
          3,
        )
      : 1;

  for (
    let i = 0;
    i < particleCount;
    i += 1
  ) {
    particlePositions[i * 3] =
      startPositions[i * 3] +
      (
        targetPositions[i * 3] -
        startPositions[i * 3]
      ) *
        eased;

    particlePositions[i * 3 + 1] =
      startPositions[i * 3 + 1] +
      (
        targetPositions[i * 3 + 1] -
        startPositions[i * 3 + 1]
      ) *
        eased;

    particlePositions[i * 3 + 2] =
      startPositions[i * 3 + 2] +
      (
        targetPositions[i * 3 + 2] -
        startPositions[i * 3 + 2]
      ) *
        eased;
  }

  particleGeometry
    .attributes
    .position
    .needsUpdate = true;
}

animateParticles();

/* =========================================================
   LOW-VOLUME OBJECTS
   EVENTS + EARTHQUAKES + LAUNCHES + DISASTERS
========================================================= */

function renderLowVolumeLayer() {
  const combined = [
    ...(
      layerVisible.event
        ? lowVolumeData.events
        : []
    ),

    ...(
      layerVisible.quake
        ? lowVolumeData.quakes
        : []
    ),

    ...(
      layerVisible.launch
        ? lowVolumeData.launches
        : []
    ),

    ...(
      layerVisible.disaster
        ? lowVolumeData.disasters
        : []
    ),
  ];

  world
    .objectsData(combined)
    .objectLat('lat')
    .objectLng('lng')
    .objectAltitude(0.01)

    .objectThreeObject(
      (data) => {
        const isSelected =
          data.id === selectedId;

        let visibleRadius;

        if (data.type === 'quake') {
          visibleRadius =
            Math.min(
              0.4 +
                (
                  Number(data.mag) ||
                  1
                ) *
                  0.3,
              2.4,
            );
        } else if (
          data.type === 'launch'
        ) {
          visibleRadius = 1.2;
        } else if (
          data.type === 'disaster'
        ) {
          visibleRadius = 1.3;
        } else {
          visibleRadius =
            Math.min(
              0.5 +
                (
                  Number(data.count) ||
                  1
                ) *
                  0.05,
              1.8,
            );
        }

        const group =
          new THREE.Group();

        const geometry =
          new THREE.SphereGeometry(
            isSelected
              ? visibleRadius * 1.6
              : visibleRadius,
            8,
            8,
          );

        const material =
          new THREE.MeshBasicMaterial({
            color:
              isSelected
                ? 0xffffff
                : COLORS[data.type] ||
                  COLORS.event,
          });

        group.add(
          new THREE.Mesh(
            geometry,
            material,
          ),
        );

        const hitGeometry =
          new THREE.SphereGeometry(
            visibleRadius * 5,
            8,
            8,
          );

        const hitMaterial =
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });

        group.add(
          new THREE.Mesh(
            hitGeometry,
            hitMaterial,
          ),
        );

        return group;
      },
    )

    .onObjectClick(
      (data) => {
        selectTrack(
          data,
          {
            flyTo: false,
          },
        );
      },
    );
}

/* =========================================================
   SATELLITE TLE LOADING
========================================================= */

async function loadSatelliteTLEs() {
  try {
    const response =
      await fetch(
        'http://localhost:8001/api/satellites/tle',
      );

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}`,
      );
    }

    const data =
      await response.json();

    satRecs =
      (data.satellites || [])
        .map((record) => {
          try {
            if (
              !record.line1 ||
              !record.line2
            ) {
              return null;
            }

            return {
              name:
                record.name ||
                'Unknown satellite',

              group:
                record.group ||
                'Unknown',

              rec:
                satellite.twoline2satrec(
                  record.line1,
                  record.line2,
                ),
            };
          } catch (error) {
            console.warn(
              'Invalid satellite TLE:',
              record,
              error,
            );

            return null;
          }
        })
        .filter(Boolean);

    console.log(
      `Loaded ${satRecs.length} satellites for propagation.`,
    );
  } catch (error) {
    console.error(
      'Satellite TLE fetch failed:',
      error,
    );

    satRecs = [];
    satPositions = [];
  }
}

/* =========================================================
   SATELLITE PROPAGATION
========================================================= */

function propagateSatellites() {
  const now = new Date();

  const gmst =
    satellite.gstime(now);

  const positions = [];

  for (
    const record of satRecs
  ) {
    try {
      const pv =
        satellite.propagate(
          record.rec,
          now,
        );

      if (
        !pv ||
        !pv.position
      ) {
        continue;
      }

      const geo =
        satellite.eciToGeodetic(
          pv.position,
          gmst,
        );

      const altKm =
        Number(geo.height);

      const lat =
        satellite.degreesLat(
          geo.latitude,
        );

      const lng =
        satellite.degreesLong(
          geo.longitude,
        );

      if (
        !Number.isFinite(altKm) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        continue;
      }

      positions.push({
        id: `sat-${record.name}`,
        type: 'satellite',
        name: record.name,
        group: record.group,
        lat,
        lng,
        altKm,
        altFraction:
          altKm /
          EARTH_RADIUS_KM,
      });
    } catch (error) {
      continue;
    }
  }

  satPositions =
    positions;

  updateAllTracks();
  renderCustomLayer();
  renderTrackList();

  if (statusEl) {
    const current =
      statusEl.textContent || '';

    statusEl.textContent =
      current.replace(
        /\d+ satellites/,
        `${satPositions.length} satellites`,
      );
  }
}

/* =========================================================
   CUSTOM LAYER
   SATELLITES + GPS JAM ZONES
========================================================= */

function renderCustomLayer() {
  const satelliteData =
    layerVisible.satellite
      ? satPositions
      : [];

  const jamData =
    lastJamRegions.map(
      (region) => ({
        ...region,
        id: `jam-${region.region}`,
        type: 'jam',
      }),
    );

  const combined = [
    ...satelliteData,
    ...jamData,
  ];

  world
    .customLayerData(
      combined,
    )

    .customThreeObject(
      (data) => {
        /* -------------------------------------------------
           SATELLITE
        ------------------------------------------------- */

      if (data.type === 'satellite') {
  const isSelected =
    data.id === selectedId;

  const group = new THREE.Group();
  
  // Bright satellite core
  const coreGeometry =
    new THREE.SphereGeometry(
      isSelected ? 1.4 : 0.8,
      8,
      8
    );

  const coreMaterial =
    new THREE.MeshBasicMaterial({
      color: isSelected
        ? 0xffffff
        : COLORS.satellite
    });

  group.add(
    new THREE.Mesh(
      coreGeometry,
      coreMaterial
    )
  );

  // Outer glow
  const glowGeometry =
    new THREE.SphereGeometry(
      isSelected ? 3.2 : 2.2,
      16,
      16
    );

  const glowMaterial =
    new THREE.MeshBasicMaterial({
      color: isSelected
        ? 0xffffff
        : COLORS.satellite,
      transparent: true,
      opacity: 0.18,
      depthWrite: false
    });

  group.add(
    new THREE.Mesh(
      glowGeometry,
      glowMaterial
    )
  );

  return group;
}

        /* -------------------------------------------------
           GPS JAM ZONE
        ------------------------------------------------- */

        const isSelected =
          data.id === selectedId;

        const color =
          isSelected
            ? 0xffffff
            : jamColor(
                data.jam_score,
              );

        const group =
          new THREE.Group();

        const radius =
          (
            4 +
            (
              Number(
                data.jam_score,
              ) / 100
            ) *
              10
          ) *
          (
            isSelected
              ? 1.3
              : 1
          );

        const domeGeometry =
          new THREE.SphereGeometry(
            radius,
            20,
            10,
            0,
            Math.PI * 2,
            0,
            Math.PI / 2,
          );

        const domeMaterial =
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity:
              isSelected
                ? 0.5
                : 0.35,
            side: THREE.DoubleSide,
            depthWrite: false,
          });

        group.add(
          new THREE.Mesh(
            domeGeometry,
            domeMaterial,
          ),
        );

        const ringGeometry =
          new THREE.RingGeometry(
            radius * 0.96,
            radius,
            40,
          );

        const ringMaterial =
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
          });

        const ring =
          new THREE.Mesh(
            ringGeometry,
            ringMaterial,
          );

        ring.rotation.x =
          -Math.PI / 2;

        group.add(ring);

        const coreGeometry =
          new THREE.SphereGeometry(
            1.2,
            12,
            12,
          );

        const coreMaterial =
          new THREE.MeshBasicMaterial({
            color,
          });

        group.add(
          new THREE.Mesh(
            coreGeometry,
            coreMaterial,
          ),
        );

        return group;
      },
    )

    .customThreeObjectUpdate(
      (object, data) => {
        /* -----------------------------------------------
           SATELLITE POSITION
        ----------------------------------------------- */

        if (
          data.type ===
          'satellite'
        ) {
          Object.assign(
            object.position,
            world.getCoords(
              data.lat,
              data.lng,
              data.altFraction,
            ),
          );

          return;
        }

        /* -----------------------------------------------
           JAM ZONE POSITION
        ----------------------------------------------- */

        Object.assign(
          object.position,
          world.getCoords(
            data.lat,
            data.lon,
            0.03,
          ),
        );
      },
    )

    .onCustomLayerClick(
      (data) => {
        if (
          data.type ===
          'satellite'
        ) {
          selectTrack(
            data,
            {
              flyTo: false,
            },
          );

          return;
        }

        if (
          data.type ===
          'jam'
        ) {
          selectJamZone(data);
        }
      },
    );
}

/* =========================================================
   GPS JAM ZONES
========================================================= */

function jamColor(score) {
  const value =
    Number(score) || 0;

  if (value < 15) {
    return 0x22c55e;
  }

  if (value < 35) {
    return 0xeab308;
  }

  if (value < 60) {
    return 0xf97316;
  }

  return 0xef4444;
}

function renderJamLabels(regions) {
  world
    .labelsData(
      regions || [],
    )
    .labelLat('lat')
    .labelLng('lon')

    .labelText(
      (data) =>
        `${String(
          data.region || '',
        )
          .replace(
            /_/g,
            ' ',
          )
          .toUpperCase()} · ${
            data.jam_score ?? 0
          }%`,
    )

    .labelSize(1.1)

    .labelColor(
      (data) =>
        colorToCss(
          jamColor(
            data.jam_score,
          ),
        ),
    )

    .labelDotRadius(0)
    .labelAltitude(0.06)
    .labelResolution(2);
}

function selectJamZone(data) {
  selectedId =
    `jam-${data.region}`;

  showJamPanel(data);

  reapplyParticleHighlight();
  renderLowVolumeLayer();
  renderCustomLayer();

  renderPath(
    [],
    '#ffffff',
  );
}

function showJamPanel(data) {
  if (
    !panelContentEl ||
    !panelEl
  ) {
    return;
  }

  const regionName =
    String(
      data.region || '',
    )
      .replace(
        /_/g,
        ' ',
      )
      .toUpperCase();

  panelContentEl.innerHTML = `
    <div class="panel-type">
      GPS INTEGRITY ANALYSIS
    </div>

    <div class="panel-title">
      ${escapeHtml(regionName)}
    </div>

    <div class="panel-row">
      <span class="label">
        Jam score
      </span>

      <span>
        ${escapeHtml(
          data.jam_score,
        )}/100
      </span>
    </div>

    <div class="panel-row">
      <span class="label">
        Aircraft sampled
      </span>

      <span>
        ${escapeHtml(
          data.sample_count,
        )}
      </span>
    </div>

    <div class="panel-row">
      <span class="label">
        Avg NIC
      </span>

      <span>
        ${escapeHtml(
          data.avg_nic,
        )}
      </span>
    </div>

    <div class="panel-row">
      <span class="label">
        % degraded (NIC&lt;7)
      </span>

      <span>
        ${escapeHtml(
          data.pct_degraded,
        )}%
      </span>
    </div>

    <p
      style="
        font-size:0.72rem;
        opacity:0.6;
        margin-top:16px;
        line-height:1.5;
      "
    >
      Computed live from raw ADS-B Navigation
      Integrity Category (NIC) values reported
      by aircraft transponders in this region.
    </p>
  `;

  panelEl.classList.remove(
    'hidden',
  );
}

/* =========================================================
   TRACK PATHS
========================================================= */

function renderPath(
  historyPoints,
  colorHex,
) {
  const path =
    (historyPoints || [])
      .map((point) => {
        const lat =
          safeNumber(
            point.lat,
          );

        const lon =
          safeNumber(
            point.lon ??
              point.lng,
          );

        if (
          lat === null ||
          lon === null
        ) {
          return null;
        }

        return [
          lat,
          lon,
        ];
      })
      .filter(Boolean);

  world
    .pathsData(
      path.length > 1
        ? [path]
        : [],
    )

    .pathPointLat(
      (point) => point[0],
    )

    .pathPointLng(
      (point) => point[1],
    )

    .pathPointAlt(
      0.015,
    )

    .pathColor(
      () => colorHex,
    )

    .pathStroke(2.5)

    .pathDashLength(0.4)

    .pathDashGap(0.15)

    .pathDashAnimateTime(
      2500,
    );
}

async function loadHistorical(year) {
  try {
    const res = await fetch(`http://localhost:8001/api/historical?up_to_year=${year}`);
    const data = await res.json();
    return (data.events || []).map((e, i) => ({
      id: `hist-${i}`,
      type: 'historical',
      lat: e.lat,
      lng: e.lon,
      name: e.title,
      year: e.year,
      category: e.category,
    }));
  } catch (err) {
    console.error('Historical fetch failed:', err);
    return [];
  }
}

let historicalEvents = [];
const yearRange = document.getElementById('tlYearRange');
const yearLabel = document.getElementById('timeYear');

async function refreshHistorical() {
  const year = parseInt(yearRange.value, 10);
  yearLabel.textContent = year;
  historicalEvents = await loadHistorical(year);
  renderLowVolumeLayer(); // extend this to include historicalEvents, same pattern as launches/disasters
}
yearRange.addEventListener('input', refreshHistorical);
refreshHistorical();
EOF
Output

async function loadHistorical(year) {
  try {
    const res = await fetch(`http://localhost:8001/api/historical?up_to_year=${year}`);
    const data = await res.json();
    return (data.events || []).map((e, i) => ({
      id: `hist-${i}`,
      type: 'historical',
      lat: e.lat,
      lng: e.lon,
      name: e.title,
      year: e.year,
      category: e.category,
    }));
  } catch (err) {
    console.error('Historical fetch failed:', err);
    return [];
  }
}

let historicalEvents = [];
const yearRange = document.getElementById('tlYearRange');
const yearLabel = document.getElementById('timeYear');

async function refreshHistorical() {
  const year = parseInt(yearRange.value, 10);
  yearLabel.textContent = year;
  historicalEvents = await loadHistorical(year);
  renderLowVolumeLayer(); // extend this to include historicalEvents, same pattern as launches/disasters
}
yearRange.addEventListener('input', refreshHistorical);
refreshHistorical();

async function loadHistoryFor(
  track,
) {
  if (
    track.type ===
    'ship'
  ) {
    const data =
      await fetchJSON(
        `http://localhost:8001/api/ships/${encodeURIComponent(
          track.mmsi,
        )}/history`,
        {
          history: [],
        },
      );

    return (
      data.history || []
    );
  }

  if (
    track.type ===
    'flight'
  ) {
    const data =
      await fetchJSON(
        `http://localhost:8001/api/flights/${encodeURIComponent(
          track.icao24,
        )}/history`,
        {
          history: [],
        },
      );

    return (
      data.history || []
    );
  }

  return [];
}

/* =========================================================
   TRACK SELECTION
========================================================= */

async function selectTrack(
  track,
  {
    flyTo = false,
  } = {},
) {
  if (!track) {
    return;
  }

  selectedId =
    track.id;

  showPanel(track);

  reapplyParticleHighlight();
  renderLowVolumeLayer();
  renderCustomLayer();

  if (
    track.type === 'ship' ||
    track.type === 'flight'
  ) {
    const colorHex =
      colorToCss(
        COLORS[track.type] ||
          COLORS.satellite,
      );

    const history =
      await loadHistoryFor(
        track,
      );

    renderPath(
      history,
      colorHex,
    );
  } else {
    renderPath(
      [],
      '#ffffff',
    );
  }

  if (
    flyTo &&
    Number.isFinite(track.lat) &&
    Number.isFinite(track.lng)
  ) {
    const altitude =
      track.type ===
      'satellite'
        ? 0.7
        : 0.6;

    world.pointOfView(
      {
        lat: track.lat,
        lng: track.lng,
        altitude,
      },
      1200,
    );
  }
}

function clearSelection() {
  selectedId = null;

  reapplyParticleHighlight();
  renderLowVolumeLayer();
  renderCustomLayer();

  renderPath(
    [],
    '#ffffff',
  );
}

/* =========================================================
   INFO PANEL
========================================================= */

function showPanel(data) {
  if (
    !panelContentEl ||
    !panelEl
  ) {
    return;
  }

  const rows = [];

  let title =
    data.name ||
    'Unknown';

  let typeLabel = '';

  /* -------------------------------------------------------
     EVENT
  ------------------------------------------------------- */

  if (
    data.type ===
    'event'
  ) {
    typeLabel =
      'GEOPOLITICAL EVENT';

    rows.push([
      'Related articles',
      data.count,
    ]);

    rows.push([
      'Source',
      data.source ===
      'live_gdelt'
        ? 'GDELT (live)'
        : 'Sample data',
    ]);
  }

  /* -------------------------------------------------------
     SHIP
  ------------------------------------------------------- */

  else if (
    data.type ===
    'ship'
  ) {
    typeLabel =
      'VESSEL (AIS)';

    rows.push([
      'MMSI',
      data.mmsi,
    ]);

    rows.push([
      'Heading',
      data.heading != null
        ? `${Math.round(
            data.heading,
          )}°`
        : 'Unknown',
    ]);

    rows.push([
      'Latitude',
      safeNumber(
        data.lat,
      )?.toFixed(4) ??
        'Unknown',
    ]);

    rows.push([
      'Longitude',
      safeNumber(
        data.lng,
      )?.toFixed(4) ??
        'Unknown',
    ]);
  }

  /* -------------------------------------------------------
     FLIGHT
  ------------------------------------------------------- */

  else if (
    data.type ===
    'flight'
  ) {
    typeLabel =
      'AIRCRAFT (ADS-B)';

    rows.push([
      'ICAO24',
      data.icao24,
    ]);

    rows.push([
      'Altitude',
      data.alt != null
        ? `${data.alt} ft`
        : 'Unknown',
    ]);

    rows.push([
      'Heading',
      data.heading != null
        ? `${Math.round(
            data.heading,
          )}°`
        : 'Unknown',
    ]);

    rows.push([
      'Latitude',
      safeNumber(
        data.lat,
      )?.toFixed(4) ??
        'Unknown',
    ]);

    rows.push([
      'Longitude',
      safeNumber(
        data.lng,
      )?.toFixed(4) ??
        'Unknown',
    ]);
  }

  /* -------------------------------------------------------
     EARTHQUAKE
  ------------------------------------------------------- */

  else if (
    data.type ===
    'quake'
  ) {
    typeLabel =
      'EARTHQUAKE (USGS)';

    title =
      `M${data.mag ?? '?'} Earthquake`;

    rows.push([
      'Location',
      data.name,
    ]);

    rows.push([
      'Magnitude',
      data.mag,
    ]);

    rows.push([
      'Depth',
      data.depth != null
        ? `${Number(
            data.depth,
          ).toFixed(1)} km`
        : 'Unknown',
    ]);
  }

  /* -------------------------------------------------------
     SATELLITE
  ------------------------------------------------------- */

  else if (
    data.type ===
    'satellite'
  ) {
    typeLabel =
      'SATELLITE (SGP4)';

    rows.push([
      'Group',
      data.group ||
        'Unknown',
    ]);

    rows.push([
      'Altitude',
      Number.isFinite(
        data.altKm,
      )
        ? `${Math.round(
            data.altKm,
          )} km`
        : 'Unknown',
    ]);

    rows.push([
      'Latitude',
      safeNumber(
        data.lat,
      )?.toFixed(2) ??
        'Unknown',
    ]);

    rows.push([
      'Longitude',
      safeNumber(
        data.lng,
      )?.toFixed(2) ??
        'Unknown',
    ]);
  }

  /* -------------------------------------------------------
     LAUNCH
  ------------------------------------------------------- */

  else if (
    data.type ===
    'launch'
  ) {
    typeLabel =
      'UPCOMING LAUNCH';

    rows.push([
      'Provider',
      data.provider,
    ]);

    rows.push([
      'Pad',
      data.pad_name,
    ]);

    rows.push([
      'Status',
      data.status,
    ]);

    rows.push([
      'NET',
      data.net
        ? new Date(
            data.net,
          ).toLocaleString()
        : 'TBD',
    ]);
  }

  /* -------------------------------------------------------
     DISASTER
  ------------------------------------------------------- */

  else if (
    data.type ===
    'disaster'
  ) {
    typeLabel =
      'DISASTER ALERT (GDACS)';

    rows.push([
      'Type',
      data.event_type,
    ]);

    rows.push([
      'Alert level',
      data.alert_level,
    ]);

    rows.push([
      'Country',
      data.country ||
        'Unknown',
    ]);
  }

  panelContentEl.innerHTML = `
    <div class="panel-type">
      ${escapeHtml(typeLabel)}
    </div>

    <div class="panel-title">
      ${escapeHtml(title)}
    </div>

    ${rows
      .map(
        ([label, value]) => `
          <div class="panel-row">
            <span class="label">
              ${escapeHtml(label)}
            </span>

            <span>
              ${escapeHtml(
                value ?? '',
              )}
            </span>
          </div>
        `,
      )
      .join('')}
  `;

  panelEl.classList.remove(
    'hidden',
  );
}

const closePanel =
  getElement(
    'closePanel',
  );

if (closePanel) {
  closePanel.addEventListener(
    'click',
    () => {
      if (panelEl) {
        panelEl.classList.add(
          'hidden',
        );
      }

      clearSelection();
    },
  );
}

/* =========================================================
   MOUSE / PARTICLE CLICK DETECTION
========================================================= */

const raycaster =
  new THREE.Raycaster();

raycaster.params.Points.threshold =
  3;

const mouse =
  new THREE.Vector2();

let pointerDownPos =
  null;

const canvasEl =
  world.renderer()
    .domElement;

canvasEl.addEventListener(
  'pointerdown',
  (event) => {
    pointerDownPos = {
      x: event.clientX,
      y: event.clientY,
    };
  },
);

canvasEl.addEventListener(
  'pointerup',
  (event) => {
    if (!pointerDownPos) {
      return;
    }

    const moved =
      Math.hypot(
        event.clientX -
          pointerDownPos.x,
        event.clientY -
          pointerDownPos.y,
      );

    pointerDownPos =
      null;

    if (moved > 5) {
      return;
    }

    const rect =
      canvasEl.getBoundingClientRect();

    mouse.x =
      (
        (
          event.clientX -
          rect.left
        ) /
          rect.width
      ) *
        2 -
      1;

    mouse.y =
      -(
        (
          event.clientY -
          rect.top
        ) /
          rect.height
      ) *
        2 +
      1;

    raycaster.setFromCamera(
      mouse,
      world.camera(),
    );

    const cameraDistance =
      world.camera()
        .position.length();

    raycaster.params.Points.threshold =
      cameraDistance *
      0.018;

    particleGeometry.computeBoundingSphere();

    const hits =
      raycaster.intersectObject(
        particleSystem,
        false,
      );

    if (
      hits.length === 0
    ) {
      return;
    }

    const index =
      hits[0].index;

    const record =
      particleRecords[index];

    if (
      record &&
      particleSizes[index] > 0
    ) {
      selectTrack(
        record,
        {
          flyTo: false,
        },
      );
    }
  },
);

/* =========================================================
   TRACK LIST
========================================================= */

const trackListToggle =
  getElement(
    'trackListToggle',
  );

const trackListPanel =
  getElement(
    'trackListPanel',
  );

const closeTrackList =
  getElement(
    'closeTrackList',
  );

const tlSearch =
  getElement(
    'tlSearch',
  );

const tlFilter =
  getElement(
    'tlFilter',
  );

const tlList =
  getElement(
    'tlList',
  );

const tlCount =
  getElement(
    'tlCount',
  );

if (
  closeTrackList &&
  trackListPanel
) {
  closeTrackList.addEventListener(
    'click',
    () => {
      trackListPanel.classList.add(
        'hidden',
      );
    },
  );
}

if (
  trackListToggle &&
  trackListPanel
) {
  trackListToggle.addEventListener(
    'click',
    () => {
      trackListPanel.classList.toggle(
        'hidden',
      );
    },
  );
}

/* =========================================================
   TRACK DATA
========================================================= */

function updateAllTracks() {
  allTracks = [
    ...lowVolumeData.events,
    ...particleRecords,
    ...lowVolumeData.quakes,
    ...lowVolumeData.launches,
    ...lowVolumeData.disasters,
    ...satPositions,
  ];
}

function getAllTracks() {
  return [
    ...lowVolumeData.events,
    ...particleRecords,
    ...lowVolumeData.quakes,
    ...lowVolumeData.launches,
    ...lowVolumeData.disasters,
    ...satPositions,
  ];
}

function trackLabel(track) {
  if (
    track.type ===
    'flight'
  ) {
    return (
      track.name ||
      track.icao24 ||
      'Unknown flight'
    );
  }

  if (
    track.type ===
    'ship'
  ) {
    return (
      track.name ||
      `MMSI ${track.mmsi}`
    );
  }

  if (
    track.type ===
    'quake'
  ) {
    return (
      `M${track.mag ?? '?'} ${
        track.name || ''
      }`
    ).trim();
  }

  if (
    track.type ===
    'satellite'
  ) {
    return (
      track.name ||
      'Unknown satellite'
    );
  }

  if (
    track.type ===
    'launch'
  ) {
    return (
      track.name ||
      'Unknown launch'
    );
  }

  if (
    track.type ===
    'disaster'
  ) {
    return (
      track.name ||
      track.event_type ||
      'Unknown disaster'
    );
  }

  return (
    track.name ||
    'Unnamed event'
  );
}

function trackMeta(track) {
  if (
    track.type ===
    'flight'
  ) {
    return track.alt != null
      ? `${track.alt} ft`
      : '';
  }

  if (
    track.type ===
    'ship'
  ) {
    return (
      track.mmsi ||
      ''
    );
  }

  if (
    track.type ===
    'quake'
  ) {
    return track.depth != null
      ? `${Number(
          track.depth,
        ).toFixed(
          0,
        )} km deep`
      : '';
  }

  if (
    track.type ===
    'satellite'
  ) {
    return Number.isFinite(
      track.altKm,
    )
      ? `${Math.round(
          track.altKm,
        )} km orbit`
      : 'Orbit';
  }

  if (
    track.type ===
    'launch'
  ) {
    return (
      track.status ||
      ''
    );
  }

  if (
    track.type ===
    'disaster'
  ) {
    return (
      track.alert_level ||
      ''
    );
  }

  return `${track.count || 1} articles`;
}

function renderTrackList() {
  if (
    !tlSearch ||
    !tlFilter ||
    !tlList ||
    !tlCount
  ) {
    return;
  }

  allTracks =
    getAllTracks();

  const query =
    tlSearch.value
      .trim()
      .toLowerCase();

  const typeFilter =
    tlFilter.value;

  const filtered =
    allTracks.filter(
      (track) => {
        if (
          typeFilter !==
            'all' &&
          track.type !==
            typeFilter
        ) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack = [
          track.name,
          track.mmsi,
          track.icao24,
          track.group,
          track.event_type,
          track.region,
        ]
          .filter(
            (value) =>
              value != null,
          )
          .join(' ')
          .toLowerCase();

        return haystack.includes(
          query,
        );
      },
    );

  tlCount.textContent =
    `${filtered.length} matching ` +
    `(showing up to ${MAX_LIST_ROWS})`;

  const rows =
    filtered
      .slice(
        0,
        MAX_LIST_ROWS,
      )
      .map((track) => {
        const color =
          COLORS[track.type] ||
          COLORS.satellite;

        const colorHex =
          colorToCss(color);

        return `
          <div
            class="tl-row"
            data-id="${escapeHtml(
              track.id,
            )}"
          >
            <span
              class="tl-dot"
              style="
                background:${colorHex};
                color:${colorHex};
              "
            ></span>

            <span class="tl-name">
              ${escapeHtml(
                trackLabel(
                  track,
                ),
              )}
            </span>

            <span class="tl-meta">
              ${escapeHtml(
                trackMeta(
                  track,
                ),
              )}
            </span>
          </div>
        `;
      });

  tlList.innerHTML =
    rows.join('') ||
    `
      <div
        style="
          padding:20px;
          opacity:0.5;
          font-size:0.75rem;
        "
      >
        No matches.
      </div>
    `;

  tlList
    .querySelectorAll(
      '.tl-row',
    )
    .forEach((row) => {
      row.addEventListener(
        'click',
        () => {
          const track =
            allTracks.find(
              (item) =>
                String(
                  item.id,
                ) ===
                String(
                  row.dataset.id,
                ),
            );

          if (!track) {
            return;
          }

          selectTrack(
            track,
            {
              flyTo: true,
            },
          );
        },
      );
    });
}

if (tlSearch) {
  tlSearch.addEventListener(
    'input',
    renderTrackList,
  );
}

if (tlFilter) {
  tlFilter.addEventListener(
    'change',
    renderTrackList,
  );
}

/* =========================================================
   API LOADERS
========================================================= */

async function loadLaunches() {
  const data =
    await fetchJSON(
      'http://localhost:8001/api/launches',
      {
        launches: [],
      },
    );

  return (
    data.launches || []
  )
    .map(
      (launch, index) => ({
        id: `launch-${index}`,
        type: 'launch',

        lat: safeNumber(
          launch.lat,
        ),

        lng: safeNumber(
          launch.lon,
        ),

        name: launch.name,
        net: launch.net,
        status: launch.status,
        pad_name:
          launch.pad_name,
        provider:
          launch.provider,
      }),
    )
    .filter(
      (launch) =>
        launch.lat !==
          null &&
        launch.lng !==
          null,
    );
}

async function loadDisasters() {
  const data =
    await fetchJSON(
      'http://localhost:8001/api/disasters',
      {
        disasters: [],
      },
    );

  return (
    data.disasters || []
  )
    .map(
      (
        disaster,
        index,
      ) => ({
        id: `disaster-${index}`,
        type: 'disaster',

        lat: safeNumber(
          disaster.lat,
        ),

        lng: safeNumber(
          disaster.lon,
        ),

        name:
          disaster.name ||
          disaster.event_type ||
          'Unknown disaster',

        event_type:
          disaster.event_type,

        alert_level:
          disaster.alert_level,

        country:
          disaster.country,

        count: 1,
      }),
    )
    .filter(
      (disaster) =>
        disaster.lat !==
          null &&
        disaster.lng !==
          null,
    );
}

async function loadGpsIntegrity() {
  try {
    const response =
      await fetch(
        'http://localhost:8001/api/gps-integrity',
      );

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}`,
      );
    }

    const data =
      await response.json();

    return Array.isArray(
      data.regions,
    )
      ? data.regions
      : [];
  } catch (error) {
    console.error(
      'GPS integrity fetch failed:',
      error,
    );

    return [];
  }
}

async function loadChokepointRisk() {
  try {
    const response =
      await fetch(
        'http://localhost:8001/api/chokepoint-risk',
      );

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}`,
      );
    }

    const data =
      await response.json();

    return Array.isArray(
      data.chokepoints,
    )
      ? data.chokepoints
      : [];
  } catch (error) {
    console.error(
      'Chokepoint risk fetch failed:',
      error,
    );

    return [];
  }
}

/* =========================================================
   HEALTH PANEL
========================================================= */

const LAYER_LABELS = {
  aircraft: 'Aircraft',
  ships: 'Ships',
  satellites: 'Satellites',
  fires: 'Fires',
  earthquakes: 'Earthquakes',
  events: 'Events',
  launches: 'Launches',
  disasters: 'Disasters',
  gps_integrity: 'GPS Integrity',
  chokepoints: 'Chokepoints',
};

async function refreshHealth() {
  try {
    const response =
      await fetch(
        'http://localhost:8001/api/health',
      );

    if (!response.ok) {
      throw new Error(
        response.status,
      );
    }

    const data =
      await response.json();

    const element =
      getElement(
        'healthPanel',
      );

    if (!element) {
      return;
    }

    element.innerHTML =
      Object.entries(
        LAYER_LABELS,
      )
        .map(
          ([key, label]) => {
            const status =
              data[key]?.status ||
              'down';

            const icon =
              status ===
              'live'
                ? '🟢'
                : '🔴';

            return `
              <div>
                ${icon}
                ${escapeHtml(
                  label.padEnd(
                    14,
                  ),
                )}
                ${escapeHtml(
                  status.toUpperCase(),
                )}
              </div>
            `;
          },
        )
        .join('');
  } catch (error) {
    console.error(
      'Health fetch failed:',
      error,
    );
  }
}

/* =========================================================
   INITIALIZATION
========================================================= */

async function initializeSatellites() {
  await loadSatelliteTLEs();

  propagateSatellites();

  console.log(
    `Satellite layer initialized with ${satPositions.length} active positions.`,
  );
}

/* ---------------------------------------------------------
   START DATA
--------------------------------------------------------- */

refreshData();

setInterval(
  refreshData,
  20000,
);

/* ---------------------------------------------------------
   START SATELLITES
--------------------------------------------------------- */

initializeSatellites();

setInterval(
  () => {
    propagateSatellites();
  },
  5000,
);

/* ---------------------------------------------------------
   HEALTH
--------------------------------------------------------- */

refreshHealth();

setInterval(
  refreshHealth,
  15000,
);

/* ---------------------------------------------------------
   INITIAL RENDER
--------------------------------------------------------- */

renderLowVolumeLayer();
renderCustomLayer();
renderTrackList();