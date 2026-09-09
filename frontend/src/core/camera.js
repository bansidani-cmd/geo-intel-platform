import * as THREE from "three";

class CameraController {
    constructor(getCamera, getControls) {
        this.getCamera = getCamera;
        this.getControls = getControls;

        this.transition = null;
        this.animationFrame = null;
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
                ? position
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

transitionTo(position, target, duration = 1500, onComplete = null) 
{        const camera = this.camera;
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
        }

        if (controls) {
            controls.enabled = false;
        }

        const startTime = performance.now();

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
                camera.lookAt(endTarget);
            }

            if (progress < 1) {
                this.animationFrame =
                    requestAnimationFrame(
                        animate
                    );
            } else {
                this.animationFrame = null;

                if (controls) {
                    controls.enabled = true;
                }

                camera.lookAt(endTarget);

                if (controls) {
                    controls.target.copy(
                        endTarget
                    );
                }

                if (typeof onComplete === "function") {
    onComplete();
}
            }
        };

        this.animationFrame =
            requestAnimationFrame(animate);
    }
}

export { CameraController };

