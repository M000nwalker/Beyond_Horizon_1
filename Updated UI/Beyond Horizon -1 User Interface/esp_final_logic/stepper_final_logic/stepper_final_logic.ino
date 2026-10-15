/*
 * Beyond Horizon Telescope Mount -- Single-Core Non-Blocking Stepper Controller
 * ============================================================================
 * Runs ALT and AZ stepping sequentially/interleaved in a single loop on Core 1.
 * Uses a non-blocking queue mechanism for HTTP handling so client requests
 * complete instantly without waiting for physical movement to finish.
 *
 * Endpoints:
 *   GET /target?alt={delta_alt}&az={delta_az}   -- delta move (interleaved execution)
 *   GET /calibrate?alt={abs_alt}&az={abs_az}     -- sync coordinates, NO motor motion
 *   GET /status                                  -- report current tracked position
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>

// --- PIN DEFINITIONS -------------------------------------------------------
#ifndef LED_BUILTIN
  #define LED_BUILTIN 2
#endif
const int LED_PIN      = LED_BUILTIN;

const int AZ_STEP_PIN  = 18;
const int AZ_DIR_PIN   = 19;
const int ALT_STEP_PIN = 22;
const int ALT_DIR_PIN  = 23;

// --- KINEMATICS ------------------------------------------------------------
const float GEAR_RATIO          = 120.0;
const float MICROSTEPPING       = 16.0;
const float STEPS_PER_REV_MOTOR = 200.0;
const float STEPS_PER_DEGREE    = (STEPS_PER_REV_MOTOR * MICROSTEPPING * GEAR_RATIO) / 360.0;

const int STEP_DELAY_US = 200; // Pulse half-period delay

// --- PHYSICAL SAFETY LIMITS ------------------------------------------------
const float AZ_MIN  =   0.0f;
const float AZ_MAX  = 360.0f;
const float ALT_MIN =   0.0f;
const float ALT_MAX =  90.0f;

// --- TRACKED POSITION ------------------------------------------------------
float currentAzDeg  = 0.0f;
float currentAltDeg = 0.0f;

// --- Wi-Fi -----------------------------------------------------------------
const char* ssid     = "Doza";
const char* password = "sicilian";

WebServer server(80);

// --- COMMAND QUEUE BUFFER --------------------------------------------------
struct SlewCommand {
  float dAlt;
  float dAz;
};

SlewCommand pendingCmd;
bool hasPendingCmd = false;

// --- MOVE FLAGS -------------------------------------------------------------
bool altMoving = false;
bool azMoving  = false;

// ===========================================================================
// INTERLEAVED STEP GENERATOR
// ===========================================================================
void executeInterleavedSlew(long altStepsTotal, bool altDir, long azStepsTotal, bool azDir) {
  if (altStepsTotal <= 0 && azStepsTotal <= 0) return;

  digitalWrite(ALT_DIR_PIN, altDir ? HIGH : LOW);
  digitalWrite(AZ_DIR_PIN,  azDir  ? HIGH : LOW);

  long altStepsRemaining = altStepsTotal;
  long azStepsRemaining  = azStepsTotal;

  altMoving = (altStepsRemaining > 0);
  azMoving  = (azStepsRemaining > 0);

  while (altStepsRemaining > 0 || azStepsRemaining > 0) {
    // Pulse HIGH for active axes
    if (altStepsRemaining > 0) digitalWrite(ALT_STEP_PIN, HIGH);
    if (azStepsRemaining > 0)  digitalWrite(AZ_STEP_PIN,  HIGH);

    delayMicroseconds(STEP_DELAY_US);

    // Pulse LOW for active axes
    if (altStepsRemaining > 0) {
      digitalWrite(ALT_STEP_PIN, LOW);
      altStepsRemaining--;
    }
    if (azStepsRemaining > 0) {
      digitalWrite(AZ_STEP_PIN, LOW);
      azStepsRemaining--;
    }

    delayMicroseconds(STEP_DELAY_US);

    // Keep HTTP server responsive during step execution
    server.handleClient();
  }

  altMoving = false;
  azMoving  = false;
}

// ===========================================================================
// DISPATCHER
// ===========================================================================
void dispatchSlew(SlewCommand& cmd) {

  // Altitude clamping
  float dAlt         = cmd.dAlt;
  float candidateAlt = currentAltDeg + dAlt;
  if (candidateAlt > ALT_MAX) { dAlt = ALT_MAX - currentAltDeg; candidateAlt = ALT_MAX; }
  if (candidateAlt < ALT_MIN) { dAlt = ALT_MIN - currentAltDeg; candidateAlt = ALT_MIN; }
  long altSteps = labs((long)(dAlt * STEPS_PER_DEGREE));
  bool altDir   = (dAlt >= 0);

  // Azimuth clamping
  float dAz         = cmd.dAz;
  float candidateAz = currentAzDeg + dAz;
  if (candidateAz > AZ_MAX) { dAz = AZ_MAX - currentAzDeg; candidateAz = AZ_MAX; }
  if (candidateAz < AZ_MIN) { dAz = AZ_MIN - currentAzDeg; candidateAz = AZ_MIN; }
  long azSteps = labs((long)(dAz * STEPS_PER_DEGREE));
  bool azDir   = (dAz >= 0);

  // Serial log
  Serial.println("----------------------------------------");
  if (altSteps > 0) {
    Serial.print("[ALT] delta=");
    if (dAlt >= 0) Serial.print("+");
    Serial.print(dAlt, 4);
    Serial.print("deg  ");
    Serial.print(currentAltDeg, 4);
    Serial.print(" -> ");
    Serial.print(candidateAlt, 4);
    Serial.print("deg  (");
    Serial.print(altSteps);
    Serial.println(" steps)");
  } else {
    Serial.println("[ALT] No movement");
  }

  if (azSteps > 0) {
    Serial.print("[AZ]  delta=");
    if (dAz >= 0) Serial.print("+");
    Serial.print(dAz, 4);
    Serial.print("deg  ");
    Serial.print(currentAzDeg, 4);
    Serial.print(" -> ");
    Serial.print(candidateAz, 4);
    Serial.print("deg  (");
    Serial.print(azSteps);
    Serial.println(" steps)");
  } else {
    Serial.println("[AZ]  No movement");
  }
  Serial.println(">> EXECUTING INTERLEAVED AXIS SLEW");

  // Execute stepped motion
  executeInterleavedSlew(altSteps, altDir, azSteps, azDir);

  // Commit new positions
  currentAltDeg = candidateAlt;
  currentAzDeg  = candidateAz;

  Serial.print("[DONE] Alt=");
  Serial.print(currentAltDeg, 4);
  Serial.print("deg  Az=");
  Serial.print(currentAzDeg, 4);
  Serial.println("deg");
  Serial.println("----------------------------------------");

  digitalWrite(LED_PIN, HIGH); delay(60); digitalWrite(LED_PIN, LOW);
}

// ===========================================================================
// HTTP HANDLERS
// ===========================================================================

void handleData() {
  bool hasAlt = server.hasArg("alt");
  bool hasAz  = server.hasArg("az");

  if (!hasAlt && !hasAz) {
    server.send(400, "text/plain", "ERROR: Missing alt and/or az delta parameters\n");
    return;
  }

  // Store target command in buffer (latest request overrides pending request)
  pendingCmd.dAlt = hasAlt ? server.arg("alt").toFloat() : 0.0f;
  pendingCmd.dAz  = hasAz  ? server.arg("az").toFloat()  : 0.0f;
  hasPendingCmd   = true;

  // Immediate response matching original format
  String resp = "OK\nQueued dAlt=" + String(pendingCmd.dAlt, 4) + " dAz=" + String(pendingCmd.dAz, 4) + "\n";
  server.send(200, "text/plain", resp);

  Serial.print("[HTTP /target] dAlt=");
  Serial.print(pendingCmd.dAlt, 4);
  Serial.print("  dAz=");
  Serial.println(pendingCmd.dAz, 4);

  digitalWrite(LED_PIN, HIGH); delayMicroseconds(30000); digitalWrite(LED_PIN, LOW);
}

void handleCalibrate() {
  bool hasAlt = server.hasArg("alt");
  bool hasAz  = server.hasArg("az");

  if (!hasAlt && !hasAz) {
    server.send(400, "text/plain", "ERROR: Missing alt/az calibration parameters\n");
    return;
  }

  // Clear any pending movement when calibrating
  hasPendingCmd = false;

  if (hasAlt) {
    float v = server.arg("alt").toFloat();
    if (v < ALT_MIN) v = ALT_MIN;
    if (v > ALT_MAX) v = ALT_MAX;
    currentAltDeg = v;
  }
  if (hasAz) {
    float v = server.arg("az").toFloat();
    if (v < AZ_MIN) v = AZ_MIN;
    if (v > AZ_MAX) v = AZ_MAX;
    currentAzDeg = v;
  }

  String resp = "Calibrated: Alt=" + String(currentAltDeg, 4)
              + " Az="  + String(currentAzDeg, 4)
              + " (no motor motion)\n";
  server.send(200, "text/plain", resp);

  Serial.print("[CALIBRATE] Alt=");
  Serial.print(currentAltDeg, 4);
  Serial.print("deg  Az=");
  Serial.print(currentAzDeg, 4);
  Serial.println("deg  (zero motor motion)");

  digitalWrite(LED_PIN, HIGH); delay(150); digitalWrite(LED_PIN, LOW);
}

void handleStatus() {
  String resp = "Alt=" + String(currentAltDeg, 4)
              + " Az=" + String(currentAzDeg, 4)
              + " AltMoving=" + String(altMoving ? "YES" : "NO")
              + " AzMoving="  + String(azMoving  ? "YES" : "NO") + "\n";
  server.send(200, "text/plain", resp);
}

// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(1500);

  pinMode(LED_PIN,      OUTPUT); digitalWrite(LED_PIN,      LOW);
  pinMode(AZ_STEP_PIN,  OUTPUT); digitalWrite(AZ_STEP_PIN,  LOW);
  pinMode(AZ_DIR_PIN,   OUTPUT); digitalWrite(AZ_DIR_PIN,   LOW);
  pinMode(ALT_STEP_PIN, OUTPUT); digitalWrite(ALT_STEP_PIN, LOW);
  pinMode(ALT_DIR_PIN,  OUTPUT); digitalWrite(ALT_DIR_PIN,  LOW);

  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.println("\nWi-Fi Connected!");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  server.on("/target",    handleData);
  server.on("/calibrate", handleCalibrate);
  server.on("/status",    handleStatus);
  server.begin();

  Serial.println("HTTP Server Ready:");
  Serial.println("  /target?alt=<delta>&az=<delta>   interleaved simultaneous slew");
  Serial.println("  /calibrate?alt=<abs>&az=<abs>    sync position (no motion)");
  Serial.println("  /status                          current position report");

  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH); delay(80);
    digitalWrite(LED_PIN, LOW);  delay(80);
  }
}

// ===========================================================================
// MAIN LOOP
// ===========================================================================
void loop() {
  server.handleClient();

  if (hasPendingCmd) {
    hasPendingCmd = false;
    dispatchSlew(pendingCmd);
  }
}
