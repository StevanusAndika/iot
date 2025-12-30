#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>

// ===== AP SETTINGS =====
const char* AP_SSID = "Steven -AP";
const char* AP_PASS = "12345678";
const char* API_KEY = "rahasiaku123";

// LED builtin D1 mini = D4 (GPIO2), AKTIF LOW
const int LED_PIN = LED_BUILTIN;

ESP8266WebServer server(80);

// ===== VARIABEL UNTUK LED BLINK =====
bool ledState = false;                     // Status LED (false = OFF, true = ON)
bool blinkActive = false;                  // Status blink aktif/tidak
unsigned long blinkStartTime = 0;          // Waktu mulai blink
const unsigned long SINGLE_BLINK_DURATION = 800; // Blink sekali (800ms)
unsigned long lastBlinkToggle = 0;         // Waktu terakhir toggle blink
bool blinkPhase = false;                   // Fase blink (true = ON, false = OFF)

// ===== VARIABEL UNTUK SHUTDOWN =====
bool shutdownRequested = false;            // Flag untuk shutdown
unsigned long shutdownTime = 0;            // Waktu shutdown dimulai
const unsigned long SHUTDOWN_DURATION = 5000; // Durasi shutdown (5 detik)

// ===== VARIABEL SISTEM =====
bool systemActive = true;                  // Status sistem aktif/tidak
unsigned long systemUptime = 0;            // Waktu sistem hidup
unsigned long lastHeartbeat = 0;           // Waktu terakhir heartbeat

// ---- CORS helper ----
void sendCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  server.sendHeader("Access-Control-Expose-Headers", "Content-Type");
}

void handleOptions() { 
  sendCORS(); 
  server.send(204); 
}

void setLed(bool on) { 
  ledState = on;
  digitalWrite(LED_PIN, on ? LOW : HIGH);  // aktif LOW
}

// Fungsi untuk memulai efek blink sekali
void startSingleBlink() {
  if (!blinkActive && systemActive) {
    blinkActive = true;
    blinkStartTime = millis();
    blinkPhase = true; // Mulai dengan LED ON
    
    // Turn LED ON untuk awal blink
    digitalWrite(LED_PIN, LOW); // LOW = ON
    Serial.println("Blink started");
  }
}

// Fungsi untuk mengupdate LED (dipanggil di loop)
void updateLed() {
  if (!systemActive) return; // Jangan update LED jika sistem mati
  
  if (blinkActive) {
    unsigned long currentTime = millis();
    unsigned long elapsed = currentTime - blinkStartTime;
    
    // Single blink pattern: ON 400ms, OFF 400ms
    if (elapsed < 400) {
      // Fase ON (400ms pertama)
      if (!blinkPhase) {
        digitalWrite(LED_PIN, LOW); // ON
        blinkPhase = true;
      }
    } else if (elapsed < 800) {
      // Fase OFF (400ms kedua)
      if (blinkPhase) {
        digitalWrite(LED_PIN, HIGH); // OFF
        blinkPhase = false;
      }
    } else {
      // Blink selesai, kembalikan ke state asli
      blinkActive = false;
      digitalWrite(LED_PIN, ledState ? LOW : HIGH);
      Serial.println("Blink completed");
    }
  }
}

// Fungsi untuk memulai shutdown sequence
void startShutdown() {
  if (systemActive) {
    shutdownRequested = true;
    shutdownTime = millis();
    systemActive = false;
    
    Serial.println("Shutdown sequence initiated");
    Serial.println("System will shutdown in 5 seconds...");
    
    // Matikan LED selama shutdown
    digitalWrite(LED_PIN, HIGH); // OFF
  }
}

// Fungsi untuk reboot ESP8266
void rebootESP() {
  Serial.println("Rebooting ESP8266...");
  Serial.println("==========================================");
  delay(100);
  ESP.restart();
}

