#include <WiFi.h>
#include <WebServer.h>

// Onboard LED pin
#ifndef LED_BUILTIN
  #define LED_BUILTIN 2
#endif
const int LED_PIN = LED_BUILTIN;

// --- STEPPER MOTOR PINS ---
// Azimuth Motor (A4988 / TMC2209)
const int AZ_STEP_PIN = 18;
const int AZ_DIR_PIN  = 19;

// Altitude Motor
const int ALT_STEP_PIN = 22;
const int ALT_DIR_PIN  = 23;

// --- GEARING & KINEMATICS CONFIGURATION ---
const float GEAR_RATIO = 120.0;
const float MICROSTEPPING = 16.0;
const float STEPS_PER_REV_MOTOR = 200.0; // Standard 1.8 degree stepper

// Total microsteps per full 360-degree rotation of the telescope axis
const float STEPS_PER_DEGREE = (STEPS_PER_REV_MOTOR * MICROSTEPPING * GEAR_RATIO) / 360.0;

// Step pulse timing (microseconds delay between step pulses)
const int STEP_DELAY_US = 200; 

// --- AZIMUTH CABLE WRAP BOUNDARIES ---
// Prevents wire entanglement by keeping absolute position between -180 and +180 deg
const float AZ_MIN_LIMIT_DEG = -180.0;
const float AZ_MAX_LIMIT_DEG =  180.0;

// Current tracked positions in degrees
float currentAzDeg = 0.0;
float currentAltDeg = 0.0;

// Wi-Fi credentials
const char* ssid = "Doza";
const char* password = "sicilian";

WebServer server(80);

QueueHandle_t altQueue;
QueueHandle_t azQueue;

void blinkLED(int durationMs = 100) {
  digitalWrite(LED_PIN, HIGH);
  delay(durationMs);
  digitalWrite(LED_PIN, LOW);
}

// Low-level step pulse generator
void stepMotor(int stepPin, int dirPin, bool direction, long steps) {
  digitalWrite(dirPin, direction ? HIGH : LOW);
  for (long i = 0; i < steps; i++) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(STEP_DELAY_US);
    digitalWrite(stepPin, LOW);
    delayMicroseconds(STEP_DELAY_US);
  }
}

// Normalizes an angle into the standard [-180, +180) range
float normalize180(float angle) {
  while (angle >= 180.0)  angle -= 360.0;
  while (angle < -180.0) angle += 360.0;
  return angle;
}

// Moves Azimuth taking cable wrap limits into account
void moveAzimuthTo(float targetDeg) {
  targetDeg = normalize180(targetDeg);
  
  // Calculate potential move options
  float deltaShortest = targetDeg - currentAzDeg;
  deltaShortest = normalize180(deltaShortest);
  
  float candidatePos = currentAzDeg + deltaShortest;
  float chosenDelta = deltaShortest;

  // Verify if shortest route breaks cable wrap limits
  if (candidatePos > AZ_MAX_LIMIT_DEG) {
    chosenDelta = deltaShortest - 360.0; // Forced unwind counter-clockwise
  } else if (candidatePos < AZ_MIN_LIMIT_DEG) {
    chosenDelta = deltaShortest + 360.0; // Forced unwind clockwise
  }

  long stepsToMove = labs((long)(chosenDelta * STEPS_PER_DEGREE));
  bool direction = (chosenDelta >= 0);

  if (stepsToMove > 0) {
    Serial.print("Az Unwind Move: ");
    Serial.print(chosenDelta, 4);
    Serial.println(" deg");
    
    stepMotor(AZ_STEP_PIN, AZ_DIR_PIN, direction, stepsToMove);
    currentAzDeg += chosenDelta;
  }
}

// Moves Altitude directly (bounded between 0 and 90 degrees)
void moveAltitudeTo(float targetDeg) {
  // Constrain to physical horizon limits
  if (targetDeg < 0.0) targetDeg = 0.0;
  if (targetDeg > 90.0) targetDeg = 90.0;

  float delta = targetDeg - currentAltDeg;
  long stepsToMove = labs((long)(delta * STEPS_PER_DEGREE));
  bool direction = (delta >= 0);

  if (stepsToMove > 0) {
    stepMotor(ALT_STEP_PIN, ALT_DIR_PIN, direction, stepsToMove);
    currentAltDeg = targetDeg;
  }
}

void handleData() {
  bool success = false;
  String response = "";

  if (server.hasArg("alt")) {
    float altVal = server.arg("alt").toFloat();
    if (xQueueSend(altQueue, &altVal, 0) == pdTRUE) { 
      response += "Alt queued: " + String(altVal, 4) + "\n";
      success = true;
    } else {
      response += "Error: Alt queue is full!\n";
    }
  }

  if (server.hasArg("az")) {
    float azVal = server.arg("az").toFloat();
    if (xQueueSend(azQueue, &azVal, 0) == pdTRUE) {
      response += "Az queued: " + String(azVal, 4) + "\n";
      success = true;
    } else {
      response += "Error: Az queue is full!\n";
    }
  }

  if (success) {
    server.send(200, "text/plain", response);
    blinkLED(100); 
  } else {
    server.send(400, "text/plain", "Failed: No valid parameters provided or queues full.\n");
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  pinMode(AZ_STEP_PIN, OUTPUT);
  pinMode(AZ_DIR_PIN, OUTPUT);
  pinMode(ALT_STEP_PIN, OUTPUT);
  pinMode(ALT_DIR_PIN, OUTPUT);

  // Queue capacity increased to 1000 items each
  altQueue = xQueueCreate(1000, sizeof(float));
  azQueue  = xQueueCreate(1000, sizeof(float));

  if (altQueue == NULL || azQueue == NULL) {
    Serial.println("Error creating queues!");
  }

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nConnected!");
  Serial.print("ESP32 IP Address: ");
  Serial.println(WiFi.localIP());

  server.on("/target", handleData);
  server.begin();
  Serial.println("HTTP server started");

  blinkLED(100);
  delay(100);
  blinkLED(100);
}

void loop() {
  server.handleClient();

  float currentTargetAlt;
  float currentTargetAz;

  if (xQueueReceive(altQueue, &currentTargetAlt, 0) == pdTRUE) {
    Serial.print("Actuating Alt to: ");
    Serial.println(currentTargetAlt, 4);
    moveAltitudeTo(currentTargetAlt);
  }
  
  if (xQueueReceive(azQueue, &currentTargetAz, 0) == pdTRUE) {
    Serial.print("Actuating Az to: ");
    Serial.println(currentTargetAz, 4);
    moveAzimuthTo(currentTargetAz);
  }
}
