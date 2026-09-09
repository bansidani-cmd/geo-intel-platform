import * as THREE from "three";

const SOLAR_DISTANCE_OFFSET = 130;
const SOLAR_DISTANCE_SCALE = 55;

const MOON_ORBIT_RADIUS = 18;
const MOON_ORBIT_SPEED = 0.003;

const SOLAR_ROTATION_SPEEDS = {
    sun: 0.0005,
    mercury: 0.002,
    venus: 0.001,
    earth: 0.003,
    mars: 0.0028,
    jupiter: 0.006,
    saturn: 0.005,
    uranus: 0.003,
    neptune: 0.003,
    moon: 0.003,
};

const PLANET_COLORS = {
    sun: 0xffcc66,
    mercury: 0x9b9388,
    venus: 0xd6b47c,
    earth: 0x3976b8,
    mars: 0xb85c3b,
    jupiter: 0xc98b55,
    saturn: 0xd8c18d,
    uranus: 0x83cbd1,
    neptune: 0x4169a8,
    moon: 0xaaa9a4,
};

const ORBIT_COLORS = {
    mercury: 0xb0b0b0,
    venus: 0xffc857,
    earth: 0x4da6ff,
    mars: 0xff5c5c,
    jupiter: 0xffa64d,
    saturn: 0xf2d16b,
    uranus: 0x4dd9d9,
    neptune: 0x668cff,
};

const PLANET_RADII = {
    sun: 15,
    mercury: 2.4,
    venus: 4.2,
    earth: 4.5,
    mars: 3.2,
    jupiter: 10,
    saturn: 8.5,
    uranus: 6.5,
    neptune: 6.2,
    moon: 1.5,
};

const AXIAL_TILTS = {
    mercury: 0.034,
    venus: 3.095,
    earth: 0.409,
    mars: 0.439,
    jupiter: 0.122,
    saturn: 0.466,
    uranus: 1.706,
    neptune: 0.494,
};

const BODY_ORDER = [
    "sun",
    "mercury",
    "venus",
    "earth",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "moon",
];

function getSolarVisualPosition(body, sun) {
    const x = Number(body.x) - Number(sun.x);
    const y = Number(body.y) - Number(sun.y);
    const z = Number(body.z) - Number(sun.z);

    const distance =
        Math.sqrt(
            x * x +
            y * y +
            z * z
        );

    if (body.id === "sun") {
        return new THREE.Vector3(0, 0, 0);
    }

    if (
        !Number.isFinite(distance) ||
        distance <= 0
    ) {
        return new THREE.Vector3(0, 0, 0);
    }

    const visualDistance =
        SOLAR_DISTANCE_OFFSET +
        Math.log10(1 + distance) *
            SOLAR_DISTANCE_SCALE;

    const nx = x / distance;
    const ny = y / distance;
    const nz = z / distance;

    if (body.id === "moon") {
        return new THREE.Vector3(
            nx * visualDistance + 5,
            nz * visualDistance + 2,
            ny * visualDistance + 5
        );
    }

    return new THREE.Vector3(
        nx * visualDistance,
        nz * visualDistance,
        ny * visualDistance
    );
}

function createCanvasTexture(drawFunction, size = 512) {
    const canvas =
        document.createElement("canvas");

    canvas.width = size;
    canvas.height = size;

    const ctx =
        canvas.getContext("2d");

    drawFunction(ctx, size);

    const texture =
        new THREE.CanvasTexture(canvas);

    texture.colorSpace =
        THREE.SRGBColorSpace;

    texture.needsUpdate = true;

    return texture;
}