void replyJson(int code, const char* status, const char* msg, JsonObject extra = JsonObject()) {
  sendCORS();
  StaticJsonDocument<300> doc;
  doc["status"] = status;
  doc["message"] = msg;
  
  if (!extra.isNull()) {
    for (auto kvp : extra) {
      doc[kvp.key()] = kvp.value();
    }
  }
  
  String out; 
  serializeJson(doc, out);
  server.send(code, "application/json", out);
}

// Cek API key dari header ATAU query (?key=)
bool checkApiKey() {
  String key = server.header("X-API-Key");
  if (key.length() == 0) key = server.arg("key");
  return key == API_KEY;
}

// ---- Handlers ----
void handlePing() {
  StaticJsonDocument<200> doc;
  doc["pong"] = true;
  doc["system"] = systemActive ? "active" : "shutting_down";
  doc["uptime"] = systemUptime;
  
  String out;
  serializeJson(doc, out);
  sendCORS();
  server.send(200, "application/json", out);
}

void handleInfo() {
  StaticJsonDocument<400> doc;
  doc["device"] = "ESP8266 D1 Mini";
  doc["firmware"] = "v2.1-single-blink";
  doc["mode"] = "Access Point";
  doc["ap_ssid"] = AP_SSID;
  doc["ap_ip"] = WiFi.softAPIP().toString();
  doc["api_key"] = API_KEY;
  doc["led_state"] = ledState;
  doc["system_active"] = systemActive;
  doc["uptime"] = systemUptime;
  doc["free_heap"] = ESP.getFreeHeap();
  doc["clients_connected"] = WiFi.softAPgetStationNum();
  
  String out;
  serializeJson(doc, out);
  sendCORS();
  server.send(200, "application/json", out);
}

// GET /api/led?state=on|off|blink&key=...
void handleLedGet() {
  if (!checkApiKey()) { 
    replyJson(401, "error", "invalid api key"); 
    return; 
  }
  
  if (!systemActive) {
    replyJson(503, "error", "system is shutting down");
    return;
  }
  
  String s = server.arg("state"); 
  s.toLowerCase();
  
  StaticJsonDocument<100> extra;
  JsonObject extraObj = extra.to<JsonObject>();
  
  if (s == "on") { 
    setLed(true);
    startSingleBlink();
    extraObj["led"] = true;
    extraObj["blink"] = true;
    replyJson(200, "ok", "led turned on with single blink", extraObj);  
  }
  else if (s == "off") { 
    setLed(false); 
    startSingleBlink();
    extraObj["led"] = false;
    extraObj["blink"] = true;
    replyJson(200, "ok", "led turned off with single blink", extraObj); 
  }
  else if (s == "blink") {
    // Blink saja tanpa mengubah state akhir
    startSingleBlink();
    extraObj["led"] = ledState;
    extraObj["blink"] = true;
    replyJson(200, "ok", "single blink executed", extraObj);
  }
  else if (s == "status") {
    extraObj["led"] = ledState;
    extraObj["blink_active"] = blinkActive;
    replyJson(200, "ok", ledState ? "led is on" : "led is off", extraObj);
  }
  else if (s == "toggle") {
    // Toggle state
    setLed(!ledState);
    startSingleBlink();
    extraObj["led"] = ledState;
    extraObj["blink"] = true;
    replyJson(200, "ok", ledState ? "led toggled on" : "led toggled off", extraObj);
  }
  else {
    replyJson(400, "error", "state must be 'on', 'off', 'blink', 'toggle', or 'status'");
  }
}

