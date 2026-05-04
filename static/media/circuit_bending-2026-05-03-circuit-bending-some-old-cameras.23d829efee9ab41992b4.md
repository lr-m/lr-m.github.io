---
published: true
title: "📷 Circuit Bending Some Old Cameras"
toc: true
toc_sticky: true
tagline: "I eBaY'd a couple of early 2000s cameras to give them a new lease on life."
windowGradientStart: rgb(19 19 15)
windowGradientEnd: rgb(24 26 48)
windowBorder: rgb(15 19 15)
minimizeButton: rgb(52, 56, 100)
maximizeButton: rgb(90 145 195)
closeButton: rgb(40 62 211)
tags:
    - Hardware
    - Fun/Creative
---

The circuit bending in the previous blog was cool, but the resolution and image quality on cheap kids cameras isn't great. Therefore, I threw £20 at eBaY, and got a couple of early 2000s digital cameras with higher resolutions to bend!

# Praktica DC42

This is an old 4.07 MP digital camera, old enough that they will be using a separate analog-to-digital converter that we can bend on. 

![praktica_dc42.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/praktica_dc42.jpg)

Fun fact, this is the first digital camera I have ever owned, feeling the nostalgia of pictures at birthdays back in the good old days...

## ADC - VSP1021

Anyway, I tore the camera down, and located this chip:

![adc.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/adc.jpg)

Looking up a datasheet for it yields the following info:

> *The VSP1021 device is a highly-integrated monolithic analog-signal processor/digitizer designed to interface the area charge-coupled-device (CCD) sensors in digital-camera and camcorder applications. The VSP1021 device performs all the analog processing functions necessary to maximize the dynamic range, corrects various errors associated with the CCD sensor, and then digitizes the results with an on-chip, high-speed ADC.*

TLDR: Takes analog signals from the camera, and converts them into digital ones with magic. This will be the chip we are going to be messing with in this blog.

![adc_pins.png](/assets/images/circuit_bending/bending_old_cameras_p2/adc_pins.png)

There are loads of pins to mess with, but I will just focus on the digital output pins on this camera, which should give some interesting colour effects.

On this camera, they actually threw a resistor on the trace for every data output pin, which we can use as a nicer solder point than the legs of the chip itself.

![soldered_wires.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/soldered_wires.jpg)

With that done, I reassembled the wires and tested out the effects of shorting these pins. Here is what I saw:

![broken1.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/broken1.JPG)

![broken2.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/broken2.JPG)

![broken3.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/broken3.JPG)

![wtf.png](/assets/images/circuit_bending/bending_old_cameras_p2/wtf.png)

## Fixing the Camera

Doesn't look great, does it? Luckily, I've been scouring r/CircuitBending for long enough to recognise that weird shifting pattern going on, it's usually achieved by messing with the sensor connections.

With this in mind, I checked the continuity between some of the test points on the sensor ribbon cable, and the pins themselves.

![ribbon_cable.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/ribbon_cable.jpg)

And what do you know, some of the traces are somehow not connected to the pins anymore, not sure how that happened - definitely not from accidentally pulling the ribbon cable up during disassembly...

![wasnt_me.png](/assets/images/circuit_bending/bending_old_cameras_p2/wasnt_me.png)

Water under the bridge - let's fix that a bit quick by bridging the test pads and the pins to bypass the trace altogether.

![fixed_it.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/fixed_it.jpg)

With the sensor fixed, I reassembled the camera and shorted a few wires to make sure the bending was working, and here is the first photo I took:

![first_bend.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/first_bend.JPG)

## Putting it Back Together

After fixing the sensor connections and making sure the shorts were creating interesting effects, I moved on to making it usable without wires all over the shop. I opted for a DIL switch with all of the top pins shorted, and a data pin on each of the bottom pins. The idea being that it acts like a single bus, and any number of pins can be added to the short with the switches.

With a bit of solder, heat shrink, and hot glue, this is how it looks:

![assembled.png](/assets/images/circuit_bending/bending_old_cameras_p2/assembled.png)

## Praktica Results

After using it around the house and taking it for a walk, here are some of my favourite pictures:

![praktica1.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica1.JPG)
![praktica2.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica2.JPG)
![praktica3.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica3.JPG)
![praktica4.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica4.JPG)
![praktica5.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica5.JPG)
![praktica6.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica6.JPG)
![praktica7.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica7.JPG)
![praktica8.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica8.JPG)
![praktica9.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica9.JPG)
![praktica10.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica10.JPG)
![praktica11.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica11.JPG)
![praktica12.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica12.JPG)
![praktica13.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica13.JPG)
![praktica14.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica14.JPG)
![praktica15.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/praktica15.JPG)

Definitely beats the cheap toy camera!

![pretty_good.gif](/assets/images/circuit_bending/bending_old_cameras_p2/pretty_good.gif)

# Revue DC 310

Off the back of the success of the last camera, I moved onto the next one:

![revue.png](/assets/images/circuit_bending/bending_old_cameras_p2/revue.png)

Another 4MP model, and to make a long story short, it is VERY similar to the last camera.

## ADC - HD49334

The process was the exact same, find the ADC (**HD49334**), use the datasheet to locate data pins, solder onto them, do the DIL switch thing.

![revue_adc_pinout.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/revue_adc_pinout.jpg)

What made this camera more painful to work with than the last is that there are no resistors or test points breaking out the chip legs for the data lines, meaning I had to solder to them directly. Unfortunately, one of the legs of the chip and its associated pad found themselves separated from the chip and board (beyond repair :( ). This doesn't really impact anything, it just means we have one less pin to bend, and we have also perma-bent the camera in a way - having no bends in place makes everything bright super rainbow-like, which is kinda cool?

Either way, I ended up soldering as many other data lines as I could, and ended up looking like this:

![revue_adc.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/revue_adc.jpg)

Somehow there weren't any shorts, what a great invention enameled wire is.

## Sensor Pins

On the last camera, I just soldered up the ADC pins and called it there, but on this camera, I wanted to get some cool melt effects, which you can get by shorting pins on the sensor itself.

I first used a multimeter to ensure I wasn't sending 12v down any data lines, and found 8 pins of similar voltage that seemed to be some sort of data. I soldered onto these:

![sensor_pins_soldered.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/sensor_pins_soldered.jpg)

## Assembling Camera

I found three shorts that gave cool effects, and wired them up to a small DIL switch to go alongside the ADC switches. I used an old soldering iron to melt some slots in the plastic casing for the switches, and hot glued to keep everything secure.

![revue_assembled.jpg](/assets/images/circuit_bending/bending_old_cameras_p2/revue_assembled.jpg)

## Revue Results

![revue1.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue1.JPG)
![revue2.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue2.JPG)
![revue3.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue3.JPG)
![revue4.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue4.JPG)
![revue5.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue5.JPG)
![revue6.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue6.JPG)
![revue7.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue7.JPG)
![revue8.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue8.JPG)
![revue9.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue9.JPG)
![revue10.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue10.JPG)
![revue11.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue11.JPG)
![revue12.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue12.JPG)
![revue13.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue13.JPG)
![revue14.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue14.JPG)
![revue15.JPG](/assets/images/circuit_bending/bending_old_cameras_p2/revue15.JPG)

And this thing can also shoot videos, here is a cool result I got:

![walk.gif](/assets/images/circuit_bending/bending_old_cameras_p2/walk.gif)

# Conclusion

Circuit bending these cameras was a good soldering exercise and test of patience, but also great fun and the results speak for themselves! I can't recommend doing this enough, you never know what you are going to get when you've got a cool bend and you hit the shutter button.

