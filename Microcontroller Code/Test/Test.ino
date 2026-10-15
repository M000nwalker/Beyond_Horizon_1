#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
    digitalWrite(LED_BUILTIN, HIGH);
    Serial.println("LED is ON");
    delay(1000);
    digitalWrite(LED_BUILTIN, LOW);
    Serial.println("LED is OFF");
    delay(1000);
}