// POST /api/led body: {"state":"on"} header: X-API-Key
void handleLedPost() {
  if (!checkApiKey()) { 
    replyJson(401, "error", "invalid api key"); 
    return; 
  }
  
  if (!systemActive) {
    replyJson(503, "error", "system is shutting down");
    return;
  }
  
  if (!server.hasArg("plain")) { 
    replyJson(400, "error", "missing body"); 
    return; 
  }

  StaticJsonDocument<200> doc;
  auto err = deserializeJson(doc, server.arg("plain"));
  if (err) { 
    replyJson(400, "error", "invalid json"); 
    return; 
  }

  String s = doc["state"] | ""; 
  s.toLowerCase();
  
  StaticJsonDocument<100> extra;
  JsonObject extraObj = extra.to<JsonObject>();
  
  if (s == "on") { 
    setLed(true);
    startSingleBlink();
    extraObj["led"] = true;
    extraObj["blink"] = true;
    replyJson(200, "ok", "led turned on with single blink", extraObj);  
  }
  else if (s == "off") { 
    setLed(false); 
    startSingleBlink();
    extraObj["led"] = false;
    extraObj["blink"] = true;
    replyJson(200, "ok", "led turned off with single blink", extraObj); 
  }
  else if (s == "blink") {
    startSingleBlink();
    extraObj["led"] = ledState;
    extraObj["blink"] = true;
    replyJson(200, "ok", "single blink executed", extraObj);
  }
  else if (s == "toggle") {
    setLed(!ledState);
    startSingleBlink();
    extraObj["led"] = ledState;
    extraObj["blink"] = true;
    replyJson(200, "ok", ledState ? "led toggled on" : "led toggled off", extraObj);
  }
  else {
    replyJson(400, "error", "state must be 'on', 'off', 'blink', or 'toggle'");
  }
}

// Handler untuk system control: reboot dan shutdown
void handleSystemControl() {
  if (!checkApiKey()) { 
    replyJson(401, "error", "invalid api key"); 
    return; 
  }
  
  if (!systemActive) {
    replyJson(503, "error", "system is already shutting down");
    return;
  }
  
  String action = server.arg("action");
  action.toLowerCase();
  
  StaticJsonDocument<100> extra;
  JsonObject extraObj = extra.to<JsonObject>();
  
  if (action == "reboot") {
    extraObj["action"] = "reboot";
    extraObj["delay_ms"] = 100;
    replyJson(200, "ok", "system will reboot now", extraObj);
    
    // Delay sedikit sebelum reboot untuk response
    delay(10);
    server.handleClient();
    delay(10);
    rebootESP();
  }
  else if (action == "shutdown") {
    startShutdown();
    extraObj["action"] = "shutdown";
    extraObj["delay_seconds"] = 5;
    replyJson(200, "ok", "system will shutdown in 5 seconds", extraObj);
  }
  else if (action == "status") {
    extraObj["system_active"] = systemActive;
    extraObj["uptime"] = systemUptime;
    extraObj["free_heap"] = ESP.getFreeHeap();
    extraObj["clients"] = WiFi.softAPgetStationNum();
    replyJson(200, "ok", systemActive ? "system is active" : "system is shutting down", extraObj);
  }
  else {
    replyJson(400, "error", "action must be 'reboot', 'shutdown', or 'status'");
  }
}

// Handler untuk status detail
void handleStatus() {
  StaticJsonDocument<500> doc;
  doc["status"] = systemActive ? "active" : "shutting_down";
  doc["device"] = "ESP8266";
  doc["firmware"] = "v2.1-single-blink";
  doc["uptime"] = systemUptime;
  doc["free_heap"] = ESP.getFreeHeap();
  doc["ap_clients"] = WiFi.softAPgetStationNum();
  doc["led_state"] = ledState;
  doc["blink_active"] = blinkActive;
  doc["system_active"] = systemActive;
  
  if (shutdownRequested) {
    doc["shutdown_elapsed"] = (millis() - shutdownTime) / 1000;
    doc["shutdown_remaining"] = (SHUTDOWN_DURATION - (millis() - shutdownTime)) / 1000;
  }
  
  String out;
  serializeJson(doc, out);
  sendCORS();
  server.send(200, "application/json", out);
}

