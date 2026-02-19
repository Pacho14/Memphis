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
let isARMode = false; // True si WebXR está activo
let deviceOS = detectOS(); // 'iOS' o 'Android'

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

// Detector de SO
function detectOS() {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'iOS';
    if (/Android/.test(ua)) return 'Android';
    return 'Desktop';
}

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

    // Setup por SO
    const overlay = document.getElementById('overlay');
    const introScreen = document.getElementById('intro-screen');
    const arUI = document.getElementById('ar-ui');
    
    if (deviceOS === 'iOS') {
        // iOS: Modo 3D interactivo sin WebXR
        initIOSMode(overlay, introScreen, arUI);
    } else if (deviceOS === 'Android') {
        // Android: Intentar WebXR
        initAndroidMode(overlay, introScreen, arUI);
    } else {
        // Desktop: Fallback 3D
        initDesktopMode(overlay, introScreen, arUI);
    }

    // Cargar Modelo (común para todos)
    loadModel();

    // Controlador para "Select" (toque simple para colocar)
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    // Retícula
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Event Listeners para Gestos
    overlay.addEventListener('touchstart', onTouchStart, { passive: false });
    overlay.addEventListener('touchmove', onTouchMove, { passive: false });
    overlay.addEventListener('touchend', onTouchEnd);

    // Botón Reset
    document.getElementById('reset-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        resetScene();
    });

    window.addEventListener('resize', onWindowResize);
}

// --- MODOS DE INICIALIZACIÓN ---

function initAndroidMode(overlay, introScreen, arUI) {
    // Detectar inicio de sesión AR
    renderer.xr.addEventListener('sessionstart', () => {
        introScreen.style.display = 'none';
        arUI.style.display = 'flex';
        isARMode = true;
    });

    renderer.xr.addEventListener('sessionend', () => {
        introScreen.style.display = 'block';
        arUI.style.display = 'none';
        resetScene();
        isARMode = false;
    });

    // Verificar soporte de WebXR en Android
    if (!navigator.xr) {
        console.warn('WebXR no disponible en este Android');
        initDesktopMode(overlay, introScreen, arUI);
        return;
    }

    navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (!supported) {
            console.warn('AR no soportado');
            initDesktopMode(overlay, introScreen, arUI);
            return;
        }
        
        // Crear botón AR
        try {
            const arButton = ARButton.createButton(renderer, {
                requiredFeatures: ['hit-test'],
                optionalFeatures: ['dom-overlay'],
                domOverlay: { root: overlay }
            });
            document.body.appendChild(arButton);
            console.log('ARButton creado exitosamente');
        } catch (error) {
            console.error('Error creando ARButton:', error);
            initDesktopMode(overlay, introScreen, arUI);
        }
    }).catch(err => {
        console.error('Error verificando soporte AR:', err);
        initDesktopMode(overlay, introScreen, arUI);
    });
}

function initIOSMode(overlay, introScreen, arUI) {
    // iOS: Modo 3D interactivo sin WebXR
    console.log('Iniciando modo iOS (3D interactivo)');
    
    introScreen.innerHTML = `
        <h1>🎨 Visualizador 3D</h1>
        <p>Usa tus dedos para interactuar con el modelo</p>
        <p style="font-size: 0.85em; color: #999;">
            • Un dedo: mover<br>
            • Dos dedos: rotar y escalar
        </p>
    `;
    
    // Esperar a que el modelo cargue (máximo 8 segundos)
    waitForModel(() => {
        introScreen.style.display = 'none';
        arUI.style.display = 'flex';
        isPlaced = true;
        if (model) {
            model.visible = true;
            model.position.z = -1;
            animateScaleIn();
        } else {
            showFallbackUI(introScreen, arUI);
        }
    });
}

function initDesktopMode(overlay, introScreen, arUI) {
    // Desktop/Fallback: Modo 3D básico
    console.log('Iniciando modo Desktop (3D básico)');
    
    introScreen.innerHTML = `
        <h1>🎨 Visualizador 3D</h1>
        <p>Para mejor experiencia, accede desde Android</p>
        <p style="font-size: 0.85em; color: #999;">
            Este dispositivo no soporta AR
        </p>
    `;
    
    // Esperar a que el modelo cargue
    waitForModel(() => {
        introScreen.style.display = 'none';
        arUI.style.display = 'flex';
        isPlaced = true;
        if (model) {
            model.visible = true;
            model.position.z = -1.5;
            animateScaleIn();
        } else {
            showFallbackUI(introScreen, arUI);
        }
    });
}

