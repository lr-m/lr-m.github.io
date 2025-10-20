---
published: true
title: "🎥 [7] Emulating NES Games on the Camera"
toc: true
toc_sticky: true
tagline: "After porting Pong to the camera, I wasn't satisfied that this was funny enough. I decided to see if this camera is able to run an NES emulator, and play some Kirby's Adventure!"
windowGradientStart: rgb(4,4,163)
windowGradientEnd: rgb(16,134,251)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgba(244,243,64,255)
maximizeButton: rgb(203,40,86)
closeButton: rgb(222,199,239)
tags:
  - Binary Exploitation
  - Coding
  - Fun/Creative
---

# Porting an NES Emulator

The NES is (no offense to my older audience if you exist) getting on a bit now, and as computers have gotten much faster and smaller, it isn't outside of the realms of possibility that this thing can emulate an NES - hell, even an [ESP32 can emulate it](https://www.hackster.io/news/build-a-portable-nes-console-using-an-esp32-and-arduino-b73e29fb5b83).

## *smolnes*

I browsed around on Github for a bit for some code to lovingly borrow, and came across [smolnes](https://github.com/binji/smolnes). It is a 700 line implementation of an NES emulator in C - this should be perfect!

![smolnes.png](/assets/images/icsee_cameras/p8/smolnes.png)

*Note*: There is also a deobfuscated version I used, I didn't feel like deciphering whatever that abomination is...

## Making it Portable

I tested it locally and it worked great, but it makes use of the SDL library for its graphics - we don't need this as we simply have direct access to the framebuffer.

I created a separate file called **platform.c** which implements all of the core functionality required for the emulator to interface with the hardware. So all we have to do it provide implementations for these functions:

```c
int platform_init(void);
void platform_cleanup(void);
int is_key_pressed(int key);
void update_screen(uint16_t *buffer, int width, int height);
int read_file(const char *filename, void *buffer, int max_size);
int platform_check_events(void);
```

We'll get around to completing these functions for the camera once we've sorted the IPC between our process and the App binary we inject into - but it works great for the SDL implementation.

## IPC

We need to figure out how our process running the NES emulator will interact with our injected payload.

### mmap?

I used this approach when I did [DOOM on the Yi IoT camera](https://luke-m.xyz/camera/p8.md), which essentially set up some shared memory between the DOOM process and the injected payload. This allowed the DOOM process to have access to the framebuffer drawn onto the screen.

However, on this camera, I could not get it to work. My main theory is that there just isn't enough memory for the ***320*240*2*** bytes needed for the framebuffer - especially after we just filled the *ramfs* with a NES ROM and the statically-compiled emulator itself!

### FIFO Pipe

Luckily, there are plenty of other ways we can send data between the processes. The next method I wanted to try was a FIFO pipe, where framebuffer data is fed into the pipe by the emulator, and read to the screen in our payload.

The FIFO pipe is initialised in the emulator:

```c
// Create the FIFO if it doesn't exist
if (mkfifo(FRAMEBUFFER_FIFO, 0666) == -1) {
    // If the error is not "File exists", report it
    if (errno != EEXIST) {
        perror("Failed to create FIFO");
        return 0;
    }
}

// Open the FIFO for writing only (non-blocking)
// O_NONBLOCK is important to prevent blocking on open if there's no reader
fifo_fd = open(FRAMEBUFFER_FIFO, O_WRONLY | O_NONBLOCK);
if (fifo_fd == -1) {
    perror("Failed to open FIFO for writing");
    return 0;
}

// Once connection is established, disable non-blocking mode
int flags = fcntl(fifo_fd, F_GETFL);
fcntl(fifo_fd, F_SETFL, flags & ~O_NONBLOCK);
```

And all our payload has to do is open the pipe and read it into the framebuffer:

```c
while (running) {
    // Read a complete frame from the FIFO
    uint32_t bytes_read = 0;
    while (bytes_read < BUFFER_SIZE) {
        uint32_t result = read(fifo_fd, 
                            ((char*)trans_buffer) + bytes_read, 
                            BUFFER_SIZE - bytes_read);

        bytes_read += result;
    }
    
    // send data when full frame received
    if (bytes_read == BUFFER_SIZE) {
        // Send the data to the LCD
        LibXmDvr_SpiLcd_sendData(0xf0, 0x140, trans_buffer, BUFFER_SIZE);
        printf("Frame displayed\n");
    }
}
```

## Result

Now that our IPC mechanism is sorted, I implemented the platform-specific functions for the camera (mainly just FIFO stuff for the framebuffer and initialisation). After some tweaking and fixing some bugs, here is how we are looking:

![slow.gif](/assets/images/icsee_cameras/p8/slow.gif)

It works! But I wasn't expecting it to be THAT slow...

![slow_meme.png](/assets/images/icsee_cameras/p8/slow_meme.png)

# Speeding Up

Looks like we need to think of some methods to speed it up!

![thinking.gif](/assets/images/icsee_cameras/p8/thinking.gif)

## Compiler Flags

The first obvious thing to look at is compiler flags, if we look at the CPU info, there is plenty of information we can give to the compiler so that it generates faster code.

```
model name    : ARMv7 Processor rev 5 (v7l)
BogoMIPS    : 100.00
Features    : half thumb fastmult vfp edsp neon vfpv3 tls vfpv4 idiva idivt vfpd32 lpae evtstrm 
CPU implementer    : 0x41
CPU architecture: 7
CPU variant    : 0x0
CPU part    : 0xc07
CPU revision    : 5
Hardware    : Generic DT based system
Revision    : 0000
Serial        : 0000000000000000
```

There are also generic compiler flags which boost performance, such as ***-03*** which heavily optimises the code for performance. Here is the final ***Makefile*** that helped speed up execution significantly:

```make
CC=arm-linux-gnueabi-gcc
STRIP=arm-linux-gnueabi-strip
CFLAGS=-march=armv7-a -mfpu=neon-vfpv4 -mfloat-abi=softfp -fno-PIC -fno-PIE -O3 -ffast-math -funroll-loops -flto -fomit-frame-pointer
LDFLAGS=-static -no-pie -flto
all: smolnes
smolnes: smolnes.c platform.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o smolnes smolnes.c platform.c
	$(STRIP) smolnes
clean:
	rm -f smolnes
```

## Scheduling Priority

As we are running in Linux and have code execution, we should be able to give our process a higher priority so that it doesn't get interrupted as much and gets more CPU time.

It is simple to change the scheduling priority in Linux:

```c
int priority = -20;
int result = setpriority(PRIO_PROCESS, 0, priority);

if (result == -1){
    printf("Error setting priority...\n");
} else {
    int current = getpriority(PRIO_PROCESS, 0);
    printf("New priority value: %d\n", current);
}
```

Our process now has a priority of ***-20*** which is as high as it can go - this yielded some decent performance improvements.

![scheduler.gif](/assets/images/icsee_cameras/p8/scheduler.gif)

## Branch Prediction

The compiler doesn't know how our code works because it isn't running it and observing the output. We can give the compiler some hints as to how the code will run. For example, in an ***if*** statement, we can tell the compiler if this is a common case, and if so, make this code faster. First define these macros:

```c
#define likely(x)      __builtin_expect(!!(x), 1)
#define unlikely(x)    __builtin_expect(!!(x), 0)
```

Then use in the code like so:

```c
cycles = nomem = 0;
if (unlikely(nmi_irq))
  goto nmi_irq;
```

```c
uint8_t condition = !(P & mask[opcode >> 6 & 3]) ^ ((opcode >> 5) & 1);
if (likely(condition)) {
  cross = ((int8_t)val + PCL) >> 8;  // Calculate if page boundary crossed
  cycles += 1 + (cross != 0);        // Add cycles based on cross
  PCH += cross;                       // Add carry to PCH if needed
  PCL += (int8_t)val;                // Add offset to PCL
}
```

![branch_meme.jpeg](/assets/images/icsee_cameras/p8/branch_meme.jpeg)

## Other Bits

- Swapping ***/*** and ***\**** operations for bit-shifts (just in case the compiler hasn't optimised these)
- Loop unrolling for better cache utilization
- Inlining small functions

## NEON?

You might have seen in the **/proc/cpuinfo** output from earlier that this processor has the *neon* flag, indicating that it supports ARM's NEON intrinsics (like SSE or AVX). This means this CPU supports instructions for vectorization, basically meaning that multiple calculations can be done in parallel (instead of having to do those multiplications sequentially) - known as SIMD instructions (Single Instruction Multiple Data).

Unfortunately, vectorization has limited applicability here, as about 90% of our current slowdown is happening in the main function with all of the CPU emulation. We can't vectorize the CPU instructions as the current instruction might be dependent on the previous!

## Result

There is definitely some improvement!

![kirby.gif](/assets/images/icsee_cameras/p8/kirby.gif)

I'd even call it playable, if you've got lots of time to spare that is...

For some context, here is how quick it should be:

![actual.gif](/assets/images/icsee_cameras/p8/actual.gif)

# Controls

The controls were pretty straight-forward as the camera is connected to the network, therefore I can simply use the keyboard of the computer running the Python script. All I had to do was spawn a new thread in the **smolnes** binary that listens for a bitmap generated on the Python side, indicating which keys are pressed. This bitmap can then be parsed and the keys can be passed into the emulator.

The Python side uses *pynput* to listen for key presses, and a simple UDP socket to send the keys every *100ms*:

```python
import socket
import time
import sys
import argparse
from pynput import keyboard

def parse_arguments():
    parser = argparse.ArgumentParser(description='NES Controller Emulator')
    parser.add_argument('--ip', type=str, default='127.0.0.1',
                        help='IP address to send controller data (default: 127.0.0.1)')
    parser.add_argument('--port', type=int, default=1337,
                        help='Port to send controller data (default: 1337)')
    return parser.parse_args()

class NESController:
    # NES controller button bitmask values
    # Bit positions: 7  6  5   4    3     2    1    0
    #                A  B  SEL ST   UP   DOWN  LEFT RIGHT
    A_BUTTON = 0b10000000  # Bit 7
    B_BUTTON = 0b01000000  # Bit 6
    SELECT   = 0b00100000  # Bit 5
    START    = 0b00010000  # Bit 4
    UP       = 0b00001000  # Bit 3
    DOWN     = 0b00000100  # Bit 2
    LEFT     = 0b00000010  # Bit 1
    RIGHT    = 0b00000001  # Bit 0

    def __init__(self, target_ip, target_port):
        self.target_ip = target_ip
        self.target_port = target_port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.button_state = 0
        
        # Define key mappings
        self.key_mappings = {
            'w': self.UP,
            's': self.DOWN,
            'a': self.LEFT,
            'd': self.RIGHT,
            'g': self.START,
            'h': self.SELECT,
            'k': self.A_BUTTON,
            'l': self.B_BUTTON
        }
        
        # Track pressed keys
        self.pressed_keys = set()
        
        # Set up keyboard listener
        self.listener = keyboard.Listener(
            on_press=self.on_press,
            on_release=self.on_release)
        self.listener.start()
    
    def on_press(self, key):
        try:
            key_char = key.char.lower()
            if key_char in self.key_mappings and key_char not in self.pressed_keys:
                self.pressed_keys.add(key_char)
                self.button_state |= self.key_mappings[key_char]
        except (AttributeError, TypeError):
            # Ignore special keys that don't have a char attribute
            pass
    
    def on_release(self, key):
        try:
            key_char = key.char.lower()
            if key_char in self.key_mappings and key_char in self.pressed_keys:
                self.pressed_keys.remove(key_char)
                self.button_state &= ~self.key_mappings[key_char]
        except (AttributeError, TypeError):
            # Ignore special keys that don't have a char attribute
            pass
            
        # Return False to stop listener if escape key is pressed
        return key != keyboard.Key.esc
    
    def send_state(self):
        try:
            self.sock.sendto(bytes([self.button_state]), (self.target_ip, self.target_port))
        except Exception as e:
            print(f"Error sending data: {e}")
    
    def print_state(self):
        state_str = f"Button state: {self.button_state:08b}"
        buttons_pressed = []
        
        if self.button_state & self.A_BUTTON: buttons_pressed.append("A")
        if self.button_state & self.B_BUTTON: buttons_pressed.append("B")
        if self.button_state & self.SELECT: buttons_pressed.append("SELECT")
        if self.button_state & self.START: buttons_pressed.append("START")
        if self.button_state & self.UP: buttons_pressed.append("UP")
        if self.button_state & self.DOWN: buttons_pressed.append("DOWN")
        if self.button_state & self.LEFT: buttons_pressed.append("LEFT")
        if self.button_state & self.RIGHT: buttons_pressed.append("RIGHT")
        
        if buttons_pressed:
            state_str += f" - Pressed: {', '.join(buttons_pressed)}"
        else:
            state_str += " - No buttons pressed"
        
        # Clear line and print updated state
        print(state_str, end='\r')
```

And the C code responsible for processing the inputs from the network in another thread is seen here:

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <errno.h>

// Number of controller buttons
#define MAX_KEYS 8

// Default port to listen on
#define DEFAULT_PORT 1337

// External keyboard state array from smolnes.c
extern uint8_t keyboard_state[MAX_KEYS];

// Thread control
static pthread_t listener_thread;
static int thread_running = 0;
static int socket_fd = -1;
static pthread_mutex_t kb_mutex = PTHREAD_MUTEX_INITIALIZER;

// Function prototypes
void *controller_listener_thread(void *arg);
int start_controller_listener(int port);
void stop_controller_listener(void);

/**
 * Controller listener thread function - receives UDP packets and updates keyboard state
 */
void *controller_listener_thread(void *arg) {
    int port = *((int *)arg);
    free(arg); // Free the dynamically allocated port number
    
    struct sockaddr_in server_addr, client_addr;
    socklen_t client_len = sizeof(client_addr);
    uint8_t buffer[1]; // We only need 1 byte for the controller bitmask
    
    // Create UDP socket
    socket_fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (socket_fd < 0) {
        perror("Error creating socket");
        return NULL;
    }
    
    // Setup server address
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);
    server_addr.sin_port = htons(port);
    
    // Bind socket
    if (bind(socket_fd, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        perror("Error binding socket");
        close(socket_fd);
        socket_fd = -1;
        return NULL;
    }
    
    // Set socket to non-blocking mode
    int flags = fcntl(socket_fd, F_GETFL, 0);
    fcntl(socket_fd, F_SETFL, flags | O_NONBLOCK);
    
    printf("Controller listener started on port %d\n", port);
    
    // Main receiving loop
    while (thread_running) {
        ssize_t recv_len = recvfrom(socket_fd, buffer, 1, 0, 
                                   (struct sockaddr *)&client_addr, &client_len);
        
        if (recv_len > 0) {
            pthread_mutex_lock(&kb_mutex);
            
            // Update keyboard state based on the bitmask received
            // Based on the bitmask in nescontroller.py:
            // Bit positions: 7  6  5   4    3     2    1    0
            //                A  B  SEL ST   UP   DOWN  LEFT RIGHT
            keyboard_state[0] = (buffer[0] & 0x80) ? 1 : 0; // A
            keyboard_state[1] = (buffer[0] & 0x40) ? 1 : 0; // B
            keyboard_state[2] = (buffer[0] & 0x20) ? 1 : 0; // SELECT
            keyboard_state[3] = (buffer[0] & 0x10) ? 1 : 0; // START
            keyboard_state[4] = (buffer[0] & 0x08) ? 1 : 0; // UP
            keyboard_state[5] = (buffer[0] & 0x04) ? 1 : 0; // DOWN
            keyboard_state[6] = (buffer[0] & 0x02) ? 1 : 0; // LEFT
            keyboard_state[7] = (buffer[0] & 0x01) ? 1 : 0; // RIGHT
            
            pthread_mutex_unlock(&kb_mutex);
            
            // Debug: print the received byte in binary
            char bin_str[9];
            for (int i = 0; i < 8; i++) {
                bin_str[7-i] = (buffer[0] & (1 << i)) ? '1' : '0';
            }
            bin_str[8] = '\0';
            printf("Controller state: %s\n", bin_str);
        } else if (recv_len < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
            // Only print errors that are not related to non-blocking operation
            perror("Error receiving data");
        }
        
        // Small sleep to avoid high CPU usage
        usleep(5000); // 5ms sleep, short enough to not miss inputs
    }
    
    // Clean up
    if (socket_fd >= 0) {
        close(socket_fd);
        socket_fd = -1;
    }
    
    printf("Controller listener thread exiting\n");
    return NULL;
}

/**
 * Start the controller listener thread
 */
int start_controller_listener(int port) {
    if (thread_running) {
        printf("Controller listener already running\n");
        return 0;
    }
    
    // Use the provided port, or default if 0
    if (port <= 0) {
        port = DEFAULT_PORT;
    }
    
    // Allocate port number on heap to pass to thread
    int *port_ptr = malloc(sizeof(int));
    if (!port_ptr) {
        perror("Failed to allocate memory");
        return 0;
    }
    *port_ptr = port;
    
    // Initialize mutex
    pthread_mutex_init(&kb_mutex, NULL);
    
    // Start the thread
    thread_running = 1;
    if (pthread_create(&listener_thread, NULL, controller_listener_thread, port_ptr) != 0) {
        perror("Failed to create controller listener thread");
        free(port_ptr);
        thread_running = 0;
        return 0;
    }
    
    return 1;
}

/**
 * Stop the controller listener thread
 */
void stop_controller_listener(void) {
    if (!thread_running) {
        return;
    }
    
    // Signal thread to stop
    thread_running = 0;
    
    // Wait for thread to finish
    pthread_join(listener_thread, NULL);
    
    // Destroy mutex
    pthread_mutex_destroy(&kb_mutex);
    
    printf("Controller listener stopped\n");
}

/**
 * Function to check if a key is pressed (implementation for platform.c)
 */
int is_key_pressed(int key) {
    if (key < 0 || key >= MAX_KEYS) {
        return 0;
    }
    
    int result = 0;
    pthread_mutex_lock(&kb_mutex);
    result = keyboard_state[key];
    pthread_mutex_unlock(&kb_mutex);
    
    return result;
}
```

This is then imported into **platform.c** and **smolnes.c** so that the **is_key_pressed** can be used to detect key presses!

## Final Demo

With the controls working, we can actually now play NES games:

![final_demo.gif](/assets/images/icsee_cameras/p8/final_demo.gif)

I think it is safe to say this isn't a very convenient method of emulating NES games, but it is playable!

# Conclusion

To answer the question - yes, it can play NES games! If it was running bare-metal and not in an emulator it would be far quicker, but I enjoy working in the constrained environment of an already-running system.

I think I've had my fun with this camera now; I'm slowly working through retro consoles to emulate on devices they definitely should not be running on! I had a bunch of fun with this camera, and this has been a series of firsts:
- First C++ binary
- First encounter with stack canaries
- First stack canary bypass
- First almost-usable integer overflow/underflows

Thanks for following along!