void setup() {
  // Setup LED
  pinMode(LED_PIN, OUTPUT);
  setLed(false); // Matikan LED awal
  
  // Startup blink sequence
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n==========================================");
  Serial.println("   ESP8266 SINGLE BLINK + SYSTEM CONTROL");
  Serial.println("==========================================");
  
  // Animasi startup (3 quick blinks)
  for(int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, LOW); // ON
    delay(100);
    digitalWrite(LED_PIN, HIGH); // OFF
    delay(100);
  }
  
  // Setup Access Point
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  
  Serial.println("\nWIFI ACCESS POINT");
  Serial.print("SSID:     ");
  Serial.println(AP_SSID);
  Serial.print("Password: ");
  Serial.println(AP_PASS);
  Serial.print("IP:       ");
  Serial.println(WiFi.softAPIP());
  
  Serial.println("\nSYSTEM INFO");
  Serial.print("API Key:  ");
  Serial.println(API_KEY);
  Serial.print("Chip ID:  ");
  Serial.println(ESP.getChipId());
  Serial.print("Flash:    ");
  Serial.print(ESP.getFlashChipSize() / 1024);
  Serial.println(" KB");
  Serial.print("Free RAM: ");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");
  
  Serial.println("\nFEATURES");
  Serial.println("• Single blink (800ms) on LED control");
  Serial.println("• System reboot endpoint");
  Serial.println("• Graceful shutdown");
  Serial.println("• System status monitoring");
  
  // Setup server headers
  const char* headerKeys[] = {"X-API-Key"};
  const size_t headerKeysCount = sizeof(headerKeys) / sizeof(headerKeys[0]);
  server.collectHeaders(headerKeys, headerKeysCount);
  
  // Routes
  server.on("/", HTTP_GET, []() {
    sendCORS();
    String html = "<!DOCTYPE html><html><head>";
    html += "<meta charset='UTF-8'>";
    html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
    html += "<title>ESP8266 System Control</title>";
    html += "<style>";
    html += "body {font-family: Arial, sans-serif; padding: 20px; background: #0f1720; color: #e6eef6; max-width: 800px; margin: 0 auto;}";
    html += "h1 {color: #2b6cb0; border-bottom: 2px solid #334155; padding-bottom: 10px;}";
    html += ".card {background: #0b1220; padding: 20px; border-radius: 10px; margin: 15px 0; border: 1px solid #1b2b48;}";
    html += "button {padding: 12px 24px; margin: 5px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; transition: all 0.2s;}";
    html += "button:hover {opacity: 0.9; transform: translateY(-2px);}";
    html += ".btn-on {background: #10b981; color: white;}";
    html += ".btn-off {background: #ef4444; color: white;}";
    html += ".btn-blink {background: #f59e0b; color: white;}";
    html += ".btn-reboot {background: #3b82f6; color: white;}";
    html += ".btn-shutdown {background: #6b7280; color: white;}";
    html += ".status {padding: 12px; border-radius: 6px; margin: 10px 0; font-weight: bold;}";
    html += ".status-on {background: rgba(16,185,129,0.1); color: #10b981; border-left: 4px solid #10b981;}";
    html += ".status-off {background: rgba(239,68,68,0.1); color: #ef4444; border-left: 4px solid #ef4444;}";
    html += ".status-shutdown {background: rgba(107,114,128,0.1); color: #6b7280; border-left: 4px solid #6b7280;}";
    html += ".info-grid {display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;}";
    html += ".info-item {background: rgba(59,130,246,0.1); padding: 10px; border-radius: 6px;}";
    html += "code {background: rgba(59,130,246,0.2); padding: 2px 6px; border-radius: 4px; font-family: monospace;}";
    html += "</style>";
    html += "</head><body>";
    html += "<h1>ESP8266 System Control</h1>";
    
    html += "<div class='card'>";
    html += "<h3>Network Info</h3>";
    html += "<p><strong>AP SSID:</strong> " + String(AP_SSID) + "</p>";
    html += "<p><strong>AP IP:</strong> " + WiFi.softAPIP().toString() + "</p>";
    html += "<p><strong>API Key:</strong> <code>" + String(API_KEY) + "</code></p>";
    html += "</div>";
    
    html += "<div class='card'>";
    html += "<h3>LED Control (Single Blink)</h3>";
    html += "<div id='ledStatus' class='status status-off'>LED Status: OFF</div>";
    html += "<div id='systemStatus' class='status status-on'>System: ACTIVE</div>";
    html += "<div>";
    html += "<button class='btn-on' onclick=\"controlLed('on')\">TURN ON</button>";
    html += "<button class='btn-off' onclick=\"controlLed('off')\">TURN OFF</button>";
    html += "<button class='btn-blink' onclick=\"controlLed('blink')\">BLINK ONCE</button>";
    html += "<button class='btn-blink' onclick=\"controlLed('toggle')\">TOGGLE</button>";
    html += "</div>";
    html += "<div id='blinkStatus' style='margin-top:10px; padding:10px; background:rgba(245,158,11,0.1); border-radius:6px; display:none;'>";
    html += "<strong>Blink in progress...</strong>";
    html += "</div>";
    html += "</div>";
    
    html += "<div class='card'>";
    html += "<h3>System Control</h3>";
    html += "<div class='info-grid'>";
    html += "<div class='info-item'><strong>Uptime:</strong><br><span id='uptime'>0s</span></div>";
    html += "<div class='info-item'><strong>Free RAM:</strong><br><span id='freeRam'>0</span> bytes</div>";
    html += "</div>";
    html += "<div style='margin-top:15px;'>";
    html += "<button class='btn-reboot' onclick=\"systemControl('reboot')\">REBOOT</button>";
    html += "<button class='btn-shutdown' onclick=\"systemControl('shutdown')\">SHUTDOWN</button>";
    html += "<button class='btn-blink' onclick=\"systemControl('status')\">SYSTEM STATUS</button>";
    html += "</div>";
    html += "</div>";
    
    html += "<div class='card'>";
    html += "<h3>API Endpoints</h3>";
    html += "<pre style='background:#1b2b48; padding:15px; border-radius:6px; overflow-x:auto;'>";
    html += "GET  /ping                     - Test connection\n";
    html += "GET  /info                     - Device info\n";
    html += "GET  /status                   - Detailed status\n";
    html += "GET  /api/led?state=on|off|blink|toggle|status&key=" + String(API_KEY) + "\n";
    html += "POST /api/led                  - Control LED via JSON\n";
    html += "GET  /api/system?action=reboot|shutdown|status&key=" + String(API_KEY);
    html += "</pre>";
    html += "</div>";
    
    html += "<script>";
    html += "const apiKey = '" + String(API_KEY) + "';";
    html += "function controlLed(state) {";
    html += "  var btn = event.target;";
    html += "  var originalText = btn.innerHTML;";
    html += "  btn.disabled = true;";
    html += "  btn.innerHTML = '...';";
    html += "  var xhr = new XMLHttpRequest();";
    html += "  xhr.open('GET', '/api/led?state=' + state + '&key=' + apiKey, true);";
    html += "  xhr.onload = function() {";
    html += "    if (xhr.status === 200) {";
    html += "      var data = JSON.parse(xhr.responseText);";
    html += "      showMessage(data.message, 'success');";
    html += "      if (data.blink) {";
    html += "        var blinkDiv = document.getElementById('blinkStatus');";
    html += "        blinkDiv.style.display = 'block';";
    html += "        setTimeout(function() { blinkDiv.style.display = 'none'; }, 800);";
    html += "      }";
    html += "      updateStatus();";
    html += "    } else {";
    html += "      showMessage('Error: ' + xhr.status, 'error');";
    html += "    }";
    html += "    btn.disabled = false;";
    html += "    btn.innerHTML = originalText;";
    html += "  };";
    html += "  xhr.onerror = function() {";
    html += "    showMessage('Network error', 'error');";
    html += "    btn.disabled = false;";
    html += "    btn.innerHTML = originalText;";
    html += "  };";
    html += "  xhr.send();";
    html += "}";
    
    html += "function systemControl(action) {";
    html += "  if (action === 'reboot' && !confirm('Reboot ESP8266?')) return;";
    html += "  if (action === 'shutdown' && !confirm('Shutdown ESP8266?')) return;";
    html += "  var btn = event.target;";
    html += "  var originalText = btn.innerHTML;";
    html += "  btn.disabled = true;";
    html += "  btn.innerHTML = '...';";
    html += "  var xhr = new XMLHttpRequest();";
    html += "  xhr.open('GET', '/api/system?action=' + action + '&key=' + apiKey, true);";
    html += "  xhr.onload = function() {";
    html += "    if (xhr.status === 200) {";
    html += "      var data = JSON.parse(xhr.responseText);";
    html += "      showMessage(data.message, 'success');";
    html += "      if (action === 'reboot') {";
    html += "        setTimeout(function() { showMessage('System rebooting...', 'info'); }, 100);";
    html += "      }";
    html += "      updateStatus();";
    html += "    } else {";
    html += "      showMessage('Error: ' + xhr.status, 'error');";
    html += "    }";
    html += "    if (action !== 'reboot') {";
    html += "      btn.disabled = false;";
    html += "      btn.innerHTML = originalText;";
    html += "    }";
    html += "  };";
    html += "  xhr.onerror = function() {";
    html += "    showMessage('Network error', 'error');";
    html += "    if (action !== 'reboot') {";
    html += "      btn.disabled = false;";
    html += "      btn.innerHTML = originalText;";
    html += "    }";
    html += "  };";
    html += "  xhr.send();";
    html += "}";
    
    html += "function updateStatus() {";
    html += "  var xhr = new XMLHttpRequest();";
    html += "  xhr.open('GET', '/status', true);";
    html += "  xhr.onload = function() {";
    html += "    if (xhr.status === 200) {";
    html += "      var data = JSON.parse(xhr.responseText);";
    html += "      var ledDiv = document.getElementById('ledStatus');";
    html += "      if(data.led_state) {";
    html += "        ledDiv.className = 'status status-on';";
    html += "        ledDiv.innerHTML = 'LED Status: ON';";
    html += "      } else {";
    html += "        ledDiv.className = 'status status-off';";
    html += "        ledDiv.innerHTML = 'LED Status: OFF';";
    html += "      }";
    html += "      var sysDiv = document.getElementById('systemStatus');";
    html += "      if(data.system_active) {";
    html += "        sysDiv.className = 'status status-on';";
    html += "        sysDiv.innerHTML = 'System: ACTIVE';";
    html += "      } else {";
    html += "        sysDiv.className = 'status status-shutdown';";
    html += "        sysDiv.innerHTML = 'System: SHUTTING DOWN';";
    html += "      }";
    html += "      document.getElementById('uptime').textContent = data.uptime + 's';";
    html += "      document.getElementById('freeRam').textContent = data.free_heap;";
    html += "    }";
    html += "  };";
    html += "  xhr.send();";
    html += "}";
    
    html += "function showMessage(message, type) {";
    html += "  var div = document.createElement('div');";
    html += "  div.style.cssText = 'position: fixed; top: 20px; right: 20px; padding: 15px 25px; background: ' + (type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6') + '; color: white; border-radius: 10px; z-index: 1000; box-shadow: 0 5px 15px rgba(0,0,0,0.3); animation: slideIn 0.3s ease;';";
    html += "  div.textContent = message;";
    html += "  document.body.appendChild(div);";
    html += "  setTimeout(function() {";
    html += "    div.style.animation = 'slideOut 0.3s ease';";
    html += "    setTimeout(function() { div.remove(); }, 300);";
    html += "  }, 3000);";
    html += "}";
    
    html += "setInterval(updateStatus, 2000);";
    html += "updateStatus();";
    
    html += "var style = document.createElement('style');";
    html += "style.textContent = '@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }';";
    html += "document.head.appendChild(style);";
    html += "</script>";
    
    html += "</body></html>";
    server.send(200, "text/html", html);
  });
  
  server.on("/ping", HTTP_GET, handlePing);
  server.on("/info", HTTP_GET, handleInfo);
  server.on("/status", HTTP_GET, handleStatus);
  
  server.on("/api/led", HTTP_OPTIONS, handleOptions);
  server.on("/api/led", HTTP_GET, handleLedGet);
  server.on("/api/led", HTTP_POST, handleLedPost);
  
  server.on("/api/system", HTTP_GET, handleSystemControl);
  
  server.onNotFound([]() {
    sendCORS();
    server.send(404, "application/json", "{\"error\":\"not found\"}");
  });
  
  server.begin();
  Serial.println("\nHTTP server started");
  Serial.println("Port: 80");
  Serial.println("==========================================\n");
  
  // Success indicator (single blink)
  digitalWrite(LED_PIN, LOW);
  delay(400);
  digitalWrite(LED_PIN, HIGH);
  delay(400);
  digitalWrite(LED_PIN, LOW);
  delay(100);
  digitalWrite(LED_PIN, HIGH);
  
  // Initialize system uptime
  systemUptime = millis() / 1000;
  lastHeartbeat = millis();
}

