---
published: true
title: "🌎 [2] Messing with the Display"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Linux Drivers
  - Reverse Engineering
  - C
  - Image Formats
tagline: "Now that we've got code execution, we obviously need to use our newfound power to come up with something funny to put on the display. But before we can do that, we'll have to reverse-engineer some stuff!"
excerpt: "So we've got code execution, lets make the display do something fun."
windowGradientStart: "#469099"
windowGradientEnd: "#71c6d0"
windowBorder: "#469099"
minimizeButton: "#ffeb3a"
maximizeButton: "#75bf2e"
closeButton: "#ff5822"
---

# Compiling Code

We are able to upload binaries onto the device using the pre-auth file write we discovered in the previous blog, and we can execute commands as root using our 2-bug chain. But how do we get binaries that will actually run on the device?

As this architecture is ARM, we'll need to cross-compile our C code into a form that will run on the device. I've done this for both the camera and router projects I worked on before (the router was MIPS, and the camera was ARM), so I'll just use the same method to compile my code:

```
arm-linux-gnueabi-gcc -static payload.c -o payload
```

We're using static compilation because I don't want to deal with dynamically linking everything. With our payload built, we can simply transfer it over with the file write primitive, then make it executable and run it with our command injection!

# Messing with Display

The goal of this blog is to mess with the display, typically there will be a nice Linux driver for interacting with the display - let's examine the ***zte_mmi*** binary (which manages the UI) and figure out how this binary interacts with the display.

## Reversing Display Driver

Lets spend some time reversing the nice driver they have hopefully given us.

### ioctls

***ioctls*** are used to interact with a kernel driver, typically sending data in and getting data back. The following ***ioctl*** calls were observed to the ***/dev/fb0*** device (located in ***/dev***):

- ***ret = ioctl(fd,0x4600,&ioctl_lcd_info_struct);*** : This fetches information about the LCD and the driver places the information into the provided struct
- ***ret = ioctl(fd,0x40044c01,setting);*** : This is for controlling if the display is asleep or not
- ***ret = ioctl(fd,0x40044c02,setting);*** : This controls the LCD backlight
- ***ret = ioctl(fd,0x40044c03,setting);*** : This controls the LCD brighness

The last three were straightforward to implement since you only need to provide the argument along with the ***ioctl*** call. However, the first one was more challenging because it returns data that is necessary for interacting with the display.

### Getting the FrameBuffer

After investing some time figuring out structs and identifying the usage of certain global addresses, I eventually came up with the following:.

![get_lcd_info.png](/assets/images/travel_router_hacking_p3/get_lcd_info.png)

Lets walk through what is happening:
- The ***fb0*** device is opened and the file descriptor is saved to ***fd***
- An ***ioctl*** call is made to the opened ***fd***, and the information is loaded into a structure
- If this succeeds, this structure is parsed into a secondary structure (the pointer to this is the argument of the function call)
- Some logs are printed, which was useful for working out what each element of the struct was for
- It then calculates the length of the frame buffer (which is *width* * *height* \* 2, because each pixel is represented by 2 bytes)
- Now it uses ***malloc*** to allocate a ***g_output_buffer***
- Next, it uses a call to ***mmap*** to map the framebuffer device into memory, saving the result in a global
- It finally saves the allocated ***g_output_buffer*** to the struct argument, and closes the framebuffer file

This is how the information about the framebuffer is retrieved, and how the memory/framebuffer is initialised.

### Writing to the Framebuffer

Now that we know how the framebuffer is set up, we need to figure out how to write to it - lets take a look at some more code:

![write_framebuffer.png](/assets/images/travel_router_hacking_p3/write_framebuffer.png)

This is the code that actually uses the ***write*** syscall to write data to the framebuffer address that was ***mmap***'d when it was initialized. There's a function in there which essentially copies the contents of the allocated ***g_output_buffer*** to the framebuffer address, which is then written to the fd. Therefore, we can simply feed a framebuffer directly into the ***/dev/fb0*** fd rather than needing to copy it when refreshing the screen:

```
-c
unsigned int write_to_fb0(unsigned char* framebuffer, unsigned int size)
{
    int fd = open("/dev/fb0", O_RDWR);
    if (fd < 0) {
        perror("Failed to open /dev/fb0 for writing");
        return 0xffffffff;
    }

    write(fd, framebuffer, size);
    close(fd);
    return 0;
}
```

