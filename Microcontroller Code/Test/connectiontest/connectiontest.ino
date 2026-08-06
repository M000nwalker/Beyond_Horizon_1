#include <WiFi.h>
#include <HTTPClient.h>

// Your Wi-Fi credentials
const char* ssid = "TP-Link_98F0_5G";
const char* password = "78813168";

// Your PC's Ethernet IP address and port
const char* serverUrl = "http://10.13.24.234:8000/data";

void setupWiFi() {
    delay(10);
    Serial.begin(115200);
    Serial.println();
    Serial.print("Connecting to ");
    Serial.println(ssid);

    WiFi.begin(ssid, password);

    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println("");
    Serial.println("WiFi connected successfully.");
    Serial.print("ESP32 IP address: ");
    Serial.println(WiFi.localIP());
}

void pollInterface() {
    if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        
        // Begin the connection to your PC's interface
        http.begin(serverUrl);
        
        int httpResponseCode = http.GET();
        
        if (httpResponseCode > 0) {
            String payload = http.getString();
            Serial.print("Response from PC (Code ");
            Serial.print(httpResponseCode);
            Serial.println("):");
            Serial.println(payload);
        } else {
            Serial.print("Error code: ");
            Serial.println(httpResponseCode);
            Serial.println("Check if your PC interface is running and firewall allows port 8000.");
        }
        
        http.end();
    } else {
        Serial.println("WiFi Disconnected. Reconnecting...");
        WiFi.begin(ssid, password);
    }
}

void setup() {
    setupWiFi();
}

void loop() {
    pollInterface();
    delay(1000); // Poll every 1 second
}
