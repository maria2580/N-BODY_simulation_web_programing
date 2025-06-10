import WindowManager from './WindowManager.js';
// =================================================================================================================
// INITIALIZATION
// =================================================================================================================

const t = THREE;
let camera, scene, renderer, world;
let pixR = window.devicePixelRatio || 1;

const DIMENSIONS = [
    { name: "XYZ (Time)", projection: (pos) => new t.Vector3(pos.x, pos.y, pos.z), axes: { x: 'x', y: 'y', z: 'z' }, hidden: 't', desc: "기본 3D 공간입니다. 네 번째 차원(시간)은 객체의 크기와 투명도에 영향을 줍니다." },
    { name: "XYt (Z-Depth)", projection: (pos) => new t.Vector3(pos.x, pos.y, pos.t), axes: { x: 'x', y: 'y', z: 't' }, hidden: 'z', desc: "Z축이 시간(t)으로 대체되었습니다. 실제 Z 깊이는 객체의 크기와 투명도로 표현됩니다." },
    { name: "YZt (X-Depth)", projection: (pos) => new t.Vector3(pos.t, pos.y, pos.z), axes: { x: 't', y: 'y', z: 'z' }, hidden: 'x', desc: "X축이 시간(t)으로 대체되었습니다. 실제 X 깊이는 객체의 크기와 투명도로 표현됩니다." },
    { name: "XZt (Y-Depth)", projection: (pos) => new t.Vector3(pos.x, pos.t, pos.z), axes: { x: 'x', y: 't', z: 'z' }, hidden: 'y', desc: "Y축이 시간(t)으로 대체되었습니다. 실제 Y 깊이는 객체의 크기와 투명도로 표현됩니다." }
];

let objects4D = [];
let sceneMeshes = {};
let thisDimensionType = 0;
let allWindows = [];
let windowManager;
let initialized = false;
const clock = new t.Clock();
let TIME_SPEED = 0.01;

// --- 물리 상수 ---
let G = 98; // 중력 상수
let softening = 100.0;
const TOTAL_4D_SPEED = 30 * 1000;
const TOTAL_4D_SPEED_SQ = TOTAL_4D_SPEED * TOTAL_4D_SPEED;
const C = TOTAL_4D_SPEED; // 빛의 속도

// --- 입자 속성 ---
let RADIATION_CONSTANT = 0.05;
let COOLING_CONSTANT = 0.001;
let initialRadius = 10;
let positionSpread = 1000;
let velocitySpread = 10000;
let minTemperature = 500;
let temperatureRange = 2000;

// --- 시뮬레이션 상태 ---
let simulationStarted = false;

// --- 카메라 및 상호작용 상태 ---
const initialCameraPosition4D = { x: 1000, y: 1000, z: 1000, t: 1000 };
const initialCameraLookAt4D = { x: 0, y: 0, z: 0, t: 0 };
const FARPLANE = 1000000;

let camera4D = {
    position: { ...initialCameraPosition4D },
    quaternion: new t.Quaternion()
};

const controls = {
    moveForward: false, moveBackward: false, moveLeft: false, moveRight: false,
    moveUp: false, moveDown: false, rotateLeft: false, rotateRight: false,
    pitchUp: false, pitchDown: false
};


let followedParticleUUID = null;
let cameraOffset = new t.Vector3();
const raycaster = new t.Raycaster();
const mouse = new t.Vector2();

// --- 도플러 효과 상태 ---
let dopplerEffectActive = false;
let referenceHiddenVel = 0.0;


// =================================================================================================================
// MAIN LOGIC & SETUP
// =================================================================================================================

if (new URLSearchParams(window.location.search).get("clear")) {
    localStorage.clear();
} else {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== 'hidden' && !initialized) init();
    });
    window.onload = () => {
        if (document.visibilityState !== 'hidden') init();
    };
}

function init() {
    initialized = true;
    setTimeout(() => {
        setupScene();
        setupWindowManager();
        setupEventListeners();
        setupGlobalControls(); // 새로운 함수 호출
        resize();
        loadInitialCameraState();
        render();
    }, 500);
}

