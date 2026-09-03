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
let satelliteOrbitPath = [];
let satelliteGroundTrack = [];
let satelliteGroundTrackLine = null;
let satelliteJourneyProgress = 0;
let satelliteJourneyStartTime = 0;
let satelliteJourneyAnimationId = null;
let satelliteJourneyMarker = null;
let satelliteCameraAnimationId = null;
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

let earthLayersVisible = true;
function earthDataShouldRender() {
  return earthLayersVisible && solarMode !== SOLAR_MODES.SOLAR;
}
const previousById = new Map();

/* HELPERS */

function getShipTypeLabel(type) {
  if (type == null) {
    return 'Unknown';
  }

  const typeNum = Number(type);

  if (typeNum >= 20 && typeNum <= 29) {
    return 'Wing in ground / Special';
  }

  if (typeNum >= 30 && typeNum <= 39) {
    return 'Tug / Special';
  }

  if (typeNum >= 40 && typeNum <= 49) {
    return 'High-speed craft';
  }

  if (typeNum >= 50 && typeNum <= 59) {
    return 'Pilot / SAR / Special';
  }

  if (typeNum >= 60 && typeNum <= 69) {
    return 'Passenger';
  }

  if (typeNum >= 70 && typeNum <= 79) {
    return 'Cargo';
  }

  if (typeNum >= 80 && typeNum <= 89) {
    return 'Tanker';
  }

  if (typeNum >= 90 && typeNum <= 99) {
    return 'Other / Unknown';
  }

  return `Type ${typeNum}`;
}

function getNavigationStatusLabel(status) {
  const statuses = {
    0: 'Under way using engine',
    1: 'At anchor',
    2: 'Not under command',
    3: 'Restricted manoeuvrability',
    4: 'Constrained by draught',
    5: 'Moored',
    6: 'Aground',
    7: 'Engaged in fishing',
    8: 'Under way sailing',
    9: 'Reserved',
    10: 'Reserved',
    11: 'Power-driven vessel towing astern',
    12: 'Power-driven vessel pushing ahead',
    13: 'Reserved',
    14: 'AIS-SART active',
    15: 'Not defined',
  };

  if (status == null) {
    return 'Unknown';
  }

  return statuses[Number(status)] ?? `Status ${status}`;
}

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

async function fetchJSON(url, fallback, timeoutMs = 15000) {
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

/* GLOBE */

const globeContainer = getElement('globeViz');

if (!globeContainer) {
  throw new Error('Missing #globeViz element.');
}

const world = Globe()(globeContainer)
  .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
  .pointOfView({
    lat: 20,
    lng: 30,
    altitude: 2.5,
  });

window.world = world;

function resizeGlobe() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  globeContainer.style.width = `${width}px`;
  globeContainer.style.height = `${height}px`;

  world.width(width);
  world.height(height);
}

window.addEventListener('resize', resizeGlobe);

// Give the dashboard/layout time to settle before measuring.
requestAnimationFrame(() => {
  requestAnimationFrame(resizeGlobe);
});

world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.25;
world.scene().background = new THREE.Color(0x000000);

/* SOLAR SYSTEM / VIEW MODES */

const SOLAR_SYSTEM_API = 'http://localhost:8001/api/solar-system';

const SOLAR_MODES = {
  EARTH: 'earth',
  SOLAR: 'solar',
  JOURNEY: 'journey',
};

let solarMode = SOLAR_MODES.EARTH;

let solarSystemBodies = [];

const solarSystemObjects = new Map();
let historicalMissionTrajectory = null;

/*SOLAR SYSTEM VISUAL SETTINGS
These are dashboard visual units.
They are NOT Earth-globe units.
The planets are deliberately enlarged so they remain
visible, while maintaining a sensible relative hierarchy.
 */

const SOLAR_SYSTEM_RADII = {
  sun: 16,
  mercury: 4.2,
  venus: 5.2,
  earth: 6.0,
  moon: 2.4,
  mars: 5.0,
  jupiter: 11.0,
  saturn: 10.0,
  uranus: 7.0,
  neptune: 7.0,
};

const SOLAR_ROTATION_SPEEDS = {
  sun: 0.0035,

  mercury: 0.018,
  venus: -0.012,

  earth: 0.007,
  moon: 0.008,

  mars: 0.008,

  jupiter: 0.010,
  saturn: 0.009,

  uranus: 0.014,
  neptune: 0.014,
};

let solarAnimationSpeed = 1.0;

const SOLAR_AXIAL_TILTS = {
  sun: 7.25,
  mercury: 0.03,
  venus: 177.4,
  earth: 23.44,
  moon: 6.68,
  mars: 25.19,
  jupiter: 3.13,
  saturn: 26.73,
  uranus: 97.77,
  neptune: 28.32,
};

const SOLAR_BODY_INFO = {
  sun: {
    name: 'Sun',
    type: 'Star',
    diameter: '1,392,700 km',
    distance: '0 AU',
    orbitalPeriod: '—',
    rotationPeriod: '25.4 days',
  },

  mercury: {
    name: 'Mercury',
    type: 'Terrestrial Planet',
    diameter: '4,879 km',
    distance: '0.39 AU',
    orbitalPeriod: '88 days',
    rotationPeriod: '58.6 days',
  },

  venus: {
    name: 'Venus',
    type: 'Terrestrial Planet',
    diameter: '12,104 km',
    distance: '0.72 AU',
    orbitalPeriod: '224.7 days',
    rotationPeriod: '243 days',
  },

  earth: {
    name: 'Earth',
    type: 'Terrestrial Planet',
    diameter: '12,742 km',
    distance: '1 AU',
    orbitalPeriod: '365.25 days',
    rotationPeriod: '23.93 hours',
  },

  moon: {
    name: 'Moon',
    type: 'Natural Satellite',
    diameter: '3,475 km',
    distance: '0.00257 AU',
    orbitalPeriod: '27.3 days',
    rotationPeriod: '27.3 days',
  },

  mars: {
    name: 'Mars',
    type: 'Terrestrial Planet',
    diameter: '6,779 km',
    distance: '1.52 AU',
    orbitalPeriod: '687 days',
    rotationPeriod: '24.6 hours',
  },

  jupiter: {
    name: 'Jupiter',
    type: 'Gas Giant',
    diameter: '139,820 km',
    distance: '5.20 AU',
    orbitalPeriod: '11.86 years',
    rotationPeriod: '9.93 hours',
  },

  saturn: {
    name: 'Saturn',
    type: 'Gas Giant',
    diameter: '116,460 km',
    distance: '9.58 AU',
    orbitalPeriod: '29.45 years',
    rotationPeriod: '10.7 hours',
  },

  uranus: {
    name: 'Uranus',
    type: 'Ice Giant',
    diameter: '50,724 km',
    distance: '19.2 AU',
    orbitalPeriod: '84 years',
    rotationPeriod: '17.2 hours',
  },

  neptune: {
    name: 'Neptune',
    type: 'Ice Giant',
    diameter: '49,244 km',
    distance: '30.1 AU',
    orbitalPeriod: '164.8 years',
    rotationPeriod: '16.1 hours',
  },
};

const SOLAR_SYSTEM_COLORS = {
  sun: 0xffcc33,
  mercury: 0xaaaaaa,
  venus: 0xd9b36c,
  earth: 0x4488ff,
  moon: 0xbbbbbb,
  mars: 0xcc5533,
  jupiter: 0xd8a066,
  saturn: 0xd8c090,
  uranus: 0x66ccdd,
  neptune: 0x3366cc,
};

const MOON_ORBIT_RADIUS = 18;
const MOON_ORBIT_SPEED = 0.003;

/* HELIOCENTRIC VISUAL DISTANCE
 * Real Solar System distances are enormous.
 * We compress them logarithmically.
 * This preserves:
 * Sun -> Mercury -> Venus -> Earth -> Mars -> ...
 * while allowing the entire system to fit comfortably inside the dashboard.
 */

/*
 * The Earth globe (three-globe default) has radius 100.
 * Keep every solar body's visual distance comfortably
 * outside that, so nothing overlaps where Earth was,
 * even before the globe/data-layer visibility settles.
 */
const SOLAR_DISTANCE_OFFSET = 130;
const SOLAR_DISTANCE_SCALE = 55;

const solarRaycaster = new THREE.Raycaster();
const solarMouse = new THREE.Vector2();

/* DEDICATED SOLAR SYSTEM GROUP
*This group belongs exclusively to Solar View.
 * It has nothing to do with the Earth globe.
 */

const solarSystemGroup = new THREE.Group();
const solarLabels = new Map();

let selectedSolarBody = null;
let hoveredSolarBody = null;

let solarOrbitsVisible = true;
let solarLabelsVisible = true;
let solarStarsVisible = true;

solarSystemGroup.visible = false;


function setSolarOrbitsVisible(visible) {
  solarOrbitsVisible = visible;
  solarOrbitGroup.visible = visible;
}

function setSolarLabelsVisible(visible) {
  solarLabelsVisible = visible;

  for (const label of solarLabels.values()) {
    label.visible = visible;
  }
}

/* SOLAR SYSTEM LIGHTING */
const solarAmbientLight = new THREE.AmbientLight(
  0xffffff,
  0.12,
);

const solarSunLight = new THREE.PointLight(
  0xffffff,
  2.5,
  0,
  1.5,
);

solarSunLight.position.set(0, 0, 0);

solarSystemGroup.add(solarAmbientLight);
solarSystemGroup.add(solarSunLight);

solarSystemGroup.visible = false;

world.scene().add(solarSystemGroup);

/*SOLAR SYSTEM STARFIELD*/

const solarStarfieldGroup = new THREE.Group();

solarStarfieldGroup.visible = solarStarsVisible;

solarSystemGroup.add(solarStarfieldGroup);

function createSolarStarfield() {
  const starCount = 1800;

  const positions = new Float32Array(
    starCount * 3
  );

  for (let i = 0; i < starCount; i++) {
    /*
     * Random point on a large sphere.
     */

    const radius =
      1400 + Math.random() * 1600;

    const theta =
      Math.random() * Math.PI * 2;

    const phi =
      Math.acos(
        2 * Math.random() - 1
      );

    positions[i * 3] =
      radius *
      Math.sin(phi) *
      Math.cos(theta);

    positions[i * 3 + 1] =
      radius *
      Math.cos(phi);

    positions[i * 3 + 2] =
      radius *
      Math.sin(phi) *
      Math.sin(theta);
  }

  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      positions,
      3,
    ),
  );

  const material =
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });

  const stars =
    new THREE.Points(
      geometry,
      material,
    );

  solarStarfieldGroup.add(stars);
}

createSolarStarfield();

function setSolarStarsVisible(visible) {
  solarStarsVisible = visible;
  solarStarfieldGroup.visible = visible;
}


/*
 * ---------------------------------------------------------
 * SOLAR ORBIT GROUP
 * ---------------------------------------------------------
 *
 * Decorative orbital paths around the Sun.
 */

const solarOrbitGroup = new THREE.Group();

solarOrbitGroup.visible = solarOrbitsVisible;

solarSystemGroup.add(solarOrbitGroup);


/*Approximate orbital eccentricities.
These are used only for visualising the orbital shapes.*/

const SOLAR_ORBIT_ECCENTRICITIES = {
  mercury: 0.206,
  venus: 0.007,
  earth: 0.017,
  mars: 0.093,
  jupiter: 0.049,
  saturn: 0.057,
  uranus: 0.046,
  neptune: 0.011,
};

/*CREATE PLANES*/

function createSolarSystemBody(body) {
  const radius = SOLAR_SYSTEM_RADII[body.id] || 2.5;
  const color = SOLAR_SYSTEM_COLORS[body.id] || 0xffffff;

  const group = new THREE.Group();
  group.userData.bodyId = body.id;

  const axialTilt =
  SOLAR_AXIAL_TILTS[body.id] || 0;

group.rotation.z =
  THREE.MathUtils.degToRad(axialTilt);

  /*PLANET SURFACE*/

  const geometry = new THREE.SphereGeometry(
    radius,
    48,
    48,
  );

  /*
   * Base planet material.
   */

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.0,
  });

  const sphere = new THREE.Mesh(
    geometry,
    material,
  );

  group.add(sphere);

  /*
   * ---------------------------------------------------------
   * SUN
   * ---------------------------------------------------------
   */

  if (body.id === 'sun') {
    sphere.material = new THREE.MeshBasicMaterial({
      color: 0xffcc33,
    });

    /*
     * Inner glow.
     */

    const glowGeometry = new THREE.SphereGeometry(
      radius * 1.35,
      32,
      32,
    );

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa22,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    group.add(
      new THREE.Mesh(
        glowGeometry,
        glowMaterial,
      ),
    );


/*
 * ---------------------------------------------------------
 * SOLAR CORONA
 * ---------------------------------------------------------
 */

const coronaGeometry = new THREE.SphereGeometry(
  radius * 2.2,
  48,
  48,
);

const coronaMaterial = new THREE.MeshBasicMaterial({
  color: 0xff8a22,
  transparent: true,
  opacity: 0.055,
  depthWrite: false,
});

const corona = new THREE.Mesh(
  coronaGeometry,
  coronaMaterial,
);

group.add(corona);

/*
 * Secondary corona layer.
 */

const coronaInnerGeometry = new THREE.SphereGeometry(
  radius * 1.55,
  48,
  48,
);

const coronaInnerMaterial = new THREE.MeshBasicMaterial({
  color: 0xffbb44,
  transparent: true,
  opacity: 0.10,
  depthWrite: false,
});

group.add(
  new THREE.Mesh(
    coronaInnerGeometry,
    coronaInnerMaterial,
  ),
  );
  }


  /*PLANET-SPECIFIC SURFACE DETAILS*/

  /* JUPITER — ATMOSPHERIC SURFACE */

