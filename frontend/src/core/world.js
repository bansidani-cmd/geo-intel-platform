import * as THREE from "three";

class World {
    constructor() {
        this.scene = new THREE.Scene();

        this.earth = null;
        this.solarSystem = null;
        this.journey = null;

        this.initialized = false;
    }

    initialize() {
        if (this.initialized) {
            return;
        }

        this.scene.background =
            new THREE.Color(0x000000);

        this.initialized = true;
    }

    setEarth(earthWorld) {
        this.earth = earthWorld;
    }

    setSolarSystem(solarSystem) {
        this.solarSystem = solarSystem;
    }

    setJourney(journeyWorld) {
        this.journey = journeyWorld;
    }
}

const worldState = new World();

export {
    World,
    worldState,
};