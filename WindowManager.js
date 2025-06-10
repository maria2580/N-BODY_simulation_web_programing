class WindowManager {
    #windows;
    #count;
    #id;
    #winData;
    #winShapeChangeCallback;
    #winChangeCallback;

    constructor() {
        let that = this;
        addEventListener("storage", (event) => {
            // MODIFICATION: Add 'cameraState' to the list of keys to watch
            if (["windows", "objects4d", "followedParticleUUID", "dimensionChange", "cameraState"].includes(event.key)) {
                if (that.#winChangeCallback) that.#winChangeCallback(event.key, event.newValue);
            }
        });

        window.addEventListener('beforeunload', function(e) {
            if (!that.#id) return;
            let index = that.getWindowIndexFromId(that.#id);
            if (index !== -1) {
                that.#windows.splice(index, 1);
                that.updateWindowsLocalStorage();
            }
        });
    }

    #didWindowsChange(pWins, nWins) {
        if (!pWins || pWins.length !== nWins.length) {
            return true;
        } else {
            let c = false;
            for (let i = 0; i < pWins.length; i++) {
                if (pWins[i].id !== nWins[i].id) c = true;
            }
            return c;
        }
    }

    init(metaData) {
        this.#windows = JSON.parse(localStorage.getItem("windows")) || [];
        this.#count = parseInt(localStorage.getItem("count") || 0);
        this.#count++;
        this.#id = this.#count;
        let shape = this.getWinShape();
        this.#winData = { id: this.#id, shape: shape, metaData: metaData, lastSeen: Date.now() };
        this.#windows.push(this.#winData);
        this.#windows.sort((a, b) => a.id - b.id);
        localStorage.setItem("count", this.#count);
        this.updateWindowsLocalStorage();
    }

    getWinShape() {
        let shape = { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight };
        return shape;
    }

    getWindowIndexFromId(id) {
        for (let i = 0; i < this.#windows.length; i++) {
            if (this.#windows[i].id === id) return i;
        }
        return -1;
    }

    updateWindowsLocalStorage() {
        localStorage.setItem("windows", JSON.stringify(this.#windows));
        if (this.#winChangeCallback) this.#winChangeCallback("windows", JSON.stringify(this.#windows));
    }

    update() {
        if (!this.#winData) return;
        if (Date.now() - (this.#winData.lastSeen || 0) > 2000) {
            let currentWindowsInStorage = JSON.parse(localStorage.getItem("windows")) || [];
            let thisWindowFound = false;
            for (let i = 0; i < currentWindowsInStorage.length; i++) {
                if (currentWindowsInStorage[i].id === this.#id) {
                    currentWindowsInStorage[i].lastSeen = Date.now();
                    this.#winData.lastSeen = currentWindowsInStorage[i].lastSeen;
                    thisWindowFound = true;
                    break;
                }
            }
            if (!thisWindowFound) {
                currentWindowsInStorage.push(this.#winData);
                currentWindowsInStorage.sort((a, b) => a.id - b.id);
            }
            this.#windows = currentWindowsInStorage;
            this.updateWindowsLocalStorage();
        }

        let winShape = this.getWinShape();
        if (winShape.x !== this.#winData.shape.x ||
            winShape.y !== this.#winData.shape.y ||
            winShape.w !== this.#winData.shape.w ||
            winShape.h !== this.#winData.shape.h) {
            this.#winData.shape = winShape;
            let index = this.getWindowIndexFromId(this.#id);
            if (index !== -1) {
                this.#windows[index].shape = winShape;
            }
            if (this.#winShapeChangeCallback) this.#winShapeChangeCallback();
            this.updateWindowsLocalStorage();
        }
    }

    setWinShapeChangeCallback(callback) {
        this.#winShapeChangeCallback = callback;
    }

    setWinChangeCallback(callback) {
        this.#winChangeCallback = callback;
    }

    getWindows() {
        return this.#windows || [];
    }

    getThisWindowData() {
        return this.#winData;
    }

    setThisWindowMetaData(metaData) {
        if (this.#winData) {
            this.#winData.metaData = metaData;
            const index = this.getWindowIndexFromId(this.#id);
            if (index !== -1) {
                this.#windows[index].metaData = metaData;
                this.updateWindowsLocalStorage();
                localStorage.setItem('dimensionChange', JSON.stringify({ id: this.#id, ...metaData }));
            }
        }
    }

    getThisWindowID() {
        return this.#id;
    }
}

export default WindowManager;