function createPlanetTexture(id) {
    return createCanvasTexture(
        (ctx, size) => {
            const gradient =
                ctx.createLinearGradient(
                    0,
                    0,
                    0,
                    size
                );

            const base =
                PLANET_COLORS[id] ??
                0x888888;

            const color =
                new THREE.Color(base);

            const hex =
                "#" +
                color.getHexString();

            gradient.addColorStop(
                0,
                hex
            );

            gradient.addColorStop(
                1,
                "#111111"
            );

            ctx.fillStyle = gradient;

            ctx.fillRect(
                0,
                0,
                size,
                size
            );

            if (id === "earth") {
                drawEarthTexture(ctx, size);
            }

            if (id === "jupiter") {
                drawJupiterTexture(ctx, size);
            }

            if (id === "saturn") {
                drawSaturnTexture(ctx, size);
            }

            if (id === "mars") {
                drawMarsTexture(ctx, size);
            }

            if (id === "mercury") {
                drawMercuryTexture(ctx, size);
            }

            if (id === "venus") {
                drawVenusTexture(ctx, size);
            }

            if (id === "uranus") {
                drawUranusTexture(ctx, size);
            }

            if (id === "neptune") {
                drawNeptuneTexture(ctx, size);
            }

            if (id === "moon") {
                drawMoonTexture(ctx, size);
            }
        }
    );
}

function drawEarthTexture(ctx, size) {
    ctx.fillStyle = "#164f82";

    ctx.fillRect(
        0,
        0,
        size,
        size
    );

    for (let i = 0; i < 18; i++) {
        const x =
            Math.random() * size;

        const y =
            Math.random() * size;

        const width =
            25 +
            Math.random() * 100;

        const height =
            15 +
            Math.random() * 60;

        ctx.fillStyle =
            i % 3 === 0
                ? "#9b9b51"
                : "#397344";

        ctx.beginPath();

        ctx.ellipse(
            x,
            y,
            width,
            height,
            Math.random(),
            0,
            Math.PI * 2
        );

        ctx.fill();
    }

    ctx.fillStyle =
        "rgba(230,245,255,0.9)";

    ctx.fillRect(
        0,
        0,
        size,
        size * 0.035
    );

    ctx.fillRect(
        0,
        size * 0.965,
        size,
        size * 0.035
    );
}

function drawJupiterTexture(ctx, size) {
    const bands = [
        "#c48a62",
        "#e0b082",
        "#9e684d",
        "#d5a47c",
        "#8d5c46",
        "#d9b08d",
    ];

    const bandHeight =
        size / bands.length;

    bands.forEach(
        (color, index) => {
            ctx.fillStyle = color;

            ctx.fillRect(
                0,
                index * bandHeight,
                size,
                bandHeight
            );
        }
    );

    for (let i = 0; i < 80; i++) {
        ctx.strokeStyle =
            "rgba(255,255,255,0.08)";

        ctx.lineWidth =
            1 +
            Math.random() * 3;

        const y =
            Math.random() * size;

        ctx.beginPath();

        ctx.moveTo(0, y);

        ctx.bezierCurveTo(
            size * 0.25,
            y + Math.random() * 20,
            size * 0.75,
            y - Math.random() * 20,
            size,
            y
        );

        ctx.stroke();
    }

    ctx.fillStyle =
        "#a94732";

    ctx.beginPath();

    ctx.ellipse(
        size * 0.72,
        size * 0.64,
        size * 0.12,
        size * 0.07,
        0,
        0,
        Math.PI * 2
    );

    ctx.fill();
}

function drawSaturnTexture(ctx, size) {
    const bands = [
        "#d8c08e",
        "#c7aa75",
        "#ead7ad",
        "#b99765",
        "#dcc695",
    ];

    bands.forEach(
        (color, index) => {
            ctx.fillStyle = color;

            ctx.fillRect(
                0,
                (index / bands.length) * size,
                size,
                size / bands.length
            );
        }
    );

    for (let i = 0; i < 50; i++) {
        ctx.strokeStyle =
            "rgba(120,90,50,0.18)";

        ctx.beginPath();

        const y =
            Math.random() * size;

        ctx.moveTo(0, y);

        ctx.lineTo(
            size,
            y +
                (Math.random() - 0.5) * 8
        );

        ctx.stroke();
    }
}

function drawMarsTexture(ctx, size) {
    ctx.fillStyle =
        "#a84d34";

    ctx.fillRect(
        0,
        0,
        size,
        size
    );

    for (let i = 0; i < 45; i++) {
        ctx.fillStyle =
            i % 2 === 0
                ? "rgba(80,35,25,0.25)"
                : "rgba(230,130,90,0.18)";

        ctx.beginPath();

        ctx.arc(
            Math.random() * size,
            Math.random() * size,
            5 + Math.random() * 18,
            0,
            Math.PI * 2
        );

        ctx.fill();
    }
}

