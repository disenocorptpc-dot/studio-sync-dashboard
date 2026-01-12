import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy, writeBatch, getDocs, getDoc, arrayUnion } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBq4Y-zfQvksbFe36vb0pjagNu8poHvjyg",
    authDomain: "speed-dashboard-8a1a9.firebaseapp.com",
    projectId: "speed-dashboard-8a1a9",
    storageBucket: "speed-dashboard-8a1a9.firebasestorage.app",
    messagingSenderId: "650632424816",
    appId: "1:650632424816:web:bd37e796996ad3db9273b5",
    measurementId: "G-WDR0Z2EDHC"
};

let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (e) { console.error(e); }

const canvas = document.querySelector('#multiview-canvas');
const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const STAGES = ["1. Boceto / Concepto", "2. Modelado 3D", "3. Slicer / Prep", "4. Impresión 3D", "5. Estructura / Lijado", "6. Acabados / Pintura"];
let scenes = [];
let sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
let projects = [];
let geometryCache = new Map();
let loader = new OBJLoader();
let dragSrcIndex = null;
let loadingProjects = new Set();

init();

function init() {
    loadDefaultObj();
    subscribeToProjects();
    window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));
    window.addEventListener('scroll', () => renderer.setSize(window.innerWidth, window.innerHeight), true);

    const style = document.createElement('style');
    style.textContent = `
        .project-card.dragging { opacity: 0.4; border: 2px dashed #00f3ff; }
        .drag-over { transform: scale(1.02); box-shadow: 0 0 20px rgba(0, 243, 255, 0.2); border-color: #00f3ff; }
        .drag-handle { cursor: grab; padding: 5px; color: #555; } .drag-handle:hover { color: #fff; }
        
        /* BITÁCORA STYLES */
        .log-container {
            margin-top: 10px;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 6px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .log-scroll-area {
            height: 120px;
            overflow-y: auto;
            padding: 8px;
            display: flex;
            flex-direction: column-reverse; /* Newest at bottom visually, or top? Let's stick to standard chat: newest at bottom, but for logs usually newest top. Let's do Standard list: top is old, bottom is new, scroll to bottom. */
            scroll-behavior: smooth;
        }
        /* Custom Scrollbar for Log */
        .log-scroll-area::-webkit-scrollbar { width: 4px; }
        .log-scroll-area::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        
        .log-entry {
            margin-bottom: 8px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            padding-bottom: 4px;
            font-size: 0.8rem;
            color: #ccc;
            font-family: 'Outfit', sans-serif;
            text-align: left;
        }
        .log-date {
            display: block;
            font-size: 0.65rem;
            color: #00f3ff;
            margin-bottom: 2px;
            font-family: 'Rajdhani', monospace;
        }
        .log-input-area {
            display: flex;
            border-top: 1px solid rgba(255,255,255,0.1);
        }
        .log-input {
            flex: 1;
            background: rgba(0,0,0,0.2);
            border: none;
            color: white;
            padding: 8px;
            font-size: 0.8rem;
            outline: none;
            font-family: 'Outfit';
        }
        .log-btn {
            background: #00f3ff22;
            color: #00f3ff;
            border: none;
            padding: 0 12px;
            cursor: pointer;
            font-weight: bold;
            transition: 0.2s;
        }
        .log-btn:hover { background: #00f3ff44; }

        /* Estado por defecto (PC): Arriba Derecha */
        #db-status { 
            position: fixed; 
            top: 20px; 
            right: 20px; 
            z-index: 9999; 
            display: flex; 
            align-items: center; 
            gap: 8px; 
            font-family: 'Rajdhani'; 
            font-weight: bold; 
            background: rgba(0,0,0,0.8); 
            padding: 5px 10px; 
            border-radius: 20px; 
            border: 1px solid #333; 
        }

        /* MOBILE STATUS: Abajo Derecha (estilo whatsapp/chat) para no tapar el titulo */
        @media (max-width: 768px) {
            #db-status {
                top: auto;
                bottom: 20px;
                right: 20px;
                font-size: 0.7rem;
                padding: 4px 8px;
            }
        }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; transition: all 0.3s; }
        .debug-info { font-size: 0.7rem; color: #ffae00; margin-top: 5px; font-family: monospace; }
        .download-btn { background: #00f3ff; color: #000; border: none; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; cursor: pointer; margin-left: 5px; }
    `;
    document.head.appendChild(style);

    const statusDiv = document.createElement('div');
    statusDiv.id = "db-status";
    statusDiv.innerHTML = `<div class="status-dot" style="background:gray;"></div><span id="status-text" style="color:gray;">CONNECTING...</span>`;
    document.body.appendChild(statusDiv);
}

