---
published: true
title : "🎮 Modding my Childhood Xbox 360 with RGH3"
toc: true
toc_sticky: true
categories:
  - Console Modding
tags:
  - Hardware
  - Modding
  - Xbox 360
tagline: "My childhood Xbox 360 was lying around collecting dust after several years of unwavering service, so I decided to give it a new lease of life. Lets mod my old Xbox 360 using RGH3 (Reset Glitch Hack) and give it a breath of fresh air."
excerpt: "This blog is a guide for performing the RGH3 (Reset Glitch Hack) mod on a Xbox 360 with a falcon motherboard."
header:
  teaser: /assets/images/cheap_and_cheerful_400_in_1/controller.png
  overlay_image: /assets/images/cheap_and_cheerful_400_in_1/header.PNG
  overlay_filter: 0.4
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

RGH3 is an amazing hack that is the result of several years of reverse engineering, it is essentially a 2-wire install (ignoring the wires you need to solder to read/write the NAND - more on that later).

![console.jpg](/assets/images/xbox_360_rgh/logo.jpg)

## Background

Before we dive into the modding, you will need to know a few things about the Xbox.

### Console Types

During the life cycle of the Xbox 360, there were various board revisions with evolving characteristics. A great reference for this is [here](https://www.xenonwiki.com/Xbox_360_Motherboards), and it describes the differences between the various motherboard variations.

The motherboard I will be working with is the falcon, it is less plagued with RROD issues that the Xenon as these were manufactured using CPU/GPU components that aren't defective. 

#### RROD Issues

- The Xenon was the first Xbox 360 motherboard and it was released in November 2005
- Had a high failure rate due to issues in the manufacturing of the chips, this caused the notorious Red Ring of Death (RROD) ([link to an amazing video about the PS3 Yellow Light of Death, PS3 equivalent to RROD caused by the same issue](https://www.youtube.com/watch?v=Za7WTNwAX0c))
- Used a 90nm GPU and CPU
- Can be a pain to RGH due to the CPU wanting to crash during the process after the CPU is returned to its original clock speed
- These issues were for the most part fixed in motherboard revisions released after 2008

![console.jpg](/assets/images/xbox_360_rgh/rrod.png)

### NAND

The NAND stores a bunch of important firmware and data, it is a TSOP-48 package, and the size varies between motherboard variations. Here are some of the things it contains:

- System software:
  - This contains the kernel. It is the heart of the OS, it manages hardware resources, memory allocations, task scheduling, and other low-level functions - just like other kernels.
  - Also includes device drivers that enable communication with other hardware components such as CPU/GPU, southbridge, memory, and other controllers.
- Dashboard:
  - This is the the graphical user interface that the user interacts with when the xbox is powered on, the 'home page'.
  - It is the central hub for accessing all of the Xbox 360 software, settings, playing games, etc.
- Bootloader:
  - The bootloader is a small piece of code stored in the NAND, it is one of the first things to be executed when the Xbox is powered on.
  - Its primary purpose is to initiate the boot pocess, and load the kernel into memory for execution.

![console.jpg](/assets/images/xbox_360_rgh/nand.jpg)

### CPU Key

The CPU key is a unique, 32-byte code that is specific to each Xbox 360 console. It is stored in the CPU of the Xbox 360, and it cannot be changed. These come in the form of eFUSEs (one-time programmable bits) in the CPU, which are blown during the manufacturing process. 

This key is used to encrypt/decrypt various bits of data in the console, and it must be known if we want to write custom software for the device. Otherwise when the console starts up and verifies the software on the NAND, the checks will fail and the boot will abort. This prevents unauthorized firmware from being run on the console. However, once the key is known, these checks become redundant.

#### Digital Signature Verification

As mentioned above, the CPU key prevents the running of unauthorized code. But how does this work exactly?

Essentially, the Xbox 360 system software (kernel) and other critical components are digitally signed by Microsoft before they are released. Digital signatures are created using cryptographic algorithms and the CPU key.

The digital signature contains a unique hash of the software and is encrypted with the private key corresponding to the CPU key. This creates a digital signature that is specific to that particular version of the software and the Xbox 360 console.

During the boot process, when the Xbox 360 is powered on, the bootloader (a piece of code responsible for starting the system software) checks the digital signature of the system software stored in the NAND flash memory.

The bootloader uses the corresponding public key (hardcoded in the previous bootloader - chaining multiple bootloaders like this is called a chain of trust) to decrypt the digital signature and verify the integrity of the system software. If the signature is valid, it means that the software has not been altered or tampered with since it was signed by Microsoft.

## Doing the Mod

So now we can take my old Xbox, and use RGH to install some custom software! This guide will start from a torn-down Xbox 360, [here is a dissassembly guide](https://www.ifixit.com/Teardown/Xbox+360+Teardown/1203).

Here is what it looks like at the moment:

![console.jpg](/assets/images/xbox_360_rgh/completely_torn_down.jpg)

### Soldering Flash Wires

The first stage is to retrieve the CPU key, and to do this, we need to hook up to the flash. Obviously we aren't going to solder to all 48 wires on the parallel flash, there is a memory controller that can be interacted with via SPI (Serial Peripheral Interface). There are also a couple of magical pins that allow us to get access to the SPI functionality, so we will need to solder to those too.

Here are the pins we need to solder wires to:

![console.jpg](/assets/images/xbox_360_rgh/flash_points.jpg)

After locating the points and soldering wires to them, here is how the motherboard looks:

![console.jpg](/assets/images/xbox_360_rgh/soldered_flash.jpg)

### Reading NAND Using ESP32

#### Connecting

With the necessary wires soldered, we can now move on to connecting the ESP32, which we can use to read our flash.

The code we will be using is [Xbox360-ESP32-Flasher](https://github.com/SlowLogicBoy/Xbox360-ESP32-Flasher), which is essentially a port of the Teensy flasher (which was also ported to the Raspberry Pi Pico). This code is a bit broken on the latest ESP32 libraries, so we will need to fix it up for the write - it works fine for reading (after the flash ID has been modified that is).

Here is how the wires need to be connected:

| Xbox 360 | ESP32 |
|-|-|
| CLK | D18 |
| MOSI | D23 |
| GND | Any GND |
| MISO | D19 |
| CS | D5 |
| SMC RST | D13 |
| SMC DBG EN | D15 |

And here is how everything looks with everything hooked up:

![console.jpg](/assets/images/xbox_360_rgh/hooked_up_esp.jpg)

Now, you can connect your console to power (but do not turn it on) - this powers the flash and allows us to read it.

#### Fixing Flasher

I'm planning to fork the code and fix it, but for now, the fix will need to be applied manually. Download the repo from the github page I linked earlier and extract it, then open a terminal in the directory. Next, run the following command **python3 .\xflash-serial.py COM? read nand1.bin**, replace **COMX** with the COM port your ESP32 is on.

If you don't get an error here, then I will be surprised! You should get an error like the one below:

![console.jpg](/assets/images/xbox_360_rgh/invalid_flashconfig.png)

If the flashconfig value is **0x00000000**, then double check your wiring, if you get a consistent value, then your wiring is probably all good.

To fix this error, open up the **xflash_serial.py** file, and change the code below to use the flashconfig you saw when you ran the read command, or remove the check altogether:

![console.jpg](/assets/images/xbox_360_rgh/to_change.png)

With this change, you should get by the check, and will be able to read your NAND. If you have a flash chip which is different to the one on my console, you may have to make some changes to things like block sizes.

Once the read is complete, open it up in a hex editor (I recommend HxD for windows), and check that you get the following string at the start:

![console.jpg](/assets/images/xbox_360_rgh/microsoft_string.png)

If you can see this string, take 3-5 reads of the flash in case one of them has errors (this stops you flashing a bad NAND read and bricking your console forever!). Once these reads are done, we can move onto writing our Xell image to the NAND.

### Generating Xell Image

Now that we have our flash images, we can download and open a tool called J-Runner Pro. 

![console.jpg](/assets/images/xbox_360_rgh/j_runner_pro.png)

This tool has a bunch of functionality that is incredibly useful when performing RGH. Peform the following steps to generate the Xell image to flash onto the NAND:

1. Click **Load Source** and select one of your NAND reads
2. Click **Load Extra** and selected another NAND read, but not the same as the first one
3. Click **Nand Compare**, you should see that the Nand's are the same, if you hear 'Oh no', try and use a different combination of flashes, they need to match (if none of them match, check your wiring connections are strong, and perform some more reads)
4. Once you have matching Nand's, head over to the XeBuild area and select the **RGH3** tick-box (leave the **MHz** as 27 for now)
5. Finally, click on **Create ECC** to create your Xell image - it will be located at the path in the first Nand source box

Your J-Runner window should match this:

![console.jpg](/assets/images/xbox_360_rgh/j_runner_pro_xell_gen.png)

### Writing to NAND

With our **glitch.ecc** file with Xell acquired, we can now use the flasher software we used earlier to write this to the flash!

We have to do some patching to get the software to work properly. On the latest ESP32 libraries, the code that listens for the incoming data to write is completely broken. Open up **/src/main.cpp** in an editor/IDE, and change this code in the **StartFlashWrite** function:

```
-cpp
if (!wordsLeft)
{
    while (USBSERIAL.available() < PAGE_SIZE)
    {
    }
    USBSERIAL.readBytes((char *)PAGE_BUFFER, PAGE_SIZE);
    buff_ptr = PAGE_BUFFER;
    wordsLeft = PAGE_SIZE / 4;
}
```

To this:

```
-cpp
if (!wordsLeft)
{
    int buffSize = 0;

    while ( buffSize < PAGE_SIZE )
    {
        if ( USBSERIAL.available() )
        {
            PAGE_BUFFER[ buffSize ] = USBSERIAL.read();
            buffSize++;
        }
    }
    buff_ptr = PAGE_BUFFER;
    wordsLeft = PAGE_SIZE / 4;
}
```

In the old code, due to **USBSERIAL.available()** no longer returning the amount of data that is available, it gets stuck in the while loop forever.

With this completed, we can run **python3 .\xflash-serial.py COMX write .\glitch.ecc** where COMX is the COM port the ESP32 is on. The program will then send the data to the ESP32, and it will use the SPI flash controller to write the contents of the flash! It should get to about **0x50/0x400** this is fine, as the entire NAND doesn't need to be flashed for this step. Once this is finished, disconnect the ESP32 from the computer.

### Soldering RGH Wires

Now that the flash is written, when we turn the Xbox on, it will attempt to glitch the CPU. However, it isn't going to get very far without the necessary wires, so lets do that.

You will need 2 things for a Phat Xbox 360 (like the one we are working on), a 1n4148 diode, and a 22k resistor. These are used to reduce the likelihood of frying the console over time, although some people don't bother with these, its good practice for longevity.

There are 4 points we need to worry about, there are a number of ways you can attach to these points (there are alternative points you can use), but these work well for me. 

I usually construct my wires with the component in the middle of the wire like so:

![console.jpg](/assets/images/xbox_360_rgh/diode_resistor_soldered.jpg)

With the wires constructed (make sure you put your heatshrink on them before you solder both points!), we can now locate the points we need to solder. To solder the points, I usually put some solder onto the end of my iron, dab the pad so that some of the solder sticks to it (not too much), apply solder to the end of the wire, rest the wire on the pad, apply heat, and they should merge together and form a good connection.

Starting with the easier resistor wire (easier because direction of component doesn't matter), locate point 1 as seen below, and solder the end of the resistor wire to the pad. The point is lodged between 2 components, so be careful and make sure you have something to rest on to give you a steadier hand:

![console.jpg](/assets/images/xbox_360_rgh/rgh_point_1.jpg)

With that done we can move on to point 2, which is where we solder the other end of the resistor wire.

Moving on to point 3, we need to make sure we get the diode facing the correct way, otherwise it will block the opposite direction. On the diode, the side with the black strip is the cathode, that should be facing away from point 3. 

![console.jpg](/assets/images/xbox_360_rgh/rgh_point_2_3.jpg)

The final point, point 4, just needs to be connected to the other end of the diode wire:

![console.jpg](/assets/images/xbox_360_rgh/rgh_point_4.jpg)

If all of the connections are good, we should be able to boot our console into Xell! It should look something like this when you are done:

![console.jpg](/assets/images/xbox_360_rgh/rgh_wires_not_shrinked.jpg)

And with the heat shrink properly applied:

![console.jpg](/assets/images/xbox_360_rgh/rgh_wires_shrinked.jpg)

You can optionally secure the wires in place with some kapton tape to stop it moving around when you reassemble the console.

### Booting Into Xell

At this point, ***disconnect your ESP32 from the console***, otherwise you may get some booting issues. Connect HDMI and power to the console, reattach the front panel PCB, and press the power button (or you can use the eject button on the left of the console). And wait for Xell to hopefully boot up!

![console.jpg](/assets/images/xbox_360_rgh/xell.jpg)

If it doesn't boot up, you may have to change the 27MHz timing we set earlier in J-Runner Pro to 10MHz instead - different chips have different timing preferences.

Once Xell has completed the boot sequence, you should see your CPU Key, and your DVD key on the screen - take a picture of these or write them down somewhere (you can also see the key in the printed fuses).

![console.jpg](/assets/images/xbox_360_rgh/xell_keys.jpg)

### Generating Xebuild

Now that we have our CPU key, we can go back to J-Runner and enter this key into the **CPU Key:** entry. Once the key has been entered, J-Runner automatically decrypts and checks that the decrypted contents is valid - if it isn't, check that you've entered the key correctly.

Next, check that **RGH-3** is checked on the **XeBuild** window, and select the frequency that worked before. Once this is set, click **Create XeBuild Image**. This will generate a file called **updflash.bin**, the location of said file is printed in the console. This is the final modified firmware we will need to flash to the NAND using the points we soldered earlier (not the RGH ones, they are a permanent feature now!).

![console.jpg](/assets/images/xbox_360_rgh/xebuild.png)

Once this file has been located, we can go back to our good old ESP32 flasher, and run the following command **python3 .\xflash-serial.py COMX write .\updflash.bin**, where **COMX** is the COM port the ESP32 is using. Then wait for the entire flash to be written (which takes a while now that we are writing the full 0x400 blocks).

Once this has flashed, disconnected the ESP32 from the computer, and turn the console on via the power button - you should see the normal boot sequence. From now on, if you boot using the eject key, you will end up back in Xell.

Congratulations if you got this far, you have successfully RGH'd your console (or learned how to do so). You can de-solder the NAND flash wires now if you want, or just disconnect the ESP32 and leave them in there (just make sure they aren't touching anything important) - up to you!

## Conclusion

Job done! Now, you can install any homebrew software you like, you can copy across DashLaunch on a USB stick to set up an FTP server and transfer all of the content you want. You can install custom dashboards such as Aurora, emulators, and [all of this fun stuff](https://www.360-hq.com/xbox360-homebrew.html).

RGH is an excellent hack, and it blew the security of the Xbox 360 wide open.

*Note: I don't encourage piracy of any sort!*