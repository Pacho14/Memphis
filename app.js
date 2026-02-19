import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let container;
let camera, scene, renderer;
let controller;

let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;

let model = null;
let isPlaced = false;

// Variables para gestos
let initialTouchDistance = 0;
let initialScale = new THREE.Vector3();
let initialAngle = 0;
let initialRotation = 0;
let toneMappingExposure = 1.0;

// Estado del gesto
const STATE = { NONE: -1, ROTATE: 0, TOUCH_START: 1, DRAG: 2, PINCH: 3 };
let state = STATE.NONE;
let startingTouchPosition = new THREE.Vector2();
let previousTouchPosition = new THREE.Vector2();

init();
animate();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // Iluminación
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // Renderizador
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // Setup ARButton con 'dom-overlay' para permitir UI e interacción táctil
    const overlay = document.getElementById('overlay');
    const introScreen = document.getElementById('intro-screen');
    const arUI = document.getElementById('ar-ui');
    
    document.body.appendChild(ARButton.createButton(renderer, { 
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: overlay }
    }));

    // Detectar inicio de sesión AR para cambiar UI
    renderer.xr.addEventListener('sessionstart', () => {
        introScreen.style.display = 'none';
        arUI.style.display = 'flex';
    });

    renderer.xr.addEventListener('sessionend', () => {
        introScreen.style.display = 'block';
        arUI.style.display = 'none';
        resetScene();
    });

    // Controlador para "Select" (toque simple para colocar)
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    // Retícula
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff }) // Solo anillo blanco
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Cargar Modelo
    const loader = new GLTFLoader();
    loader.load('LAMPARA.glb', function (gltf) {
        model = gltf.scene;
        // Ajuste inicial si es necesario, pero lo haremos al colocar
        model.visible = false; 
        scene.add(model);
        console.log("Model loaded");
    });

    // Event Listeners para Gestos (Touch Events en el Overlay)
    overlay.addEventListener('touchstart', onTouchStart, { passive: false });
    overlay.addEventListener('touchmove', onTouchMove, { passive: false });
    overlay.addEventListener('touchend', onTouchEnd);

    // Botón Reset
    document.getElementById('reset-btn').addEventListener('click', (e) => {
        e.stopPropagation(); // Evitar que el click se propague al canvas/AR
        resetScene();
    });

    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Lógica de Colocación ---

function onSelect() {
    if (reticle.visible && model && !isPlaced) {
        // Colocar modelo
        model.position.setFromMatrixPosition(reticle.matrix);
        // Orientar hacia la cámara (solo eje Y)
        model.quaternion.setFromRotationMatrix(reticle.matrix);
        // model.lookAt(camera.position.x, model.position.y, camera.position.z); // Opcional: rotar hacia usuario

        model.scale.set(0, 0, 0);
        model.visible = true;
        isPlaced = true;
        reticle.visible = false;

        // Animar entrada
        animateScaleIn();
        
        // UI Update
        document.getElementById('instructions').textContent = "Usa gestos para mover, rotar o escalar";
        document.getElementById('reset-btn').classList.remove('hidden');
    }
}

function animateScaleIn() {
    let scale = 0;
    const duration = 600; // ms
    const start = performance.now();

    function update(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing: easeOutCubic
        const ease = 1 - Math.pow(1 - progress, 3);
        
        scale = ease;
        model.scale.set(scale, scale, scale);

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    requestAnimationFrame(update);
}

function resetScene() {
    isPlaced = false;
    if (model) {
        model.visible = false;
        model.scale.set(1, 1, 1); // Reset scale memory
    }
    document.getElementById('instructions').textContent = "Apunta al suelo y mueve suavemente el móvil";
    document.getElementById('reset-btn').classList.add('hidden');
    
    // Reiniciar hit test si es necesario
    hitTestSourceRequested = false; 
    hitTestSource = null;
}

// --- Gestos Táctiles ---

function onTouchStart(event) {
    if (!isPlaced) return; // Solo gestos si el modelo está colocado

    if (event.touches.length === 1) {
        state = STATE.DRAG;
        startingTouchPosition.set(event.touches[0].pageX, event.touches[0].pageY);
        previousTouchPosition.copy(startingTouchPosition);
    } else if (event.touches.length === 2) {
        state = STATE.PINCH; // Consideramos PINCH y ROTATE juntos
        
        const dx = event.touches[0].pageX - event.touches[1].pageX;
        const dy = event.touches[0].pageY - event.touches[1].pageY;
        initialTouchDistance = Math.sqrt(dx * dx + dy * dy);
        initialScale.copy(model.scale);

        initialAngle = Math.atan2(dy, dx);
        initialRotation = model.rotation.y;
    }
}

function onTouchMove(event) {
    if (!isPlaced || !model) return;
    event.preventDefault(); // Evitar scroll

    if (state === STATE.DRAG && event.touches.length === 1) {
        // Simple Drag visual (mejorable con Raycaster real contra plano "infinito" en altura del modelo)
        // Por ahora, asumimos que el usuario "arrastra" en pantalla
        // Para "Drag" correcto en AR, necesitamos hacer raycast de la nueva posición del dedo 
        // contra el plano horizontal donde está el objeto.
        // Simplificación: Delta en pantalla -> Delta en mundo? No es preciso.
        // Mejor enfoque: re-run hit test or raycast plane at model height.
        // Dado que Hit Test es caro y asincrono, usamos un plano matemático.
        
        handleDrag(event.touches[0].pageX, event.touches[0].pageY);

    } else if (state === STATE.PINCH && event.touches.length === 2) {
        // Escalar / Rotar
        const dx = event.touches[0].pageX - event.touches[1].pageX;
        const dy = event.touches[0].pageY - event.touches[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Escala
        if (initialTouchDistance > 0) {
            const scaleFactor = distance / initialTouchDistance;
            // Limitar escala
            const newScale = Math.max(0.1, Math.min(initialScale.x * scaleFactor, 5.0));
            model.scale.set(newScale, newScale, newScale);
        }

        // Rotación
        const angle = Math.atan2(dy, dx);
        const rotationChange = angle - initialAngle;
        model.rotation.y = initialRotation - rotationChange;
    }
}

function onTouchEnd(event) {
    state = STATE.NONE;
}

function handleDrag(x, y) {
    // Convertir coordenadas de pantalla a Device Coordinates normalizadas (-1 a +1)
    const mouse = new THREE.Vector2();
    mouse.x = (x / window.innerWidth) * 2 - 1;
    mouse.y = -(y / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Crear un plano matemático horizontal a la altura del modelo
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -model.position.y);
    const target = new THREE.Vector3();
    
    if (raycaster.ray.intersectPlane(plane, target)) {
        model.position.x = target.x;
        model.position.z = target.z;
        // Mantenemos Y original
    }
}

// --- Loop Principal ---

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                    hitTestSource = source;
                });
            });

            session.addEventListener('end', function () {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });

            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);

            if (hitTestResults.length > 0 && !isPlaced) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
                
                // Actualizar texto si estaba buscando
                const instr = document.getElementById('instructions');
                if (instr.textContent.includes('mueve')) instr.textContent = "Toca para colocar";

            } else {
                reticle.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}