function setupGlobalControls() {
    const dropdowns = document.getElementsByClassName("dropdown-btn");
    for (let i = 0; i < dropdowns.length; i++) {
        dropdowns[i].addEventListener("click", function() {
            var dropdownContent = this.nextElementSibling;
            dropdownContent.classList.toggle("show");
        });
    }

    const linkSliderAndInput = (sliderId, valueId, variableUpdate) => {
        const slider = document.getElementById(sliderId);
        const valueSpan = document.getElementById(valueId);
        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            valueSpan.textContent = value.toFixed(slider.step.length > 2 ? 4 : 2);
            variableUpdate(value);
        });
    };

    linkSliderAndInput('g-slider', 'g-value', (value) => G = value);
    linkSliderAndInput('softening-slider', 'softening-value', (value) => softening = value);
    linkSliderAndInput('radiation-slider', 'radiation-value', (value) => RADIATION_CONSTANT = value);
    linkSliderAndInput('cooling-slider', 'cooling-value', (value) => COOLING_CONSTANT = value);
    linkSliderAndInput('time-speed-slider', 'time-speed-value', (value) => TIME_SPEED = value);
    linkSliderAndInput('radius-slider', 'radius-value', (value) => initialRadius = value);
    linkSliderAndInput('pos-spread-slider', 'pos-spread-value', (value) => positionSpread = value);
    linkSliderAndInput('vel-spread-slider', 'vel-spread-value', (value) => velocitySpread = value);
    linkSliderAndInput('temp-min-slider', 'temp-min-value', (value) => minTemperature = value);
    linkSliderAndInput('temp-range-slider', 'temp-range-value', (value) => temperatureRange = value);
}

function loadInitialCameraState() {
    const storedState = localStorage.getItem('cameraState');
    if (storedState) {
        const parsedState = JSON.parse(storedState);
        camera4D.position = parsedState.position;
        camera4D.quaternion.fromArray(parsedState.quaternion);
    } else {
        resetCameraState(false); // Don't save on initial load
    }
}

function setupScene() {
    camera = new t.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, FARPLANE);
    applyCameraState(); // Set initial camera from shared state

    scene = new t.Scene();
    scene.background = new t.Color(0x10101a);
    scene.fog = new t.Fog(0x10101a, 1500, FARPLANE);

    renderer = new t.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(pixR);

    world = new t.Object3D();
    scene.add(world);

    const ambientLight = new t.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new t.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(200, 500, 300);
    scene.add(directionalLight);

    const gridHelper = new t.GridHelper(4000, 40, 0x4a4a8f, 0x3a3a5f);
    world.add(gridHelper);

    const axesHelper = new t.AxesHelper(500);
    world.add(axesHelper);

    renderer.domElement.setAttribute("id", "scene");
    document.body.appendChild(renderer.domElement);
}

function setupWindowManager() {
    windowManager = new WindowManager();
    windowManager.setWinChangeCallback(onDataChange);
    
    let dimensionId = 0;
    const hash = window.location.hash.replace('#', '');
    if (hash && !isNaN(parseInt(hash))) {
        dimensionId = parseInt(hash) % DIMENSIONS.length;
    } else {
        const currentWindows = JSON.parse(localStorage.getItem("windows")) || [];
        const assignedDimensionIds = currentWindows.map(w => w.metaData.dimensionId);
        while (assignedDimensionIds.includes(dimensionId)) {
            dimensionId++;
        }
        dimensionId = dimensionId % DIMENSIONS.length;
    }
    window.location.hash = dimensionId; // Set hash for new windows

    windowManager.init({ dimensionId });
    loadFromStorage();
    populateDimensionModal();
}

function setupEventListeners() {
    window.addEventListener('resize', resize);
    document.getElementById('add-box-btn').addEventListener('click', addObject);
    document.getElementById('reset-btn').addEventListener('click', resetObjects);
    document.getElementById('camera-reset-btn').addEventListener('click', () => resetCameraState(true));
    document.getElementById('dimension-title').addEventListener('click', openDimensionModal);
    document.getElementById('close-modal-btn').addEventListener('click', closeDimensionModal);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    window.addEventListener('wheel', onMouseWheel);
    window.addEventListener('mousedown', onDocumentMouseDown, false);

    const infoPanel = document.getElementById('info');
    infoPanel.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    document.getElementById('doppler-btn').addEventListener('click', () => {
        if (followedParticleUUID) {
            dopplerEffectActive = !dopplerEffectActive;
            const followedObject = objects4D.find(obj => obj.uuid === followedParticleUUID);
            if (followedObject) {
                const hiddenDim = DIMENSIONS[thisDimensionType].hidden;
                referenceHiddenVel = followedObject.vel[hiddenDim];
            }
        }
    });
}