So, now that we can initialize and write to the framebuffer, let's figure out what format it's expecting the data in.

## Displaying an Image

### Pixel Format

So we know the data is going to be *2* bytes (or *16* bits), and it will probably be RGB, so this points to *RGB565*. I did some experiments, and I determined that it is actually "*rgb565be*" in ffmpeg, here are the three main colour values:
- Blue: *0xf800*
- Red: *0x07e0*
- Green: *0x001f*

So now we know the format of the data, we can spin up ffmpeg and get converting.

### Converting PNG to RGB565

This is a pretty simple process:
- Download a PNG
- Crop it to be square
- Resize it to be *128x128*
- Run the following *ffmpeg* command: ***ffmpeg -i image.png -pix_fmt rgb565be image.rgb***

### Demo

After writing some code to open the image, and copy the data to the initialised framebuffer before writing it, it works!

![mii_need_0_days.jpg](/assets/images/travel_router_hacking_p3/mii_need_0_days.jpg)

![we_need_to_cook.jpg](/assets/images/travel_router_hacking_p3/we_need_to_cook.jpg)

*Note:* The foam on the back of the LCD got a bit hot and shrunk when doing the chip dumps so that's why the display looks a bit dodgy.

## Mandelbrot

As we've reversed everything and now need to draw pixels, it's absolutely necessary to write a quick Mandelbrot visualization for the router:

![mandelbrot.jpg](/assets/images/travel_router_hacking_p3/mandelbrot.jpg)

# Flappy Bird

As I've already done Doom once, and I would be limited to 2 buttons anyway (power and WPS), I opted for something different - Flappy Bird!

## Reversing Button-press

A pretty important part of Flappy Bird is the jump, so I need to understand how the ***zte_mmi*** binary is handling button presses for switching between windows.

When the program starts, it opens the ***/dev/event0*** device and stores the fd in a global - it then starts a thread that listens for data coming from this fd, and acts accordingly. It's a pretty chunky function (has code for power, WPS and reset buttons in various states), so I'll just show you the test code I wrote to listen for the WPS event:

```
-c
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>

#define DEVICE_FILE "/dev/event0"

// Define the structure to hold the parsed data
struct EventData {
    unsigned long long timestamp;  // 8 bytes for timestamp
    unsigned short type;           // 2 bytes for type
    unsigned short code;           // 2 bytes for code
    unsigned int value;            // 4 bytes for value
};

int main() {
    int fd;
    struct EventData event_data;
    ssize_t bytes_read;

    // Open the device file
    fd = open(DEVICE_FILE, O_RDONLY);
    if (fd == -1) {
        perror("Failed to open the device file");
        return 1;
    }

    while(1){
        // Read 16 bytes
        bytes_read = read(fd, &event_data, sizeof(struct EventData));
        if (bytes_read != sizeof(struct EventData)) {
            perror("Failed to read struct EventData");
            close(fd);
            return 1;
        }

        if (event_data.type == 1 && event_data.value == 1){
            if (event_data.code == 117){
                printf("[*] WPS button down\n");
            } else if (event_data.code == 116){
                printf("[*] Power button down\n");
            }
        }

        if (event_data.type == 1 && event_data.value == 0){
            if (event_data.code == 117){
                printf("[*] WPS button up\n");
            } else if (event_data.code == 116){
                printf("[*] Power button up\n");
            }
        }
    }

    // Close the device file
    close(fd);

    return 0;
}
```

So now we know when the WPS button is pressed/released.

## Writing the Game

As it is 2024, ChatGPT did some heavy lifting to put a prototype together (it must have been trained on a million Flappy Bird demos), and I added the finishing touches. Here is what ChatGPT came up when given the WPS button press and image drawing payloads as examples:

![flappy_proto.gif](/assets/images/travel_router_hacking_p3/flappy_proto.gif)

This was a good start; all I had to do was add the score system, replace a circle with an actual bird, make the pipes look better, add a background, add rotation to the bird, and finally, implement a dying animation.

## Demo

With all of those changes made, here is how it looks:

![flappy.gif](/assets/images/travel_router_hacking_p3/flappy.gif)

# Conclusion

In this blog, we reversed some drivers using the ***zte_mmi*** binary, figured out the expected pixel format for the framebuffer, drew images on the screen, and finally implemented flappy bird. I had a lot of fun with this device, and I hope you enjoyed reading my research.