if (body.id === 'jupiter') {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');

  /* Warm orange base */
  ctx.fillStyle = '#d98245';
  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  /* Jupiter's major atmospheric bands */
  const bands = [
    '#9e4f2f',
    '#e79a58',
    '#b9653b',
    '#f0b875',
    '#a95132',
    '#d77b45',
    '#f3c080',
    '#a95a37',
  ];

  const bandHeight =
    canvas.height / bands.length;

  bands.forEach((band, index) => {
    ctx.fillStyle = band;

    ctx.fillRect(
      0,
      index * bandHeight,
      canvas.width,
      bandHeight,
    );

    /* Turbulent cloud detail */
    ctx.globalAlpha = 0.16;

    for (let i = 0; i < 18; i++) {
      const y =
        index * bandHeight +
        Math.random() * bandHeight;

      ctx.fillRect(
        0,
        y,
        canvas.width,
        2 + Math.random() * 6,
      );
    }

    ctx.globalAlpha = 1;
  });

  /* Additional swirling atmospheric streaks */
  for (let i = 0; i < 45; i++) {
    ctx.strokeStyle =
      i % 2 === 0
        ? 'rgba(255,210,150,0.20)'
        : 'rgba(90,40,20,0.16)';

    ctx.lineWidth =
      1 + Math.random() * 4;

    ctx.beginPath();

    const y =
      Math.random() * canvas.height;

    ctx.moveTo(0, y);

    for (
      let x = 0;
      x <= canvas.width;
      x += 20
    ) {
      ctx.lineTo(
        x,
        y +
          Math.sin(x * 0.025) *
            (3 + Math.random() * 6),
      );
    }

    ctx.stroke();
  }

  /* Great Red Spot */
  ctx.fillStyle = '#b94f32';

  ctx.beginPath();

  ctx.ellipse(
    canvas.width * 0.68,
    canvas.height * 0.64,
    34,
    17,
    0,
    0,
    Math.PI * 2,
  );

  ctx.fill();

  /* Red Spot inner turbulence */
  ctx.fillStyle = '#e58a58';

  ctx.beginPath();

  ctx.ellipse(
    canvas.width * 0.68,
    canvas.height * 0.64,
    21,
    9,
    0,
    0,
    Math.PI * 2,
  );

  ctx.fill();

  const texture =
    new THREE.CanvasTexture(canvas);

  texture.wrapS =
    THREE.RepeatWrapping;

  texture.wrapT =
    THREE.ClampToEdgeWrapping;

  sphere.material =
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1.0,
      metalness: 0.0,
    });
}

/* SATURN — ATMOSPHERIC SURFACE */

if (body.id === 'saturn') {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');

  /* Pale golden base */
  ctx.fillStyle = '#cbb98c';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  /* Saturn's subtle atmospheric bands */
  const bands = [
    '#8f8061',
    '#d8c99f',
    '#a99770',
    '#e7d8ad',
    '#968765',
    '#c4b386',
    '#eee0b9',
    '#aa9a75',
  ];

  const bandHeight =
    canvas.height / bands.length;

  bands.forEach((band, index) => {
    ctx.fillStyle = band;

    ctx.fillRect(
      0,
      index * bandHeight,
      canvas.width,
      bandHeight,
    );

    /* Very subtle cloud variation */
    ctx.globalAlpha = 0.12;

    for (let i = 0; i < 15; i++) {
      const y =
        index * bandHeight +
        Math.random() * bandHeight;

      ctx.fillRect(
        0,
        y,
        canvas.width,
        2 + Math.random() * 5,
      );
    }

    ctx.globalAlpha = 1;
  });

  /* Saturn's fine atmospheric streaks */
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle =
      i % 2 === 0
        ? 'rgba(255,245,210,0.28)'
        : 'rgba(90,75,50,0.18)';

    ctx.lineWidth =
      1 + Math.random() * 3;

    ctx.beginPath();

    const y =
      Math.random() * canvas.height;

    ctx.moveTo(0, y);

    for (
      let x = 0;
      x <= canvas.width;
      x += 20
    ) {
      ctx.lineTo(
        x,
        y +
          Math.sin(x * 0.025) *
            (2 + Math.random() * 4),
      );
    }

    ctx.stroke();
  }

  const texture =
    new THREE.CanvasTexture(canvas);

  texture.wrapS =
    THREE.RepeatWrapping;

  texture.wrapT =
    THREE.ClampToEdgeWrapping;

  sphere.material =
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1.0,
      metalness: 0.0,
    });
}


    /*
   * ---------------------------------------------------------
   * EARTH
   * ---------------------------------------------------------
   */

  if (body.id === 'earth') {
    const canvas = document.createElement('canvas');

    canvas.width = 512;
    canvas.height = 256;

    const ctx = canvas.getContext('2d');

    /* Ocean */

    ctx.fillStyle = '#185b9d';

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    /* Continental land masses */

    ctx.fillStyle = '#438653';

    const continents = [
      [120, 85, 55, 35],
      [175, 145, 35, 65],
      [285, 90, 65, 38],
      [360, 145, 38, 55],
      [420, 80, 35, 25],
      [80, 170, 25, 15],
    ];

    continents.forEach(
      ([x, y, rx, ry]) => {
        ctx.beginPath();

        ctx.ellipse(
          x,
          y,
          rx,
          ry,
          Math.random() * 0.5,
          0,
          Math.PI * 2,
        );

        ctx.fill();
      },
    );

    /*
     * Lighter terrain.
     */

    ctx.fillStyle = '#79a85d';

    for (let i = 0; i < 25; i++) {
      ctx.beginPath();

      ctx.ellipse(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        5 + Math.random() * 15,
        3 + Math.random() * 9,
        0,
        0,
        Math.PI * 2,
      );

      ctx.fill();
    }

    /*
     * Desert regions.
     */

    ctx.fillStyle = '#b59b61';

    for (let i = 0; i < 10; i++) {
      ctx.beginPath();

      ctx.ellipse(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        8 + Math.random() * 15,
        4 + Math.random() * 8,
        0,
        0,
        Math.PI * 2,
      );

      ctx.fill();
    }

    /*
     * Polar ice.
     */

    ctx.fillStyle = '#e8f3ed';

    ctx.fillRect(
      0,
      0,
      canvas.width,
      12,
    );

    ctx.fillRect(
      0,
      canvas.height - 12,
      canvas.width,
      12,
    );

    const earthTexture =
      new THREE.CanvasTexture(canvas);

    earthTexture.wrapS =
      THREE.RepeatWrapping;

    earthTexture.wrapT =
      THREE.ClampToEdgeWrapping;

    sphere.material =
      new THREE.MeshStandardMaterial({
        map: earthTexture,
        roughness: 0.85,
        metalness: 0.0,
      });

    /*
     * -------------------------------------------------------
     * EARTH CLOUD LAYER
     * -------------------------------------------------------
     */

    const cloudCanvas =
      document.createElement('canvas');

    cloudCanvas.width = 512;
    cloudCanvas.height = 256;

    const cloudCtx =
      cloudCanvas.getContext('2d');

    cloudCtx.clearRect(
      0,
      0,
      cloudCanvas.width,
      cloudCanvas.height,
    );

    /*
     * Large cloud formations.
     */

    for (let i = 0; i < 55; i++) {
      cloudCtx.fillStyle =
        `rgba(255,255,255,${0.18 + Math.random() * 0.30})`;

      cloudCtx.beginPath();

      cloudCtx.ellipse(
        Math.random() * cloudCanvas.width,
        Math.random() * cloudCanvas.height,
        8 + Math.random() * 28,
        3 + Math.random() * 10,
        0,
        0,
        Math.PI * 2,
      );

      cloudCtx.fill();
    }

    const cloudTexture =
      new THREE.CanvasTexture(cloudCanvas);

    cloudTexture.wrapS =
      THREE.RepeatWrapping;

    cloudTexture.wrapT =
      THREE.ClampToEdgeWrapping;

    /*
     * Slightly larger sphere so clouds
     * sit above the surface.
     */

    const cloudGeometry =
      new THREE.SphereGeometry(
        radius * 1.025,
        48,
        48,
      );

    const cloudMaterial =
      new THREE.MeshStandardMaterial({
        map: cloudTexture,
        transparent: true,
        opacity: 0.72,
        roughness: 1.0,
        metalness: 0.0,
        depthWrite: false,
      });

    const cloudLayer =
      new THREE.Mesh(
        cloudGeometry,
        cloudMaterial,
      );

    group.add(cloudLayer);

    /*
     * Store reference so the cloud layer can
     * rotate slightly faster than the surface.
     */

    group.userData.cloudLayer =
      cloudLayer;

    /*
     * Earth atmosphere.
     */

    const atmosphereGeometry =
      new THREE.SphereGeometry(
        radius * 1.09,
        48,
        48,
      );

    const atmosphereMaterial =
      new THREE.MeshBasicMaterial({
        color: 0x4da6ff,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
        depthWrite: false,
      });

    group.add(
      new THREE.Mesh(
        atmosphereGeometry,
        atmosphereMaterial,
      ),
    );
  }

  /*
   * ---------------------------------------------------------
   * MARS SURFACE
   * ---------------------------------------------------------
   */

  if (body.id === 'mars') {
    const canvas = document.createElement('canvas');

    canvas.width = 512;
    canvas.height = 256;

    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#a94732';

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    /*
     * Subtle darker surface regions.
     */

    for (let i = 0; i < 35; i++) {
      ctx.fillStyle =
        i % 2 === 0
          ? '#7f382b'
          : '#c66b4d';

      ctx.beginPath();

      ctx.ellipse(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        8 + Math.random() * 25,
        4 + Math.random() * 14,
        0,
        0,
        Math.PI * 2,
      );

      ctx.fill();
    }

    const marsTexture =
      new THREE.CanvasTexture(canvas);

    sphere.material =
      new THREE.MeshStandardMaterial({
        map: marsTexture,
        roughness: 1.0,
        metalness: 0.0,
      });
  }


/*
 * ---------------------------------------------------------
 * MERCURY SURFACE
 * ---------------------------------------------------------
 */

if (body.id === 'mercury') {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');

  /*
   * Rocky base.
   */

  ctx.fillStyle = '#8d8a84';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  /*
   * Large craters.
   */

  for (let i = 0; i < 45; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;

    const craterRadius =
      4 + Math.random() * 18;

    ctx.fillStyle =
      i % 2 === 0
        ? '#66645f'
        : '#aaa7a0';

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      craterRadius,
      0,
      Math.PI * 2,
    );

    ctx.fill();

    /*
     * Crater rim.
     */

    ctx.strokeStyle = '#c2beb6';
    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      craterRadius * 0.72,
      0,
      Math.PI * 2,
    );

    ctx.stroke();
  }

  /*
   * Bright impact regions.
   */

  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = '#c9c5bc';

    ctx.beginPath();

    ctx.arc(
      Math.random() * canvas.width,
      Math.random() * canvas.height,
      2 + Math.random() * 6,
      0,
      Math.PI * 2,
    );

    ctx.fill();
  }

  const mercuryTexture =
    new THREE.CanvasTexture(canvas);

  mercuryTexture.wrapS =
    THREE.RepeatWrapping;

  mercuryTexture.wrapT =
    THREE.ClampToEdgeWrapping;

  sphere.material =
    new THREE.MeshStandardMaterial({
      map: mercuryTexture,
      roughness: 1.0,
      metalness: 0.0,
    });
}


/*
 * ---------------------------------------------------------
 * VENUS CLOUDS
 * ---------------------------------------------------------
 */

if (body.id === 'venus') {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');

  /*
   * Thick cloud base.
   */

  ctx.fillStyle = '#d8b86a';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  /*
   * Atmospheric cloud bands.
   */

  const venusBands = [
    '#b89450',
    '#ead18b',
    '#c5a35c',
    '#f0d997',
    '#b18d4d',
    '#dfc276',
    '#f3dda0',
  ];

  const bandHeight =
    canvas.height / venusBands.length;

  venusBands.forEach((band, index) => {
    ctx.fillStyle = band;

    ctx.fillRect(
      0,
      index * bandHeight,
      canvas.width,
      bandHeight,
    );
  });

  /*Swirling cloud structures*/

for (let i = 0; i < 100; i++) {
  ctx.strokeStyle =
    i % 3 === 0
      ? 'rgba(255,240,180,0.32)'
      : 'rgba(120,85,35,0.22)';

  ctx.lineWidth =
    1 + Math.random() * 4;

  ctx.beginPath();

  const y =
    Math.random() * canvas.height;

  ctx.moveTo(0, y);

  for (
    let x = 0;
    x <= canvas.width;
    x += 16
  ) {
    ctx.lineTo(
      x,
      y +
        Math.sin(
          x * 0.035 +
          i * 0.4
        ) *
          (4 + Math.random() * 7),
    );
  }

  ctx.stroke();
}

  const venusTexture =
    new THREE.CanvasTexture(canvas);

  venusTexture.wrapS =
    THREE.RepeatWrapping;

  venusTexture.wrapT =
    THREE.ClampToEdgeWrapping;

  sphere.material =
    new THREE.MeshStandardMaterial({
      map: venusTexture,
      roughness: 1.0,
      metalness: 0.0,
    });
}


/*
 * ---------------------------------------------------------
 * URANUS ATMOSPHERE
 * ---------------------------------------------------------
 */

if (body.id === 'uranus') {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#55b9c7';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const uranusBands = [
    '#3f9daa',
    '#67c8d2',
    '#4aaeba',
    '#7bd2d7',
    '#4199a8',
    '#69c4ca',
    '#3d91a1',
  ];

  const bandHeight =
    canvas.height / uranusBands.length;

  uranusBands.forEach((band, index) => {
    ctx.fillStyle = band;

    ctx.fillRect(
      0,
      index * bandHeight,
      canvas.width,
      bandHeight,
    );
  });

  /*
   * Subtle high-altitude streaks.
   */

  for (let i = 0; i < 35; i++) {
    ctx.strokeStyle =
      'rgba(220,255,255,0.20)';

    ctx.lineWidth =
      1 + Math.random() * 3;

    ctx.beginPath();

    const y =
      Math.random() * canvas.height;

    ctx.moveTo(0, y);

    ctx.lineTo(
      canvas.width,
      y + (Math.random() * 10 - 5),
    );

    ctx.stroke();
  }

  const uranusTexture =
    new THREE.CanvasTexture(canvas);

  uranusTexture.wrapS =
    THREE.RepeatWrapping;

  uranusTexture.wrapT =
    THREE.ClampToEdgeWrapping;

  sphere.material =
    new THREE.MeshStandardMaterial({
      map: uranusTexture,
      roughness: 0.95,
      metalness: 0.0,
    });
}


/*
 * ---------------------------------------------------------
 * NEPTUNE ATMOSPHERE
 * ---------------------------------------------------------
 */