// =================================================================================================================
// DATA & STATE MANAGEMENT
// =================================================================================================================
function onDataChange(key, newValue) {
    try {
        if (key === "windows") {
            allWindows = JSON.parse(newValue);
            updateUI();
        }
        if (key === "objects4d") {
            const newObjects = JSON.parse(newValue);
            if (newObjects) {
                syncScene(newObjects);
            }
        }
        if (key === "followedParticleUUID") {
            const newFollowedId = newValue ? JSON.parse(newValue) : null;
            if (followedParticleUUID !== newFollowedId) {
                followedParticleUUID = newFollowedId;
                if (followedParticleUUID) {
                    document.getElementById('doppler-btn').disabled = false;
                    const targetMesh = sceneMeshes[followedParticleUUID];
                    if (targetMesh) {
                        // --- MODIFICATION START: Set initial follow distance to 1000 ---
                        const direction = new t.Vector3().subVectors(camera.position, targetMesh.position).normalize();
                        cameraOffset.copy(direction).multiplyScalar(1000);
                        // --- MODIFICATION END ---
                    }
                } else {
                    dopplerEffectActive = false;
                    document.getElementById('doppler-btn').disabled = true;
                }
            }
        }
        // MODIFICATION: Update UI when another window changes dimension
        if (key === "dimensionChange") {
            updateUI();
        }
        // MODIFICATION: Update camera from localStorage
        if (key === "cameraState") {
            const parsedState = JSON.parse(newValue);
            camera4D.position = parsedState.position;
            camera4D.quaternion.fromArray(parsedState.quaternion);
        }
    } catch(e) {}
}

function syncScene(newObjects) {
    objects4D = newObjects;
    const currentUUIDs = new Set(objects4D.map(o => o.uuid));

    for (const uuid in sceneMeshes) {
        if (!currentUUIDs.has(uuid)) {
            const mesh = sceneMeshes[uuid];
            world.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            delete sceneMeshes[uuid];
        }
    }

    for (const obj4D of objects4D) {
        if (!sceneMeshes[obj4D.uuid]) {
            const geometry = new t.SphereGeometry(1, 16, 16);
            const material = new t.MeshStandardMaterial({
                color: new t.Color(0x000000), // 기본 색상은 검정으로 하여 반사광을 최소화
                roughness: 0.8,
                metalness: 0.2,
                transparent: true,
                emissive: new t.Color(0x000000), // 발광색은 동적으로 업데이트
                emissiveIntensity: 1.0
            });
            const mesh = new t.Mesh(geometry, material);
            mesh.userData.uuid = obj4D.uuid;
            sceneMeshes[obj4D.uuid] = mesh;
            world.add(mesh);
        }
    }
    document.getElementById('object-count').innerText = `Particles: ${objects4D.length}`;
}

function loadFromStorage() {
    const storedObjects = localStorage.getItem("objects4d");
    if (storedObjects) {
        syncScene(JSON.parse(storedObjects));
    }
    const followedId = localStorage.getItem('followedParticleUUID');
    if (followedId) {
        onDataChange('followedParticleUUID', followedId);
    }
}

function saveToStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
    onDataChange(key, JSON.stringify(data));
}

function addObject() {
    if (!simulationStarted) {
        simulationStarted = true;
    }
    const count = parseInt(document.getElementById('particle-count-input').value) || 100;
    for (let i = 0; i < count; i++) {
        const newObj = {
            uuid: t.MathUtils.generateUUID(),
            colorId: Math.random(),
            mass: 1.0,
            temperature: minTemperature + Math.random() * temperatureRange,
            radius: initialRadius,
            pos: {
                x: (Math.random() - 0.5) * positionSpread,
                y: (Math.random() - 0.5) * positionSpread,
                z: (Math.random() - 0.5) * positionSpread,
                t: (Math.random() - 0.5) * 1
            },
            vel: {
                x: (Math.random() - 0.5) * velocitySpread,
                y: (Math.random() - 0.5) * velocitySpread,
                z: (Math.random() - 0.5) * velocitySpread,
                t: (Math.random() - 0.5) * 1
            }
        };
        objects4D.push(newObj);
    }
    saveToStorage('objects4d', objects4D);
}

