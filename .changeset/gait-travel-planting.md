---
"posecode-render": patch
---

Carry the body to its authored travel waypoints in gait moves. A floor foot-pin in a clip that travels and alternates both feet is now solved as a stance foot (leg IK to the fixed plant) while the travelled root stays put, instead of translating the whole body back onto the plant and cancelling the travel. Same-foot travel pins and vertical supports keep the body-translate behaviour.
