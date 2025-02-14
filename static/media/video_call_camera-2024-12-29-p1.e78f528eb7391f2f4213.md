---
published: true
title: "🎥 [0] Enumeration, Teardown and Firmware Extraction"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Hardware
  - Reverse Engineering
tagline: "While browsing my favourite website (Aliexpress), I found an IoT camera that for some reason has a screen on it. I thought this was a pretty cool feature so I added to basket and immediately got to work on it - lets figure out how this thing works."
excerpt: "Lets kick off this project looking at a strange video call camera."
windowGradientStart: rgb(59, 59, 59)
windowGradientEnd: rgb(22, 22, 22)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(255, 255, 255)
maximizeButton: rgb(0, 0, 255)
closeButton: rgb(255, 0, 0)
---

# Introduction

I purchased this *BESDER Video Call Camera* for roughly £20, and it showed up in a few days - suspiciously quick for Aliexpress.

![listing.png](/assets/images/video_call_camera_p1/listing.png)

It seems to have some cool features, and the screen is mainly used for video calls. After playing with the device for a little while, it does seem that this is pretty much the only purpose of the screen. While not in a video call, it just displays the time as shown above.

The two buttons on the bottom are for starting and ending video calls. Interaction with the camera is done via the *iCSee* app, which is pretty commonly used for a decent amount of the cheap Aliexpress cameras kicking about.

# Enumeration

Lets first connect the device to a network (and set it up with the *iCSee* app), do some captures and see what ports are open.

## Captures

I used the trusty old *DroidPCAP* app to do the captures, then exported the **.pcap**'s to my PC to view in *Wireshark*.

From looking at the traffic, the following is observed:
- Data sent via TCP
- Uses port *34567*
- Some plaintext communications observed
- Most messages appear encrypted
- JSON format?

Here is an example plaintext message:

![plaintext_message.png](/assets/images/video_call_camera_p1/plaintext_message.png)

The content definitely looks to be JSON, it will be interesting to figure out what this is for.

## Network Scans

Now lets use *nmap* to do some basic network scans (**nmap 192.168.188.2 -p-**):

```
Starting Nmap 7.94SVN ( https://nmap.org ) at 2024-12-29 20:35 GMT
Nmap scan report for 192.168.188.2
Host is up (0.010s latency).
Not shown: 65531 closed tcp ports (conn-refused)
PORT      STATE SERVICE
80/tcp    open  http
554/tcp   open  rtsp
23000/tcp open  inovaport1
34567/tcp open  dhanalakshmi
```

Cool, so we can see the *34567* port that the app is using, a HTTP server on port *80*, RTSP on port *554*, and an unknown *23000* port.

# Teardown

Now that we have had a brief look at the device and how it communicates with the app, we can move on to having a look under the hood.

## Components

Lets take a look at what is on the main PCB of the device.

![pcb_front.png](/assets/images/video_call_camera_p1/pcb_front.jpg)

![pcb_back.png](/assets/images/video_call_camera_p1/pcb_back.jpg)

### MCU