function resetObjects() {
    objects4D = [];
    simulationStarted = false;
    dopplerEffectActive = false;
    saveToStorage('objects4d', objects4D);
}

// =================================================================================================================
// CAMERA CONTROLS & PARTICLE FOLLOWING
// =================================================================================================================
function onDocumentMouseDown(event) {
    event.preventDefault();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(Object.values(sceneMeshes));

    if (intersects.length > 0) {
        saveToStorage('followedParticleUUID', intersects[0].object.userData.uuid);
    } else {
        localStorage.removeItem('followedParticleUUID');
        onDataChange('followedParticleUUID', null);
    }
}

function onMouseWheel(event) {
    const zoomSpeed = 5;
    const moveVector = new t.Vector3();
    camera.getWorldDirection(moveVector);
    moveVector.multiplyScalar(-event.deltaY * zoomSpeed);

    if (followedParticleUUID) {
        cameraOffset.add(moveVector);
    } else {
        // Move in the direction of the current 3D view
        const dim = DIMENSIONS[thisDimensionType];
        camera4D.position[dim.axes.x] += moveVector.x;
        camera4D.position[dim.axes.y] += moveVector.y;
        camera4D.position[dim.axes.z] += moveVector.z;
    }
}


function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW': controls.moveForward = true; break;
        case 'KeyS': controls.moveBackward = true; break;
        case 'KeyA': controls.moveLeft = true; break;
        case 'KeyD': controls.moveRight = true; break;
        case 'Space': controls.moveUp = true; break;
        case 'ShiftLeft': case 'ShiftRight': controls.moveDown = true; break;
        case 'KeyQ': controls.rotateLeft = true; break;
        case 'KeyE': controls.rotateRight = true; break;
        case 'KeyR': controls.pitchUp = true; break;
        case 'KeyF': controls.pitchDown = true; break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW': controls.moveForward = false; break;
        case 'KeyS': controls.moveBackward = false; break;
        case 'KeyA': controls.moveLeft = false; break;
        case 'KeyD': controls.moveRight = false; break;
        case 'Space': controls.moveUp = false; break;
        case 'ShiftLeft': case 'ShiftRight': controls.moveDown = false; break;
        case 'KeyQ': controls.rotateLeft = false; break;
        case 'KeyE': controls.rotateRight = false; break;
        case 'KeyR': controls.pitchUp = false; break;
        case 'KeyF': controls.pitchDown = false; break;
    }
}

// MODIFICATION: Renamed from updateCamera to updateCameraState
function updateCameraState(deltaTime) {
    const moveSpeed = 800 / TIME_SPEED;
    const rotateSpeed = 1.5 / TIME_SPEED;
    if (followedParticleUUID) {
        updateFollowCamera(deltaTime, rotateSpeed);
    } else {
        updateFreeCameraState(deltaTime, moveSpeed, rotateSpeed);
    }
    // Save the updated state for other windows to consume
    saveToStorage('cameraState', {
        position: camera4D.position,
        quaternion: camera4D.quaternion.toArray()
    });
}

function updateFollowCamera(deltaTime, rotateSpeed) {
    const targetObj = objects4D.find(o => o.uuid === followedParticleUUID);
    if (!targetObj) {
        localStorage.removeItem('followedParticleUUID');
        onDataChange('followedParticleUUID', null);
        return;
    }
    const rotateAngle = rotateSpeed * deltaTime;
    const orbitSpeed = 100 * deltaTime;
    const yawAngle = (controls.moveLeft || controls.rotateLeft ? 1 : 0) * rotateAngle - (controls.moveRight || controls.rotateRight ? 1 : 0) * rotateAngle;
    if (Math.abs(yawAngle) > 0) {
        const yawQuaternion = new t.Quaternion().setFromAxisAngle(new t.Vector3(0, 1, 0), yawAngle);
        cameraOffset.applyQuaternion(yawQuaternion);
    }
    
    const pitchAngle = (controls.pitchUp ? -1 : 0) * rotateAngle + (controls.pitchDown ? 1 : 0) * rotateAngle;
    if (Math.abs(pitchAngle) > 0) {
        const right = new t.Vector3().crossVectors(camera.up, cameraOffset).normalize();
        const pitchQuaternion = new t.Quaternion().setFromAxisAngle(right, pitchAngle);
        cameraOffset.applyQuaternion(pitchQuaternion);
    }

    if (controls.moveForward) cameraOffset.multiplyScalar(1 - orbitSpeed * 0.01);
    if (controls.moveBackward) cameraOffset.multiplyScalar(1 + orbitSpeed * 0.01);
}