if (body.id === 'neptune') {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#315fa8';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const neptuneBands = [
    '#244d91',
    '#376bb6',
    '#28559f',
    '#4a78bd',
    '#234b8e',
    '#3b69aa',
    '#214985',
  ];

  const bandHeight =
    canvas.height / neptuneBands.length;

  neptuneBands.forEach((band, index) => {
    ctx.fillStyle = band;

    ctx.fillRect(
      0,
      index * bandHeight,
      canvas.width,
      bandHeight,
    );
  });

  /*
   * Atmospheric streaks.
   */

  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle =
      i % 2 === 0
        ? 'rgba(130,190,240,0.28)'
        : 'rgba(10,35,80,0.25)';

    ctx.lineWidth =
      2 + Math.random() * 4;

    ctx.beginPath();

    const y =
      Math.random() * canvas.height;

    ctx.moveTo(
      0,
      y,
    );

    ctx.lineTo(
      canvas.width,
      y + (Math.random() * 14 - 7),
    );

    ctx.stroke();
  }

  /*
   * Dark storm.
   */

  ctx.fillStyle = '#172f61';

  ctx.beginPath();

  ctx.ellipse(
    canvas.width * 0.67,
    canvas.height * 0.38,
    28,
    16,
    0,
    0,
    Math.PI * 2,
  );

  ctx.fill();

  /*
   * Bright cloud surrounding storm.
   */

  ctx.strokeStyle =
    'rgba(170,220,255,0.55)';

  ctx.lineWidth = 5;

  ctx.beginPath();

  ctx.ellipse(
    canvas.width * 0.67,
    canvas.height * 0.38,
    35,
    20,
    0,
    0,
    Math.PI * 2,
  );

  ctx.stroke();

  const neptuneTexture =
    new THREE.CanvasTexture(canvas);

  neptuneTexture.wrapS =
    THREE.RepeatWrapping;

  neptuneTexture.wrapT =
    THREE.ClampToEdgeWrapping;

  sphere.material =
    new THREE.MeshStandardMaterial({
      map: neptuneTexture,
      roughness: 0.95,
      metalness: 0.0,
    });
}


/*
 * ---------------------------------------------------------
 * MOON SURFACE
 * ---------------------------------------------------------
 */

if (body.id === 'moon') {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 256;

  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#9b9b98';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  /*
   * Lunar surface variation.
   */

  for (let i = 0; i < 70; i++) {
    ctx.fillStyle =
      i % 2 === 0
        ? '#73736f'
        : '#b8b8b3';

    ctx.beginPath();

    ctx.arc(
      Math.random() * canvas.width,
      Math.random() * canvas.height,
      3 + Math.random() * 12,
      0,
      Math.PI * 2,
    );

    ctx.fill();
  }

  /*
   * Large impact craters.
   */

  for (let i = 0; i < 20; i++) {
    const x =
      Math.random() * canvas.width;

    const y =
      Math.random() * canvas.height;

    const r =
      7 + Math.random() * 15;

    ctx.strokeStyle = '#c8c8c2';
    ctx.lineWidth = 3;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      r,
      0,
      Math.PI * 2,
    );

    ctx.stroke();

    ctx.fillStyle = '#696966';

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      r * 0.65,
      0,
      Math.PI * 2,
    );

    ctx.fill();
  }

  const moonTexture =
    new THREE.CanvasTexture(canvas);

  moonTexture.wrapS =
    THREE.RepeatWrapping;

  moonTexture.wrapT =
    THREE.ClampToEdgeWrapping;

  sphere.material =
    new THREE.MeshStandardMaterial({
      map: moonTexture,
      roughness: 1.0,
      metalness: 0.0,
    });
}


  /*
   * ---------------------------------------------------------
   * SATURN RINGS
   * ---------------------------------------------------------
   */

  if (body.id === 'saturn') {
    const ringGeometry =
      new THREE.RingGeometry(
        radius * 1.35,
        radius * 2.25,
        96,
      );

    const ringMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xd8c090,
        transparent: true,
        opacity: 0.72,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

    const ring = new THREE.Mesh(
      ringGeometry,
      ringMaterial,
    );

    ring.rotation.x = Math.PI / 2;

    group.add(ring);

    /*
     * Inner ring.
     */

    const innerRingGeometry =
      new THREE.RingGeometry(
        radius * 1.12,
        radius * 1.35,
        96,
      );

    const innerRingMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xb8a77e,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

    const innerRing =
      new THREE.Mesh(
        innerRingGeometry,
        innerRingMaterial,
      );

    innerRing.rotation.x =
      Math.PI / 2;

    group.add(innerRing);
  }

  return group;
}


function createSolarBodyLabel(body) {
  const canvas =
    document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 128;

  const ctx =
    canvas.getContext('2d');

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  ctx.font =
    '600 32px Arial';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle =
    'rgba(255,255,255,0.9)';

  ctx.fillText(
    body.name,
    canvas.width / 2,
    canvas.height / 2,
  );

  const texture =
    new THREE.CanvasTexture(canvas);

  const material =
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

  const sprite =
    new THREE.Sprite(material);

  sprite.scale.set(
    55,
    14,
    1,
  );

  return sprite;
}


/*CALCULATE HELIOCENTRIC POSITION */

function getSolarVisualPosition(body, sun) {
  const x = Number(body.x) - Number(sun.x);

  const y = Number(body.y) - Number(sun.y);

  const z = Number(body.z) - Number(sun.z);

  const distance = Math.sqrt(x * x + y * y + z * z);

  /* Sun.*/
  if (body.id === 'sun') {
    return new THREE.Vector3(0, 0, 0);
  }

  /*Invalid position.*/
  if (!Number.isFinite(distance) || distance <= 0) {
    return new THREE.Vector3(0, 0, 0);
  }

  /*Compress astronomical distance.*/
  const visualDistance =
    SOLAR_DISTANCE_OFFSET + Math.log10(1 + distance) * SOLAR_DISTANCE_SCALE;

  /*Normalised heliocentric direction. */
  const nx = x / distance;

  const ny = y / distance;

  const nz = z / distance;

  /*Map astronomical coordinates to Three.js.
   * X = astronomical X
   * Y = astronomical Z
   * Z = astronomical Y
   * This gives us a horizontal ecliptic plane.
   */

  if (body.id === 'moon') {
  return new THREE.Vector3(
    nx * visualDistance + 5,
    nz * visualDistance + 2,
    ny * visualDistance + 5,
  );
}


  return new THREE.Vector3(
    nx * visualDistance,
    nz * visualDistance,
    ny * visualDistance,
  );
}


/*CREATE SOLAR ORBIT*/

function createSolarOrbit(body, sun) {
  const x = Number(body.x) - Number(sun.x);
  const y = Number(body.y) - Number(sun.y);
  const z = Number(body.z) - Number(sun.z);

  const distance = Math.sqrt(x * x + y * y + z * z);

  if (
    !Number.isFinite(distance) ||
    distance <= 0 ||
    body.id === 'sun' ||
    body.id === 'moon'
  ) {
    return null;
  }

  const visualDistance =
    SOLAR_DISTANCE_OFFSET +
    Math.log10(1 + distance) * SOLAR_DISTANCE_SCALE;

  const eccentricity =
    SOLAR_ORBIT_ECCENTRICITIES[body.id] || 0.02;

  const semiMajor = visualDistance;

  const semiMinor =
    semiMajor * Math.sqrt(1 - eccentricity * eccentricity);

  const curve = new THREE.EllipseCurve(
    0,
    0,
    semiMajor,
    semiMinor,
    0,
    Math.PI * 2,
    false,
    0,
  );

  const points = curve.getPoints(160);

  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map(
      point =>
        new THREE.Vector3(
          point.x,
          0,
          point.y,
        ),
    ),
  );

  const material = new THREE.LineBasicMaterial({
    color: SOLAR_SYSTEM_COLORS[body.id] || 0xffffff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  return new THREE.LineLoop(
    geometry,
    material,
  );
}


async function loadHistoricalMissionTrajectory(missionId) {
  console.log(
    'Loading historical trajectory:',
    missionId,
  );

  try {
    const response = await fetch(
      `http://localhost:8001/api/missions/${missionId}/trajectory`,
    );

    if (!response.ok) {
      throw new Error(
        `Backend returned ${response.status}`,
      );
    }

    const data = await response.json();

    console.log(
      'Historical trajectory response:',
      data,
    );

    if (
      data.available !== true ||
      !Array.isArray(data.points) ||
      data.points.length < 2
    ) {
      console.error(
        'Historical trajectory unavailable:',
        data,
      );
      return;
    }

    const trajectory =
      createHistoricalMissionTrajectory(
        data.points,
      );

    if (!trajectory) {
      console.error(
        'Could not create THREE trajectory.',
      );
      return;
    }

    if (historicalMissionTrajectory) {
      solarSystemGroup.remove(
        historicalMissionTrajectory,
      );

      historicalMissionTrajectory.geometry.dispose();
      historicalMissionTrajectory.material.dispose();
    }

    historicalMissionTrajectory = trajectory;

    historicalMissionTrajectory.name =
      `mission-${missionId}`;

    solarSystemGroup.add(
      historicalMissionTrajectory,
    );

    console.log(
      'Historical trajectory successfully added:',
      data.name,
      data.points.length,
      'points',
    );

  } catch (error) {
    console.error(
      'Historical mission trajectory failed:',
      error,
    );
  }
}


/* CREATE HISTORICAL MISSION TRAJECTORY */
function createHistoricalMissionTrajectory(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  const THREE_POINTS = [];

  for (const point of points) {
    const x = Number(point.x);
    const y = Number(point.y);
    const z = Number(point.z);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      continue;
    }

    const distance = Math.sqrt(
      x * x +
      y * y +
      z * z
    );

    if (!Number.isFinite(distance) || distance <= 0) {
      continue;
    }

    /* Use the EXACT same distance compression
       as the solar-system renderer. */
    const visualDistance =
      SOLAR_DISTANCE_OFFSET +
      Math.log10(1 + distance) *
        SOLAR_DISTANCE_SCALE;

    /* Same coordinate mapping as
       getSolarVisualPosition():

       Horizons X -> Three.js X
       Horizons Z -> Three.js Y
       Horizons Y -> Three.js Z
    */
    const nx = x / distance;
    const ny = y / distance;
    const nz = z / distance;

    THREE_POINTS.push(
      new THREE.Vector3(
        nx * visualDistance,
        nz * visualDistance,
        ny * visualDistance,
      ),
    );
  }

  if (THREE_POINTS.length < 2) {
    return null;
  }

  const geometry =
    new THREE.BufferGeometry().setFromPoints(
      THREE_POINTS,
    );

  const material =
    new THREE.LineBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

  return new THREE.Line(
    geometry,
    material,
  );
}

/*UPDATE SOLAR SYSTEM*/

function updateSolarSystemBodies(bodies) {
  solarSystemBodies = Array.isArray(bodies) ? bodies : [];

  const sun = solarSystemBodies.find((body) => body.id === 'sun');

  if (!sun) {
    console.warn('Solar System: Sun not available.');
    return;
  }

  const activeIds = new Set();

  /*
   * Create/update every body.
   */

  for (const body of solarSystemBodies) {
    activeIds.add(body.id);

    let object = solarSystemObjects.get(body.id);

    /*
     * Create object if required.
     */

    if (!object) {
      object = createSolarSystemBody(body);

      solarSystemObjects.set(body.id, object);

      solarSystemGroup.add(object);
    }

const label = createSolarBodyLabel(body);

label.position.set(
  0,
  (SOLAR_SYSTEM_RADII[body.id] || 2.5) + 5,
  0,
);

object.add(label);

solarLabels.set(body.id, label);

label.visible = solarLabelsVisible;

    /*Calculate heliocentric position*/

    const position = getSolarVisualPosition(body, sun);

    object.position.copy(position);
    object.userData.apiData = body;

    /*Make sure every body is visible.*/

    object.visible = true;

    /* Create orbital path.*/

    if (
      body.id !== 'sun' &&
      body.id !== 'moon' &&
      !solarOrbitGroup.getObjectByName(`orbit-${body.id}`)
    ) {
      const orbit = createSolarOrbit(body, sun);

      if (orbit) {
        orbit.name = `orbit-${body.id}`;
        solarOrbitGroup.add(orbit);
      }
    }
  }

  /*
   * Remove stale bodies.
   */

  for (const [id, object] of solarSystemObjects) {
    if (!activeIds.has(id)) {
      solarSystemGroup.remove(object);
      solarSystemObjects.delete(id);
    }
  }

  /*
   * Remove stale orbital paths.
   */

  for (const orbit of [...solarOrbitGroup.children]) {
    const bodyId = orbit.name.replace('orbit-', '');

    if (!activeIds.has(bodyId)) {
      solarOrbitGroup.remove(orbit);
      orbit.geometry.dispose();
      orbit.material.dispose();
    }
  }

  /*
   * Show orbital paths.
   */

  solarOrbitGroup.visible = solarOrbitsVisible;

  console.log(
    `SOLAR SYSTEM: updated ${solarSystemBodies.length} bodies`
  );
}

function handleSolarPointerMove(event) {
  if (
    solarMode !== SOLAR_MODES.SOLAR &&
    solarMode !== SOLAR_MODES.JOURNEY
  ) {
    return;
  }

  const rect =
    world.renderer().domElement.getBoundingClientRect();

  solarMouse.x =
    ((event.clientX - rect.left) / rect.width) * 2 - 1;

  solarMouse.y =
    -((event.clientY - rect.top) / rect.height) * 2 + 1;

  solarRaycaster.setFromCamera(
    solarMouse,
    world.camera(),
  );

  const meshes = [];

  for (const object of solarSystemObjects.values()) {
    object.traverse((child) => {
      if (child.isMesh) {
        meshes.push(child);
      }
    });
  }

  const intersections =
    solarRaycaster.intersectObjects(
      meshes,
      false,
    );

  if (intersections.length === 0) {
    if (hoveredSolarBody) {
      hoveredSolarBody.userData.hovered = false;
      hoveredSolarBody = null;
    }

    document.body.style.cursor = 'default';
    return;
  }

  let object =
    intersections[0].object;

  while (
    object.parent &&
    !solarSystemObjects.has(
      object.userData?.bodyId,
    )
  ) {
    object = object.parent;
  }

  let bodyObject = null;

  for (const [id, solarObject] of solarSystemObjects) {
    if (
      solarObject === object ||
      solarObject === intersections[0].object ||
      solarObject.getObjectById(
        intersections[0].object.id,
      )
    ) {
      bodyObject = solarObject;
      break;
    }
  }

  if (!bodyObject) return;

  if (
    hoveredSolarBody &&
    hoveredSolarBody !== bodyObject
  ) {
    hoveredSolarBody.userData.hovered = false;
  }

  hoveredSolarBody = bodyObject;
  hoveredSolarBody.userData.hovered = true;

  document.body.style.cursor = 'pointer';
}