void loop() {
  // Update system uptime
  if (systemActive) {
    systemUptime = millis() / 1000;
  }
  
  // Handle HTTP requests (jika sistem aktif atau dalam shutdown awal)
  if (systemActive || (shutdownRequested && (millis() - shutdownTime) < 4000)) {
    server.handleClient();
  }
  
  // Update LED untuk efek blink
  updateLed();
  
  // Handle shutdown sequence
  if (shutdownRequested) {
    unsigned long elapsed = millis() - shutdownTime;
    
    // Blink cepat selama shutdown
    if (elapsed < SHUTDOWN_DURATION) {
      static unsigned long lastShutdownBlink = 0;
      if (elapsed - lastShutdownBlink > 200) {
        digitalWrite(LED_PIN, digitalRead(LED_PIN) == LOW ? HIGH : LOW);
        lastShutdownBlink = elapsed;
      }
      
      // Log countdown setiap detik
      static unsigned long lastLog = 0;
      if (elapsed - lastLog > 1000) {
        int remaining = (SHUTDOWN_DURATION - elapsed) / 1000;
        Serial.print("Shutdown in ");
        Serial.print(remaining);
        Serial.println(" seconds...");
        lastLog = elapsed;
      }
    } else {
      // Shutdown complete, stop everything
      Serial.println("System shutdown complete");
      Serial.println("==========================================");
      
      // Turn off LED
      digitalWrite(LED_PIN, HIGH);
      
      // Infinite loop (system halted)
      while(true) {
        delay(1000);
      }
    }
  } else {
    // Normal operation heartbeat (slow blink setiap 10 detik)
    if (millis() - lastHeartbeat > 10000) {
      digitalWrite(LED_PIN, LOW); // ON
      delay(30);
      digitalWrite(LED_PIN, HIGH); // OFF
      lastHeartbeat = millis();
      
      // Log status setiap heartbeat
      static unsigned long lastStatusLog = 0;
      if (millis() - lastStatusLog > 30000) { // Setiap 30 detik
        Serial.print("Status: Uptime ");
        Serial.print(systemUptime);
        Serial.print("s, Clients: ");
        Serial.println(WiFi.softAPgetStationNum());
        lastStatusLog = millis();
      }
    }
  }
}