function updateFreeCameraState(deltaTime, moveSpeed, rotateSpeed) {
    const moveDistance = moveSpeed * deltaTime;
    const rotateAngle = rotateSpeed * deltaTime;
    
    const yawAngle = (controls.rotateLeft ? 1 : 0) * rotateAngle - (controls.rotateRight ? 1 : 0) * rotateAngle;
    const pitchAngle = (controls.pitchUp ? 1 : 0) * rotateAngle - (controls.pitchDown ? 1 : 0) * rotateAngle;

    const yawQuaternion = new t.Quaternion().setFromAxisAngle(new t.Vector3(0, 1, 0), yawAngle);
    const pitchQuaternion = new t.Quaternion().setFromAxisAngle(new t.Vector3(1, 0, 0), pitchAngle);
    
    camera4D.quaternion.premultiply(yawQuaternion).multiply(pitchQuaternion);

    const forward = new t.Vector3(0, 0, -1).applyQuaternion(camera4D.quaternion);
    const right = new t.Vector3(1, 0, 0).applyQuaternion(camera4D.quaternion);
    
    // --- MODIFICATION: Map 3D movement to 4D axes based on current view ---
    const dim = DIMENSIONS[thisDimensionType];
    const axes = dim.axes;

    const moveDirection = new t.Vector3();
    if (controls.moveForward) moveDirection.add(forward);
    if (controls.moveBackward) moveDirection.sub(forward);
    if (controls.moveLeft) moveDirection.sub(right);
    if (controls.moveRight) moveDirection.add(right);
    
    // Apply planar movement based on view axes
    camera4D.position[axes.x] += moveDirection.x * moveDistance;
    camera4D.position[axes.z] += moveDirection.z * moveDistance;
    
    // Vertical movement is always applied to the view's Y-axis
    if (controls.moveUp) camera4D.position[axes.y] += moveDistance;
    if (controls.moveDown) camera4D.position[axes.y] -= moveDistance;
}


function applyCameraState() {
    const dim = DIMENSIONS[thisDimensionType];
    
    if (followedParticleUUID) {
        const targetObj = objects4D.find(o => o.uuid === followedParticleUUID);
        if (targetObj) {
            const targetPos3D = dim.projection(targetObj.pos);
            camera.position.copy(targetPos3D).add(cameraOffset);
            camera.lookAt(targetPos3D);
        }
    } else {
        camera.position.copy(dim.projection(camera4D.position));
        camera.quaternion.copy(camera4D.quaternion);
    }
}

function resetCameraState(save = true) {
    localStorage.removeItem('followedParticleUUID');
    onDataChange('followedParticleUUID', null); 
    
    camera4D.position = { ...initialCameraPosition4D };
    
    // MODIFICATION: Calculate quaternion to look at origin
    const tempCam = new t.PerspectiveCamera();
    tempCam.position.set(initialCameraPosition4D.x, initialCameraPosition4D.y, initialCameraPosition4D.z);
    tempCam.lookAt(initialCameraLookAt4D.x, initialCameraLookAt4D.y, initialCameraLookAt4D.z);
    camera4D.quaternion.copy(tempCam.quaternion);

    if (save) {
        saveToStorage('cameraState', {
            position: camera4D.position,
            quaternion: camera4D.quaternion.toArray()
        });
    }
}

// =================================================================================================================
// UI & VISUALS
// =================================================================================================================

function updateUI() {
    const thisWindowData = windowManager.getThisWindowData();
    if (thisWindowData && thisWindowData.metaData) {
        thisDimensionType = thisWindowData.metaData.dimensionId;
        window.location.hash = thisDimensionType;
        const dimension = DIMENSIONS[thisDimensionType];
        if (dimension) {
            document.getElementById('dimension-title').innerText = `Dimension ${thisDimensionType + 1}: ${dimension.name}`;
            document.getElementById('dimension-desc').innerText = dimension.desc || "";
            updateAxesLegend(); // MODIFICATION: Call legend update
        }
    }
}