function handleSolarPointerClick(event) {
  if (
    solarMode !== SOLAR_MODES.SOLAR &&
    solarMode !== SOLAR_MODES.JOURNEY
  ) {
    return;
  }

  const rect =
    world.renderer().domElement.getBoundingClientRect();

  solarMouse.x =
    ((event.clientX - rect.left) / rect.width) * 2 - 1;

  solarMouse.y =
    -((event.clientY - rect.top) / rect.height) * 2 + 1;

  solarRaycaster.setFromCamera(
    solarMouse,
    world.camera(),
  );

  const meshes = [];

  for (const object of solarSystemObjects.values()) {
    object.traverse((child) => {
      if (child.isMesh) {
        meshes.push(child);
      }
    });
  }

  const intersections =
    solarRaycaster.intersectObjects(
      meshes,
      false,
    );

  if (intersections.length === 0) {
    return;
  }

  const hit =
    intersections[0].object;

  let selected = null;

  for (const [id, object] of solarSystemObjects) {
    let containsHit = false;

    object.traverse((child) => {
      if (child === hit) {
        containsHit = true;
      }
    });

    if (containsHit) {
      selected = object;
      break;
    }
  }

  if (!selected) return;

selectedSolarBody = selected;

const bodyId =
  selected.userData.bodyId;

console.log(
  'Selected solar body:',
  bodyId,
);

showSolarBodyInfo(bodyId);

focusSolarBody(selected);
}

function focusSolarBody(bodyObject) {
  if (!bodyObject) return;

  // Selection is handled visually and through the info panel.
  // Camera remains under normal Globe controls.
  console.log(
    'Solar body selected:',
    bodyObject.userData.bodyId,
  );
}

function showSolarBodyInfo(bodyId) {
  const info = SOLAR_BODY_INFO[bodyId];

  if (!info) return;

  const body = solarSystemBodies.find(
    (item) => item.id === bodyId,
  );

  let panel =
    document.getElementById(
      'solarBodyInfo',
    );

  if (!panel) {
    panel =
      document.createElement('div');

    panel.id = 'solarBodyInfo';

    panel.innerHTML = `
  <div class="solar-info-header">
    <span id="solarInfoName"></span>

    <button
      id="solarInfoClose"
      type="button"
    >
      ×
    </button>
  </div>

  <div
    id="solarInfoType"
    class="solar-info-type"
  ></div>

  <div class="solar-info-grid">
    <div>
      <span>Diameter</span>
      <strong id="solarInfoDiameter"></strong>
    </div>

    <div>
      <span>Distance from Sun</span>
      <strong id="solarInfoDistance"></strong>
    </div>

    <div>
      <span>Orbital Period</span>
      <strong id="solarInfoOrbit"></strong>
    </div>

    <div>
      <span>Rotation Period</span>
      <strong id="solarInfoRotation"></strong>
    </div>

    <div>
      <span>Position</span>
      <strong id="solarInfoPosition"></strong>
    </div>

    <div>
      <span>Velocity</span>
      <strong id="solarInfoVelocity"></strong>
    </div>
  </div>

  <div class="solar-info-scale">
    <strong>VISUAL SCALE</strong>
    Planet sizes and distances are exaggerated
    for visibility and are not to physical scale.
  </div>
`;  

    document.body.appendChild(panel);

    document
      .getElementById('solarInfoClose')
      .addEventListener(
        'click',
        () => {
          panel.classList.remove(
            'visible',
          );

          selectedSolarBody = null;
        },
      );
  }

  document.getElementById(
    'solarInfoName',
  ).textContent = info.name;

  document.getElementById(
    'solarInfoType',
  ).textContent = info.type;

  document.getElementById(
    'solarInfoDiameter',
  ).textContent = info.diameter;

  document.getElementById(
    'solarInfoDistance',
  ).textContent = info.distance;

  document.getElementById(
    'solarInfoOrbit',
  ).textContent = info.orbitalPeriod;

  document.getElementById(
    'solarInfoRotation',
  ).textContent = info.rotationPeriod;

  /*
   * Real API position and velocity.
   */
  if (body) {
    const distanceFromSun = Math.sqrt(
      body.x ** 2 +
      body.y ** 2 +
      body.z ** 2,
    );

    const positionText =
      `${body.x.toFixed(3)}, ` +
      `${body.y.toFixed(3)}, ` +
      `${body.z.toFixed(3)} AU`;

const velocityAUPerDay = Math.sqrt(
  body.vx ** 2 +
  body.vy ** 2 +
  body.vz ** 2,
);

const velocityKmPerSecond =
  velocityAUPerDay * 1731.4568;

const velocityText =
  `${velocityAUPerDay.toFixed(5)} AU/day\n` +
  `${velocityKmPerSecond.toFixed(2)} km/s`;

    document.getElementById(
      'solarInfoPosition',
    ).textContent = positionText;

    document.getElementById(
      'solarInfoVelocity',
    ).textContent = velocityText;

    document.getElementById(
      'solarInfoDistance',
    ).textContent =
      `${distanceFromSun.toFixed(3)} AU`;
  }

  panel.classList.add('visible');
}


function animateSolarSystem() {

  const now = performance.now();


  // Planet rotation
  for (const [id, object] of solarSystemObjects) {
    const speed =
      SOLAR_ROTATION_SPEEDS[id] || 0.002;

  object.rotation.y += speed * solarAnimationSpeed;

    // Hover scale
    const targetScale =
      object === hoveredSolarBody
        ? 1.12
        : 1.0;

    object.scale.x +=
      (targetScale - object.scale.x) * 0.12;

    object.scale.y +=
      (targetScale - object.scale.y) * 0.12;

    object.scale.z +=
      (targetScale - object.scale.z) * 0.12;

    // Earth cloud rotation
    if (
      id === 'earth' &&
      object.userData.cloudLayer
    ) {
      object.userData.cloudLayer.rotation.y +=
        speed * 0.35 * solarAnimationSpeed;
    }
  }

  // Moon orbit
  const earth =
    solarSystemObjects.get('earth');

  const moon =
    solarSystemObjects.get('moon');

  if (earth && moon) {
    const angle =
      now * MOON_ORBIT_SPEED * solarAnimationSpeed * 0.001;

    moon.position.set(
      earth.position.x +
        Math.cos(angle) * MOON_ORBIT_RADIUS,

      earth.position.y +
        Math.sin(angle * 0.35) * 3,

      earth.position.z +
        Math.sin(angle) * MOON_ORBIT_RADIUS,
    );
  }

  requestAnimationFrame(animateSolarSystem);
}

animateSolarSystem();


/*EARTH VISIBILITY */

/*
 * Earth View:
 *   Globe ON
 *   Earth intelligence ON
 *
 * Solar View:
 *   Globe OFF
 *   Earth intelligence OFF
 *
 * Journey View:
 *   Globe ON
 *   Earth intelligence ON
 *
 * IMPORTANT:
 * We do NOT modify the checkbox state.
 * We temporarily override rendering instead.
 */

function setEarthGlobeVisible(visible) {
  const material = world.globeMaterial();

  if (!material) {
    return;
  }

  material.transparent = !visible;
  material.opacity = visible ? 1 : 0;
  material.depthWrite = visible;

  world.showAtmosphere(visible);

  world.scene().traverse((obj) => {
    if (obj.isMesh && obj.material === material) {
      obj.visible = visible;
    }
  });
}

function setEarthDataVisible(visible) {
  /*
   * -------------------------------------------------------
   * PARTICLES
   * Aircraft + ships
   * -------------------------------------------------------
   *
   * A zeroed point size can still rasterize as a faint
   * 1px dot on some GPUs/drivers (WebGL enforces a minimum
   * point size). Toggle the whole Points object off too,
   * so there's nothing left for the GPU to draw at all.
   */

  if (particleSystem) {
    particleSystem.visible = visible;
  }

  if (
    particleGeometry &&
    particleGeometry.attributes &&
    particleGeometry.attributes.size
  ) {
    for (let i = 0; i < particleCount; i += 1) {
      const record = particleRecords[i];

      if (!record) {
        particleSizes[i] = 0;
        continue;
      }

      /*
       * Solar View:
       * absolutely zero particle size.
       *
       * This prevents tiny residual dots.
       */

      if (!visible) {
        particleSizes[i] = 0;
        continue;
      }

      particleSizes[i] =
        layerVisible[record.type] !== false
          ? record.baseSize * (record.id === selectedId ? 1.8 : 1)
          : 0;
    }

    particleGeometry.attributes.size.needsUpdate = true;
  }

  /*LOW VOLUME OBJECTS
   * Events / earthquakes / launches / disasters
   */

  if (!visible) {
    world.objectsData([]);
  } else if (typeof renderLowVolumeLayer === 'function') {
    renderLowVolumeLayer();
  }

  /*CUSTOM LAYERS
   * Satellites / GPS jam zonez
   */

  if (!visible) {
    world.customLayerData([]);
  } else if (typeof renderCustomLayer === 'function') {
    renderCustomLayer();
  }

  /* LABELS */

  if (!visible) {
    world.labelsData([]);
  } else if (typeof renderJamLabels === 'function') {
    renderJamLabels(lastJamRegions);
  }

  /*PATHS / TRAJECTORIES*/

  if (!visible) {
    world.pathsData([]);
  } else if (typeof renderTrackList === 'function') {
    renderTrackList();
  }
}

/*EARTH VIEW */

function showEarthView() {
  solarMode = SOLAR_MODES.EARTH;
  document.body.classList.remove('solar-mode');

  /*Solar System OFF*/

  solarSystemGroup.visible = false;

  /*Earth globe ON*/

  setEarthGlobeVisible(true);

  /*Earth intelligence ON*/

  setEarthDataVisible(true);

  /*Restore Earth controls*/

  world.controls().enabled = true;

  world.controls().autoRotate = true;

  world.controls().autoRotateSpeed = 0.25;

  /*
   * Return to normal Earth camera.
   */

  world.pointOfView(
    {
      lat: 20,
      lng: 30,
      altitude: 2.5,
    },
    1000,
  );

  console.log('Solar Mode: EARTH');
}

/*SOLAR VIEW */

function showSolarView() {
  solarMode = SOLAR_MODES.SOLAR;
  document.body.classList.add('solar-mode');

  selectedSolarBody = null;

  setEarthGlobeVisible(false);

  setEarthDataVisible(false);

  solarSystemGroup.visible = true;

  world.controls().autoRotate = false;

  world.controls().enabled = true;

  focusSolarSystem();

  console.log('Solar Mode: SOLAR');
}




// HISTORICAL MISSION JOURNEY ENGINE // 

const journeyState = {
    active: false,
    missionId: null,
    mission: null,
    currentTime: null,
    currentPhase: null,
    coordinateSystem: null,
    spacecraftPosition: null,
    trajectory: null,
};

window.journeyState = journeyState;
window.loadMissionDefinition = loadMissionDefinition;
window.loadMissionState = loadMissionState;
window.loadMissionTrajectory = loadMissionTrajectory;

//HISTORICAL MISSION SPACECRAFT MARKER// 

let historicalSpacecraftMarker = null;

function createHistoricalSpacecraftMarker() {
    if (historicalSpacecraftMarker) {
        return historicalSpacecraftMarker;
    }

    const geometry = new THREE.SphereGeometry(0.025, 16, 16);
    const material = new THREE.MeshBasicMaterial({
        color: 0xffff00
    });

    historicalSpacecraftMarker = new THREE.Mesh(
        geometry,
        material
    );

    historicalSpacecraftMarker.name =
        "Historical Mission Spacecraft";

    historicalSpacecraftMarker.visible = false;

    trajectoryGroup.add(historicalSpacecraftMarker);

    return historicalSpacecraftMarker;
}

window.createHistoricalSpacecraftMarker =
    createHistoricalSpacecraftMarker;

// HISTORICAL MISSION JOURNEY CONTROLLER// 

async function startHistoricalMissionJourney(missionId) {
    console.log("Starting historical mission journey:", missionId);

    try {
        // 1. Load mission definition
        const mission = await loadMissionDefinition(missionId);

        if (!mission) {
            throw new Error(`Mission definition unavailable: ${missionId}`);
        }

        // 2. Load historical trajectory
        const trajectory = await loadMissionTrajectory(missionId);

        if (!trajectory || !trajectory.available) {
            throw new Error(`Historical trajectory unavailable: ${missionId}`);
        }

        // 3. Determine initial journey time
        const firstPhase = mission.phases?.[0];

        if (!firstPhase) {
            throw new Error(`Mission has no phases: ${missionId}`);
        }

        const initialTime = firstPhase.start;

        // 4. Load mission state at the beginning
        const state = await loadMissionState(
            missionId,
            initialTime
        );

        if (!state) {
            throw new Error(`Mission state unavailable: ${missionId}`);
        }

        // 5. Activate Journey mode
        journeyState.active = true;

        // 6. Switch the visual scene to Journey mode
        showJourneyView();

        console.log("Historical mission journey started:", {
            missionId,
            time: journeyState.currentTime,
            phase: journeyState.currentPhase?.name,
            coordinateSystem: journeyState.coordinateSystem,
            spacecraftPosition: journeyState.spacecraftPosition,
        });

        return journeyState;

    } catch (error) {
        console.error(
            "Failed to start historical mission journey:",
            missionId,
            error
        );

        journeyState.active = false;

        return null;
    }
}

window.startHistoricalMissionJourney =
    startHistoricalMissionJourney;
  

async function loadMissionDefinition(missionId) {
    const mission = await fetchJSON(
    `http://localhost:8001/api/missions/${missionId}`,
    null
);

    if (!mission) {
        console.error("Failed to load mission:", missionId);
        return null;
    }

    journeyState.missionId = missionId;
    journeyState.mission = mission;

    console.log("Mission definition loaded:", mission);

    return mission;
}

async function loadMissionState(missionId, time) {
    const state = await fetchJSON(
        `http://localhost:8001/api/missions/${missionId}/state?time=${encodeURIComponent(time)}`,
        null
    );

    if (!state) {
        console.error(
            "Failed to load mission state:",
            missionId,
            time
        );
        return null;
    }

    journeyState.currentTime = state.time;
    journeyState.currentPhase = state.phase;
    journeyState.coordinateSystem = state.coordinate_system;
    journeyState.spacecraftPosition =
        state.spacecraft?.position || null;

    return state;
}


