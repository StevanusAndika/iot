#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>

// ===== WIFI & API KEY =====
const char* WIFI_SSID = "Steven";
const char* WIFI_PASS = "12345678";
const char* API_KEY   = "rahasiaku123";     // samakan dengan di HTML

// LED builtin D1 mini = D4 (GPIO2), AKTIF LOW
const int LED_PIN = LED_BUILTIN;

ESP8266WebServer server(80);

// ---- CORS helper ----
void sendCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  server.sendHeader("Access-Control-Expose-Headers", "Content-Type");
}
void handleOptions() { sendCORS(); server.send(204); }

void setLed(bool on) { digitalWrite(LED_PIN, on ? LOW : HIGH); }  // aktif LOW

void replyJson(int code, const char* status, const char* msg) {
  sendCORS();
  StaticJsonDocument<200> doc;
  doc["status"]  = status;
  doc["message"] = msg;
  String out; serializeJson(doc, out);
  server.send(code, "application/json", out);
}

// Cek API key dari header ATAU query (?key=)
bool checkApiKey() {
  // header (butuh collectHeaders)
  String key = server.header("X-API-Key");
  if (key.length() == 0) key = server.arg("key"); // fallback via query
  return key == API_KEY;
}

// ---- Handlers ----
void handlePing() {
  sendCORS();
  server.send(200, "application/json", "{\"pong\":true}");
}

// GET /api/led?state=on|off&key=...
void handleLedGet() {
  if (!checkApiKey()) { replyJson(401, "error", "invalid api key"); return; }
  String s = server.arg("state"); s.toLowerCase();
  if (s == "on")      { setLed(true);  replyJson(200, "ok", "led on");  }
  else if (s == "off"){ setLed(false); replyJson(200, "ok", "led off"); }
  else replyJson(400, "error", "state must be on/off");
}

// POST /api/led  body: {"state":"on"} header: X-API-Key (atau query ?key=)
void handleLedPost() {
  if (!checkApiKey()) { replyJson(401, "error", "invalid api key"); return; }
  if (!server.hasArg("plain")) { replyJson(400, "error", "missing body"); return; }

  StaticJsonDocument<200> doc;
  auto err = deserializeJson(doc, server.arg("plain"));
  if (err) { replyJson(400, "error", "invalid json"); return; }

  String s = doc["state"] | ""; s.toLowerCase();
  if (s == "on")      { setLed(true);  replyJson(200, "ok", "led on");  }
  else if (s == "off"){ setLed(false); replyJson(200, "ok", "led off"); }
  else replyJson(400, "error", "state must be on/off");
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  setLed(false);

  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  uint32_t t0=millis();
  while (WiFi.status()!=WL_CONNECTED && millis()-t0<20000) { Serial.print("."); delay(500); }
  Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());

  // ---- DAFTARKAN HEADER agar server.header("X-API-Key") bisa dibaca
  const char* headerKeys[] = {"X-API-Key"};
  const size_t headerKeysCount = sizeof(headerKeys) / sizeof(headerKeys[0]);
  server.collectHeaders(headerKeys, headerKeysCount);

  // Routes
  server.on("/ping", HTTP_GET, handlePing);

  server.on("/api/led", HTTP_OPTIONS, handleOptions);
  server.on("/api/led", HTTP_GET,  handleLedGet);   // GET + ?state=on&key=...
  server.on("/api/led", HTTP_POST, handleLedPost);  // POST + header X-API-Key

  server.onNotFound([](){
    sendCORS();
    server.send(404, "application/json", "{\"error\":\"not found\"}");
  });

  server.begin();
  Serial.println("HTTP server started");
}

void loop() { server.handleClient(); }