// MODIFICATION: New function to update the axes legend
function updateAxesLegend() {
    const dimension = DIMENSIONS[thisDimensionType];
    if (!dimension || !dimension.axes) return;

    document.getElementById('legend-x').innerHTML = `<span class="legend-color" style="background-color: #ff4444;"></span> ${dimension.axes.x.toUpperCase()}-Axis (Red)`;
    document.getElementById('legend-y').innerHTML = `<span class="legend-color" style="background-color: #44ff44;"></span> ${dimension.axes.y.toUpperCase()}-Axis (Green)`;
    document.getElementById('legend-z').innerHTML = `<span class="legend-color" style="background-color: #4444ff;"></span> ${dimension.axes.z.toUpperCase()}-Axis (Blue)`;
}

function openDimensionModal() {
    const modal = document.getElementById('dimension-modal');
    modal.classList.remove('modal-hidden');
}

function closeDimensionModal() {
    const modal = document.getElementById('dimension-modal');
    modal.classList.add('modal-hidden');
}

function populateDimensionModal() {
    const list = document.getElementById('dimension-list');
    list.innerHTML = '';
    DIMENSIONS.forEach((dim, index) => {
        const li = document.createElement('li');
        li.innerText = `Dimension ${index + 1}: ${dim.name}`;
        li.dataset.dimensionId = index;
        li.addEventListener('click', () => {
            changeDimension(index);
        });
        list.appendChild(li);
    });
}

function changeDimension(newDimensionId) {
    // MODIFICATION: Update URL hash when changing dimension
    window.location.hash = newDimensionId;
    windowManager.setThisWindowMetaData({ dimensionId: newDimensionId });
    updateUI();
    closeDimensionModal();
}