function drawMercuryTexture(ctx, size) {
    ctx.fillStyle =
        "#817970";

    ctx.fillRect(
        0,
        0,
        size,
        size
    );

    for (let i = 0; i < 90; i++) {
        const radius =
            1 +
            Math.random() * 8;

        ctx.fillStyle =
            "rgba(30,30,30,0.35)";

        ctx.beginPath();

        ctx.arc(
            Math.random() * size,
            Math.random() * size,
            radius,
            0,
            Math.PI * 2
        );

        ctx.fill();
    }
}

function drawVenusTexture(ctx, size) {
    ctx.fillStyle =
        "#d2a45e";

    ctx.fillRect(
        0,
        0,
        size,
        size
    );

    for (let i = 0; i < 50; i++) {
        ctx.strokeStyle =
            "rgba(255,230,170,0.18)";

        ctx.lineWidth =
            2 +
            Math.random() * 5;

        const y =
            Math.random() * size;

        ctx.beginPath();

        ctx.moveTo(0, y);

        ctx.bezierCurveTo(
            size * 0.3,
            y - 20,
            size * 0.7,
            y + 20,
            size,
            y
        );

        ctx.stroke();
    }
}

function drawUranusTexture(ctx, size) {
    ctx.fillStyle =
        "#83cbd1";

    ctx.fillRect(
        0,
        0,
        size,
        size
    );

    for (let i = 0; i < 20; i++) {
        ctx.strokeStyle =
            "rgba(255,255,255,0.12)";

        ctx.beginPath();

        const y =
            Math.random() * size;

        ctx.moveTo(0, y);

        ctx.lineTo(
            size,
            y
        );

        ctx.stroke();
    }
}

function drawNeptuneTexture(ctx, size) {
    ctx.fillStyle =
        "#315b9d";

    ctx.fillRect(
        0,
        0,
        size,
        size
    );

    for (let i = 0; i < 30; i++) {
        ctx.strokeStyle =
            "rgba(160,200,255,0.15)";

        ctx.beginPath();

        const y =
            Math.random() * size;

        ctx.moveTo(0, y);

        ctx.lineTo(
            size,
            y +
                (Math.random() - 0.5) * 10
        );

        ctx.stroke();
    }

    ctx.fillStyle =
        "rgba(20,35,70,0.8)";

    ctx.beginPath();

    ctx.ellipse(
        size * 0.65,
        size * 0.42,
        size * 0.08,
        size * 0.045,
        0,
        0,
        Math.PI * 2
    );

    ctx.fill();

    ctx.fillStyle =
        "rgba(220,240,255,0.8)";

    ctx.beginPath();

    ctx.ellipse(
        size * 0.3,
        size * 0.65,
        size * 0.06,
        size * 0.025,
        0,
        0,
        Math.PI * 2
    );

    ctx.fill();
}

function drawMoonTexture(ctx, size) {
    ctx.fillStyle =
        "#aaa9a4";

    ctx.fillRect(
        0,
        0,
        size,
        size
    );

    for (let i = 0; i < 120; i++) {
        const radius =
            1 +
            Math.random() * 7;

        ctx.fillStyle =
            "rgba(45,45,45,0.3)";

        ctx.beginPath();

        ctx.arc(
            Math.random() * size,
            Math.random() * size,
            radius,
            0,
            Math.PI * 2
        );

        ctx.fill();
    }
}

