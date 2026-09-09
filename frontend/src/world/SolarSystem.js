import * as THREE from "three";

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

const SOLAR_DISTANCE_OFFSET = 130;
const SOLAR_DISTANCE_SCALE = 55;

const MOON_ORBIT_RADIUS = 18;
const MOON_ORBIT_SPEED = 0.003;

class SolarSystem {
    constructor() {
        this.group = new THREE.Group();
        this.group.name = "SolarSystemWorld";
        this.group.visible = false;

        this.bodies = new Map();
        this.labels = new Map();

        this.orbitGroup = new THREE.Group();
        this.orbitGroup.name = "SolarOrbits";

        this.starfieldGroup = new THREE.Group();
        this.starfieldGroup.name = "SolarStarfield";

        this.bodiesData = [];

        this.orbitsVisible = true;
        this.labelsVisible = true;
        this.starsVisible = true;

        this.animationSpeed = 1.0;

        this.initialized = false;
    }

    initialize(scene) {
        if (this.initialized) {
            return;
        }

        scene.add(this.group);

        this.group.add(this.orbitGroup);
        this.group.add(this.starfieldGroup);

        this.createLights();
        this.createStarfield();

        this.initialized = true;

        console.log("SolarSystem initialized.");
    }

    createLights() {
        const ambientLight =
            new THREE.AmbientLight(
                0xffffff,
                0.35
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

        this.group.add(ambientLight);
        this.group.add(sunLight);
    }

    createStarfield() {
        const starCount = 1800;

        const positions =
            new Float32Array(
                starCount * 3
            );

        for (
            let i = 0;
            i < starCount;
            i++
        ) {
            const radius =
                1400 +
                Math.random() * 1600;

            const theta =
                Math.random() *
                Math.PI * 2;

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
            "position",
            new THREE.BufferAttribute(
                positions,
                3
            )
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
                material
            );

        this.starfieldGroup.add(stars);
    }

    createSolarSystemBody(body) {
        const radius =
            SOLAR_SYSTEM_RADII[body.id] ||
            2.5;

        const color =
            SOLAR_SYSTEM_COLORS[body.id] ||
            0xffffff;

        const group =
            new THREE.Group();

        group.userData.bodyId =
            body.id;

        const axialTilt =
            SOLAR_AXIAL_TILTS[body.id] ||
            0;

        group.rotation.z =
            THREE.MathUtils.degToRad(
                axialTilt
            );

        const geometry =
            new THREE.SphereGeometry(
                radius,
                48,
                48
            );

        let material =
            new THREE.MeshStandardMaterial({
                color,
                roughness: 0.9,
                metalness: 0.0,
            });

        const sphere =
            new THREE.Mesh(
                geometry,
                material
            );

        group.add(sphere);

        /*
         * Sun
         */

        if (body.id === "sun") {
            sphere.material =
                new THREE.MeshBasicMaterial({
                    color: 0xffcc33,
                });

            const glowGeometry =
                new THREE.SphereGeometry(
                    radius * 1.35,
                    32,
                    32
                );

            const glowMaterial =
                new THREE.MeshBasicMaterial({
                    color: 0xffaa22,
                    transparent: true,
                    opacity: 0.22,
                    depthWrite: false,
                });

            group.add(
                new THREE.Mesh(
                    glowGeometry,
                    glowMaterial
                )
            );

            const coronaGeometry =
                new THREE.SphereGeometry(
                    radius * 2.2,
                    48,
                    48
                );

            const coronaMaterial =
                new THREE.MeshBasicMaterial({
                    color: 0xff8a22,
                    transparent: true,
                    opacity: 0.055,
                    depthWrite: false,
                });

            group.add(
                new THREE.Mesh(
                    coronaGeometry,
                    coronaMaterial
                )
            );

            const innerGeometry =
                new THREE.SphereGeometry(
                    radius * 1.55,
                    48,
                    48
                );

            const innerMaterial =
                new THREE.MeshBasicMaterial({
                    color: 0xffbb44,
                    transparent: true,
                    opacity: 0.10,
                    depthWrite: false,
                });

            group.add(
                new THREE.Mesh(
                    innerGeometry,
                    innerMaterial
                )
            );
        }

        /*
         * Saturn rings
         */

        if (body.id === "saturn") {
            const ringGeometry =
                new THREE.RingGeometry(
                    radius * 1.35,
                    radius * 2.25,
                    96
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

            const ring =
                new THREE.Mesh(
                    ringGeometry,
                    ringMaterial
                );

            ring.rotation.x =
                Math.PI / 2;

            group.add(ring);

            const innerRingGeometry =
                new THREE.RingGeometry(
                    radius * 1.12,
                    radius * 1.35,
                    96
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
                    innerRingMaterial
                );

            innerRing.rotation.x =
                Math.PI / 2;

            group.add(innerRing);
        }

        return group;
    }

    createBodyLabel(body) {
        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width = 512;
        canvas.height = 128;

        const ctx =
            canvas.getContext("2d");

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        ctx.font =
            "600 32px Arial";

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle =
            "rgba(255,255,255,0.9)";

        ctx.fillText(
            body.name,
            canvas.width / 2,
            canvas.height / 2
        );

        const texture =
            new THREE.CanvasTexture(
                canvas
            );

        const material =
            new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
            });

        const sprite =
            new THREE.Sprite(
                material
            );

        sprite.scale.set(
            55,
            14,
            1
        );

        return sprite;
    }