// =================================================================================================================
// PHYSICS ENGINE
// =================================================================================================================
function updatePhysics(deltaTime) {
    if (objects4D.length < 2) return;

    // --- MODIFICATION: Temperature update logic ---
    const tempChanges = new Array(objects4D.length).fill(0);

    for (let i = 0; i < objects4D.length; i++) {
        const emitter = objects4D[i];
        
        // 1. Cooling: Radiate energy based on own temperature
        const radiatedEnergy = COOLING_CONSTANT * Math.pow(emitter.temperature / 1000, 4) * deltaTime;
        tempChanges[i] -= radiatedEnergy;
        
        // 2. Heating: Absorb energy from others
        for (let j = 0; j < objects4D.length; j++) {
            if (i === j) continue;
            const dx = emitter.pos.x - objects4D[j].pos.x;
            const dy = emitter.pos.y - objects4D[j].pos.y;
            const dz = emitter.pos.z - objects4D[j].pos.z;
            const distSq = dx*dx + dy*dy + dz*dz;
            
            if (distSq > 0) {
                tempChanges[j] += (RADIATION_CONSTANT * Math.pow(emitter.temperature / 1000, 4)) / distSq * deltaTime;
            }
        }
    }
    
    // Apply temperature changes
    for (let i = 0; i < objects4D.length; i++) {
        objects4D[i].temperature = Math.max(0, objects4D[i].temperature + tempChanges[i]);
    }


    // --- Gravity and Velocity (largely the same) ---
    const forces = objects4D.map(() => ({ x: 0, y: 0, z: 0, t: 0 }));

    for (let i = 0; i < objects4D.length; i++) {
        for (let j = i + 1; j < objects4D.length; j++) {
            const objA = objects4D[i];
            const objB = objects4D[j];

            const dx = objB.pos.x - objA.pos.x;
            const dy = objB.pos.y - objA.pos.y;
            const dz = objB.pos.z - objA.pos.z;
            
            const distSq = dx*dx + dy*dy + dz*dz + softening;
            
            if (distSq > 0) {
                const dist = Math.sqrt(distSq);
                const forceMagnitude = (G * objA.mass * objB.mass) / distSq;
                const forceVec = 
                { 
                     x: forceMagnitude * (dx / dist),
                     y: forceMagnitude * (dy / dist),
                     z: forceMagnitude * (dz / dist) 
                    };
                forces[i].x += forceVec.x;
                forces[i].y += forceVec.y;
                forces[i].z += forceVec.z;
                forces[j].x -= forceVec.x;
                forces[j].y -= forceVec.y;
                forces[j].z -= forceVec.z;
            }
        }
    }
    
    for (let i = 0; i < objects4D.length; i++) {
        const obj = objects4D[i];
        const force = forces[i];
        const hiddenDim = DIMENSIONS[thisDimensionType].hidden;
        const spatialDims = ['x', 'y', 'z'];

        let v_sq_visible = 0;
        ['x', 'y', 'z', 't'].forEach(d => { if (d !== hiddenDim) v_sq_visible += obj.vel[d] * obj.vel[d]; });
        if (v_sq_visible >= TOTAL_4D_SPEED_SQ) v_sq_visible = TOTAL_4D_SPEED_SQ * 0.9999999;
        obj.mass = 1.0 / Math.sqrt(1.0 - v_sq_visible / TOTAL_4D_SPEED_SQ);
        spatialDims.forEach(d => { obj.vel[d] += (force[d] / obj.mass) * deltaTime; });
        let spatial_v_sq = obj.vel.x*obj.vel.x + obj.vel.y*obj.vel.y + obj.vel.z*obj.vel.z;

        if (spatial_v_sq > TOTAL_4D_SPEED_SQ) {
             const scale = Math.sqrt(TOTAL_4D_SPEED_SQ) / Math.sqrt(spatial_v_sq);
             obj.vel.x *= scale;
             obj.vel.y *= scale;
             obj.vel.z *= scale;
             spatial_v_sq = TOTAL_4D_SPEED_SQ;
        }
        obj.vel.t = Math.sqrt(TOTAL_4D_SPEED_SQ - spatial_v_sq) * (Math.sign(obj.vel.t) || (Math.random() > 0.5 ? 1 : -1));
        ['x', 'y', 'z', 't'].forEach(d => obj.pos[d] += obj.vel[d] * deltaTime);
    }

    // --- Collision and Merging ---
    const toRemove = new Set();
    for (let i = 0; i < objects4D.length; i++) {
        for (let j = i + 1; j < objects4D.length; j++) {
            const objA = objects4D[i];
            const objB = objects4D[j];

            if (toRemove.has(objA.uuid) || toRemove.has(objB.uuid)) continue;

            const dx = objB.pos.x - objA.pos.x;
            const dy = objB.pos.y - objA.pos.y;
            const dz = objB.pos.z - objA.pos.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            // MODIFICATION: Collision based on combined radii
            if (dist < (objA.radius + objB.radius)) {
                const absorber = objA.mass >= objB.mass ? objA : objB;
                const absorbed = objA.mass < objB.mass ? objA : objB;

                const totalMass = absorber.mass + absorbed.mass;
                
                // Conserve thermal energy: T_new = (m1*T1 + m2*T2) / (m1+m2)
                absorber.temperature = (absorber.mass * absorber.temperature + absorbed.mass * absorbed.temperature) / totalMass;
                ['x', 'y', 'z', 't'].forEach(d => {
                    absorber.vel[d] = (absorber.mass * absorber.vel[d] + absorbed.mass * absorbed.vel[d]) / totalMass;
                });
                absorber.mass = totalMass;
                absorber.radius = Math.pow(Math.pow(absorber.radius, 3) + Math.pow(absorbed.radius, 3), 1/3);

                toRemove.add(absorbed.uuid);
            }
        }
    }

    if (toRemove.size > 0) {
        objects4D = objects4D.filter(obj => !toRemove.has(obj.uuid));
    }
}

// =================================================================================================================
// RENDER LOOP
// =================================================================================================================

// MODIFICATION: Function to get color from temperature
function getBlackbodyColor(temp) {
    // Simple approximation of black-body radiation color
    if (temp <= 0) return new t.Color(0x000000);
    
    let color = new t.Color();
    // Clamp temperature for color calculation
    const clampedTemp = Math.max(100, Math.min(temp, 15000));
    
    // Red component
    let red = clampedTemp <= 6600 ? 255 : 329.698727446 * Math.pow(clampedTemp / 100 - 60, -0.1332047592);
    
    // Green component
    let green = clampedTemp <= 6600 
        ? 99.4708025861 * Math.log(clampedTemp / 100) - 161.1195681661
        : 288.1221695283 * Math.pow(clampedTemp / 100 - 60, -0.0755148492);
    
    // Blue component
    let blue = clampedTemp >= 6600 ? 255 : (clampedTemp <= 1900 ? 0 : 138.5177312231 * Math.log(clampedTemp / 100 - 10) - 305.0447927307);
    
    color.setRGB(
        Math.max(0, Math.min(255, red)) / 255,
        Math.max(0, Math.min(255, green)) / 255,
        Math.max(0, Math.min(255, blue)) / 255
    );

    return color;
}
// main.js
// main.js 파일의 render 함수를 아래 코드로 전체 교체하세요.