function createPlanetMaterial(id) {
    if (id === "sun") {
        const texture =
            createCanvasTexture(
                (ctx, size) => {
                    const gradient =
                        ctx.createRadialGradient(
                            size * 0.5,
                            size * 0.5,
                            size * 0.05,
                            size * 0.5,
                            size * 0.5,
                            size * 0.7
                        );

                    gradient.addColorStop(
                        0,
                        "#fff4b0"
                    );

                    gradient.addColorStop(
                        0.35,
                        "#ffd45c"
                    );

                    gradient.addColorStop(
                        0.7,
                        "#ff9f1c"
                    );

                    gradient.addColorStop(
                        1,
                        "#d85b08"
                    );

                    ctx.fillStyle =
                        gradient;

                    ctx.fillRect(
                        0,
                        0,
                        size,
                        size
                    );

                    for (
                        let i = 0;
                        i < 450;
                        i++
                    ) {
                        const x =
                            Math.random() * size;

                        const y =
                            Math.random() * size;

                        const radius =
                            2 +
                            Math.random() * 10;

                        const hot =
                            Math.random() > 0.45;

                        ctx.fillStyle =
                            hot
                                ? "rgba(255,245,170,0.18)"
                                : "rgba(190,55,0,0.16)";

                        ctx.beginPath();

                        ctx.arc(
                            x,
                            y,
                            radius,
                            0,
                            Math.PI * 2
                        );

                        ctx.fill();
                    }

                    for (
                        let i = 0;
                        i < 180;
                        i++
                    ) {
                        ctx.fillStyle =
                            "rgba(120,35,0,0.12)";

                        ctx.beginPath();

                        ctx.ellipse(
                            Math.random() * size,
                            Math.random() * size,
                            3 + Math.random() * 12,
                            1 + Math.random() * 5,
                            Math.random(),
                            0,
                            Math.PI * 2
                        );

                        ctx.fill();
                    }

                    for (
                        let i = 0;
                        i < 35;
                        i++
                    ) {
                        ctx.strokeStyle =
                            "rgba(255,240,150,0.22)";

                        ctx.lineWidth =
                            1 +
                            Math.random() * 3;

                        ctx.beginPath();

                        const y =
                            Math.random() * size;

                        ctx.moveTo(
                            0,
                            y
                        );

                        ctx.bezierCurveTo(
                            size * 0.25,
                            y +
                                (Math.random() - 0.5) * 40,
                            size * 0.75,
                            y +
                                (Math.random() - 0.5) * 40,
                            size,
                            y
                        );

                        ctx.stroke();
                    }
                }
            );

        return new THREE.MeshBasicMaterial({
            map: texture,
        });
    }

    const texture =
        createPlanetTexture(id);

    return new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.82,
        metalness: 0.02,
    });
}

function createEarthCloudLayer(radius) {
    const texture =
        createCanvasTexture(
            (ctx, size) => {
                ctx.clearRect(
                    0,
                    0,
                    size,
                    size
                );

                for (let i = 0; i < 100; i++) {
                    ctx.fillStyle =
                        `rgba(255,255,255,${
                            0.08 +
                            Math.random() * 0.25
                        })`;

                    ctx.beginPath();

                    ctx.ellipse(
                        Math.random() * size,
                        Math.random() * size,
                        10 + Math.random() * 45,
                        3 + Math.random() * 12,
                        0,
                        0,
                        Math.PI * 2
                    );

                    ctx.fill();
                }
            }
        );

    const material =
        new THREE.MeshPhongMaterial({
            map: texture,
            transparent: true,
            opacity: 0.72,
            depthWrite: false,
        });

    return new THREE.Mesh(
        new THREE.SphereGeometry(
            radius * 1.025,
            48,
            48
        ),
        material
    );
}

function createEarthAtmosphere(radius) {
    return new THREE.Mesh(
        new THREE.SphereGeometry(
            radius * 1.09,
            48,
            48
        ),
        new THREE.MeshBasicMaterial({
            color: 0x4da6ff,
            transparent: true,
            opacity: 0.16,
            side: THREE.BackSide,
            depthWrite: false,
        })
    );
}

function createSunGlow(radius) {
    return new THREE.Mesh(
        new THREE.SphereGeometry(
            radius * 1.18,
            32,
            32
        ),
        new THREE.MeshBasicMaterial({
            color: 0xffaa33,
            transparent: true,
            opacity: 0.12,
            side: THREE.BackSide,
            depthWrite: false,
        })
    );
}

