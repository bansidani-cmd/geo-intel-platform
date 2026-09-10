import * as THREE from "three";

class CameraController {
    constructor(getCamera, getControls) {
        this.getCamera = getCamera;
        this.getControls = getControls;

        this.transition = null;
        this.animationFrame = null;
        this.panStarted = false;
    }

    get camera() {
        return this.getCamera();
    }

    get controls() {
        return this.getControls();
    }

    lookAt(target) {
        const camera = this.camera;
        const controls = this.controls;

        if (!camera) return;

        const targetVector =
            target instanceof THREE.Vector3
                ? target.clone()
                : new THREE.Vector3(
                      target.x,
                      target.y,
                      target.z
                  );

        camera.lookAt(targetVector);

        if (controls) {
            controls.target.copy(targetVector);
        }
    }

    setPosition(position) {
        const camera = this.camera;

        if (!camera) return;

        const positionVector =
            position instanceof THREE.Vector3
                ? position.clone()
                : new THREE.Vector3(
                      position.x,
                      position.y,
                      position.z
                  );

        camera.position.copy(positionVector);
    }

    setView(position, target) {
        this.setPosition(position);
        this.lookAt(target);
    }

    transitionTo(
        position,
        target,
        duration = 1500,
        onComplete = null
    ) {
        const camera = this.camera;
        const controls = this.controls;

        if (!camera) return;

        const startPosition =
            camera.position.clone();

        const startTarget =
            controls
                ? controls.target.clone()
                : new THREE.Vector3();

        const endPosition =
            position instanceof THREE.Vector3
                ? position.clone()
                : new THREE.Vector3(
                      position.x,
                      position.y,
                      position.z
                  );

        const endTarget =
            target instanceof THREE.Vector3
                ? target.clone()
                : new THREE.Vector3(
                      target.x,
                      target.y,
                      target.z
                  );

        if (this.animationFrame) {
            cancelAnimationFrame(
                this.animationFrame
            );

            this.animationFrame = null;
        }

        if (controls) {
            controls.enabled = false;
        }

        const startTime =
            performance.now();

        const easeInOutCubic = (t) => {
            return t < 0.5
                ? 4 * t * t * t
                : 1 -
                  Math.pow(-2 * t + 2, 3) / 2;
        };

        const animate = (now) => {

            const elapsed =
                now - startTime;

            const progress =
                Math.min(
                    elapsed / duration,
                    1
                );

            const eased =
                easeInOutCubic(progress);

            camera.position.lerpVectors(
                startPosition,
                endPosition,
                eased
            );

            if (controls) {

                controls.target.lerpVectors(
                    startTarget,
                    endTarget,
                    eased
                );

                camera.lookAt(
                    controls.target
                );

            } else {

                camera.lookAt(
                    endTarget
                );
            }

            if (progress < 1) {

                this.animationFrame =
                    requestAnimationFrame(
                        animate
                    );

                return;
            }

            camera.position.copy(
                endPosition
            );

            camera.lookAt(
                endTarget
            );

            if (controls) {

                controls.target.copy(
                    endTarget
                );

                controls.enabled = true;
            }

            this.animationFrame = null;

            if (
                typeof onComplete ===
                "function"
            ) {
                onComplete();
            }
        };

        this.animationFrame =
            requestAnimationFrame(
                animate
            );
    }

    transitionCinematic(
        position,
        target,
        options = {}
    ) {
        const camera = this.camera;
        const controls = this.controls;

        if (!camera) return;

        const {
            duration = 3200,
            zoomOutDistance = 350,
            onPanStart = null,
            onZoomInStart = null,
            onComplete = null,
        } = options;

        const startPosition =
            camera.position.clone();

        const startTarget =
            controls
                ? controls.target.clone()
                : new THREE.Vector3();

        const endPosition =
            position instanceof THREE.Vector3
                ? position.clone()
                : new THREE.Vector3(
                      position.x,
                      position.y,
                      position.z
                  );

        const endTarget =
            target instanceof THREE.Vector3
                ? target.clone()
                : new THREE.Vector3(
                      target.x,
                      target.y,
                      target.z
                  );

        if (this.animationFrame) {
            cancelAnimationFrame(
                this.animationFrame
            );

            this.animationFrame = null;
        }

        if (controls) {
            controls.enabled = false;
        }

        this.panStarted = false;
        this.zoomInStarted = false;

        const viewDirection =
            startPosition
                .clone()
                .sub(startTarget)
                .normalize();

        const zoomOutPosition =
            startPosition
                .clone()
                .add(
                    viewDirection.multiplyScalar(
                        zoomOutDistance
                    )
                );

        const zoomOutTarget =
            startTarget.clone();

        const panPosition =
            endPosition
                .clone()
                .normalize()
                .multiplyScalar(
                    endPosition.length() +
                    zoomOutDistance
                );

        const panTarget =
            endTarget.clone();

        const startTime =
            performance.now();

        const easeInOutCubic = (t) => {
            return t < 0.5
                ? 4 * t * t * t
                : 1 -
                  Math.pow(-2 * t + 2, 3) / 2;
        };

        const animate = (now) => {

            const elapsed =
                now - startTime;

            const progress =
                Math.min(
                    elapsed / duration,
                    1
                );

            if (progress < 0.33) {

                const t =
                    progress / 0.33;

                const eased =
                    easeInOutCubic(t);

                camera.position.lerpVectors(
                    startPosition,
                    zoomOutPosition,
                    eased
                );

                if (controls) {

                    controls.target.lerpVectors(
                        startTarget,
                        zoomOutTarget,
                        eased
                    );
                }

            } else if (progress < 0.67) {

                if (!this.panStarted) {

                    this.panStarted = true;

                    if (
                        typeof onPanStart ===
                        "function"
                    ) {
                        onPanStart();
                    }
                }

                const t =
                    (progress - 0.33) / 0.34;

                const eased =
                    easeInOutCubic(t);

                camera.position.lerpVectors(
                    zoomOutPosition,
                    panPosition,
                    eased
                );

                if (controls) {

                    controls.target.lerpVectors(
                        zoomOutTarget,
                        panTarget,
                        eased
                    );
                }

            } else {

                if (!this.zoomInStarted) {

                    this.zoomInStarted = true;

                    if (
                        typeof onZoomInStart ===
                        "function"
                    ) {
                        onZoomInStart();
                    }
                }

                const t =
                    (progress - 0.67) / 0.33;

                const eased =
                    easeInOutCubic(t);

                camera.position.lerpVectors(
                    panPosition,
                    endPosition,
                    eased
                );

                if (controls) {

                    controls.target.lerpVectors(
                        panTarget,
                        endTarget,
                        eased
                    );
                }
            }

            if (controls) {

                camera.lookAt(
                    controls.target
                );

            } else {

                camera.lookAt(
                    endTarget
                );
            }

            if (progress < 1) {

                this.animationFrame =
                    requestAnimationFrame(
                        animate
                    );

                return;
            }

            camera.position.copy(
                endPosition
            );

            camera.lookAt(
                endTarget
            );

            if (controls) {

                controls.target.copy(
                    endTarget
                );

                controls.enabled = true;
            }

            this.animationFrame = null;

            if (
                typeof onComplete ===
                "function"
            ) {
                onComplete();
            }
        };

        this.animationFrame =
            requestAnimationFrame(
                animate
            );
    }
}

export {
    CameraController,
};