function render() {
    requestAnimationFrame(render);
    const deltaTime = clock.getDelta() * TIME_SPEED;

    let isMaster = false;
    let currentWindows = JSON.parse(localStorage.getItem("windows")) || [];
    
    if (currentWindows.length > 0) {
        let masterWindow = currentWindows[0];
        for (let i = 1; i < currentWindows.length; i++) {
            if (currentWindows[i].shape.y < masterWindow.shape.y || 
               (currentWindows[i].shape.y === masterWindow.shape.y && currentWindows[i].shape.x < masterWindow.shape.x)) {
                masterWindow = currentWindows[i];
            }
        }
        if (windowManager.getThisWindowID() === masterWindow.id) {
            isMaster = true;
        }
    }

    windowManager.update();
    updateCameraState(deltaTime);
    
    if (isMaster) {
        if (simulationStarted) {
            updatePhysics(deltaTime);
            saveToStorage('objects4d', objects4D);
        }
    }
    
    applyCameraState();

    const dimension = DIMENSIONS[thisDimensionType];
    for (const obj4D of objects4D) {
        const mesh = sceneMeshes[obj4D.uuid];
        if (mesh) {
            mesh.position.copy(dimension.projection(obj4D.pos));

            // =======================================================================
            // MODIFICATION START: 개선된 도플러 효과 시각화 로직
            // =======================================================================
            if (dopplerEffectActive) {
                const hiddenDim = dimension.hidden;
                const velDiff = obj4D.vel[hiddenDim] - referenceHiddenVel;
                
                // 1. 민감도 조절: 값을 낮추면 작은 속도 변화에도 색이 민감하게 변합니다.
                const maxColorRange = TOTAL_4D_SPEED / 15.0; 

                const normalizedDiff = Math.max(-1, Math.min(1, velDiff / maxColorRange));
                const absDiff = Math.abs(normalizedDiff);

                // 2. 색상(Hue) 결정: 멀어지면 빨강, 가까워지면 파랑으로 고정
                const hue = normalizedDiff < 0 ? 0.0 : 0.66; // 적색편이(Redshift)는 0.0, 청색편이(Blueshift)는 0.66

                // 3. 채도(Saturation)와 밝기(Lightness) 조절로 흰색에서부터 변화 구현
                //    - 채도: 속도 차이가 0일 때 0(무채색), 최대일 때 1(순색)
                //    - 밝기: 속도 차이가 0일 때 1(흰색), 최대일 때 0.5(본래 색)
                const saturation = absDiff;
                const lightness = 1.0 - (absDiff * 0.5);
                
                mesh.material.color.setHSL(hue, saturation, lightness);
                
                // 4. 발광(Emissive) 효과로 시인성 강화
                //    - 속도 차이가 클수록 더 강하게 빛나도록 설정
                mesh.material.emissive.setHSL(hue, saturation, lightness * 0.5); // 발광색은 기본색보다 약간 어둡게
                mesh.material.emissiveIntensity = absDiff * 1.5;

                // 5. 사라지는 효과 조절
                const fadeStartRange = maxColorRange * 0.9;
                const fadeEndRange = maxColorRange * 1.5;
                let opacity = 1.0;
                if (Math.abs(velDiff) > fadeStartRange) {
                    opacity = 1.0 - (Math.abs(velDiff) - fadeStartRange) / (fadeEndRange - fadeStartRange);
                }
                mesh.material.opacity = Math.max(0, opacity);

            } else {
                // 기존 온도 기반 흑체복사 효과
                const tempColor = getBlackbodyColor(obj4D.temperature);
                mesh.material.emissive.copy(tempColor);
                const intensity = Math.log(obj4D.temperature) * Math.log(obj4D.temperature) * 0.05;
                mesh.material.emissiveIntensity = Math.max(0.1, intensity);
                mesh.material.color.set(0x000000);
                mesh.material.opacity = 1.0; 
            }
            // =======================================================================
            // MODIFICATION END
            // =======================================================================

            mesh.scale.set(obj4D.radius, obj4D.radius, obj4D.radius);
        }
    }
    
    renderer.render(scene, camera);
}

// =================================================================================================================
// UTILITY FUNCTIONS
// =================================================================================================================

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
}