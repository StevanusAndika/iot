// ===== DOM References =====
  const $ = (id) => document.getElementById(id);
  const camSourceEl = $("cameraSource"), nthEl = $("nth"), sizeEl = $("size"), 
        btnS = $("start"), btnT = $("stop"), showVideoCb = $("showVideo");
  const nameEl = $("name"), samplesEl = $("samples"), thEl = $("th"), 
        btnEnroll = $("enroll"), btnExport = $("exportDb"), dbStatusEl = $("dbStatus");
  const espUrlEl = $("espUrl"), espKeyEl = $("espKey"), espOffEl = $("espOff"), 
        btnTestOn = $("testOn"), btnTestOff = $("testOff"), autoTriggerEl = $("autoTrigger"),
        testConnBtn = $("testConnection"), connStatusEl = $("connectionStatus");
  
  // Local Storage elements
  const manualNameEl = $("manualName"), btnSaveCurrent = $("saveCurrentFace"),
        btnGetLocal = $("getLocalData"), btnClearLocal = $("clearLocalData"),
        btnExportLocal = $("exportLocalData"), importLocalEl = $("importLocalData"),
        localStorageStatusEl = $("localStorageStatus");
  
  // Cloudflare elements
  const cfWorkerUrlEl = $("cfWorkerUrl"), cfApiTokenEl = $("cfApiToken"),
        btnGetCloud = $("getCloudData"), btnSyncToCloud = $("syncToCloud"),
        btnLoadFromCloud = $("loadFromCloud"), btnTestCloud = $("testCloudConnection"),
        cloudStatusEl = $("cloudStatus");
  
  const statusEl = $("status"), logEl = $("log"), video = $("video"), 
        canvas = $("canvas"), ctx = canvas.getContext('2d');

  // ===== System Variables =====
  let stream = null, running = false, rafId = null, enrolling = false, 
      enrollLeft = 0, enrollSum = null;
  let detectEveryN = 2, frameIndex = 0, facesCount = 0, procFPS = 0, 
      lastFPS = 0, procCount = 0;
  let classifier = null, gray = null, rgba = null;
  let usingESP32Camera = true;
  let currentFaceDescriptor = null; // Untuk simpan wajah saat ini
  
  const cascadeURL = 'https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_alt2.xml';
  const DB_KEY = 'face_db_v2';
  const LBP_SIZE = 100;

  // ===== Utility Functions =====
  function log(...args) { 
    console.log(...args); 
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent = `[${timestamp}] ${args.join(" ")}\n` + logEl.textContent.slice(0, 2000); 
  }

  function showLocalStatus(message, type = 'info') {
    localStorageStatusEl.style.display = 'block';
    localStorageStatusEl.textContent = message;
    
    if (type === 'success') {
      localStorageStatusEl.style.backgroundColor = 'rgba(16,185,129,0.1)';
      localStorageStatusEl.style.color = 'var(--success)';
    } else if (type === 'error') {
      localStorageStatusEl.style.backgroundColor = 'rgba(239,68,68,0.1)';
      localStorageStatusEl.style.color = 'var(--error)';
    } else {
      localStorageStatusEl.style.backgroundColor = 'rgba(59,130,246,0.1)';
      localStorageStatusEl.style.color = 'var(--text)';
    }
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      localStorageStatusEl.style.display = 'none';
    }, 5000);
  }

  function showCloudStatus(message, type = 'info') {
    cloudStatusEl.style.display = 'block';
    cloudStatusEl.textContent = message;
    
    if (type === 'success') {
      cloudStatusEl.style.backgroundColor = 'rgba(16,185,129,0.1)';
      cloudStatusEl.style.color = 'var(--success)';
    } else if (type === 'error') {
      cloudStatusEl.style.backgroundColor = 'rgba(239,68,68,0.1)';
      cloudStatusEl.style.color = 'var(--error)';
    } else {
      cloudStatusEl.style.backgroundColor = 'rgba(59,130,246,0.1)';
      cloudStatusEl.style.color = 'var(--text)';
    }
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      cloudStatusEl.style.display = 'none';
    }, 5000);
  }

  function loadDB() { 
    try { 
      const db = JSON.parse(localStorage.getItem(DB_KEY) || '{"labels":[]}');
      updateDBStatus(db.labels.length);
      return db;
    } catch(e) { 
      log("Error loading DB:", e);
      return {labels:[]}; 
    } 
  }

  function saveDB(db) { 
    localStorage.setItem(DB_KEY, JSON.stringify(db)); 
    updateDBStatus(db.labels.length);
    log("Database saved locally:", db.labels.length, "faces");
  }

  function updateDBStatus(count) {
    dbStatusEl.textContent = `Data: ${count} wajah`;
  }

  function clearLocalDB() { 
    localStorage.removeItem(DB_KEY); 
    updateDBStatus(0);
    log("Local database cleared");
    showLocalStatus('✅ Semua data lokal telah dihapus', 'success');
  }

  function bestMatch(vec, db) { 
    if (!db.labels.length) return {name: "Unknown", score: 0}; 
    let best = {name: "Unknown", score: 0}; 
    for (const r of db.labels) { 
      const s = cosine(vec, r.vec); 
      if (s > best.score) best = {name: r.name, score: s}; 
    } 
    return best; 
  }

  function lbpHistFromBytes(bytes, w, h) {
    const hist = new Float32Array(256);
    for (let y = 1; y < h-1; y++) {
      const yp = y * w;
      for (let x = 1; x < w-1; x++) {
        const c = bytes[yp + x];
        const code = (
          (bytes[(y-1)*w + (x-1)] >= c) << 7 |
          (bytes[(y-1)*w + (x  )] >= c) << 6 |
          (bytes[(y-1)*w + (x+1)] >= c) << 5 |
          (bytes[(y  )*w + (x+1)] >= c) << 4 |
          (bytes[(y+1)*w + (x+1)] >= c) << 3 |
          (bytes[(y+1)*w + (x  )] >= c) << 2 |
          (bytes[(y+1)*w + (x-1)] >= c) << 1 |
          (bytes[(y  )*w + (x-1)] >= c) << 0
        );
        hist[code] += 1;
      }
    }
    let norm = 0;
    for (let i = 0; i < 256; i++) norm += hist[i] * hist[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < 256; i++) hist[i] /= norm;
    return hist;
  }

  function addInPlace(a, b) { for (let i = 0; i < a.length; i++) a[i] += b[i]; }
  function scaleInPlace(a, s) { for (let i = 0; i < a.length; i++) a[i] *= s; }
  function cosine(a, b) { 
    let dot = 0, na = 0, nb = 0; 
    for (let i = 0; i < a.length; i++) { 
      dot += a[i] * b[i]; 
      na += a[i] * a[i]; 
      nb += b[i] * b[i]; 
    } 
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9); 
  }

  // ===== LOCAL STORAGE FUNCTIONS =====
  function getLocalData() {
    const db = loadDB();
    const count = db.labels.length;
    
    log("📱 Local database loaded:", count, "faces");
    showLocalStatus(`📱 Data lokal: ${count} wajah tersimpan`, 'info');
    
    // Show preview of data
    const preview = db.labels.slice(0, 3).map(l => l.name).join(', ');
    if (count > 0) {
      log("📋 Nama-nama:", preview + (count > 3 ? '...' : ''));
      log("📊 Detail:", db.labels.map(l => `${l.name} (vector: ${l.vec.length})`));
    }
    
    return db;
  }

  function saveCurrentFaceToLocal() {
    if (!currentFaceDescriptor) {
      showLocalStatus('❌ Tidak ada wajah yang terdeteksi', 'error');
      log("❌ Tidak ada wajah yang terdeteksi untuk disimpan");
      return false;
    }

    const name = manualNameEl.value.trim();
    if (!name) {
      showLocalStatus('❌ Masukkan nama terlebih dahulu', 'error');
      log("❌ Nama belum diisi");
      manualNameEl.focus();
      return false;
    }

    const db = loadDB();
    
    // Remove existing entries with same name
    db.labels = db.labels.filter(entry => entry.name !== name);
    
    // Add new entry
    db.labels.push({
      name: name,
      vec: Array.from(currentFaceDescriptor)
    });
    
    saveDB(db);
    
    showLocalStatus(`✅ Wajah "${name}" berhasil disimpan ke local storage`, 'success');
    log(`✅ Face saved locally: ${name}`);
    
    // Clear input
    manualNameEl.value = '';
    
    return true;
  }

  function exportLocalDataToFile() {
    const db = loadDB();
    
    if (db.labels.length === 0) {
      showLocalStatus('⚠️ Tidak ada data lokal untuk diexport', 'info');
      return;
    }
    
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `face_db_local_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    log("💾 Local database exported");
    showLocalStatus(`✅ ${db.labels.length} wajah diexport ke file`, 'success');
  }

  async function importLocalDataFromFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const db = JSON.parse(text);
      
      if (!db || !Array.isArray(db.labels)) {
        throw new Error('Format file tidak valid');
      }

      saveDB(db);
      showLocalStatus(`✅ Database imported: ${db.labels.length} wajah dimuat`, 'success');
      log(`📥 Database imported: ${db.labels.length} faces`);
      
      // Reset file input
      e.target.value = '';
    } catch (error) {
      showLocalStatus(`❌ Error importing: ${error.message}`, 'error');
      log("❌ Import error:", error);
    }
  }

  // ===== CLOUDFLARE FUNCTIONS =====
  function getWorkerUrl() {
    let workerUrl = cfWorkerUrlEl.value.trim();
    workerUrl = workerUrl.replace(/\/$/, '');
    return workerUrl;
  }

  async function testCloudConnection() {
    const workerUrl = getWorkerUrl();
    if (!workerUrl) {
      showCloudStatus('❌ Worker URL belum diisi', 'error');
      return false;
    }
    
    btnTestCloud.disabled = true;
    btnTestCloud.textContent = "🔍 Testing...";
    
    try {
      const response = await fetch(`${workerUrl}/health`);
      
      if (response.ok) {
        const data = await response.json();
        showCloudStatus(`✅ Cloudflare Worker terhubung: ${data.message || 'OK'}`, 'success');
        log("✅ Cloudflare connection successful");
        return true;
      } else {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (error) {
      showCloudStatus(`❌ Gagal terhubung: ${error.message}`, 'error');
      log("❌ Cloudflare connection failed:", error);
      return false;
    } finally {
      btnTestCloud.disabled = false;
      btnTestCloud.textContent = "🔍 Test Koneksi";
    }
  }

  async function getCloudData() {
    const workerUrl = getWorkerUrl();
    if (!workerUrl) {
      showCloudStatus('❌ Worker URL belum diisi', 'error');
      return;
    }
    
    btnGetCloud.disabled = true;
    btnGetCloud.textContent = "☁️ Loading...";
    
    try {
      const response = await fetch(`${workerUrl}/data`);
      
      if (response.ok) {
        const data = await response.json();
        log("☁️ Cloud database loaded:", data.length || 0, "faces");
        showCloudStatus(`☁️ Cloud data: ${data.length || 0} wajah tersimpan`, 'success');
        
        if (data.length > 0) {
          const preview = data.slice(0, 3).map(item => item.name).join(', ');
          log("📋 Cloud names:", preview + (data.length > 3 ? '...' : ''));
        }
        
        return data;
      } else {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (error) {
      showCloudStatus(`❌ Gagal mengambil data: ${error.message}`, 'error');
      log("❌ Failed to get cloud data:", error);
      return null;
    } finally {
      btnGetCloud.disabled = false;
      btnGetCloud.textContent = "☁️ Ambil Data dari Cloud";
    }
  }

  async function syncToCloud() {
    const workerUrl = getWorkerUrl();
    if (!workerUrl) {
      showCloudStatus('❌ Worker URL belum diisi', 'error');
      return;
    }
    
    const localDB = loadDB();
    
    if (localDB.labels.length === 0) {
      showCloudStatus('⚠️ Tidak ada data lokal untuk dikirim ke cloud', 'info');
      return;
    }
    
    btnSyncToCloud.disabled = true;
    btnSyncToCloud.textContent = "📤 Syncing...";
    
    try {
      // Clear existing data in cloud
      await fetch(`${workerUrl}/data/clear`, { method: 'DELETE' });
      
      // Upload all local data
      for (const label of localDB.labels) {
        await fetch(`${workerUrl}/data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(label)
        });
      }
      
      showCloudStatus(`✅ ${localDB.labels.length} wajah berhasil disinkronisasi ke cloud!`, 'success');
      log(`✅ Data synced to cloud: ${localDB.labels.length} faces`);
      
    } catch (error) {
      showCloudStatus(`❌ Gagal sinkronisasi: ${error.message}`, 'error');
      log("❌ Failed to sync to cloud:", error);
    } finally {
      btnSyncToCloud.disabled = false;
      btnSyncToCloud.textContent = "📤 Sync ke Cloud";
    }
  }

  async function loadFromCloud() {
    const cloudData = await getCloudData();
    
    if (!cloudData || cloudData.length === 0) {
      showCloudStatus('⚠️ Tidak ada data di cloud', 'info');
      return;
    }
    
    // Convert cloud data to local format
    const localDB = {
      labels: cloudData.map(item => ({
        name: item.name,
        vec: item.vector || item.vec || []
      }))
    };
    
    // Save to local storage
    saveDB(localDB);
    showCloudStatus(`✅ ${localDB.labels.length} wajah berhasil dimuat dari cloud ke lokal!`, 'success');
    log(`✅ Data loaded from cloud: ${localDB.labels.length} faces`);
  }

  // ===== OpenCV Initialization =====
  function onOpenCvReady() { 
    if (window.cv && cv.getBuildInformation) initOpenCV(); 
    else if (window.cv) cv['onRuntimeInitialized'] = initOpenCV; 
  }

  async function initOpenCV() {
    try {
      statusEl.textContent = '⏳ Status: memuat cascade classifier…';
      const res = await fetch(cascadeURL);
      if (!res.ok) throw new Error('Failed to load cascade');
      
      const buf = new Uint8Array(await res.arrayBuffer());
      cv.FS_createDataFile('/', 'haarcascade.xml', buf, true, false, false);
      
      classifier = new cv.CascadeClassifier();
      classifier.load('haarcascade.xml');
      
      statusEl.textContent = '✅ Status: OpenCV siap. Klik Start untuk mulai.';
      btnS.disabled = false;
      btnEnroll.disabled = false;
      btnSaveCurrent.disabled = false;
      
      // Load initial DB status
      loadDB();
      
      // Test ESP32 connection on startup
      setTimeout(testESP32Connection, 1000);
      
    } catch(e) {
      log("❌ Error loading OpenCV:", e);
      statusEl.textContent = '❌ Status: gagal memuat cascade classifier.';
    }
  }

  // ===== ESP32 Camera Functions =====
  async function testESP32Connection() {
    const baseUrl = espUrlEl.value.trim();
    if (!baseUrl) return false;

    testConnBtn.disabled = true;
    testConnBtn.textContent = "🔍 Testing...";
    
    try {
      const response = await fetch(`${baseUrl}/status`, {
        method: 'GET',
        timeout: 5000
      });
      
      if (response.ok) {
        const data = await response.json();
        connStatusEl.className = "status-connected";
        connStatusEl.innerHTML = `✅ Connected - ${data.clients} client(s)`;
        log("✅ ESP32 connection successful");
        return true;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      connStatusEl.className = "status-disconnected";
      connStatusEl.innerHTML = "❌ Connection Failed";
      log("❌ ESP32 connection failed:", error);
      return false;
    } finally {
      testConnBtn.disabled = false;
      testConnBtn.textContent = "🔍 Test Connection";
    }
  }

  async function setupESP32Camera() {
    const baseUrl = espUrlEl.value.trim();
    if (!baseUrl) {
      throw new Error("ESP32 URL belum diisi");
    }

    // Test connection first
    const connected = await testESP32Connection();
    if (!connected) {
      throw new Error("Tidak dapat terhubung ke ESP32");
    }

    // Setup video element for ESP32 stream
    video.src = `${baseUrl}/video`;
    video.crossOrigin = "anonymous";
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout loading ESP32 video stream"));
      }, 10000);

      video.onloadeddata = () => {
        clearTimeout(timeout);
        log("✅ ESP32 video stream loaded");
        resolve(true);
      };

      video.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error("Error loading ESP32 video stream"));
      };

      video.play().catch(reject);
    });
  }

  async function setupWebcam() {
    const { w, h } = parseSize(sizeEl.value);
    const constraints = {
      video: {
        width: { ideal: w },
        height: { ideal: h },
        facingMode: "user"
      },
      audio: false
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      log("✅ Webcam started successfully");
      return true;
    } catch (error) {
      log("❌ Webcam error:", error);
      throw error;
    }
  }

  // ===== Camera Control =====
  function parseSize(v) { 
    const [w, h] = v.split('x').map(n => parseInt(n, 10)); 
    return { w, h }; 
  }

  function setCanvasSize(v) { 
    const { w, h } = parseSize(v); 
    canvas.width = w; 
    canvas.height = h; 
  }

  async function startCamera() {
    usingESP32Camera = camSourceEl.value === "esp32";
    detectEveryN = parseInt(nthEl.value, 10) || 2;
    setCanvasSize(sizeEl.value);

    try {
      if (usingESP32Camera) {
        await setupESP32Camera();
        statusEl.textContent = '✅ Status: ESP32 camera aktif';
      } else {
        await setupWebcam();
        statusEl.textContent = '✅ Status: Webcam aktif';
      }

      running = true;
      btnS.disabled = true;
      btnT.disabled = false;
      video.style.display = showVideoCb.checked ? 'block' : 'none';
      startLoop();

    } catch (error) {
      log("❌ Failed to start camera:", error);
      statusEl.textContent = `❌ Error: ${error.message}`;
      
      // Fallback to webcam if ESP32 fails
      if (usingESP32Camera) {
        log("🔄 Falling back to webcam...");
        camSourceEl.value = "webcam";
        usingESP32Camera = false;
        await startCamera();
      }
    }
  }

  function stopCamera() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    
    video.srcObject = null;
    video.src = "";
    
    btnS.disabled = false;
    btnT.disabled = true;
    statusEl.textContent = '⏸️ Status: Stopped';
    
    // Clean up OpenCV mats
    if (rgba) { rgba.delete(); rgba = null; }
    if (gray) { gray.delete(); gray = null; }
  }

  // ===== ESP32 LED Control =====
  async function callLED(state) {
    const baseUrl = (espUrlEl.value || '').replace(/\/+$/, '');
    if (!baseUrl) {
      log("❌ ESP32 URL belum diisi");
      return;
    }

    const apiKey = espKeyEl.value || 'rahasiaku123';
    
    try {
      const response = await fetch(`${baseUrl}/api/led`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ state: state })
      });

      const result = await response.json();
      log(`💡 LED ${state}:`, result.message);
      return result;
    } catch (error) {
      log("❌ LED control error:", error);
      return { status: "error", message: error.message };
    }
  }

  let lastTrigger = 0;
  async function triggerOnVerified() {
    const enable = autoTriggerEl.checked;
    if (!enable) return;

    const now = Date.now();
    if (now - lastTrigger < 2000) return; // 2 second cooldown
    
    lastTrigger = now;
    
    const result = await callLED('on');
    if (result.status === "success") {
      const offSeconds = Math.max(1, parseInt(espOffEl.value || '5', 10));
      setTimeout(() => callLED('off'), offSeconds * 1000);
    }
  }

  // ===== UI Event Handlers =====
  btnS.onclick = startCamera;
  btnT.onclick = stopCamera;

  showVideoCb.onchange = () => {
    video.style.display = showVideoCb.checked ? 'block' : 'none';
  };

  btnEnroll.onclick = () => {
    const name = (nameEl.value || '').trim();
    if (!name) {
      alert('⚠️ Masukkan nama untuk enrollment otomatis');
      return;
    }
    
    enrolling = true;
    enrollLeft = parseInt(samplesEl.value, 10) || 20;
    enrollSum = new Float32Array(256);
    statusEl.textContent = `📸 Enrolling "${name}" — ${enrollLeft} samples remaining…`;
    log(`🎯 Starting enrollment for: ${name}`);
  };

  btnExport.onclick = exportLocalDataToFile;

  // Local Storage Event Handlers
  btnSaveCurrent.onclick = saveCurrentFaceToLocal;
  btnGetLocal.onclick = getLocalData;
  btnClearLocal.onclick = () => {
    if (confirm('🗑️ Apakah Anda yakin ingin menghapus semua data lokal?')) {
      clearLocalDB();
    }
  };
  btnExportLocal.onclick = exportLocalDataToFile;
  importLocalEl.onchange = importLocalDataFromFile;

  // Cloudflare Event Handlers
  btnGetCloud.onclick = getCloudData;
  btnSyncToCloud.onclick = syncToCloud;
  btnLoadFromCloud.onclick = loadFromCloud;
  btnTestCloud.onclick = testCloudConnection;

  btnTestOn.onclick = () => callLED('on');
  btnTestOff.onclick = () => callLED('off');
  testConnBtn.onclick = testESP32Connection;

  camSourceEl.onchange = () => {
    if (running) {
      stopCamera();
      setTimeout(startCamera, 500);
    }
  };

  // ===== Main Processing Loop =====
  function startLoop() {
    // Initialize OpenCV mats
    rgba && rgba.delete();
    gray && rgba.delete();
    
    rgba = new cv.Mat(canvas.height, canvas.width, cv.CV_8UC4);
    gray = new cv.Mat();
    
    const faces = new cv.RectVector();
    procFPS = 0;
    lastFPS = performance.now();
    procCount = 0;
    frameIndex = 0;

    const processFrame = () => {
      if (!running) {
        // Cleanup
        rgba.delete();
        gray.delete();
        faces.delete();
        return;
      }

      try {
        // Draw video to canvas
        if (video.readyState >= 2 && video.videoWidth > 0) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frameIndex++;

          // Process every Nth frame
          if (frameIndex % detectEveryN === 0) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            rgba.data.set(imageData.data);
            
            // Convert to grayscale
            cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
            cv.equalizeHist(gray, gray);
            
            // Detect faces
            classifier.detectMultiScale(gray, faces, 1.1, 5, 0, new cv.Size(60, 60));
            facesCount = faces.size();

            let displayText = '';
            
            if (faces.size() > 0) {
              // Find largest face
              let bestIndex = 0, bestArea = 0;
              for (let i = 0; i < faces.size(); i++) {
                const rect = faces.get(i);
                const area = rect.width * rect.height;
                if (area > bestArea) {
                  bestArea = area;
                  bestIndex = i;
                }
              }

              const faceRect = faces.get(bestIndex);
              
              // Extract and resize face region
              let roi = gray.roi(faceRect);
              let resized = new cv.Mat();
              cv.resize(roi, resized, new cv.Size(LBP_SIZE, LBP_SIZE), 0, 0, cv.INTER_AREA);
              
              // Compute LBP descriptor
              const descriptor = lbpHistFromBytes(resized.data, resized.cols, resized.rows);
              
              // Simpan descriptor untuk tombol "Simpan Wajah Sekarang"
              currentFaceDescriptor = descriptor;

              if (enrolling) {
                // Enrollment mode
                addInPlace(enrollSum, descriptor);
                enrollLeft--;
                
                statusEl.textContent = `📸 Enrolling "${nameEl.value.trim()}" — ${enrollLeft} samples left`;
                
                if (enrollLeft <= 0) {
                  // Finish enrollment
                  scaleInPlace(enrollSum, 1 / parseInt(samplesEl.value, 10));
                  
                  const db = loadDB();
                  // Remove existing entries with same name
                  db.labels = db.labels.filter(entry => entry.name !== nameEl.value.trim());
                  // Add new entry
                  db.labels.push({
                    name: nameEl.value.trim(),
                    vec: Array.from(enrollSum)
                  });
                  
                  saveDB(db);
                  enrolling = false;
                  
                  statusEl.textContent = `✅ Enrollment completed for "${nameEl.value.trim()}"`;
                  log(`✅ Enrollment completed: ${nameEl.value.trim()}`);
                  showLocalStatus(`✅ Enrollment otomatis selesai: ${nameEl.value.trim()}`, 'success');
                }
              } else {
                // Recognition mode
                const db = loadDB();
                const match = bestMatch(descriptor, db);
                const threshold = parseFloat(thEl.value) || 0.9;
                
                if (match.score >= threshold) {
                  displayText = `${match.name} (${match.score.toFixed(2)})`;
                  triggerOnVerified();
                } else {
                  displayText = `Unknown (${match.score.toFixed(2)})`;
                }
              }

              // Draw face rectangles
              ctx.lineWidth = Math.max(2, Math.round(canvas.width / 200));
              
              for (let i = 0; i < faces.size(); i++) {
                const rect = faces.get(i);
                ctx.strokeStyle = i === bestIndex ? '#00ff66' : '#66a3ff';
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
              }

              // Draw recognition text
              if (displayText) {
                const rect = faces.get(bestIndex);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                const textWidth = ctx.measureText(displayText).width + 14;
                ctx.fillRect(rect.x, rect.y - 24, textWidth, 20);
                ctx.fillStyle = '#ffffff';
                ctx.font = '14px system-ui, Segoe UI, Roboto, Arial';
                ctx.fillText(displayText, rect.x + 7, rect.y - 8);
              }

              // Cleanup
              roi.delete();
              resized.delete();
            } else {
              currentFaceDescriptor = null; // Reset jika tidak ada wajah
            }

            // Update FPS counter
            procCount++;
            const now = performance.now();
            if (now - lastFPS > 1000) {
              procFPS = procCount / ((now - lastFPS) / 1000);
              procCount = 0;
              lastFPS = now;
            }
          }
        }
      } catch (error) {
        log("❌ Processing error:", error);
      }

      drawHUD();
      scheduleNextFrame();
    };

    const scheduleNextFrame = () => {
      if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
        video.requestVideoFrameCallback(processFrame);
      } else {
        rafId = requestAnimationFrame(processFrame);
      }
    };

    scheduleNextFrame();
  }

  function drawHUD() {
    const padding = 10, lineHeight = 18;
    const fpsText = `FPS: ${Math.round(procFPS)}`;
    const facesText = `Faces: ${facesCount}`;
    const enrollText = enrolling ? `Enrolling: ${nameEl.value.trim()} (${enrollLeft} left)` : '';
    const saveText = currentFaceDescriptor ? '💾 Siap simpan' : '⏳ Tunggu wajah';
    
    ctx.save();
    ctx.font = '14px system-ui, Segoe UI, Roboto, Arial';
    
    const texts = [fpsText, facesText, saveText];
    if (enrolling) texts.push(enrollText);
    
    const maxWidth = Math.max(...texts.map(t => ctx.measureText(t).width)) + padding * 2;
    const totalHeight = texts.length * lineHeight + padding * 2;
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(padding, padding, maxWidth, totalHeight);
    
    // Text
    ctx.fillStyle = '#e6eef6';
    texts.forEach((text, index) => {
      ctx.fillText(text, padding * 2, padding + (index + 1) * lineHeight);
    });
    
    ctx.restore();
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    log("🚀 Face Recognition System Initialized");
    log("💡 Connect to ESP32-Camera-AP WiFi to use ESP32 camera");
    log("💾 Local storage ready - gunakan tombol 'Simpan Wajah Sekarang'");
    
    // Auto-fill Cloudflare settings
    cfWorkerUrlEl.value = 'https://iot.stevanusstudent.workers.dev';
    
    // Load initial DB status
    getLocalData();
    
    // Save Cloudflare settings on change
    cfWorkerUrlEl.addEventListener('change', () => {
      localStorage.setItem('cf_worker_url', cfWorkerUrlEl.value);
    });
    
    cfApiTokenEl.addEventListener('change', () => {
      localStorage.setItem('cf_api_token', cfApiTokenEl.value);
    });
  });