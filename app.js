import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Variables globales
let container;
let camera, scene, renderer;
let controller;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let model = null;
let isPlaced = false;
let isARMode = false;

// Variables para gestos
let initialTouchDistance = 0;
let initialScale = new THREE.Vector3();
let initialAngle = 0;
let initialRotation = 0;

const STATE = { NONE: -1, ROTATE: 0, TOUCH_START: 1, DRAG: 2, PINCH: 3 };
let state = STATE.NONE;
let startingTouchPosition = new THREE.Vector2();
let previousTouchPosition = new THREE.Vector2();

// Detectar SO
function detectOS() {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'iOS';
    if (/Android/.test(ua)) return 'Android';
    return 'Desktop';
}

const deviceOS = detectOS();

init();
animate();

function init() {
    try {
        container = document.createElement('div');
        document.body.appendChild(container);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a1a);

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

        // Elementos DOM
        const overlay = document.getElementById('overlay');
        const introScreen = document.getElementById('intro-screen');
        const arUI = document.getElementById('ar-ui');

        // Cargar modelo
        loadModelAsync();

        // Setup según SO
        if (deviceOS === 'iOS') {
            setupIOSMode(introScreen);
        } else if (deviceOS === 'Android') {
            setupAndroidMode(overlay, introScreen);
        } else {
            setupDesktopMode(introScreen);
        }

        // Controlador
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

        // Event listeners
        overlay.addEventListener('touchstart', onTouchStart, { passive: false });
        overlay.addEventListener('touchmove', onTouchMove, { passive: false });
        overlay.addEventListener('touchend', onTouchEnd);

        document.getElementById('reset-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            resetScene();
        });

        window.addEventListener('resize', onWindowResize);

        // Monitorear carga del modelo
        monitorModelLoading(introScreen, arUI);

    } catch (error) {
        console.error('Error en init:', error);
        document.getElementById('intro-screen').innerHTML = '<h1>Error</h1><p>' + error.message + '</p>';
    }
}

function loadModelAsync() {
    const loader = new GLTFLoader();
    
    console.log('Iniciando carga del modelo...');
    
    loader.load(
        'LAMPARA.glb',
        function (gltf) {
            model = gltf.scene;
            model.visible = false;
            model.scale.set(1, 1, 1);
            scene.add(model);
            console.log('✓ Modelo cargado');
        },
        function (progress) {
            console.log('Cargando:', Math.round((progress.loaded / progress.total) * 100) + '%');
        },
        function (error) {
            console.error('✗ Error cargando modelo:', error);
        }
    );
}

function monitorModelLoading(introScreen, arUI) {
    let timeElapsed = 0;
    
    const checkInterval = setInterval(() => {
        timeElapsed += 100;
        
        if (model) {
            clearInterval(checkInterval);
            console.log('Modelo detectado, mostrado UI');
            
            // Mostrar según modo
            if (deviceOS !== 'Android') {
                introScreen.style.display = 'none';
                arUI.style.display = 'flex';
                isPlaced = true;
                model.visible = true;
                model.position.z = (deviceOS === 'iOS') ? -1 : -1.5;
                animateScaleIn();
            }
        } else if (timeElapsed > 12000) {
            clearInterval(checkInterval);
            console.warn('Timeout cargando modelo');
            introScreen.innerHTML = '<h1>Error</h1><p>No se pudo cargar el modelo</p>';
        } else {
            // Actualizar texto loading
            const dots = Math.floor((timeElapsed / 300) % 4);
            introScreen.querySelector('p').textContent = 'Cargando' + '.'.repeat(dots);
        }
    }, 100);
}

function setupIOSMode(introScreen) {
    console.log('Modo iOS');
    introScreen.innerHTML = `<h1>Visualizador Memphis</h1><p>Cargando...</p>`;
}

function setupAndroidMode(overlay, introScreen) {
    console.log('Modo Android');
    introScreen.innerHTML = `<h1>Visualizador Memphis</h1><p>Cargando...</p>`;
    
    // AR listeners
    renderer.xr.addEventListener('sessionstart', () => {
        introScreen.style.display = 'none';
        document.getElementById('ar-ui').style.display = 'flex';
        isARMode = true;
    });

    renderer.xr.addEventListener('sessionend', () => {
        introScreen.style.display = 'block';
        document.getElementById('ar-ui').style.display = 'none';
        resetScene();
        isARMode = false;
    });

    // Crear botón AR si está soportado
    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-ar').then(supported => {
            if (supported) {
                try {
                    const arButton = ARButton.createButton(renderer, {
                        requiredFeatures: ['hit-test'],
                        optionalFeatures: ['dom-overlay'],
                        domOverlay: { root: overlay }
                    });
                    document.body.appendChild(arButton);
                    console.log('✓ Botón AR creado');
                } catch (e) {
                    console.error('Error creando ARButton:', e);
                }
            }
        });
    }
}

function setupDesktopMode(introScreen) {
    console.log('Modo Desktop');
    introScreen.innerHTML = `<h1>Visualizador Memphis</h1><p>Cargando...</p>`;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelect() {
    if (reticle.visible && model && !isPlaced) {
        model.position.setFromMatrixPosition(reticle.matrix);
        model.quaternion.setFromRotationMatrix(reticle.matrix);
        model.scale.set(0, 0, 0);
        model.visible = true;
        isPlaced = true;
        reticle.visible = false;

        animateScaleIn();
        document.getElementById('instructions').textContent = "Usa gestos para mover";
        document.getElementById('reset-btn').classList.remove('hidden');
    }
}

function animateScaleIn() {
    const start = performance.now();
    const duration = 600;

    function update(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        
        if (model) model.scale.set(ease, ease, ease);

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
    document.getElementById('instructions').textContent = "Apunta al suelo";
    document.getElementById('reset-btn').classList.add('hidden');
    hitTestSourceRequested = false;
    hitTestSource = null;
}

function onTouchStart(event) {
    if (!isPlaced) return;

    if (event.touches.length === 1) {
        state = STATE.DRAG;
        startingTouchPosition.set(event.touches[0].pageX, event.touches[0].pageY);
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

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    if (frame && isARMode) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then(function (refSpace) {
                session.requestHitTestSource({ space: refSpace }).then(function (source) {
                    hitTestSource = source;
                });
            });

            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);

            if (hitTestResults.length > 0 && !isPlaced) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
                
                document.getElementById('instructions').textContent = "Toca para colocar";
            } else {
                reticle.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}