    getVisualPosition(body, sun) {
        const x =
            Number(body.x) -
            Number(sun.x);

        const y =
            Number(body.y) -
            Number(sun.y);

        const z =
            Number(body.z) -
            Number(sun.z);

        const distance =
            Math.sqrt(
                x * x +
                y * y +
                z * z
            );

        if (body.id === "sun") {
            return new THREE.Vector3(
                0,
                0,
                0
            );
        }

        if (
            !Number.isFinite(distance) ||
            distance <= 0
        ) {
            return new THREE.Vector3(
                0,
                0,
                0
            );
        }

        const visualDistance =
            SOLAR_DISTANCE_OFFSET +
            Math.log10(
                1 + distance
            ) *
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

    createOrbit(body, sun) {
        const x =
            Number(body.x) -
            Number(sun.x);

        const y =
            Number(body.y) -
            Number(sun.y);

        const z =
            Number(body.z) -
            Number(sun.z);

        const distance =
            Math.sqrt(
                x * x +
                y * y +
                z * z
            );

        if (
            !Number.isFinite(distance) ||
            distance <= 0
        ) {
            return null;
        }

        const visualDistance =
            SOLAR_DISTANCE_OFFSET +
            Math.log10(
                1 + distance
            ) *
            SOLAR_DISTANCE_SCALE;

        const eccentricity =
            SOLAR_ORBIT_ECCENTRICITIES[
                body.id
            ] || 0;

        const semiMajor =
            visualDistance;

        const semiMinor =
            semiMajor *
            Math.sqrt(
                1 -
                eccentricity *
                eccentricity
            );

        const curve =
            new THREE.EllipseCurve(
                0,
                0,
                semiMajor,
                semiMinor,
                0,
                Math.PI * 2,
                false,
                0
            );

        const points =
            curve.getPoints(160);

        const geometry =
            new THREE.BufferGeometry()
                .setFromPoints(
                    points.map(
                        (point) =>
                            new THREE.Vector3(
                                point.x,
                                0,
                                point.y
                            )
                    )
                );

        const material =
            new THREE.LineBasicMaterial({
                color:
                    SOLAR_SYSTEM_COLORS[
                        body.id
                    ] ||
                    0xffffff,
                transparent: true,
                opacity: 0.22,
                depthWrite: false,
            });

        return new THREE.LineLoop(
            geometry,
            material
        );
    }

    updateBodies(bodies) {
        this.bodiesData =
            Array.isArray(bodies)
                ? bodies
                : [];

        const sun =
            this.bodiesData.find(
                (body) =>
                    body.id === "sun"
            );

        if (!sun) {
            console.warn(
                "SolarSystem: Sun not available."
            );

            return;
        }

        const activeIds =
            new Set();

        for (
            const body of this.bodiesData
        ) {
            activeIds.add(body.id);

            let object =
                this.bodies.get(
                    body.id
                );

            if (!object) {
                object =
                    this.createSolarSystemBody(
                        body
                    );

                this.bodies.set(
                    body.id,
                    object
                );

                this.group.add(
                    object
                );

                const label =
                    this.createBodyLabel(
                        body
                    );

                label.position.set(
                    0,
                    (
                        SOLAR_SYSTEM_RADII[
                            body.id
                        ] ||
                        2.5
                    ) + 5,
                    0
                );

                object.add(label);

                this.labels.set(
                    body.id,
                    label
                );
            }

            const label =
                this.labels.get(
                    body.id
                );

            if (label) {
                label.visible =
                    this.labelsVisible;
            }

            object.position.copy(
                this.getVisualPosition(
                    body,
                    sun
                )
            );

            object.userData.apiData =
                body;

            object.visible = true;

            if (
                body.id !== "sun" &&
                body.id !== "moon" &&
                !this.orbitGroup
                    .getObjectByName(
                        `orbit-${body.id}`
                    )
            ) {
                const orbit =
                    this.createOrbit(
                        body,
                        sun
                    );

                if (orbit) {
                    orbit.name =
                        `orbit-${body.id}`;

                    this.orbitGroup.add(
                        orbit
                    );
                }
            }
        }

        /*
         * Remove stale bodies.
         */

        for (
            const [
                id,
                object,
            ] of this.bodies
        ) {
            if (
                !activeIds.has(id)
            ) {
                this.group.remove(
                    object
                );

                this.bodies.delete(
                    id
                );

                this.labels.delete(
                    id
                );
            }
        }

        /*
         * Remove stale orbits.
         */

        for (
            const orbit of [
                ...this.orbitGroup
                    .children,
            ]
        ) {
            const bodyId =
                orbit.name.replace(
                    "orbit-",
                    ""
                );

            if (
                !activeIds.has(
                    bodyId
                )
            ) {
                this.orbitGroup.remove(
                    orbit
                );

                orbit.geometry.dispose();
                orbit.material.dispose();
            }
        }

        this.orbitGroup.visible =
            this.orbitsVisible;

        console.log(
            `SOLAR SYSTEM: updated ${this.bodiesData.length} bodies`
        );
    }

    update(deltaTime) {
        const now =
            performance.now();

        for (
            const [
                id,
                object,
            ] of this.bodies
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
                object.userData
                    .cloudLayer
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

        if (
            earth &&
            moon
        ) {
            const angle =
                now *
                MOON_ORBIT_SPEED *
                this.animationSpeed *
                0.001;

            moon.position.set(
                earth.position.x +
                    Math.cos(angle) *
                    MOON_ORBIT_RADIUS,

                earth.position.y +
                    Math.sin(
                        angle * 0.35
                    ) *
                    3,

                earth.position.z +
                    Math.sin(angle) *
                    MOON_ORBIT_RADIUS
            );
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

    setAnimationSpeed(speed) {
        this.animationSpeed =
            Number.isFinite(speed)
                ? speed
                : 1;
    }

    getBody(id) {
        return (
            this.bodies.get(id) ||
            null
        );
    }

    getBodyPosition(id) {
        const body =
            this.getBody(id);

        return body
            ? body.position.clone()
            : null;
    }

    getEarthPosition() {
        return this.getBodyPosition(
            "earth"
        );
    }

    getSunPosition() {
        return this.getBodyPosition(
            "sun"
        );
    }

    getMarsPosition() {
        return this.getBodyPosition(
            "mars"
        );
    }

    getAllBodies() {
        return this.bodies;
    }
}

export {
    SolarSystem,
};