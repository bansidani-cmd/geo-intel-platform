import * as THREE from "three";

class EarthWorld {
    constructor(globe) {
        this.globe = globe;

        this.group = new THREE.Group();
        this.group.name = "EarthWorld";

        this.initialized = false;
    }

    initialize(scene) {
        if (this.initialized) {
            return;
        }

        if (!this.globe) {
            throw new Error(
                "EarthWorld: Globe.gl instance is required."
            );
        }

        const globeScene = this.globe.scene();

        scene.add(this.group);

        this.initialized = true;

        console.log(
            "EarthWorld initialized."
        );
    }

    getPosition() {
        return this.group.position.clone();
    }
}

export {
    EarthWorld,
};