//HISTORICAL MISSION POSITION UPDATE// 

async function updateHistoricalMissionState(time) {
    if (!journeyState.active || !journeyState.missionId) {
        return null;
    }

    const state = await loadMissionState(
        journeyState.missionId,
        time
    );

    if (!state) {
        return null;
    }

    console.log("Journey state updated:", {
        time: journeyState.currentTime,
        phase: journeyState.currentPhase?.name,
        coordinateSystem: journeyState.coordinateSystem,
        spacecraftPosition: journeyState.spacecraftPosition,
    });

    return state;
}

window.updateHistoricalMissionState =
    updateHistoricalMissionState;

// HISTORICAL MISSION VIEW UPDATE
// 

async function updateHistoricalMissionView(time) {
    const state = await updateHistoricalMissionState(time);

    if (!state) {
        return null;
    }

    const coordinateSystem =
        journeyState.coordinateSystem;

    console.log(
        "Updating Journey view:",
        coordinateSystem
    );

    showJourneyView();

    return state;
}

window.updateHistoricalMissionView =
    updateHistoricalMissionView;

async function loadMissionTrajectory(missionId) {
    const trajectory = await fetchJSON(
        `http://localhost:8001/api/missions/${missionId}/trajectory`,
        null
    );

    if (!trajectory) {
        console.error(
            "Failed to load mission trajectory:",
            missionId
        );
        return null;
    }

    journeyState.trajectory = trajectory;

    console.log(
        "Mission trajectory loaded:",
        missionId,
        trajectory.points?.length,
        "points"
    );

    return trajectory;
}


function showJourneyView(options = {}) {
    solarMode = SOLAR_MODES.JOURNEY;

    setEarthGlobeVisible(true);
    setEarthDataVisible(true);

    if (journeyState.coordinateSystem === "earth-centered") {
        showEarthView();
        solarSystemGroup.visible = false;
    } else {
        solarSystemGroup.visible = true;
    }

    world.controls().autoRotate = false;

    if (typeof options.onStart === 'function') {
        options.onStart();
    }

    console.log(
        'Solar Mode: JOURNEY',
        journeyState.coordinateSystem
    );
}

/*PUBLIC MODE CONTROLLER */

function setSolarMode(mode, options = {}) {
  const status = document.getElementById('status');

  if (status) {
    if (mode === SOLAR_MODES.SOLAR) {
      status.textContent = 'MODE: SOLAR';
    } else if (mode === SOLAR_MODES.EARTH) {
      status.textContent = 'MODE: EARTH';
    }
  }

  if (!Object.values(SOLAR_MODES).includes(mode)) {
    console.warn(
      'Unknown Solar System mode:',
      mode,
    );
    return;
  }

  if (mode === SOLAR_MODES.EARTH) {
    showEarthView();
    return;
  }

  if (mode === SOLAR_MODES.SOLAR) {
    console.log(
      'SOLAR MODE: starting historical trajectory load',
    );

    showSolarView();

    loadHistoricalMissionTrajectory(
      'india-mangalyaan',
    );

    return;
  }

  if (mode === SOLAR_MODES.JOURNEY) {
    showJourneyView(options);
    return;
  }
}



/*SOLAR SYSTEM CAMERA */

function focusSolarSystem() {
  console.trace('focusSolarSystem() CALLED');

  if (solarSystemObjects.size === 0) {
    console.warn('Solar System: no objects to focus.');
    return;
  }

  /*Find outermost object*/

  let maxDistance = 0;

  for (const object of solarSystemObjects.values()) {
    const distance = object.position.length();

    if (Number.isFinite(distance)) {
      maxDistance = Math.max(maxDistance, distance);
    }
  }

  /*Camera must comfortably contain
   * Neptune and the other outer bodies.*/

const cameraDistance = Math.max(400, maxDistance * 1.35);

  const camera = world.camera();

  /*Slightly elevated heliocentric view. */

  camera.position.set(
    cameraDistance * 0.72,
    cameraDistance * 0.6,
    cameraDistance * 0.72,
  );

  camera.lookAt(0, 0, 0);

  world.controls().target.set(0, 0, 0);

  console.log('Solar System camera focused:', camera.position);
}

/*RETURN TO EARTH */

function returnToEarthView() {
  setSolarMode(SOLAR_MODES.EARTH);
}

/*PUBLIC API */

window.setSolarMode = setSolarMode;

window.returnToEarthView = returnToEarthView;

window.focusSolarSystem = focusSolarSystem;

/*MODE TOGGLE BUTTONS */

const btnEarthView = document.getElementById('btnEarthView');
const btnSolarView = document.getElementById('btnSolarView');

const solarSpeedSlider =
  document.getElementById('solarSpeedSlider');

const solarSpeedValue =
  document.getElementById('solarSpeedValue');

const btnToggleOrbits =
  document.getElementById('btnToggleOrbits');

const btnToggleLabels =
  document.getElementById('btnToggleLabels');

const btnToggleStars =
  document.getElementById('btnToggleStars');

const btnResetSolarView =
  document.getElementById('btnResetSolarView');

function setActiveModeButton(mode) {
  if (btnEarthView) {
    btnEarthView.classList.toggle('active', mode === SOLAR_MODES.EARTH);
  }

  if (btnSolarView) {
    btnSolarView.classList.toggle('active', mode === SOLAR_MODES.SOLAR);
  }
}

if (btnEarthView) {
  btnEarthView.addEventListener('click', () => {
    setSolarMode(SOLAR_MODES.EARTH);
    setActiveModeButton(SOLAR_MODES.EARTH);
  });
}

if (btnSolarView) {
  btnSolarView.addEventListener('click', () => {
    setSolarMode(SOLAR_MODES.SOLAR);
    setActiveModeButton(SOLAR_MODES.SOLAR);
  });
}

if (solarSpeedSlider) {
  solarSpeedSlider.addEventListener('input', () => {
    solarAnimationSpeed =
      Number(solarSpeedSlider.value);

    solarSpeedValue.textContent =
      `${solarAnimationSpeed.toFixed(1)}×`;
  });
}

if (btnToggleOrbits) {
  btnToggleOrbits.addEventListener('click', () => {
    solarOrbitsVisible =
      !solarOrbitsVisible;

    setSolarOrbitsVisible(
      solarOrbitsVisible,
    );

    btnToggleOrbits.textContent =
      `ORBITS: ${solarOrbitsVisible ? 'ON' : 'OFF'}`;
  });
}

if (btnToggleLabels) {
  btnToggleLabels.addEventListener('click', () => {
    solarLabelsVisible =
      !solarLabelsVisible;

    setSolarLabelsVisible(
      solarLabelsVisible,
    );

    btnToggleLabels.textContent =
      `LABELS: ${solarLabelsVisible ? 'ON' : 'OFF'}`;
  });
}

if (btnToggleStars) {
  btnToggleStars.addEventListener('click', () => {
    solarStarsVisible =
      !solarStarsVisible;

    setSolarStarsVisible(
      solarStarsVisible,
    );

    btnToggleStars.textContent =
      `STARS: ${solarStarsVisible ? 'ON' : 'OFF'}`;
  });
}

if (btnResetSolarView) {
  btnResetSolarView.addEventListener('click', () => {
    // Reset selection
    selectedSolarBody = null;
    hoveredSolarBody = null;

    // Reset animation speed
    solarAnimationSpeed = 1.0;

    if (solarSpeedSlider) {
      solarSpeedSlider.value = 1;
    }

    if (solarSpeedValue) {
      solarSpeedValue.textContent = '1.0×';
    }

    // Reset orbits
    setSolarOrbitsVisible(true);

    if (btnToggleOrbits) {
      btnToggleOrbits.textContent = 'ORBITS: ON';
    }

    // Reset labels
    setSolarLabelsVisible(true);

    if (btnToggleLabels) {
      btnToggleLabels.textContent = 'LABELS: ON';
    }

    // Reset stars
    setSolarStarsVisible(true);

    if (btnToggleStars) {
      btnToggleStars.textContent = 'STARS: ON';
    }

    // Reset camera and Solar mode
    setSolarMode(SOLAR_MODES.SOLAR);
    setActiveModeButton(SOLAR_MODES.SOLAR);

    focusSolarSystem();
  });
}

/*SOLAR SYSTEM LOADING */

async function loadSolarSystem() {
  try {
    const response = await fetch(SOLAR_SYSTEM_API, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Solar System API returned ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data.bodies)) {
      throw new Error('Solar System API returned no bodies array');
    }

    updateSolarSystemBodies(data.bodies);

    console.log(`Solar System: rendered ${data.bodies.length} bodies.`);

    /*If Solar View was selected before the API
     * finished loading, focus the system now.*/
if (
  solarMode === SOLAR_MODES.SOLAR &&
  !selectedSolarBody
) {
  solarSystemGroup.visible = true;
  focusSolarSystem();
}
  } catch (error) {
    console.error('Solar System frontend load failed:', error);
  }
}

/*PUBLIC API */

window.setSolarMode = setSolarMode;

window.returnToEarthView = returnToEarthView;

window.focusSolarSystem = focusSolarSystem;

/* =========================================================
   SOLAR SYSTEM DEBUG
========================================================= */

window.solarSystemDebug = function () {
  console.log('================================');

  console.log('SOLAR SYSTEM DEBUG');

  console.log('Mode:', solarMode);

  console.log('Bodies:', solarSystemBodies.length);

  console.log('Objects:', solarSystemObjects.size);

  console.log('Group visible:', solarSystemGroup.visible);

  console.log('Globe radius:', world.getGlobeRadius());

  console.log('Camera:', world.camera().position);

  console.log('Camera distance:', world.camera().position.length());

  for (const [id, object] of solarSystemObjects) {
    console.log(id, {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
      distance: object.position.length(),
      visible: object.visible,
    });
  }

  console.log('================================');
};

/* =========================================================
   INITIALISE
========================================================= */

loadSolarSystem();

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

    starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);

    starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);

    starPositions[i * 3 + 2] = radius * Math.cos(phi);
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

  world.scene().add(new THREE.Points(geometry, material));
}

addStarfield();

/* =========================================================
   PARTICLE SYSTEM
   AIRCRAFT + SHIPS
========================================================= */

const particlePositions = new Float32Array(MAX_PARTICLES * 3);

const particleColors = new Float32Array(MAX_PARTICLES * 3);

const particleSizes = new Float32Array(MAX_PARTICLES);

const startPositions = new Float32Array(MAX_PARTICLES * 3);

const targetPositions = new Float32Array(MAX_PARTICLES * 3);

const particleGeometry = new THREE.BufferGeometry();

particleGeometry.setAttribute(
  'position',
  new THREE.BufferAttribute(particlePositions, 3),
);

particleGeometry.setAttribute(
  'color',
  new THREE.BufferAttribute(particleColors, 3),
);

particleGeometry.setAttribute(
  'size',
  new THREE.BufferAttribute(particleSizes, 1),
);

particleGeometry.setDrawRange(0, 0);

const particleMaterial = new THREE.ShaderMaterial({
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

const particleSystem = new THREE.Points(particleGeometry, particleMaterial);

world.scene().add(particleSystem);

/* =========================================================
   LAYER VISIBILITY
========================================================= */

function applyVisibility() {
  for (let i = 0; i < particleCount; i += 1) {
    const record = particleRecords[i];

    if (!record) {
      particleSizes[i] = 0;
      continue;
    }

    const visible =
      earthDataShouldRender() && layerVisible[record.type] !== false;

    particleSizes[i] = visible
      ? record.baseSize * (record.id === selectedId ? 1.8 : 1)
      : 0;
  }

  particleGeometry.attributes.size.needsUpdate = true;
}

const legendInputs = document.querySelectorAll(
  '#legend input[type="checkbox"]',
);

legendInputs.forEach((element) => {
  element.addEventListener('change', () => {
    const layer = element.dataset.layer;

    if (layer && Object.prototype.hasOwnProperty.call(layerVisible, layer)) {
      layerVisible[layer] = element.checked;
    }

    applyVisibility();

    if (earthDataShouldRender()) {
      renderLowVolumeLayer();
      renderCustomLayer();
      renderTrackList();
    }
  });
});

/* DATA REFRESH */

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
    fetchJSON('http://localhost:8001/api/events', {
      features: [],
      source: 'local_fallback',
    }),

    fetchJSON('http://localhost:8001/api/ships', {
      ships: [],
    }),

    fetchJSON('http://localhost:8001/api/flights', {
      flights: [],
    }),

    fetchJSON('http://localhost:8001/api/earthquakes', {
      earthquakes: [],
    }),

    loadGpsIntegrity(),
    loadLaunches(),
    loadChokepointRisk(),
    loadDisasters(),
  ]);

  /*EVENTS */

  const events = (eventsGeo.features || [])
    .map((feature, index) => {
      const coordinates = feature.geometry && feature.geometry.coordinates;

      if (!coordinates || coordinates.length < 2) {
        return null;
      }

      const lng = safeNumber(coordinates[0]);

      const lat = safeNumber(coordinates[1]);

      if (lat === null || lng === null) {
        return null;
      }

      return {
        id: `event-${index}`,
        type: 'event',
        lat,
        lng,
        name: feature.properties?.name || 'Unnamed location',
        count: feature.properties?.count || 1,
        source: eventsGeo.source,
      };
    })
    .filter(Boolean);

  /* -------------------------------------------------------
     EARTHQUAKES
  ------------------------------------------------------- */

  const quakes = (quakesData.earthquakes || [])
    .map((quake, index) => ({
      id: `quake-${index}`,
      type: 'quake',
      lat: safeNumber(quake.lat),
      lng: safeNumber(quake.lon),
      name: quake.place || 'Unknown location',
      mag: quake.mag,
      depth: quake.depth_km,
    }))
    .filter((quake) => quake.lat !== null && quake.lng !== null);

  /* -------------------------------------------------------
     SHIPS
  ------------------------------------------------------- */

  const ships = (shipsData.ships || [])
    .map((ship) => ({
      id: `ship-${ship.mmsi}`,
      type: 'ship',

      // Position
      lat: safeNumber(ship.lat),
      lng: safeNumber(ship.lon),

      // Identification
      name: ship.name || 'Unknown vessel',
      mmsi: ship.mmsi,
      imo: ship.imo,

      // Movement
      speed: safeNumber(ship.speed),
      course: safeNumber(ship.course),
      heading: safeNumber(ship.heading),

      // Vessel information
      shipType: ship.ship_type,
      destination: ship.destination,
      eta: ship.eta,
      draught: safeNumber(ship.draught),

      // Navigation
      navigationStatus: ship.navigation_status,
    }))
    .filter((ship) => ship.lat !== null && ship.lng !== null);

  /* -------------------------------------------------------
     FLIGHTS
  ------------------------------------------------------- */

  const flights = (flightsData.flights || [])
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
    .filter((flight) => flight.lat !== null && flight.lng !== null);

  updateParticles([...ships, ...flights]);

  lowVolumeData = {
    events,
    quakes,
    launches,
    disasters,
  };

  lastJamRegions = Array.isArray(jamRegions) ? jamRegions : [];

  lastChokepointRisk = Object.fromEntries(
    (Array.isArray(chokepointRisk) ? chokepointRisk : []).map((item) => [
      item.region,
      item,
    ]),
  );

  renderLowVolumeLayer();
  renderJamLabels(lastJamRegions);
  renderCustomLayer();
  updateAllTracks();
  renderTrackList();

  const eventSourceLabel =
    eventsGeo.source === 'live_gdelt' ? 'LIVE' : 'SAMPLE';

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

