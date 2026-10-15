#include <WiFi.h>
#include <WebServer.h>

// Onboard LED pin (GPIO 2 on most ESP32 boards)
#ifndef LED_BUILTIN
  #define LED_BUILTIN 2
#endif
const int LED_PIN = LED_BUILTIN;

// Wi-Fi credentials
const char* ssid = "Doza";
const char* password = "sicilian";

// Initialize the web server on port 80
WebServer server(80);

// Define FreeRTOS Queues for Altitude and Azimuth
QueueHandle_t altQueue;
QueueHandle_t azQueue;

// Helper function to give a visual blink feedback
void blinkLED(int durationMs = 100) {
  digitalWrite(LED_PIN, HIGH);
  delay(durationMs);
  digitalWrite(LED_PIN, LOW);
}

// Handler for incoming HTTP requests
void handleData() {
  bool success = false;
  String response = "";

  // Check and queue Altitude data
  if (server.hasArg("alt")) {
    float altVal = server.arg("alt").toFloat();
    // 0 means don't block if the queue is full
    if (xQueueSend(altQueue, &altVal, 0) == pdTRUE) { 
      response += "Alt queued: " + String(altVal, 4) + "\n";
      success = true;
    } else {
      response += "Error: Alt queue is full!\n";
    }
  }

  // Check and queue Azimuth data
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
    // Flash the LED for 100ms on successful reception
    blinkLED(100); 
  } else {
    server.send(400, "text/plain", "Failed: No valid parameters provided or queues full.\n");
  }
}

void setup() {
  Serial.begin(115200);

  // Initialize LED pin
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Create queues: each holds up to 10 float variables
  altQueue = xQueueCreate(10, sizeof(float));
  azQueue = xQueueCreate(10, sizeof(float));

  if (altQueue == NULL || azQueue == NULL) {
    Serial.println("Error creating queues!");
  }

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nConnected!");
  Serial.print("ESP32 IP Address: ");
  Serial.println(WiFi.localIP());

  // Define the server route
  server.on("/target", handleData);
  
  // Start the server
  server.begin();
  Serial.println("HTTP server started");

  // Double blink to indicate full setup completion
  blinkLED(100);
  delay(100);
  blinkLED(100);
}

void loop() {
  // Listen for incoming HTTP requests
  server.handleClient();

  // ----- MOTOR CONTROL / PROCESSING LOGIC -----
  // Pull data from the queue safely and act on it
  float currentTargetAlt;
  float currentTargetAz;

  if (xQueueReceive(altQueue, &currentTargetAlt, 0) == pdTRUE) {
    Serial.print("Processing new Alt target: ");
    Serial.println(currentTargetAlt, 4);
    // Add logic here to actuate Altitude 
  }
  
  if (xQueueReceive(azQueue, &currentTargetAz, 0) == pdTRUE) {
    Serial.print("Processing new Az target: ");
    Serial.println(currentTargetAz, 4);
    // Add logic here to actuate Azimuth
  }
}
