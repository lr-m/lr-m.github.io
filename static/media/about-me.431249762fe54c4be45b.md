## Hi, I'm Luke!

I work in cyber security and have a background in Computer Science. Although I primarily focus on vulnerability research, I also enjoy dabbling in programming, binary exploitation, artificial intelligence, and visualisation. Most of my recent projects have been finding and exploiting bugs in cheap embedded devices.

I made this blog to gain some experience with React - this content was originally on a Jekyll-based blog generator, but I wanted some more control!

# 💻 Technologies/Interests

I have experience with a bunch of technologies from University, and also from doing projects when I find something interesting:
- Vulnerability Research (currently focused on embedded systems)
- Programming (*Python* / *C* / *C++* / *Java* / *Javascript*)
- Reverse engineering (Android apps using *Jadx*/*frida* and firmware blobs using *Ghidra*)
- Binary exploitation (on the hunt for self-discovered heap corruptions for experience!)
- Basic web development (*React*)
- Embedded Systems (*ESP8266*, *ESP32*, *Digikey Stump*, *Arduino*)
- Artifical Intelligence (simple neural networks, genetic algorithms, min-max trees, LLMs)
- Visualisation (*Processing*, *p5.js*, *three.js*)

# 🪣 Bug-cket List

I like keeping track of the things I have found, so enjoy this summary of all of the bugs I have found in the wild (on Aliexpress stuff so don't give me too much credit).

*Note:* All of these bugs are remote (mostly via LAN/Hotspot) unless otherwise noted.

## 📡 [Wodesys Router](https://luke-m.xyz/router/p2.md)

- Pre-auth Stack Overflow
- 2️⃣ Pre-auth Null-Pointer-Dereference
- 2️⃣ Post-auth Stack Overflow

## 📷 [Anyka-based Yi IoT PTZ Camera](https://luke-m.xyz/camera)

When in hotspot mode only:
- Arbitrary File Write
- 2️⃣ Command Injection
- Stack Overflow
- Global Overflow
- Stack Overflow via sound
- Global Overflow via sound ➡️ Command Injection

When in any mode:
- OOB-Read
- 2️⃣ Stack Overflow
- Global Overflow ➡️ Stack Overflow
- Command Injection
- Global Overflow via SD Card
- 2️⃣ Stack Overflow via SD Card
- Command Injection via SD Card

## 🌎 [KuWfi C920 (Travel Router)](https://luke-m.xyz/travel_router/p2.md)

- Pre-auth Directory Traversal ➡️ Arbitrary File Write
- Pre-auth Directory Traversal ➡️ Arbitrary File Delete
- Pre-auth Directory Traversal ➡️ Arbitrary Directory Create
- Pre-auth Directory Traversal ➡️ Arbitrary File Rename ➡️ Auth Bypass
- Pre-auth Arbitrary Config Entry Clear
- 3️⃣ Post-auth Stack Overflow
- 1️⃣1️⃣ Post-auth Command Injection

## 🌎 [ZTE MF904-E/MF931 (Travel Routers)](https://luke-m.xyz/travel_router/p4.md)

- 2️⃣ Authentication Bypass
- Post-auth Arbitrary File Read
- Post-auth ADB Enable
- Post-auth Command Injection

## 🪂 [JOZUZE CS09 (Digital Recorder)](https://luke-m.xyz/body_cam)

- Arbitrary File Read
- Heap Overflow

## 🎥 [Besder Video Call Camera](https://luke-m.xyz/video_call_camera)

- Pre-auth Integer Underflow ➡️ Global Overflow
- Post-auth Command Injection
- Post-auth Execution of a Binary on SD Card
- Post-auth Assert Trigger
- Post-auth Integer Overflow
- Stack Canary Weakness
- 1️⃣0️⃣ Stack Overflow (1️⃣ usable for Stack Canary Bypass)