/* PARTICLE UPDATE */

function updateParticles(records) {
  const count = Math.min(records.length, MAX_PARTICLES);

  const now = performance.now();

  const elapsed = Math.min((now - animStart) / ANIM_DURATION, 1);

  const newRecords = [];

  for (let i = 0; i < count; i += 1) {
    const record = records[i];

    const coords = world.getCoords(record.lat, record.lng, 0.01);

    const previous = previousById.get(record.id);

    let startX;
    let startY;
    let startZ;

    if (previous) {
      startX =
        previous.start.x + (previous.target.x - previous.start.x) * elapsed;

      startY =
        previous.start.y + (previous.target.y - previous.start.y) * elapsed;

      startZ =
        previous.start.z + (previous.target.z - previous.start.z) * elapsed;
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

    newRecords.push(newRecord);

    startPositions[i * 3] = startX;

    startPositions[i * 3 + 1] = startY;

    startPositions[i * 3 + 2] = startZ;

    targetPositions[i * 3] = coords.x;

    targetPositions[i * 3 + 1] = coords.y;

    targetPositions[i * 3 + 2] = coords.z;

    const colorHex =
      record.id === selectedId
        ? 0xffffff
        : COLORS[record.type] || COLORS.satellite;

    const [red, green, blue] = tintColor(colorHex);

    particleColors[i * 3] = red;

    particleColors[i * 3 + 1] = green;

    particleColors[i * 3 + 2] = blue;

    particleSizes[i] =
      earthDataShouldRender() && layerVisible[record.type] !== false
        ? baseSize * (record.id === selectedId ? 1.8 : 1)
        : 0;
  }

  particleRecords = newRecords;

  particleCount = count;

  particleGeometry.setDrawRange(0, count);

  particleGeometry.attributes.color.needsUpdate = true;

  particleGeometry.attributes.size.needsUpdate = true;

  previousById.clear();

  newRecords.forEach((record) => {
    previousById.set(record.id, record);
  });

  animStart = now;
}

/* =========================================================
   PARTICLE HIGHLIGHT
========================================================= */

function reapplyParticleHighlight() {
  for (let i = 0; i < particleCount; i += 1) {
    const record = particleRecords[i];

    if (!record) {
      continue;
    }

    const colorHex =
      record.id === selectedId
        ? 0xffffff
        : COLORS[record.type] || COLORS.satellite;

    const [red, green, blue] = tintColor(colorHex);

    particleColors[i * 3] = red;

    particleColors[i * 3 + 1] = green;

    particleColors[i * 3 + 2] = blue;

    particleSizes[i] =
      earthDataShouldRender() && layerVisible[record.type] !== false
        ? record.baseSize * (record.id === selectedId ? 1.8 : 1)
        : 0;
  }

  particleGeometry.attributes.color.needsUpdate = true;

  particleGeometry.attributes.size.needsUpdate = true;
}

/* =========================================================
   PARTICLE ANIMATION
========================================================= */

function animateParticles() {
  requestAnimationFrame(animateParticles);

  if (particleCount === 0) {
    return;
  }

  const time = Math.min((performance.now() - animStart) / ANIM_DURATION, 1);

  const eased = time < 1 ? 1 - Math.pow(1 - time, 3) : 1;

  for (let i = 0; i < particleCount; i += 1) {
    particlePositions[i * 3] =
      startPositions[i * 3] +
      (targetPositions[i * 3] - startPositions[i * 3]) * eased;

    particlePositions[i * 3 + 1] =
      startPositions[i * 3 + 1] +
      (targetPositions[i * 3 + 1] - startPositions[i * 3 + 1]) * eased;

    particlePositions[i * 3 + 2] =
      startPositions[i * 3 + 2] +
      (targetPositions[i * 3 + 2] - startPositions[i * 3 + 2]) * eased;
  }

  particleGeometry.attributes.position.needsUpdate = true;
}

animateParticles();

/* =========================================================
   LOW-VOLUME OBJECTS
   EVENTS + EARTHQUAKES + LAUNCHES + DISASTERS
========================================================= */

function renderLowVolumeLayer() {
  if (!earthDataShouldRender()) {
    world.objectsData([]);
    return;
  }

  const combined = [
    ...(layerVisible.event ? lowVolumeData.events : []),

    ...(layerVisible.quake ? lowVolumeData.quakes : []),

    ...(layerVisible.launch ? lowVolumeData.launches : []),

    ...(layerVisible.disaster ? lowVolumeData.disasters : []),
  ];

  world
    .objectsData(combined)
    .objectLat('lat')
    .objectLng('lng')
    .objectAltitude(0.01)

    .objectThreeObject((data) => {
      const isSelected = data.id === selectedId;

      let visibleRadius;

      if (data.type === 'quake') {
        visibleRadius = Math.min(0.4 + (Number(data.mag) || 1) * 0.3, 2.4);
      } else if (data.type === 'launch') {
        visibleRadius = 1.2;
      } else if (data.type === 'disaster') {
        visibleRadius = 1.3;
      } else {
        visibleRadius = Math.min(0.5 + (Number(data.count) || 1) * 0.05, 1.8);
      }

      const group = new THREE.Group();

      const geometry = new THREE.SphereGeometry(
        isSelected ? visibleRadius * 1.6 : visibleRadius,
        8,
        8,
      );

      const material = new THREE.MeshBasicMaterial({
        color: isSelected ? 0xffffff : COLORS[data.type] || COLORS.event,
      });

      group.add(new THREE.Mesh(geometry, material));

      const hitGeometry = new THREE.SphereGeometry(visibleRadius * 5, 8, 8);

      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });

      group.add(new THREE.Mesh(hitGeometry, hitMaterial));

      return group;
    })

    .onObjectClick((data) => {
      selectTrack(data, {
        flyTo: false,
      });
    });
}

/*SATELLITE TLE LOADING */

async function loadSatelliteTLEs() {
  try {
    const response = await fetch('http://localhost:8001/api/satellites/tle');

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    satRecs = (data.satellites || [])
      .map((record) => {
        try {
          if (!record.line1 || !record.line2) {
            return null;
          }

          const rec = satellite.twoline2satrec(
  record.line1,
  record.line2,
);

return {
  id: `sat-${record.name}`,
  name: record.name || 'Unknown satellite',
  group: record.group || 'Unknown',

  line1: record.line1,
  line2: record.line2,

  rec,
};
        } catch (error) {
          console.warn('Invalid satellite TLE:', record, error);

          return null;
        }
      })
      .filter(Boolean);

    console.log(`Loaded ${satRecs.length} satellites for propagation.`);
  } catch (error) {
    console.error('Satellite TLE fetch failed:', error);

    satRecs = [];
    satPositions = [];
  }
}

/*SATELLITE PROPAGATION */

function propagateSatellites() {
  const now = new Date();

  const gmst = satellite.gstime(now);

  const positions = [];

  for (const record of satRecs) {
    try {
      const pv = satellite.propagate(record.rec, now);

      if (!pv || !pv.position) {
        continue;
      }

      const geo = satellite.eciToGeodetic(pv.position, gmst);

      const altKm = Number(geo.height);

      const lat = satellite.degreesLat(geo.latitude);

      const lng = satellite.degreesLong(geo.longitude);

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
  rec: record.rec,
  lat,
  lng,
  altKm,
  altFraction: (altKm / EARTH_RADIUS_KM) * 1.8,
});
    } catch (error) {
      continue;
    }
  }

  satPositions = positions;

  updateAllTracks();
  renderCustomLayer();
  renderTrackList();

if (
  selectedId &&
  selectedId.startsWith('sat-')
) {
  const selectedSatellite =
    satPositions.find(
      (sat) => sat.id === selectedId,
    );

  if (selectedSatellite) {
    updateSatelliteJourneyProgress(
      selectedSatellite,
    );

    showPanel(selectedSatellite);
  }
} 

  if (statusEl) {
    const current = statusEl.textContent || '';

    statusEl.textContent = current.replace(
      /\d+ satellites/,
      `${satPositions.length} satellites`,
    );
  }
}

/*CUSTOM LAYER
  SATELLITES + GPS JAM ZONES */

function renderCustomLayer() {
  if (!earthDataShouldRender()) {
    world.customLayerData([]);
    return;
  }

  const satelliteData = layerVisible.satellite ? satPositions : [];

  const jamData = layerVisible.satellite
    ? lastJamRegions.map((region) => ({
        ...region,
        id: `jam-${region.region}`,
        type: 'jam',
      }))
    : [];

  const combined = [...satelliteData, ...jamData];

  world
    .customLayerData(combined)

    .customThreeObject((data) => {
      /* -------------------------------------------------
           SATELLITE
        ------------------------------------------------- */

      if (data.type === 'satellite') {
  const isSelected = data.id === selectedId;

  // Hide the original Globe marker while journey mode is active.
  if (isSelected) {
    return new THREE.Group();
  }

  const group = new THREE.Group();

        // Bright satellite core
        const coreGeometry = new THREE.SphereGeometry(
          isSelected ? 1.4 : 0.8,
          8,
          8,
        );

        const coreMaterial = new THREE.MeshBasicMaterial({
          color: isSelected ? 0xffffff : COLORS.satellite,
        });

        group.add(new THREE.Mesh(coreGeometry, coreMaterial));

        // Outer glow
        const glowGeometry = new THREE.SphereGeometry(
          isSelected ? 3.2 : 2.2,
          16,
          16,
        );

        const glowMaterial = new THREE.MeshBasicMaterial({
          color: isSelected ? 0xffffff : COLORS.satellite,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
        });

        group.add(new THREE.Mesh(glowGeometry, glowMaterial));

        return group;
      }

      /* GPS JAM ZONE */

      const isSelected = data.id === selectedId;

      const color = isSelected ? 0xffffff : jamColor(data.jam_score);

      const group = new THREE.Group();

      const radius =
        (4 + (Number(data.jam_score) / 100) * 10) * (isSelected ? 1.3 : 1);

      const domeGeometry = new THREE.SphereGeometry(
        radius,
        20,
        10,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      );

      const domeMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: isSelected ? 0.5 : 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      group.add(new THREE.Mesh(domeGeometry, domeMaterial));

      const ringGeometry = new THREE.RingGeometry(radius * 0.96, radius, 40);

      const ringMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const ring = new THREE.Mesh(ringGeometry, ringMaterial);

      ring.rotation.x = -Math.PI / 2;

      group.add(ring);

      const coreGeometry = new THREE.SphereGeometry(1.2, 12, 12);

      const coreMaterial = new THREE.MeshBasicMaterial({
        color,
      });

      group.add(new THREE.Mesh(coreGeometry, coreMaterial));

      return group;
    })

    .customThreeObjectUpdate((object, data) => {
      /*SATELLITE POSITION */

      if (data.type === 'satellite') {
        Object.assign(
          object.position,
          world.getCoords(data.lat, data.lng, data.altFraction),
        );

        return;
      }

      /* -----------------------------------------------
           JAM ZONE POSITION
        ----------------------------------------------- */

      Object.assign(object.position, world.getCoords(data.lat, data.lon, 0.03));
    })

    .onCustomLayerClick((data) => {
      if (data.type === 'satellite') {
        selectTrack(data, {
          flyTo: false,
        });

        return;
      }

      if (data.type === 'jam') {
        selectJamZone(data);
      }
    });

}

/*GPS JAM ZONES */

function jamColor(score) {
  const value = Number(score) || 0;

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
  if (!earthDataShouldRender()) {
    world.labelsData([]);
    return;
  }

  world
    .labelsData(regions || [])
    .labelLat('lat')
    .labelLng('lon')

    .labelText(
      (data) =>
        `${String(data.region || '')
          .replace(/_/g, ' ')
          .toUpperCase()} · ${data.jam_score ?? 0}%`,
    )

    .labelSize(1.1)

    .labelColor((data) => colorToCss(jamColor(data.jam_score)))

    .labelDotRadius(0)
    .labelAltitude(0.06)
    .labelResolution(2);
}

function selectJamZone(data) {
  selectedId = `jam-${data.region}`;

  showJamPanel(data);

  reapplyParticleHighlight();
  renderLowVolumeLayer();
  renderCustomLayer();

  renderPath([], '#ffffff');
}

function showJamPanel(data) {
  if (!panelContentEl || !panelEl) {
    return;
  }

  const regionName = String(data.region || '')
    .replace(/_/g, ' ')
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
        ${escapeHtml(data.jam_score)}/100
      </span>
    </div>

    <div class="panel-row">
      <span class="label">
        Aircraft sampled
      </span>

      <span>
        ${escapeHtml(data.sample_count)}
      </span>
    </div>

    <div class="panel-row">
      <span class="label">
        Avg NIC
      </span>

      <span>
        ${escapeHtml(data.avg_nic)}
      </span>
    </div>

    <div class="panel-row">
      <span class="label">
        % degraded (NIC&lt;7)
      </span>

      <span>
        ${escapeHtml(data.pct_degraded)}%
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

  panelEl.classList.remove('hidden');
}

/* TRACK PATHS */

function renderPath(historyPoints, colorHex) {
  const path = (historyPoints || [])
    .map((point) => {
      const lat = safeNumber(point.lat);

      const lon = safeNumber(point.lon ?? point.lng);

      if (lat === null || lon === null) {
        return null;
      }

      return [lat, lon];
    })
    .filter(Boolean);

  world
    .pathsData(path.length > 1 ? [path] : [])

    .pathPointLat((point) => point[0])

    .pathPointLng((point) => point[1])

    .pathPointAlt(0.015)

    .pathColor(() => colorHex)

    .pathStroke(2.5)

    .pathDashLength(0.4)

    .pathDashGap(0.15)

    .pathDashAnimateTime(2500);
}