function updateStatus(color, msg) {
    const el = document.querySelector('.status-dot');
    const txt = document.getElementById('status-text');
    if (el && txt) {
        el.style.background = color;
        el.style.boxShadow = `0 0 10px ${color}`;
        txt.innerText = msg;
        txt.style.color = color;
    }
}

function subscribeToProjects() {
    const q = query(collection(db, "projects"), orderBy("order", "asc"));
    onSnapshot(q, (snapshot) => {
        if (!snapshot.metadata.hasPendingWrites) updateStatus('#00ff9d', 'ONLINE');

        projects = [];
        snapshot.forEach((doc) => projects.push({ ...doc.data(), id: doc.id }));

        projects.forEach(p => {
            if (p.hasCloudModel && !geometryCache.has('cloud_' + p.id) && !loadingProjects.has(p.id)) {
                downloadModelChunks(p.id);
            }
        });
        renderCards();
    }, (error) => {
        console.error(error);
        updateStatus('#ff0055', 'PERMISSION ERROR');
    });
}

// UPLOAD
window.loadCustomModel = (id, input) => {
    const file = input.files[0]; if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const textContent = e.target.result;
        try {
            const object = loader.parse(textContent);
            let newGeo = null; let maxV = 0;
            object.traverse((child) => { if (child.isMesh) { const c = child.geometry.attributes.position.count; if (c > maxV) { maxV = c; newGeo = child.geometry; } } });
            if (newGeo) {
                processGeometry(newGeo);
                updateSceneGeometry(id, newGeo);
                geometryCache.set('cloud_' + id, newGeo);
            }
        } catch (err) { console.error(err); }
        uploadModelChunks(id, textContent);
    };
    reader.readAsText(file);
};

async function uploadModelChunks(id, fullText) {
    updateStatus('#ffae00', 'UPLOADING...');
    const dbg = document.getElementById(`debug-${id}`);
    if (dbg) dbg.innerText = "Starting Upload...";

    try {
        const CHUNK_SIZE = 200000;
        const totalChunks = Math.ceil(fullText.length / CHUNK_SIZE);
        const batch = writeBatch(db);

        for (let i = 0; i < totalChunks; i++) {
            const chunkContent = fullText.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const chunkRef = doc(db, "projects", id, "chunks", i.toString().padStart(4, '0'));
            batch.set(chunkRef, { content: chunkContent, index: i });
        }
        const projRef = doc(db, "projects", id);
        batch.update(projRef, { hasCloudModel: true, modelTimestamp: Date.now(), totalChunks: totalChunks });

        await batch.commit();
        updateStatus('#00ff9d', 'UPLOAD DONE');
        if (dbg) dbg.innerText = `Uploaded ${totalChunks} parts.`;
    } catch (e) {
        console.error("Chunk Upload Error", e);
        updateStatus('#ff0055', 'UPLOAD FAIL');
        if (dbg) dbg.innerText = "Upload Failed: " + e.message;
    }
}

// DOWNLOAD
window.forceDownload = (id) => downloadModelChunks(id);
async function downloadModelChunks(id) {
    loadingProjects.add(id);
    const dbg = document.getElementById(`debug-${id}`);
    if (dbg) dbg.innerText = "Downloading...";

    try {
        const chunksRef = collection(db, "projects", id, "chunks");
        const q = query(chunksRef, orderBy("index"));
        const snapshot = await getDocs(q);
        let fullText = ""; let count = 0;
        snapshot.forEach(doc => { fullText += doc.data().content; count++; });

        if (dbg) dbg.innerText = `Got ${count} parts. Parsing...`;

        if (fullText.length > 50) {
            const obj = loader.parse(fullText);
            let best = null, max = 0;
            obj.traverse(c => { if (c.isMesh && c.geometry.attributes.position.count > max) { max = c.geometry.attributes.position.count; best = c.geometry; } });

            if (best) {
                processGeometry(best);
                geometryCache.set('cloud_' + id, best);
                updateSceneGeometry(id, best);
                if (dbg) dbg.innerText = "Ready.";
            } else {
                if (dbg) dbg.innerText = "Parsing failed (No Mesh).";
            }
        }
    } catch (e) { console.error("Download Error", e); if (dbg) dbg.innerText = "Error: " + e.message; }
    finally { loadingProjects.delete(id); }
}

