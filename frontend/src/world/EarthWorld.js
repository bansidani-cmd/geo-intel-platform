import * as THREE from "three";

class EarthWorld {
    constructor(globe) {
        this.globe = globe;

        this.group = new THREE.Group();
        this.group.name = "EarthWorld";

        this.initialized = false;
        this.fadeAnimationFrame = null;
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

        if (this.fadeAnimationFrame) {
            cancelAnimationFrame(
                this.fadeAnimationFrame
            );

            this.fadeAnimationFrame = null;
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


fadeOut(duration = 650, onComplete = null) {
    if (!this.globe) {
        return;
    }

    if (this.fadeAnimationFrame) {
        cancelAnimationFrame(
            this.fadeAnimationFrame
        );

        this.fadeAnimationFrame = null;
    }

    const material =
        this.globe.globeMaterial();

    if (!material) {
        return;
    }

    material.transparent = true;
    material.depthWrite = false;
    material.opacity = 1;

    // Make sure atmosphere starts fully visible.
    this.globe.showAtmosphere(false);

    this.globe.scene().traverse((obj) => {
        if (
            obj.isMesh &&
            obj.material === material
        ) {
            obj.visible = true;
        }
    });

    const startTime =
        performance.now();

    const animate = (now) => {

        const progress =
            Math.min(
                (now - startTime) / duration,
                1
            );

        const eased =
            1 -
            Math.pow(
                1 - progress,
                3
            );

        material.opacity =
            1 - eased;

        if (progress < 1) {

            this.fadeAnimationFrame =
                requestAnimationFrame(
                    animate
                );

            return;
        }

        // Completely remove every Earth component.
        material.opacity = 0;
        material.transparent = true;
        material.depthWrite = false;

        this.globe.showAtmosphere(false);

        this.globe.scene().traverse(
            (obj) => {
                if (
                    obj.isMesh &&
                    obj.material === material
                ) {
                    obj.visible = false;
                }
            }
        );

        this.fadeAnimationFrame = null;

        if (
            typeof onComplete ===
            "function"
        ) {
            onComplete();
        }
    };

    this.fadeAnimationFrame =
        requestAnimationFrame(
            animate
        );
}



    fadeIn(duration = 700, onComplete = null) {
        if (!this.globe) {
            return;
        }

        if (this.fadeAnimationFrame) {
            cancelAnimationFrame(
                this.fadeAnimationFrame
            );

            this.fadeAnimationFrame = null;
        }

        const material =
            this.globe.globeMaterial();

        if (!material) {
            return;
        }

        material.transparent = true;
        material.depthWrite = false;
        material.opacity = 0;

        this.globe.showAtmosphere(true);

        this.globe.scene().traverse((obj) => {
            if (
                obj.isMesh &&
                obj.material === material
            ) {
                obj.visible = true;
            }
        });

        const startTime =
            performance.now();

        const animate = (now) => {

            const progress =
                Math.min(
                    (now - startTime) /
                        duration,
                    1
                );

            const eased =
                1 -
                Math.pow(
                    1 - progress,
                    3
                );

            material.opacity = eased;

            if (progress < 1) {

                this.fadeAnimationFrame =
                    requestAnimationFrame(
                        animate
                    );

                return;
            }

            material.opacity = 1;
            material.transparent = false;
            material.depthWrite = true;

            this.fadeAnimationFrame = null;

            if (
                typeof onComplete ===
                "function"
            ) {
                onComplete();
            }
        };

        this.fadeAnimationFrame =
            requestAnimationFrame(
                animate
            );
    }

    getPosition() {
        return this.group.position.clone();
    }
}

export {
    EarthWorld,
};
