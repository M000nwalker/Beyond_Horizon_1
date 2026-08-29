const int stepPin = 18;
const int dirPin = 19;

// Adjust steps per revolution based on microstepping:
// Standard motor = 200 steps/rev. At 1/16 microstepping = 3200 steps/rev.
const int stepsPerRevolution = 3200; 

void setup() {
  pinMode(stepPin, OUTPUT);
  pinMode(dirPin, OUTPUT);
  
  // Set initial direction
  digitalWrite(dirPin, HIGH); 
}

void loop() {
  // Rotate one full revolution forward
 
    digitalWrite(stepPin, HIGH);
   
}