function updateSceneGeometry(projectId, geometry) {
    const proj = projects.find(p => p.id === projectId);
    if (proj) proj.runtimeGeometry = geometry;
    const s = scenes.find(x => x.projectId === projectId);
    if (s) {
        // Wireframe Support: update both meshes in the group
        if (s.mesh.isGroup) {
            s.mesh.children.forEach(child => {
                if (child.isMesh) child.geometry = geometry;
            });
        } else if (s.mesh.isMesh) {
            s.mesh.geometry = geometry;
        }

        normalizeScale(s.mesh);
    }
}

function normalizeScale(m) {
    // 1. Reset scale to avoid compound scaling issues
    m.scale.set(1, 1, 1);
    m.updateMatrixWorld(true);

    // 2. Compute bounds of the RAW geometry/group
    const b = new THREE.Box3().setFromObject(m);
    const s = new THREE.Vector3(); b.getSize(s);
    const max = Math.max(s.x, s.y, s.z);

    // 3. Apply scale to fit target size (3.5 units)
    if (max > 0) m.scale.setScalar(3.5 / max);
}

function renderCards() {
    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';
    scenes = [];

    projects.forEach((proj, idx) => {
        if (!proj.responsible) proj.responsible = Array(6).fill("");
        if (!proj.phaseStarts) proj.phaseStarts = Array(6).fill("");
        if (!proj.phaseEnds) proj.phaseEnds = Array(6).fill("");

        // DATA MIGRATION: Convert old 'notes' string to 'logs' array on the fly for display
        let displayLogs = proj.logs || [];
        if (!proj.logs || proj.logs.length === 0) {
            if (proj.notes && proj.notes.trim() !== "") {
                displayLogs = [{ text: proj.notes, date: new Date().toISOString() }];
            }
        }
        // Sor logs: Newest at the bottom is standard for chat, but let's do Newest at TOP for bitacora visibility?
        // Let's do standard chronological order (Newest Last) and scroll to bottom.
        // Or Newest Top (First in list). Let's do Newest Top so user sees latest updates immediately without scrolling.
        // Sorting:
        displayLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

        const card = document.createElement('div');
        card.className = 'project-card';
        card.id = `card-dom-${proj.id}`;
        card.dataset.index = idx;
        card.draggable = true;

        card.addEventListener('dragstart', handleDragStart); card.addEventListener('dragover', handleDragOver);
        card.addEventListener('dragenter', handleDragEnter); card.addEventListener('dragleave', handleDragLeave);
        card.addEventListener('drop', handleDrop); card.addEventListener('dragend', handleDragEnd);

        let stagesHTML = '';
        STAGES.forEach((label, i) => {
            const isChecked = proj.progress >= i ? 'checked' : '';
            const resp = proj.responsible[i] || "";
            let bar = `<div style="height:4px;width:100%;background:rgba(255,255,255,0.02);margin-top:5px;"></div>`;
            const s = proj.phaseStarts[i], e = proj.phaseEnds[i];
            if (s && e) {
                const start = new Date(s).getTime(), end = new Date(e).getTime(), now = new Date().getTime();
                if (end >= start) {
                    const pct = Math.max(0, Math.min(100, ((now - start) / (end - start + 86400000)) * 100));
                    bar = `<div style="width:100%;height:8px;background:#000;margin-top:5px;border-radius:3px;position:relative;"><div style="width:${pct}%;height:100%;background:${pct >= 100 ? '#00ff9d' : '#00f3ff'};"></div></div>`;
                }
            }
            stagesHTML += `
                <div style="margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:5px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <label style="display:flex;align-items:center;color:white;font-size:0.9rem;">
                            <input type="checkbox" ${isChecked} onchange="window.updateProjectState('${proj.id}', ${i}, this)">
                            <span style="margin-left:8px;">${label}</span>
                        </label>
                        <div>
                            <input placeholder="Resp." value="${resp}" onblur="window.updateResponsible('${proj.id}', ${i}, this.value)" style="width:50px;background:#000;border:1px solid #333;color:#00f3ff;text-align:center;">
                            <button onclick="document.getElementById('d-${proj.id}-${i}').style.display=document.getElementById('d-${proj.id}-${i}').style.display==='none'?'flex':'none'" style="background:none;border:none;color:#555;cursor:pointer;">📅</button>
                        </div>
                    </div>
                    ${bar}
                    <div id="d-${proj.id}-${i}" style="display:none;margin-top:5px;">
                        <input type="date" value="${s}" onchange="window.updatePhaseDate('${proj.id}', ${i}, 'start', this.value)" style="width:48%;">
                        <input type="date" value="${e}" onchange="window.updatePhaseDate('${proj.id}', ${i}, 'end', this.value)" style="width:48%;">
                    </div>
                </div>
            `;
        });

        // GENERATE LOGS HTML
        let logsHTML = displayLogs.map(log => {
            const d = new Date(log.date);
            const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="log-entry">
                    <span class="log-date">${dateStr}</span>
                    <span>${log.text}</span>
                </div>
            `;
        }).join('');

        let debugHTML = "";
        if (proj.hasCloudModel) {
            debugHTML = `<div class="debug-info" id="debug-${proj.id}">☁️ Cloud Model Available <button class="download-btn" onclick="window.forceDownload('${proj.id}')">RELOAD 3D</button></div>`;
        }

        card.innerHTML = `
            <div class="card-header">
                <div class="drag-handle">⋮⋮</div>
                <div><h3 contenteditable="true" onblur="window.updateMeta('${proj.id}', 'name', this.innerText)" style="color:white;margin:0;">${proj.name}</h3><p contenteditable="true" onblur="window.updateMeta('${proj.id}', 'client', this.innerText)" style="color:#888;font-size:0.8rem;margin:0;">${proj.client}</p></div>
                <button onclick="window.deleteProject('${proj.id}')" style="background:#ff005533;color:#ff0055;border:1px solid #ff0055;border-radius:4px;width:24px;">×</button>
            </div>
            <div class="viewer-3d-container">
                 <label class="obj-upload-btn">📂<input type="file" accept=".obj" onchange="window.loadCustomModel('${proj.id}', this)"></label>
                 ${debugHTML}
            </div>
            <div class="controls-section">
                ${stagesHTML}
                <div style="margin-top:15px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;gap:5px;"><span style="font-size:0.75rem;color:#888;">ENTREGA:</span><input type="date" value="${proj.deadline}" onchange="window.updateDate('${proj.id}', this)" style="background:transparent;border:none;color:#fff;font-weight:bold;"></div>
                    <span style="font-size:0.75rem;color:#00f3ff;font-weight:bold;">📋 BITÁCORA</span>
                </div>
                
                <!-- NEW LOG SYSTEM -->
                <div class="log-container">
                    <div class="log-scroll-area">
                        ${logsHTML}
                    </div>
                    <div class="log-input-area">
                        <input type="text" class="log-input" placeholder="Escribir nota..." onkeypress="if(event.key==='Enter') window.addLog('${proj.id}', this)">
                        <button class="log-btn" onclick="window.addLogBtn('${proj.id}')">➤</button>
                    </div>
                </div>

            </div>
            <div style="height:4px;background:#222;"><div style="height:100%;width:${(proj.progress + 1) * 16.6}%;background:#00f3ff;"></div></div>
        `;
        grid.appendChild(card);
        setTimeout(() => initSceneForCard(card, proj), 0);
    });

    // ADD BTN
    const addBtn = document.createElement('div');
    addBtn.className = 'add-card-btn';
    addBtn.innerHTML = '<h1>+</h1><p>NUEVO</p>';
    addBtn.onclick = window.addProject;
    grid.appendChild(addBtn);
}

// LOG LOGIC
window.addLog = (id, inputEl) => {
    const text = inputEl.value.trim();
    if (!text) return;
    saveLogToFirebase(id, text);
    inputEl.value = ''; // clear
};
window.addLogBtn = (id) => {
    // Find input in specific card
    const card = document.getElementById(`card-dom-${id}`);
    const input = card.querySelector('.log-input');
    window.addLog(id, input);
};

async function saveLogToFirebase(id, text) {
    updateStatus('#ffae00', 'SAVING LOG...');
    const newEntry = { text: text, date: new Date().toISOString() };

    const projRef = doc(db, "projects", id);
    try {
        await updateDoc(projRef, {
            logs: arrayUnion(newEntry)
        });
        updateStatus('#00ff9d', 'LOG SAVED');
    } catch (e) {
        console.error(e);
        updateStatus('#ff0055', 'LOG ERROR');
    }
}


// UTILS
window.addProject = async () => { try { await addDoc(collection(db, "projects"), { name: "Nuevo Proyecto", client: "Cliente...", deadline: new Date().toISOString().split('T')[0], progress: 0, order: projects.length, responsible: Array(6).fill(""), notes: "", logs: [], phaseStarts: Array(6).fill(""), phaseEnds: Array(6).fill("") }); } catch (e) { console.error(e); } };
window.deleteProject = async (id) => { if (confirm("¿Borrar?")) await deleteDoc(doc(db, "projects", id)); };
window.updateMeta = (id, f, v) => debounceUpdate(id, { [f]: v });
// window.updateNotes removed in favor of logs, but kept for legacy text areas if needed (not needed here)
window.updateDate = (id, i) => updateDoc(doc(db, "projects", id), { deadline: i.value });
window.updateResponsible = (id, idx, v) => { const p = projects.find(x => x.id === id); let r = [...p.responsible]; r[idx] = v; updateDoc(doc(db, "projects", id), { responsible: r }); };
window.updatePhaseDate = (id, idx, t, v) => { const p = projects.find(x => x.id === id); let s = [...p.phaseStarts], e = [...p.phaseEnds]; if (t === 'start') s[idx] = v; else e[idx] = v; updateDoc(doc(db, "projects", id), { phaseStarts: s, phaseEnds: e }); };
window.updateProjectState = (id, s, c) => { if (!c.checked) return; updateDoc(doc(db, "projects", id), { progress: s }); };
let timeouts = {}; function debounceUpdate(id, d) { if (timeouts[id]) clearTimeout(timeouts[id]); timeouts[id] = setTimeout(() => updateDoc(doc(db, "projects", id), d), 500); }
function handleDragStart(e) { this.classList.add('dragging'); dragSrcIndex = Number(this.dataset.index); e.dataTransfer.effectAllowed = 'move'; }
function handleDragOver(e) { e.preventDefault(); }
function handleDragEnter() { this.classList.add('drag-over'); }
function handleDragLeave() { this.classList.remove('drag-over'); }
function handleDragEnd() { this.classList.remove('dragging'); document.querySelectorAll('.project-card').forEach(c => c.classList.remove('drag-over')); }
async function handleDrop(e) { e.stopPropagation(); const tIdx = Number(this.dataset.index); if (dragSrcIndex !== tIdx) { const m = projects[dragSrcIndex]; projects.splice(dragSrcIndex, 1); projects.splice(tIdx, 0, m); const b = writeBatch(db); projects.forEach((p, i) => b.update(doc(db, "projects", p.id), { order: i })); await b.commit(); renderCards(); } }
function initSceneForCard(card, proj) {
    const el = card.querySelector('.viewer-3d-container');
    const sc = new THREE.Scene();

    // Tech Light Setup
    const l1 = new THREE.DirectionalLight(0xffffff, 2); l1.position.set(5, 10, 7); sc.add(l1);
    sc.add(new THREE.AmbientLight(0x555555));

    const cam = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100);
    cam.position.set(0, 1.5, 6);
    cam.lookAt(0, 0, 0);

    let geo = sharedGeometry;
    if (proj.runtimeGeometry) geo = proj.runtimeGeometry;
    else if (geometryCache.has('cloud_' + proj.id)) geo = geometryCache.get('cloud_' + proj.id);

    // TECH STYLE: Hidden Line Wireframe
    // 1. The Mask (Solid Black Mesh to hide back lines)
    const matSolid = new THREE.MeshBasicMaterial({
        color: 0x050505, // Almost black
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    // 2. The Grid (Cyan Wireframe)
    const matWire = new THREE.MeshBasicMaterial({
        color: 0x00f3ff, // Cyber Cyan
        wireframe: true,
        transparent: true,
        opacity: 0.4
    });

    const meshSolid = new THREE.Mesh(geo, matSolid);
    normalizeScale(meshSolid); // Scale the solid one first

    const meshWire = new THREE.Mesh(geo, matWire);
    meshWire.scale.copy(meshSolid.scale); // Copy scale to wireframe

    const group = new THREE.Group();
    group.add(meshSolid);
    group.add(meshWire);

    sc.add(group);
    scenes.push({ scene: sc, camera: cam, element: el, mesh: group, projectId: proj.id });
}

function loadDefaultObj() { loader.load('./Reinbo.obj', (o) => { let m = 0, b = null; o.traverse(c => { if (c.isMesh && c.geometry.attributes.position.count > m) { m = c.geometry.attributes.position.count; b = c.geometry; } }); if (b) { processGeometry(b); sharedGeometry = b; } else sharedGeometry = new THREE.BoxGeometry(1, 1, 1); }); } // Box Fallback
function processGeometry(g) { g.computeBoundingBox(); g.center(); g.computeVertexNormals(); }
function animate() { requestAnimationFrame(animate); renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true); scenes.forEach(s => { const r = s.element.getBoundingClientRect(); if (r.bottom < 0 || r.top > canvas.clientHeight) return; const y = canvas.clientHeight - r.bottom; renderer.setScissor(r.left, y, r.width, r.height); renderer.setViewport(r.left, y, r.width, r.height); s.mesh.rotation.y += 0.005; renderer.render(s.scene, s.camera); }); }
animate();