async function loadHistorical(year) {
  try {
    const res = await fetch(
      `http://localhost:8001/api/historical?up_to_year=${year}`,
    );
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

async function loadHistoryFor(track) {
  if (track.type === 'ship') {
    const data = await fetchJSON(
      `http://localhost:8001/api/ships/${encodeURIComponent(
        track.mmsi,
      )}/history`,
      {
        history: [],
      },
    );

    return data.history || [];
  }

  if (track.type === 'flight') {
    const data = await fetchJSON(
      `http://localhost:8001/api/flights/${encodeURIComponent(
        track.icao24,
      )}/history`,
      {
        history: [],
      },
    );

    return data.history || [];
  }

  return [];
}


function renderSatelliteOrbit(track) {
  if (
    !track ||
    track.type !== 'satellite' ||
    !track.rec
  ) {
    renderPath([], '#ffffff');
    return;
  }

  const orbitPoints = [];
  const now = new Date();

  const meanMotion = Number(track.rec.no);

  if (
    !Number.isFinite(meanMotion) ||
    meanMotion <= 0
  ) {
    renderPath([], '#ffffff');
    return;
  }

  const orbitalPeriodMinutes =
    (2 * Math.PI) / meanMotion;

  const samples = 180;

  for (let i = 0; i <= samples; i++) {
    const time = new Date(
      now.getTime() +
      (
        (i / samples) *
        orbitalPeriodMinutes
      ) *
      60 *
      1000,
    );

    try {
      const gmst =
        satellite.gstime(time);

      const pv =
        satellite.propagate(
          track.rec,
          time,
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

      const lat =
        satellite.degreesLat(
          geo.latitude,
        );

      const lng =
        satellite.degreesLong(
          geo.longitude,
        );

      const altKm =
        Number(geo.height);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        !Number.isFinite(altKm)
      ) {
        continue;
      }

      orbitPoints.push({
        lat,
        lng,
        altKm,
      });

    } catch (error) {
      continue;
    }
  }

  if (orbitPoints.length < 2) {
    renderPath([], '#ffffff');
    return;
  }

  /*
   * Save the orbit.
   */
  satelliteOrbitPath = orbitPoints;

  /*
   * Draw the actual 3D orbit.
   */
  world
    .pathsData([orbitPoints])
    .pathPointLat(
      point => point.lat,
    )
    .pathPointLng(
      point => point.lng,
    )
    .pathPointAlt(
      point =>
        (point.altKm / EARTH_RADIUS_KM) * 1.8,
    )
    .pathColor(
      () => '#ffffff',
    )
    .pathStroke(2.5)
    .pathDashLength(0.4)
    .pathDashGap(0.15)
    .pathDashAnimateTime(2500);
}

function renderSatelliteGroundTrackLine() {
  // Remove the previous ground track
  if (satelliteGroundTrackLine) {
    world.scene().remove(satelliteGroundTrackLine);
    satelliteGroundTrackLine.geometry.dispose();
    satelliteGroundTrackLine.material.dispose();
    satelliteGroundTrackLine = null;
  }

  if (satelliteGroundTrack.length < 2) {
    return;
  }

  const points = satelliteGroundTrack.map((point) => {
    return world.getCoords(
      point.lat,
      point.lng,
      0.02,
    );
  });

  const geometry =
    new THREE.BufferGeometry().setFromPoints(
      points,
    );

  const material =
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
    });

  satelliteGroundTrackLine =
    new THREE.Line(
      geometry,
      material,
    );

  world.scene().add(
    satelliteGroundTrackLine,
  );
}

function updateSatelliteJourneyProgress(track) {
  if (
    !track ||
    track.type !== 'satellite' ||
    satelliteOrbitPath.length < 2
  ) {
    satelliteJourneyProgress = 0;
    return;
  }

  let closestIndex = 0;
  let closestDistance = Infinity;

  for (
    let i = 0;
    i < satelliteOrbitPath.length;
    i++
  ) {
    const point = satelliteOrbitPath[i];

    const latDiff =
      point.lat - track.lat;

    const lngDiff =
      point.lng - track.lng;

    const distance =
      latDiff * latDiff +
      lngDiff * lngDiff;

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  }

  satelliteJourneyProgress =
    closestIndex /
    (satelliteOrbitPath.length - 1);
}

function getAnimatedSatelliteJourneyProgress() {
  if (!satelliteJourneyStartTime) {
    return 0;
  }

  const elapsed =
    performance.now() -
    satelliteJourneyStartTime;

  const duration = 30000;

  return (
    (elapsed % duration) /duration
  );
}


function updateSatelliteJourneyMarker() {
  if (
    !satelliteJourneyMarker ||
    satelliteOrbitPath.length < 2
  ) {
    return;
  }

  const progress =
    getAnimatedSatelliteJourneyProgress();

  const exactIndex =
    progress *
    (satelliteOrbitPath.length - 1);

  const index =
    Math.floor(exactIndex);

  const nextIndex =
    Math.min(
      index + 1,
      satelliteOrbitPath.length - 1,
    );

  const point =
    satelliteOrbitPath[index];

  const nextPoint =
    satelliteOrbitPath[nextIndex];

  if (!point || !nextPoint) {
    return;
  }

  const fraction =
    exactIndex - index;

  const lat =
    point.lat +
    (nextPoint.lat - point.lat) *
      fraction;

  const lng =
    point.lng +
    (nextPoint.lng - point.lng) *
      fraction;

  const altKm =
    point.altKm +
    (nextPoint.altKm - point.altKm) *
      fraction;

  const altitude =
    (altKm / EARTH_RADIUS_KM) * 1.8;

  const position =
    world.getCoords(
      lat,
      lng,
      altitude,
    );

  satelliteJourneyMarker.position.copy(
    position,
  );
}

function updateSatelliteJourneyCamera() {
  if (
    !satelliteJourneyMarker ||
    !world
  ) {
    return;
  }

  const camera =
    world.camera();

  if (!camera) {
    return;
  }

  const target =
    satelliteJourneyMarker.position;

  const direction =
    target.clone().normalize();

  const desiredPosition =
    direction.multiplyScalar(
      target.length() + 180,
    );

  camera.position.x +=
    (desiredPosition.x - camera.position.x) * 0.015;

  camera.position.y +=
    (desiredPosition.y - camera.position.y) * 0.015;

  camera.position.z +=
    (desiredPosition.z - camera.position.z) * 0.015;
}

function createSatelliteJourneyMarker() {
  if (satelliteJourneyMarker) {
    world.scene().remove(
      satelliteJourneyMarker,
    );

    satelliteJourneyMarker.geometry.dispose();
    satelliteJourneyMarker.material.dispose();

    satelliteJourneyMarker = null;
  }

  const geometry =
    new THREE.SphereGeometry(
      1.8,
      12,
      12,
    );

  const material =
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });

  satelliteJourneyMarker =
    new THREE.Mesh(
      geometry,
      material,
    );

  world.scene().add(
    satelliteJourneyMarker,
  );

  updateSatelliteJourneyMarker();
}

function startSatelliteJourneyAnimation() {
  if (satelliteJourneyAnimationId) {
    cancelAnimationFrame(
      satelliteJourneyAnimationId,
    );
  }

  function animate() {
    if (
      !selectedId ||
      !selectedId.startsWith('sat-')
    ) {
      satelliteJourneyAnimationId = null;
      return;
    }

    const progress =
      getAnimatedSatelliteJourneyProgress();

    const percent =
      Math.round(progress * 100);

    const progressBar =
      document.querySelector(
        '.journey-progress',
      );

    const percentText =
      document.querySelector(
        '.journey-percent',
      );

    if (progressBar) {
      progressBar.style.width =
        `${percent}%`;
    }

    if (percentText) {
      percentText.textContent =
        `${percent}% COMPLETE`;
    }

    updateSatelliteJourneyMarker();
    updateSatelliteJourneyCamera();

    satelliteJourneyAnimationId =
      requestAnimationFrame(
        animate,
      );
  }

  animate();
}

function renderSatelliteGroundTrack(track) {
  if (
    !track ||
    track.type !== 'satellite' ||
    !track.rec
  ) {
    satelliteGroundTrack = [];
    return;
  }

  const groundPoints = [];
  const now = new Date();

  const meanMotion = Number(track.rec.no);

  if (
    !Number.isFinite(meanMotion) ||
    meanMotion <= 0
  ) {
    satelliteGroundTrack = [];
    return;
  }

  const orbitalPeriodMinutes =
    (2 * Math.PI) / meanMotion;

  const samples = 180;

  for (let i = 0; i <= samples; i++) {
    const time = new Date(
      now.getTime() +
      (
        (i / samples) *
        orbitalPeriodMinutes
      ) *
      60 *
      1000,
    );

    try {
      const gmst =
        satellite.gstime(time);

      const pv =
        satellite.propagate(
          track.rec,
          time,
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

      const lat =
        satellite.degreesLat(
          geo.latitude,
        );

      const lng =
        satellite.degreesLong(
          geo.longitude,
        );

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        continue;
      }

      groundPoints.push({
        lat,
        lng,
      });

    } catch (error) {
      continue;
    }
  }

  satelliteGroundTrack = groundPoints;
}

/*TRACK SELECTION */

async function selectTrack(
  track,
  { flyTo = false } = {},
) {
  if (!track) {
    return;
  }

  selectedId = track.id;

  showPanel(track);

  reapplyParticleHighlight();
  renderLowVolumeLayer();
  renderCustomLayer();

/* SATELLITE */
if (track.type === 'satellite') {
  renderSatelliteOrbit(track);
  renderSatelliteGroundTrack(track);
  renderSatelliteGroundTrackLine();

  satelliteJourneyStartTime =
    performance.now();
    
  updateSatelliteJourneyProgress(track);

  createSatelliteJourneyMarker();

  startSatelliteJourneyAnimation();

/* SHIP / FLIGHT */
} else if (
  track.type === 'ship' ||
  track.type === 'flight'
) {
    const colorHex =
      colorToCss(
        COLORS[track.type] ||
        COLORS.satellite,
      );

    const history =
      await loadHistoryFor(track);

    renderPath(
      history,
      colorHex,
    );

   } else if (track.type === 'launch') {
    renderPath([], '#ffffff');

    try {
      const details = await fetchJSON(
        `http://localhost:8001/api/launches/${track.id}/details`,
        null,
      );

      console.log('Launch details:', details);

      // Store detailed launch information for later trajectory integration.
      if (details) {
        track.details = details;
      }

    } catch (error) {
      console.warn('Launch details unavailable:', error);
    }
  }
  
  else {
    renderPath(
      [],
      '#ffffff',
    );
  }

 if (
  Number.isFinite(track.lat) &&
  Number.isFinite(track.lng)
) {

  if (track.type === 'satellite') {

    /*Bring the selected satellite into the centre of the viewport.
    Higher altitude gives us enough distance to see the orbital path around Earth.*/
    
    world.pointOfView(
      {
        lat: track.lat,
        lng: track.lng,
        altitude: 2.8,
      },
      1200,
    );

  } else if (flyTo) {

    world.pointOfView(
      {
        lat: track.lat,
        lng: track.lng,
        altitude: 0.6,
      },
      1200,
    );
  }
}
}

function clearSelection() {
  selectedId = null;

  reapplyParticleHighlight();
  renderLowVolumeLayer();
  renderCustomLayer();

  renderPath([], '#ffffff');
}

/*INFO PANEL */

