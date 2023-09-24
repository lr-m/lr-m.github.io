---
published: true
title: "🔍 Cheap Games Console + Controller Teardown"
toc: true
toc_sticky: true
categories:
  - Reverse Engineering
tags:
  - Retro Gaming
  - Hardware
  - ESP32
tagline: "Join me as I take a closer look at a budget games console. I'll be disassembling it, evaluating the hardware, and exploring its features to gain a better understanding of the device. Let's dive in and see what we can learn."
excerpt: "Lets examine a budget games console. I'll disassemble it, and explore its hardware/features to fully understand the device. Let's dive in."
header:
  teaser: /assets/images/cheap_and_cheerful_400_in_1/controller.png
  overlay_image: /assets/images/cheap_and_cheerful_400_in_1/header.PNG
  overlay_filter: 0.4
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

The device is an [£11 retro gaming device with 400 games](https://www.aliexpress.com/item/4000091808399.html?spm=a2g0o.order_list.0.0.21ef1802xgcF5t), the cheapest I could find. Tom Nardi wrote a [great article](https://hackaday.com/2019/12/09/teardown-168-in-1-retro-handheld-game/#more-387984) about a similar device, there will likely be some crossover with said article. I am sure this device hasn't changed much in the last 3 years!

# Device Overview

Here is what you get in the package:

- Handheld console containing 400 classic retro games
- Micro-USB controller
- Micro-USB cable for charging
- Some AV cables for hooking it up to a display

## Console

![console.jpg](/assets/images/cheap_and_cheerful_400_in_1/console.png)

The console is great for the price, the software isn't the most well made, but it gets the job done. There are a decent selection of games, the legality of which is questionable. Some notable features are Pacman, Tetris 2, and Super Mario Bros. It is worth noting that there are not 400 unique games, there are several duplicates. Looking online at other reviews/comments on youtube videos indicates that there are roughly 310 unique games.

I noticed that if you press all the alphabetic keys down and press reset at the same time, the test utility used by the developers pops up. This doesn't contain any interesting information, but it is pretty cool nonetheless!

![debug.jpg](/assets/images/cheap_and_cheerful_400_in_1/debug.png)

The build quality is pretty good, and it would probably survive a drop or two. It also has volume control, a well backlit display (fixed brightness), rechargable Nokia-esque battery, and a display output. Some of the games also have a 2-player mode, which is an enjoyable experience, especially on Tetris 2.

My biggest grumble with the device is that your high scores don't save, if I get a new high-score on Pacman the score is never saved for the next time I play. I can't complain too much as most of these games never had this functionality on their original console.

## Controller

![controller.jpg](/assets/images/cheap_and_cheerful_400_in_1/controller.png)

The controller is actually pretty good, the build quality is excellent for the price, the buttons feel decent, and it has a nostalgic charm to it. Its a pretty basic remote, suspiciously close to an NES controller (which I suspect this system is a clone of), it will be interesting to see how it works later on.

# Hardware

## Console

![disassembled_trimmed.jpg](/assets/images/cheap_and_cheerful_400_in_1/disassembled_trimmed.jpg)

The main components that can be seen on the board are:

- _Potted Processor_ : This is usually done when you want to hide what is underneath, epoxy is applied to ensure it is at least very difficult to reverse the chip
- _Flash chip_ : This is the chip that stores the games, the part numbers can be read from the chip to get the data sheet
- _Micro USB port_ : This is used for charging the device, and also interfacing with the controller
- _AV port_ : This can be used to connect the console to a TV
- _Volume control potentiometer_ : This controls the volume of the attached speaker
- A few other minor components, like switches, the reset button, and an oscillator

Another thing I love about this PCB is that it is single sided, and to keep the single sided-ness of the PCB they have used 0 Ohm resistors to make bridges over other traces.

### Memory Chip

![memory.jpg](/assets/images/cheap_and_cheerful_400_in_1/memory.jpg)

The datasheet for the chip can be seen [here](https://datasheet.lcsc.com/lcsc/1804241721_Cypress-Semicon-S29GL064N90TFI040_C117907.pdf), my usual procedure for finding datasheets is using [lcsc.com](lcsc.com), if they don't have the datasheet for a part, you're in trouble!

This chip is a TSOP-48 package, it is a NOR flash, with 8,388,608 bytes of space. This seems to be the entire memory of the device, containing the software and all of the games. Later, I will try and extract the contents of the chip and see if I can get it running on an emulator.

### Processor

The processor is potted, so I will not have an easy job figuring out this chip, maybe if I can analyse all of the connections on the board then this may hint at what kind of chip they are using. Most likely it is custom silicon (bought in huge quantities), as they likely just get their custom silicon, wire it up to the PCB, and epoxy it into place to stop everything from moving around.

## Controller

The controller was pretty difficult to pry apart, the build quality is solid. Once apart, we are greeted with a pretty bland PCB, with a black blob. The black blob contains the circuitry for the remote, so having a look at that is off the cards (for now).

![controller_disassembled.jpg](/assets/images/cheap_and_cheerful_400_in_1/controller_disassembled.png)

Using a logic analyser to capture console-controller communications, a pattern becomes obvious. _D0_ is high, and _D1_ is low (probably _VCC_ and _GND_), but _D2_ looks like a latch, _D3_ is a series of pulses after the latch, and _D4_ looks like it contains the response from the controller. Usually, _D4_ is held high, but when you press a button on the remote, it goes low for a brief period. If you line up _D3_ and _D4_, you can see the remote is actually indicating a selected value.

![index_access.png](/assets/images/cheap_and_cheerful_400_in_1/index_access.png)

This is basically the exact same mechanism the original NES controller used, you can see some more information on the mechanism the NES used [here](https://tresi.github.io/nes/). To put it very simply, the console polls the controller with the latch, and sends 8 pulses soon after. The controller then indicates which buttons are pressed by setting the area for its respective index to LOW.

Another interesting thing is that the A and X buttons behave differently to the others, deviating from the matching NES functionality. The X button selects the same index as Y, and the A button selects the same index as B, but they don't always indicate that they are selected when they are, they indicate they are selected in some pattern. I will let the following images do the explaining:

![weird_buttons.png](/assets/images/cheap_and_cheerful_400_in_1/weird_buttons.png)

This controller is obviously trying to emulate the original NES controller with its 8 inputs, and after playing around with the console, the only use of these extra buttons I can possibly think of is for 'rapid-firing'. That would also make sense as the A and X buttons are not present in the debug menu, pressing them just seems to press the Y and B buttons quickly.

## Interfacing the Controller with an ESP32

I wanted to see if I could interface the remote with an ESP32 (or any other Arduino-like device for that matter). Mainly because I now have a few of these controllers lying about, and they could make an interesting component for some future project.

I used a micro-USB breakout board to make connecting the remote to the ESP easier, and also added a small I2C OLED display for showing the pressed button (more interesting than the serial console). I connected both the remote and the screen to 3.3V and GND, the displays I2C pins to the respective pins on the ESP (_SCK_ -> _SCL_, _SDA_ -> _SDA_), and the remaining USB pins to three of the many available GPIO pins.

![esp32.PNG](/assets/images/cheap_and_cheerful_400_in_1/esp32.PNG)

To confirm which devices were sending what information, I used the logic analyzer on the USB port when a controller is connected, and when a controller is not connected. The console sends the 'clock' pulse, as well as the 'options' pulse, and the controller sends its response. I'll need to configure the ESP32 to send the same pulses that are sent by the console.

The created demo sketch sets GPIO pins 16 and 17 to be outputs (latch and pulse), and pin 18 to be an input (response). The ESP32 sends a pulse on the latch line, and in the middle of each pulse on the pulse line, checks if the value on the controller response line is low. If so, it knows that the controller has specified that that index has been selected. We know from our earlier analysis which buttons correspond to which indexes (minus the two weird buttons), so we can use this value to output onto the display which buttons have been pressed.

![controller_demo.jpg](/assets/images/cheap_and_cheerful_400_in_1/controller_demo.jpg)

Messing with the implementation some more, you can basically 'poll' the controller as often as you want, so I removed all of the delays from the controller poll function. Obviously the more polls you send, the less input lag you will have with the remote. I made a [small arduino library](https://github.com/luke-r-m/RetroController) that allows you to add one of these controllers to projects (I also included the demo sketch).

It would be rude of me to not use this in an actual game, so I ported an [implementation of snake for Arduino](https://github.com/Stiju/arduino_snake) I found on github that used an OLED display to use my library and the controller.

![snake.jpg](/assets/images/cheap_and_cheerful_400_in_1/snake.jpg)

# Firmware and Emulation

To get the firmware from the device, it is necessary to desolder the pins with a heat gun (usually the easiest way). You can then use a flash programmer/reader to read the data from the chip, such as a FlashcatUSB xPort, or a TL866 programmer. As we are dealing with a parallel chip, we need to make sure that our programmer can handle the large number of pins. Something like a small microcontroller would not have enough GPIO pins to read this chip, you would need to add lots of shift registers to extend the number of GPIO pins.

![programmer.PNG](/assets/images/cheap_and_cheerful_400_in_1/programmer.PNG)

Unfortunately, one of the address pins in the corner of the chip decided to snap off, _A0_ to be precise. I tried to dremel into the chip in order to connect a small wire to the severed pin in an attempt to save the chip, and managed to do this, but unfortunately when I tried to mount the chip to a breakout PCB, another pin snapped off! At this point, I called it quits with trying to fix the chip. Even if I had managed to mount it to the breakout PCB, I'd then have the problem of connecting that to the programmer, which wouldn't be fun.

I turned to the Internet to see if I could find a similar binary. In the instruction manual of the device, it is described as a 'Retro FC' console, so I searched around to see if anyone else had done work on this device, or if the contents of the chip was available online.

It turns out that there is an emulator called [Mame](https://www.mamedev.org/) which supports thousands of consoles - and somebody has actually created an emulator for this device! The rom file supported by the emulator is similar, it has 400 games with a gamelist very similar to the original console, but is 16MB instead of 8MB. Good enough for me!

![language_select_emulator.png](/assets/images/cheap_and_cheerful_400_in_1/language_select_emulator.png)

![game_select_emulator.png](/assets/images/cheap_and_cheerful_400_in_1/game_select_emulator.png)

It also shows the specs of the system it is emulating:

![properties.png](/assets/images/cheap_and_cheerful_400_in_1/properties.png)

## Messing with Graphics

I'm not going to go into detail here about how [NES graphics work](https://www.dustmop.io/blog/2015/04/28/nes-graphics-part-1/), but at a high level, the sprites are constructed out of tiles which are stored in the rom of the game. With a tool called [Tiler Pro](https://www.romhacking.net/utilities/108/), we can modify the contents of the rom to make these tiles whatever we want them to be.

The process is pretty straight forward:

1. Find the tiles, in a large rom with lots of games like this, it might take a while
2. Drag the tiles to the _Tile Arranger_ and construct the original sprite using the tiles as building blocks
3. Use the _Tile Editor_ to modify the tiles to your desired shape
4. Save your rom, and check if the changes look good

As an example, here are my modified clouds:

![changed_clouds.PNG](/assets/images/cheap_and_cheerful_400_in_1/changed_clouds.PNG)

Note that this sprite had two components, the white foreground, and the black outline. With these changes saved in the ROM, when we load into the language selection screen, we can see our new clouds (and also how we had a couple of side effects, but you get the idea):

![clouds_after.png](/assets/images/cheap_and_cheerful_400_in_1/clouds_after.png)

# Summary

Overall, this device was pretty good. Despite not managing to dump the firmware, we managed to get hold of a similar firmware that has already been emulated, and customised the graphics of the rom using some well-known NES tools. We also reversed how the contoller works with a logic analyzer, and wrote an Arduino library for interfacing the provided NES-like controller with any Arduino sketch.