function createSaturnRings(radius) {
    const geometry =
        new THREE.RingGeometry(
            radius * 1.25,
            radius * 2.15,
            96
        );

    const material =
        new THREE.MeshBasicMaterial({
            color: 0xc9b58a,
            transparent: true,
            opacity: 0.72,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

    const rings =
        new THREE.Mesh(
            geometry,
            material
        );

    rings.rotation.x =
        Math.PI / 2;

    return rings;
}

function createLabel(text) {
    const canvas =
        document.createElement("canvas");

    canvas.width = 256;
    canvas.height = 64;

    const ctx =
        canvas.getContext("2d");

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.font =
        "bold 24px Arial";

    ctx.fillStyle =
        "rgba(255,255,255,0.95)";

    ctx.textAlign =
        "center";

    ctx.textBaseline =
        "middle";

    ctx.fillText(
        text,
        canvas.width / 2,
        canvas.height / 2
    );

    const texture =
        new THREE.CanvasTexture(canvas);

    texture.colorSpace =
        THREE.SRGBColorSpace;

    const material =
        new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
        });

    const sprite =
        new THREE.Sprite(material);

    sprite.scale.set(
        20,
        5,
        1
    );

    return sprite;
}

function createStarfield() {
    const geometry =
        new THREE.BufferGeometry();

    const positions = [];

    const count = 2500;

    for (
        let i = 0;
        i < count;
        i++
    ) {
        const radius =
            500 +
            Math.random() * 1500;

        const theta =
            Math.random() *
            Math.PI *
            2;

        const phi =
            Math.acos(
                2 * Math.random() - 1
            );

        positions.push(
            radius *
                Math.sin(phi) *
                Math.cos(theta),

            radius *
                Math.cos(phi),

            radius *
                Math.sin(phi) *
                Math.sin(theta)
        );
    }

    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
            positions,
            3
        )
    );

    const material =
        new THREE.PointsMaterial({
            color: 0xffffff,
            size: 1.5,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.85,
        });

    return new THREE.Points(
        geometry,
        material
    );
}

class SolarSystem {
    constructor() {
        this.group =
            new THREE.Group();

        this.group.name =
            "SolarSystemWorld";

        this.group.visible = false;

        this.bodies =
            new Map();

        this.labels =
            new Map();

        this.orbitGroup =
            new THREE.Group();

        this.orbitGroup.name =
            "SolarOrbits";

        this.starfieldGroup =
            new THREE.Group();

        this.starfieldGroup.name =
            "SolarStarfield";

        this.bodiesData = [];

        this.orbitalTrajectories =
            new Map();

        this.orbitsVisible = true;
        this.labelsVisible = true;
        this.starsVisible = true;

        this.animationSpeed = 1.0;

        this.moonAngle = 0;

        this.animationFrame = null;

        this.initialized = false;
    }

    initialize(scene) {
        if (this.initialized) {
            return;
        }

        if (!scene) {
            throw new Error(
                "SolarSystem: THREE.Scene is required."
            );
        }

        scene.add(this.group);

        this.group.add(
            this.orbitGroup
        );

        this.group.add(
            this.starfieldGroup
        );

        const ambientLight =
            new THREE.AmbientLight(
                0xffffff,
                0.35
            );

        this.group.add(
            ambientLight
        );

        const sunLight =
            new THREE.PointLight(
                0xffffff,
                2.5,
                0,
                2
            );

        sunLight.position.set(
            0,
            0,
            0
        );

        this.group.add(
            sunLight
        );

        this.starfieldGroup.add(
            createStarfield()
        );

        this.initialized = true;

        this.startAnimation();

        console.log(
            "SolarSystem initialized."
        );
    }

    startAnimation() {
        if (this.animationFrame) {
            return;
        }

        const animate = () => {
            this.animationFrame =
                requestAnimationFrame(
                    animate
                );

            this.update();
        };

        animate();
    }

    stopAnimation() {
        if (!this.animationFrame) {
            return;
        }

        cancelAnimationFrame(
            this.animationFrame
        );

        this.animationFrame = null;
    }