function showPanel(data) {
  if (!panelContentEl || !panelEl) {
    return;
  }

  const rows = [];
  let journeyPercent = 0;

  let title = data.name || 'Unknown';

  let typeLabel = '';

  /* EVENT */

  if (data.type === 'event') {
    typeLabel = 'GEOPOLITICAL EVENT';

    rows.push(['Related articles', data.count]);

    rows.push([
      'Source',
      data.source === 'live_gdelt' ? 'GDELT (live)' : 'Sample data',
    ]);
  }

  /* -------------------------------------------------------
     SHIP
  ------------------------------------------------------- */
  else if (data.type === 'ship') {
    typeLabel = 'VESSEL (AIS)';

    rows.push(['MMSI', data.mmsi]);

    rows.push(['IMO', data.imo ?? 'Unknown']);

    rows.push(['Type', getShipTypeLabel(data.shipType)]);

    rows.push(['Status', getNavigationStatusLabel(data.navigationStatus)]);

    rows.push([
      'Speed',
      data.speed != null ? `${data.speed.toFixed(1)} kn` : 'Unknown',
    ]);

    rows.push([
      'Course',
      data.course != null ? `${Math.round(data.course)}°` : 'Unknown',
    ]);

    rows.push([
      'Heading',
      data.heading != null ? `${Math.round(data.heading)}°` : 'Unknown',
    ]);

    rows.push(['Latitude', safeNumber(data.lat)?.toFixed(4) ?? 'Unknown']);

    rows.push(['Longitude', safeNumber(data.lng)?.toFixed(4) ?? 'Unknown']);

    rows.push(['Destination', data.destination || 'Unknown']);

    rows.push(['ETA', formatAISeta(data.eta)]);

    rows.push([
      'Draught',
      data.draught != null ? `${data.draught.toFixed(1)} m` : 'Unknown',
    ]);
  }

  /* -------------------------------------------------------
     FLIGHT
  ------------------------------------------------------- */
  else if (data.type === 'flight') {
    typeLabel = 'AIRCRAFT (ADS-B)';

    rows.push(['ICAO24', data.icao24]);

    rows.push(['Altitude', data.alt != null ? `${data.alt} ft` : 'Unknown']);

    rows.push([
      'Heading',
      data.heading != null ? `${Math.round(data.heading)}°` : 'Unknown',
    ]);

    rows.push(['Latitude', safeNumber(data.lat)?.toFixed(4) ?? 'Unknown']);

    rows.push(['Longitude', safeNumber(data.lng)?.toFixed(4) ?? 'Unknown']);
  }

  /* -------------------------------------------------------
     EARTHQUAKE
  ------------------------------------------------------- */
  else if (data.type === 'quake') {
    typeLabel = 'EARTHQUAKE (USGS)';

    title = `M${data.mag ?? '?'} Earthquake`;

    rows.push(['Location', data.name]);

    rows.push(['Magnitude', data.mag]);

    rows.push([
      'Depth',
      data.depth != null ? `${Number(data.depth).toFixed(1)} km` : 'Unknown',
    ]);
  }

  /*  SATELLITE */
  else if (data.type === 'satellite') {
  typeLabel = 'SATELLITE (SGP4)';

  const rec = data.rec;

  rows.push(['Group', data.group || 'Unknown']);

  rows.push([
    'Altitude',
    Number.isFinite(data.altKm)
      ? `${Math.round(data.altKm)} km`
      : 'Unknown',
  ]);

  rows.push([
    'Latitude',
    safeNumber(data.lat)?.toFixed(2) ?? 'Unknown',
  ]);

  rows.push([
    'Longitude',
    safeNumber(data.lng)?.toFixed(2) ?? 'Unknown',
  ]);

  if (rec) {
    const inclinationDeg =
      Number.isFinite(rec.inclo)
        ? rec.inclo * 180 / Math.PI
        : null;

    const eccentricity =
      Number.isFinite(rec.ecco)
        ? rec.ecco
        : null;

    const meanMotion =
      Number.isFinite(rec.no)
        ? rec.no
        : null;

    const orbitalPeriodMinutes =
      meanMotion && meanMotion > 0
        ? (2 * Math.PI) / meanMotion
        : null;

    rows.push([
      'Inclination',
      inclinationDeg !== null
        ? `${inclinationDeg.toFixed(2)}°`
        : 'Unknown',
    ]);

    rows.push([
      'Eccentricity',
      eccentricity !== null
        ? eccentricity.toFixed(4)
        : 'Unknown',
    ]);

    rows.push([
      'Orbital period',
      orbitalPeriodMinutes !== null
        ? `${orbitalPeriodMinutes.toFixed(1)} min`
        : 'Unknown',
    ]);

    rows.push([
      'Mean motion',
      meanMotion !== null
        ? `${meanMotion.toFixed(4)} rad/min`
        : 'Unknown',
    ]);

    rows.push([
      'Journey progress',
      journeyPercent = Math.round(
        getAnimatedSatelliteJourneyProgress() * 100
      ),
    ]);

  }
}

  /* LAUNCH */
  else if (data.type === 'launch') {
    typeLabel = 'UPCOMING LAUNCH';

    rows.push(['Provider', data.provider]);

    rows.push(['Pad', data.pad_name]);

    rows.push(['Status', data.status]);

    rows.push(['NET', data.net ? new Date(data.net).toLocaleString() : 'TBD']);
  }

  /* DISASTER */
  else if (data.type === 'disaster') {
    typeLabel = 'DISASTER ALERT (GDACS)';

    rows.push(['Type', data.event_type]);

    rows.push(['Alert level', data.alert_level]);

    rows.push(['Country', data.country || 'Unknown']);
  }

  panelContentEl.innerHTML = `
    <div class="panel-type">
      ${escapeHtml(typeLabel)}
    </div>

    <div class="panel-title">
      ${escapeHtml(title)}
    </div>

${
  data.type === 'satellite'
    ? `
      <div class="journey-section">
        <div class="journey-title">
          JOURNEY
        </div>

        <div class="journey-bar">
          <div
            class="journey-progress"
            style="width: ${journeyPercent}%"
          ></div>
        </div>

        <div class="journey-percent">
          ${journeyPercent}% COMPLETE
        </div>
      </div>
    `
    : ''
}

    ${rows
      .map(
        ([label, value]) => `
          <div class="panel-row">
            <span class="label">
              ${escapeHtml(label)}
            </span>

            <span>
              ${escapeHtml(value ?? '')}
            </span>
          </div>
        `,
      )
      .join('')}
  `;

  panelEl.classList.remove('hidden');
}

const closePanel = getElement('closePanel');

if (closePanel) {
  closePanel.addEventListener('click', () => {
    if (panelEl) {
      panelEl.classList.add('hidden');
    }

    clearSelection();
  });
}

/* =========================================================
   MOUSE / PARTICLE CLICK DETECTION
========================================================= */

const raycaster = new THREE.Raycaster();

raycaster.params.Points.threshold = 3;

const mouse = new THREE.Vector2();

let pointerDownPos = null;

const canvasEl = world.renderer().domElement;

canvasEl.addEventListener('pointerdown', (event) => {
  pointerDownPos = {
    x: event.clientX,
    y: event.clientY,
  };
});

canvasEl.addEventListener('pointerup', (event) => {
  if (!pointerDownPos) {
    return;
  }

  const moved = Math.hypot(
    event.clientX - pointerDownPos.x,
    event.clientY - pointerDownPos.y,
  );

  pointerDownPos = null;

  if (moved > 5) {
    return;
  }

  const rect = canvasEl.getBoundingClientRect();

  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;

  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, world.camera());

  const cameraDistance = world.camera().position.length();

  raycaster.params.Points.threshold = cameraDistance * 0.018;

  particleGeometry.computeBoundingSphere();

  const hits = raycaster.intersectObject(particleSystem, false);

  if (hits.length === 0) {
    return;
  }

  const index = hits[0].index;

  const record = particleRecords[index];

  if (record && particleSizes[index] > 0) {
    selectTrack(record, {
      flyTo: false,
    });
  }
});

/* TRACK LIST */

const trackListToggle = getElement('trackListToggle');

const trackListPanel = getElement('trackListPanel');

const closeTrackList = getElement('closeTrackList');

const tlSearch = getElement('tlSearch');

const tlFilter = getElement('tlFilter');

const tlList = getElement('tlList');

const tlCount = getElement('tlCount');

if (closeTrackList && trackListPanel) {
  closeTrackList.addEventListener('click', () => {
    trackListPanel.classList.add('hidden');
  });
}

if (trackListToggle && trackListPanel) {
  trackListToggle.addEventListener('click', () => {
    trackListPanel.classList.toggle('hidden');
  });
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
  if (track.type === 'flight') {
    return track.name || track.icao24 || 'Unknown flight';
  }

  if (track.type === 'ship') {
    return track.name || `MMSI ${track.mmsi}`;
  }

  if (track.type === 'quake') {
    return `M${track.mag ?? '?'} ${track.name || ''}`.trim();
  }

  if (track.type === 'satellite') {
    return track.name || 'Unknown satellite';
  }

  if (track.type === 'launch') {
    return track.name || 'Unknown launch';
  }

  if (track.type === 'disaster') {
    return track.name || track.event_type || 'Unknown disaster';
  }

  return track.name || 'Unnamed event';
}

function trackMeta(track) {
  if (track.type === 'flight') {
    return track.alt != null ? `${track.alt} ft` : '';
  }

  if (track.type === 'ship') {
    return track.mmsi || '';
  }

  if (track.type === 'quake') {
    return track.depth != null
      ? `${Number(track.depth).toFixed(0)} km deep`
      : '';
  }

  if (track.type === 'satellite') {
    return Number.isFinite(track.altKm)
      ? `${Math.round(track.altKm)} km orbit`
      : 'Orbit';
  }

  if (track.type === 'launch') {
    return track.status || '';
  }

  if (track.type === 'disaster') {
    return track.alert_level || '';
  }

  return `${track.count || 1} articles`;
}

function renderTrackList() {
  if (!tlSearch || !tlFilter || !tlList || !tlCount) {
    return;
  }

  allTracks = getAllTracks();

  const query = tlSearch.value.trim().toLowerCase();

  const typeFilter = tlFilter.value;

  const filtered = allTracks.filter((track) => {
    if (typeFilter !== 'all' && track.type !== typeFilter) {
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
      .filter((value) => value != null)
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });

  tlCount.textContent =
    `${filtered.length} matching ` + `(showing up to ${MAX_LIST_ROWS})`;

  const rows = filtered.slice(0, MAX_LIST_ROWS).map((track) => {
    const color = COLORS[track.type] || COLORS.satellite;

    const colorHex = colorToCss(color);

    return `
          <div
            class="tl-row"
            data-id="${escapeHtml(track.id)}"
          >
            <span
              class="tl-dot"
              style="
                background:${colorHex};
                color:${colorHex};
              "
            ></span>

            <span class="tl-name">
              ${escapeHtml(trackLabel(track))}
            </span>

            <span class="tl-meta">
              ${escapeHtml(trackMeta(track))}
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

  tlList.querySelectorAll('.tl-row').forEach((row) => {
    row.addEventListener('click', () => {
      const track = allTracks.find(
        (item) => String(item.id) === String(row.dataset.id),
      );

      if (!track) {
        return;
      }

      selectTrack(track, {
        flyTo: true,
      });
    });
  });
}

if (tlSearch) {
  tlSearch.addEventListener('input', renderTrackList);
}

if (tlFilter) {
  tlFilter.addEventListener('change', renderTrackList);
}

/* API LOADERS */

async function loadLaunches() {
  const data = await fetchJSON('http://localhost:8001/api/launches', {
    launches: [],
  });

  return (data.launches || [])
  .map((launch, index) => ({
    id: launch.id || `launch-${index}`,
      type: 'launch',

      lat: safeNumber(launch.lat),

      lng: safeNumber(launch.lon),

      name: launch.name,
      net: launch.net,
      status: launch.status,
      pad_name: launch.pad_name,
      provider: launch.provider,
      location_name: launch.location_name,
      flightclub_url: launch.flightclub_url,
    }))
    .filter((launch) => launch.lat !== null && launch.lng !== null);
}

async function loadDisasters() {
  const data = await fetchJSON('http://localhost:8001/api/disasters', {
    disasters: [],
  });

  return (data.disasters || [])
    .map((disaster, index) => ({
      id: `disaster-${index}`,
      type: 'disaster',

      lat: safeNumber(disaster.lat),

      lng: safeNumber(disaster.lon),

      name: disaster.name || disaster.event_type || 'Unknown disaster',

      event_type: disaster.event_type,

      alert_level: disaster.alert_level,

      country: disaster.country,

      count: 1,
    }))
    .filter((disaster) => disaster.lat !== null && disaster.lng !== null);
}

async function loadGpsIntegrity() {
  try {
    const response = await fetch('http://localhost:8001/api/gps-integrity');

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    return Array.isArray(data.regions) ? data.regions : [];
  } catch (error) {
    console.error('GPS integrity fetch failed:', error);

    return [];
  }
}

async function loadChokepointRisk() {
  try {
    const response = await fetch('http://localhost:8001/api/chokepoint-risk');

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    return Array.isArray(data.chokepoints) ? data.chokepoints : [];
  } catch (error) {
    console.error('Chokepoint risk fetch failed:', error);

    return [];
  }
}

/*HEALTH PANEL */

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
    const response = await fetch('http://localhost:8001/api/health');

    if (!response.ok) {
      throw new Error(response.status);
    }

    const data = await response.json();

    const element = getElement('healthPanel');

    if (!element) {
      return;
    }

    element.innerHTML = Object.entries(LAYER_LABELS)
      .map(([key, label]) => {
        const status = data[key]?.status || 'down';

        const icon = status === 'live' ? '🟢' : '🔴';

        return `
              <div>
                ${icon}
                ${escapeHtml(label.padEnd(14))}
                ${escapeHtml(status.toUpperCase())}
              </div>
            `;
      })
      .join('');
  } catch (error) {
    console.error('Health fetch failed:', error);
  }
}

/* INITIALIZATION */

async function initializeSatellites() {
  await loadSatelliteTLEs();

  propagateSatellites();

  console.log(
    `Satellite layer initialized with ${satPositions.length} active positions.`,
  );
}

/* START DATA */

refreshData();

setInterval(refreshData, 20000);

/* START SATELLITES */

initializeSatellites();

setInterval(() => {
  propagateSatellites();
}, 5000);

/*HEALTH */

refreshHealth();

setInterval(refreshHealth, 15000);

/* INITIAL RENDER */

// Small oriented arrow marking the selected ship/aircraft's heading,
// projected in screen space every frame so it stays visually "flat"
// and correctly oriented regardless of camera angle, this is the
// technique real trackers use, just scoped to one object instead of
// thousands for performance.

let headingArrowEl = null;

function updateHeadingArrow(track) {
  if (!headingArrowEl) {
    headingArrowEl = document.createElement('div');
    headingArrowEl.style.cssText = `
      position: fixed; width: 0; height: 0; pointer-events: none; z-index: 12;
      border-left: 6px solid transparent; border-right: 6px solid transparent;
      border-bottom: 14px solid #ffffff; filter: drop-shadow(0 0 4px #fff);
    `;
    document.body.appendChild(headingArrowEl);
  }
  if (!track || track.heading == null) {
    headingArrowEl.style.display = 'none';
    return;
  }
  const coords = world.getCoords(track.lat, track.lng, 0.02);
  const vec = new THREE.Vector3(coords.x, coords.y, coords.z);
  vec.project(world.camera());
  const x = (vec.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-vec.y * 0.5 + 0.5) * window.innerHeight;
  headingArrowEl.style.left = `${x}px`;
  headingArrowEl.style.top = `${y}px`;
  headingArrowEl.style.transform = `translate(-50%,-50%) rotate(${track.heading}deg)`;
  headingArrowEl.style.display = vec.z < 1 ? 'block' : 'none'; // hide if behind globe
}

// Call every animation frame for the current selection
function trackSelectedHeading() {
  requestAnimationFrame(trackSelectedHeading);
  const rec = particleRecords.find((r) => r.id === selectedId);
  updateHeadingArrow(rec);
}
trackSelectedHeading();

renderLowVolumeLayer();
renderCustomLayer();
renderTrackList();

function formatAISeta(eta) {
  if (!eta) {
    return 'Unknown';
  }

  if (typeof eta === 'string') {
    return eta;
  }

  if (typeof eta === 'object') {
    const month = eta.Month;
    const day = eta.Day;
    const hour = eta.Hour;
    const minute = eta.Minute;

    if (month != null && day != null && hour != null && minute != null) {
      return `${String(day).padStart(2, '0')}/${String(month).padStart(
        2,
        '0',
      )} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  return String(eta);
}

window.refreshData = refreshData;

window.__debug = {
  get solarMode() {
    return solarMode;
  },
  get earthLayersVisible() {
    return earthLayersVisible;
  },
  earthDataShouldRender,
};

const solarCanvas =
  world.renderer().domElement;

solarCanvas.addEventListener(
  'pointermove',
  handleSolarPointerMove,
);

solarCanvas.addEventListener(
  'click',
  handleSolarPointerClick,
);