function loadModel() {
    const loader = new GLTFLoader();
    // Ensure correct path for GitHub Pages
    const modelPath = './LAMPARA.glb';
    
    console.log('Intentando cargar modelo desde:', modelPath);
    
    loader.load(modelPath,
        function (gltf) {
            model = gltf.scene;
            model.visible = false;
            scene.add(model);
            console.log("✓ Model loaded successfully");
        },
        function (progress) {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            console.log('Loading model:', percent + '%');
        },
        function (error) {
            console.error('✗ Error loading model:', error);
            model = null; // Mark model as failed
        }
    );
}

function waitForModel(callback, timeout = 8000) {
    const startTime = Date.now();
    
    function check() {
        if (model) {
            console.log('✓ Modelo cargado, iniciando...');
            callback();
        } else if (Date.now() - startTime < timeout) {
            setTimeout(check, 500);
        } else {
            console.warn('⏱ Timeout esperando modelo');
            callback();
        }
    }
    
    check();
}

function showFallbackUI(introScreen, arUI) {
    introScreen.innerHTML = `
        <h1>⚠️ Modelo no disponible</h1>
        <p>El modelo 3D no se cargó correctamente.</p>
        <p style="font-size: 0.85em; color: #999;">
            Intenta recargar la página.
        </p>
    `;
    introScreen.style.display = 'flex';
    arUI.style.display = 'none';
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
    // Solo usar hit test en modo AR
    if (frame && isARMode) {
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
                
                const instr = document.getElementById('instructions');
                if (instr.textContent.includes('mueve')) instr.textContent = "Toca para colocar";

            } else {
                reticle.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}

// --- Gestos Táctiles y Control ---
function onSelect() {
    if (reticle.visible && model && !isPlaced) {
        model.position.setFromMatrixPosition(reticle.matrix);
        model.quaternion.setFromRotationMatrix(reticle.matrix);
        model.scale.set(0, 0, 0);
        model.visible = true;
        isPlaced = true;
        reticle.visible = false;

        animateScaleIn();
        
        document.getElementById('instructions').textContent = "Usa gestos para mover, rotar o escalar";
        document.getElementById('reset-btn').classList.remove('hidden');
    }
}

function animateScaleIn() {
    let scale = 0;
    const duration = 600;
    const start = performance.now();

    function update(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        
        scale = ease;
        if (model) model.scale.set(scale, scale, scale);

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
        model.scale.set(1, 1, 1);
    }
    document.getElementById('instructions').textContent = "Apunta al suelo y mueve suavemente el móvil";
    document.getElementById('reset-btn').classList.add('hidden');
    
    hitTestSourceRequested = false; 
    hitTestSource = null;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onTouchStart(event) {
    if (!isPlaced) return;

    if (event.touches.length === 1) {
        state = STATE.DRAG;
        startingTouchPosition.set(event.touches[0].pageX, event.touches[0].pageY);
        previousTouchPosition.copy(startingTouchPosition);
    } else if (event.touches.length === 2) {
        state = STATE.PINCH;
        
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
    event.preventDefault();

    if (state === STATE.DRAG && event.touches.length === 1) {
        handleDrag(event.touches[0].pageX, event.touches[0].pageY);

    } else if (state === STATE.PINCH && event.touches.length === 2) {
        const dx = event.touches[0].pageX - event.touches[1].pageX;
        const dy = event.touches[0].pageY - event.touches[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (initialTouchDistance > 0) {
            const scaleFactor = distance / initialTouchDistance;
            const newScale = Math.max(0.1, Math.min(initialScale.x * scaleFactor, 5.0));
            model.scale.set(newScale, newScale, newScale);
        }

        const angle = Math.atan2(dy, dx);
        const rotationChange = angle - initialAngle;
        model.rotation.y = initialRotation - rotationChange;
    }
}

function onTouchEnd(event) {
    state = STATE.NONE;
}

function handleDrag(x, y) {
    const mouse = new THREE.Vector2();
    mouse.x = (x / window.innerWidth) * 2 - 1;
    mouse.y = -(y / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -model.position.y);
    const target = new THREE.Vector3();
    
    if (raycaster.ray.intersectPlane(plane, target)) {
        model.position.x = target.x;
        model.position.z = target.z;
    }
}