    updateBodies(bodies) {
        if (!Array.isArray(bodies)) {
            return;
        }

        this.bodiesData = bodies;

        const sun =
            bodies.find(
                (body) =>
                    body.id === "sun"
            );

        if (!sun) {
            console.warn(
                "SolarSystem: Sun data missing."
            );

            return;
        }

        for (const body of bodies) {
            if (!body?.id) {
                continue;
            }

            let object =
                this.bodies.get(
                    body.id
                );

            if (!object) {
                object =
                    this.createBody(
                        body
                    );

                this.bodies.set(
                    body.id,
                    object
                );

                this.group.add(
                    object
                );

                this.createBodyLabel(
                    body
                );
            }

            const position =
                getSolarVisualPosition(
                    body,
                    sun
                );

            object.position.copy(
                position
            );
        }

        console.log(
            `SOLAR SYSTEM: updated ${this.bodies.size} bodies`
        );
    }

    setOrbitalTrajectories(trajectories) {
        if (!Array.isArray(trajectories)) {
            console.warn(
                "SolarSystem: Invalid orbital trajectory data."
            );

            return;
        }

        while (
            this.orbitGroup.children.length > 0
        ) {
            const orbit =
                this.orbitGroup.children[
                    this.orbitGroup.children.length - 1
                ];

            this.orbitGroup.remove(
                orbit
            );

            if (orbit.geometry) {
                orbit.geometry.dispose();
            }

            if (orbit.material) {
                orbit.material.dispose();
            }
        }

        this.orbitalTrajectories.clear();

        for (
            const trajectory of trajectories
        ) {
            if (
                !trajectory ||
                !trajectory.id ||
                !Array.isArray(
                    trajectory.points
                ) ||
                trajectory.points.length < 2
            ) {
                continue;
            }

            const points = [];

            for (
                const point of trajectory.points
            ) {
                const x = Number(point.x);
                const y = Number(point.y);
                const z = Number(point.z);

                const distance =
                    Math.sqrt(
                        x * x +
                        y * y +
                        z * z
                    );

                if (
                    !Number.isFinite(
                        distance
                    ) ||
                    distance <= 0
                ) {
                    continue;
                }

                const visualDistance =
                    SOLAR_DISTANCE_OFFSET +
                    Math.log10(
                        1 + distance
                    ) *
                        SOLAR_DISTANCE_SCALE;

                const nx =
                    x / distance;

                const ny =
                    y / distance;

                const nz =
                    z / distance;

                points.push(
                    new THREE.Vector3(
                        nx * visualDistance,
                        nz * visualDistance,
                        ny * visualDistance
                    )
                );
            }

            if (points.length < 2) {
                continue;
            }

            const geometry =
                new THREE.BufferGeometry()
                    .setFromPoints(points);

            const material =
                new THREE.LineBasicMaterial({
                    color:
                        ORBIT_COLORS[
                            trajectory.id
                        ] ?? 0xffffff,

                    transparent: true,
                    opacity: 0.72,

                    depthWrite: false,
                });

            const orbit =
                new THREE.Line(
                    geometry,
                    material
                );

            orbit.name =
                `Orbit_${trajectory.id}`;

            orbit.userData.bodyId =
                trajectory.id;

            this.orbitGroup.add(
                orbit
            );

            this.orbitalTrajectories.set(
                trajectory.id,
                trajectory
            );
        }

        this.orbitGroup.visible =
            this.orbitsVisible;

        console.log(
            `SOLAR SYSTEM: rendered ${this.orbitalTrajectories.size} real orbital trajectories`
        );
    }

    createBody(body) {
        const id =
            body.id;

        const radius =
            PLANET_RADII[id] ?? 4;

        const geometry =
            new THREE.SphereGeometry(
                radius,
                48,
                48
            );

        const material =
            createPlanetMaterial(id);

        const mesh =
            new THREE.Mesh(
                geometry,
                material
            );

        mesh.name =
            `SolarBody_${id}`;

        mesh.userData.bodyId =
            id;

        if (
            AXIAL_TILTS[id] !==
            undefined
        ) {
            mesh.rotation.z =
                AXIAL_TILTS[id];
        }

        if (id === "earth") {
            const clouds =
                createEarthCloudLayer(
                    radius
                );

            mesh.add(clouds);

            mesh.userData.cloudLayer =
                clouds;

            const atmosphere =
                createEarthAtmosphere(
                    radius
                );

            mesh.add(atmosphere);

            mesh.userData.atmosphere =
                atmosphere;
        }

        if (id === "sun") {
            mesh.add(
                createSunGlow(
                    radius
                )
            );
        }

        if (id === "saturn") {
            const rings =
                createSaturnRings(
                    radius
                );

            mesh.add(rings);

            mesh.userData.rings =
                rings;
        }

        return mesh;
    }

