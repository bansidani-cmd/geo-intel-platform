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

        scene.add(this.group);

        this.initialized = true;

        console.log(
            "EarthWorld initialized."
        );
    }

    setVisible(visible) {
        if (!this.globe) {
            return;
        }

        const material =
            this.globe.globeMaterial();

        if (!material) {
            return;
        }

        material.transparent = !visible;
        material.opacity = visible ? 1 : 0;
        material.depthWrite = visible;

        this.globe.showAtmosphere(visible);

        this.globe.scene().traverse((obj) => {
            if (
                obj.isMesh &&
                obj.material === material
            ) {
                obj.visible = visible;
            }
        });
    }

    getPosition() {
        return this.group.position.clone();
    }
}

export {
    EarthWorld,
};