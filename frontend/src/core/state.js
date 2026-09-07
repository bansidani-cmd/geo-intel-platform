const appState = {
    mode: "earth",

    journey: {
        active: false,
        missionId: null,
        mission: null,
        currentTime: null,
        currentPhase: null,
        coordinateSystem: null,
        spacecraftPosition: null,
        trajectory: null,

        playback: {
            playing: false,
            speed: 1,
        },
    },

    earth: {
        layersVisible: true,

        layers: {
            event: true,
            ship: true,
            flight: true,
            quake: true,
            satellite: true,
            launch: true,
            disaster: true,
        },
    },

    solar: {
        selectedBody: null,
    },

    selection: {
        id: null,
        type: null,
    },
};

const listeners = new Set();

function getState() {
    return appState;
}

function subscribe(listener) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

function notifyStateChange() {
    for (const listener of listeners) {
        listener(appState);
    }
}

function setState(updater) {
    updater(appState);
    notifyStateChange();
}

export {
    appState,
    getState,
    subscribe,
    setState,
};