    createBodyLabel(body) {
        if (
            this.labels.has(
                body.id
            )
        ) {
            return;
        }

        const label =
            createLabel(
                body.name ??
                    body.id
            );

        label.userData.bodyId =
            body.id;

        this.labels.set(
            body.id,
            label
        );

        this.group.add(
            label
        );

        const bodyObject =
            this.bodies.get(
                body.id
            );

        if (bodyObject) {
            label.position.copy(
                bodyObject.position
            );

            label.position.y +=
                (PLANET_RADII[
                    body.id
                ] ?? 4) + 5;
        }

        label.visible =
            this.labelsVisible;
    }

    update() {
        if (!this.initialized) {
            return;
        }

        for (
            const [id, object] of
                this.bodies
        ) {
            const speed =
                SOLAR_ROTATION_SPEEDS[
                    id
                ] || 0.002;

            object.rotation.y +=
                speed *
                this.animationSpeed;

            if (
                id === "earth" &&
                object.userData.cloudLayer
            ) {
                object.userData
                    .cloudLayer
                    .rotation.y +=
                    speed *
                    0.35 *
                    this.animationSpeed;
            }
        }

        const earth =
            this.bodies.get(
                "earth"
            );

        const moon =
            this.bodies.get(
                "moon"
            );

        if (earth && moon) {
            this.moonAngle +=
                MOON_ORBIT_SPEED *
                this.animationSpeed;

            moon.position.set(
                earth.position.x +
                    Math.cos(
                        this.moonAngle
                    ) *
                        MOON_ORBIT_RADIUS,

                earth.position.y +
                    Math.sin(
                        this.moonAngle * 0.35
                    ) *
                        3,

                earth.position.z +
                    Math.sin(
                        this.moonAngle
                    ) *
                        MOON_ORBIT_RADIUS
            );
        }

        for (
            const [id, label] of
                this.labels
        ) {
            const body =
                this.bodies.get(id);

            if (!body) {
                continue;
            }

            label.position.copy(
                body.position
            );

            label.position.y +=
                (PLANET_RADII[id] ?? 4) +
                5;
        }
    }

    setVisible(visible) {
        this.group.visible =
            visible;
    }

    setStarsVisible(visible) {
        this.starsVisible =
            visible;

        this.starfieldGroup.visible =
            visible;
    }

    setOrbitsVisible(visible) {
        this.orbitsVisible =
            visible;

        this.orbitGroup.visible =
            visible;
    }

    setLabelsVisible(visible) {
        this.labelsVisible =
            visible;

        for (
            const label of
                this.labels.values()
        ) {
            label.visible =
                visible;
        }
    }

    getBody(id) {
        return this.bodies.get(
            id
        );
    }

    getBodyPosition(id) {
        const body =
            this.bodies.get(id);

        if (!body) {
            return null;
        }

        return body.position.clone();
    }

    getEarthPosition() {
        return (
            this.getBodyPosition(
                "earth"
            ) ??
            new THREE.Vector3(
                0,
                0,
                0
            )
        );
    }

    getSunPosition() {
        return (
            this.getBodyPosition(
                "sun"
            ) ??
            new THREE.Vector3(
                0,
                0,
                0
            )
        );
    }

    getMarsPosition() {
        return (
            this.getBodyPosition(
                "mars"
            ) ??
            new THREE.Vector3(
                0,
                0,
                0
            )
        );
    }

    getAllBodies() {
        return this.bodies;
    }
}

const solarSystemWorld =
    new SolarSystem();

export {
    SolarSystem,
    solarSystemWorld,
    getSolarVisualPosition,
};