The MCU that powers the device is a *Goke GK7201*, [some work appears to have been done on a previous GK7102 camera](https://github.com/dc35956/gk7102-hack) (I assume this is a previous generation) - this might come in handy.

![goke_mcu.png](/assets/images/video_call_camera_p1/goke_mcu.jpg)

I tried to find a datasheet for the chip but unfortunately it doesn't appear to be publicly available.

### Memory

The most important thing for us at the moment is the memory chip, as we will have to take this off of the board and dump it if we can't get a debug interface going.

The chip on this device is an *XMC 25QH64*, a datasheet for a similar chip is available [here](https://www.xmcwh.com/uploads/207/XM25QH64C.pdf). It looks to be a pretty standard SPI serial flash which should be dumpable if needed.

![memory_chip.png](/assets/images/video_call_camera_p1/memory_chip.jpg)

Yes, the image above is a slight spoiler for the direction I took to get the firmware...

## Debug Interface

As is usually the case with these devices, there is a straight forward UART with a baud rate of *115200*.

![debug.png](/assets/images/video_call_camera_p1/debug.png)

What is slightly more unusual is the fact that the debug interface is completely dead during normal operation. The only outputs are some debug prints from what appears to be the U-Boot bootloader.

```
System startup

Uncompress Ok!


U-Boot 2020.01-g12274797-dirty (Jan 10 2024 - 17:03:09 +0800)xm72010300

DRAM:  64 MiB
Relocation Offset is: 0373c000
Relocating to 43f3c000, new gd at 43efbed8, sp at 43efbeb0
SPI Nor:  Check Flash Memory Controller v100 ... Found
SPI Nor ID Table Version 1.0
@hifmc_spi_nor_probe(), SPI Nor(cs 0) ID: 0x20 0x40 0x17 <Read>
@hifmc_spi_nor_probe(), SPI Nor(cs 0) ID: 0x20 0x40 0x17 <Found>
SPI Nor(cs 0) ID: 0x20 0x40 0x17
eFlashType: 19.
Flash Name: XM_XM25QH64C{0x204017), 0x800000.
@hifmc_spi_nor_probe(), XmSpiNor_ProtMgr_probe(): OK.
@XmSpiNor_enableQuadMode(), Disable Quad Failed, SRx: [2, 0x2].
Block:64KB Chip:8MB Name:"XM_XM25QH64C"
CONFIG_CLOSE_SPI_8PIN_4IO = y.
read->iftype[0: STD, 1: DUAL, 2: DIO, 3: QUAD, 4: QIO]: 1.
lk=>6, 0x400000.
SRx val: {[1, 0x38], [1, 0x2], [1, 0x20], [0, 0x0]}, SrVal: 0x700000000200238.
SPI Nor total size: 8MB
Loading Environment from SPI Flash... at env_sf_save() start unlock spi flash.
@do_spi_flash_probe() flash->erase_size: 65536, flash->sector_size: 0
unlock all block.
all blocks is unlocked.
Erasing SPI flash...Writing to SPI flash...done
OK
In:    serial
Out:   serial
Err:   serial
Net:   eth0
Hit any key to stop autoboot:  0
@do_spi_flash_probe() flash->erase_size: 65536, flash->sector_size: 0
device 0 offset 0x40000, size 0x2e0000

SF: 3014656 bytes @ 0x40000 Read: OK
srcAddr: 0x43000000, dstAddr: 0x42000000, filename: boot/uImage.
created_inode 0x43efc3d8
find_squashfs_file: name bin, start_block 0, offset 1846, type 1
find_squashfs_file: name boot, start_block 0, offset 1938, type 1
read inode: name boot, sb 0, of 1938, type 1
find_squashfs_file: name uImage, start_block 0, offset 1878, type 2
read inode: name uImage, sb 0, of 1878, type 2
write_file: regular file, blocks 7
len 1574327
### get_squashfs_file OK: loade 1574327 bytes to 0x42000000
## Booting kernel from Legacy Image at 42000000 ...
   Image Name:   Linux-4.9.37
   Image Type:   ARM Linux Kernel Image (uncompressed)
   Data Size:    1574263 Bytes = 1.5 MiB
   Load Address: 40008000
   Entry Point:  40008000
   Loading Kernel Image
using: ATAGS
at setup_xminfo_tag() g_nXmBootSysIndex: 0, g_nXmRomfsIndex: 0.

Starting kernel ...
```

This doesn't really tell us that much, except a few versions and hints at the filesystem being used (*squashfs*) - it also omits any mention of encryption/decryption which is a good sign. The most interesting part is this: **Hit any key to stop autoboot:  0**. Lets press a key and see what happens:

![password_prompt.png](/assets/images/video_call_camera_p1/password_prompt.png)

No way, my first password protected Aliexpress bootloader!

![amazed.gif](/assets/images/video_call_camera_p1/amazed.gif)

You get three shots at guessing the password before the device reboots, which then immediately resets the attempt count. Oh well, better than nothing...

# Firmware Extraction

Now that we have had a sniff around the hardware, lets look at getting some firmware.

## Chip Dump

As we saw, the debug interface is dead once the kernel has started, and the bootloader is password protected, so we are going to have to take the chip off, read it, and hope that it isn't encrypted.

![missing_chip.jpg](/assets/images/video_call_camera_p1/missing_chip.jpg)

With the chip off, I threw it into my *XGecu T48*, configured the software, and read the chip contents.

![xgecu.jpg](/assets/images/video_call_camera_p1/xgecu.jpg)

## Analysis

With that done, lets have a look at the entropy graph generated by *binwalk*:

![entropy.png](/assets/images/video_call_camera_p1/entropy.png)

The entropy is pretty high, but *binwalk* does get some matches and there are dips so it is most likely highly compressed.

I used *binwalkv3* (like old *binwalk* but written in Rust and has colours, and probably some more features I have completely glossed over) to extract the chip contents, and ended up with seven folders:
- **4720**
  - *bootloader*
- **40000**
  - *squashfs*
  - Linux filesystem, main root?
- **320000**
  - *squashfs*
  - Another Linux filesystem
- **760000**
  - *squashfs*
  - Web directory
- **780000**
  - *squashfs*
  - For device customisation by vendor? Has CustomConfig, fonts, etc.
- **7B0000**
  - *jffs2*
  - Config, Flags and Log directories - persistent filesystem
- **7D0458**
  - *jffs2*
  - More config stuff, compressed JSON files

Looks like we have our work cut out for us, lots to look at!

## Quick Look Around

I want to find code responsible for handling the App traffic we saw in the earlier captures. I did some grepping of words from the unencrypted TCP traffic, and discovered that pretty much all of them were used in **4000/squashfs-root/usr/bin/App**.

As this is in the form of an ELF, we don't have to worry about architecture and base addresses and stuff like that - *Ghidra* can do all of that work for us by parsing the ELF header.

The binary loaded into *Ghidra* no problem, and it didn't take long to realise that this binary is responsible for pretty much everything - it will definitely need some significant reverse engineering effort as there is a LOT of code. Also the code is written in C++ which is a bit more painful to reverse engineer than C, but not impossible!

# Conclusion

In this blog, we did a pretty standard initial enumeration, looked at the hardware to see what we are working with, removed and dumped the chip, extracted firmware, and found a decent starting point. In the next blog, I will see if I can emulate the App with a Python script and expand the attack surface for port *34567*.