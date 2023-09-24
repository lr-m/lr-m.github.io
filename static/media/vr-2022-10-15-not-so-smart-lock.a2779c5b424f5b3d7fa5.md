---
published: true
title: "🔒 Not-so-Smart Lock"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - IoT
  - Debug Interfaces
tagline: "Discover the inner workings of smart door locks with me. I'll be sharing my project findings in this blog, offering a closer look at this technology, while exposing some of its flaws."
excerpt: "Explore a smart door lock with me. I'll share my findings and reveal both interesting aspects of its implementation, as well as its flaws, in this blog."
header:
  teaser: /assets/images/not_so_smart_lock/teaser.PNG
  overlay_image: /assets/images/not_so_smart_lock/header.png
  overlay_filter: 0.4
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

The target for this investigation is the Pineworld Q203 smart lock. The lock has several unlocking mechanisms, this blog will focus on the physical entry mechanisms, as these findings are the most interesting. These mechanisms are Fingerprint, RFID, and Numerical Passcode. It is designed to replace a conventional door handle and is full of interesting functionality.

![rsz_1lock.png](/assets/images/not_so_smart_lock/rsz_1lock.png)

See below a full threat model for the device:

![threat_model2.png](/assets/images/not_so_smart_lock/threat_model2.png)

# Hardware

It is essential to have an understanding of the hardware we are working with before we go poking around. The hardware itself is not complex by any means, and there isn't any epoxy blocking any chips we need to worry about! The image below summarises the main components of the lock:

![rsz_12rsz_layout.png](/assets/images/not_so_smart_lock/rsz_12rsz_layout.png)

The boards communicate via a connector, the devices use a UART (Universal Asynchronous Reciever-Transmitter) connection to talk to each other, and there are also some other pass-throughs for things like sound from the voice modulator chip to the speaker, and also power.

## Main Board

The main board hosts most of the functionality from the outside of the lock:

- RFID receiver
- Numerical touchpad
- STM32 microcontroller
- Intrusion detection component
- Flash memory module

![MCU_Module_Components-min.png](/assets/images/not_so_smart_lock/MCU_Module_Components-min.png)

## WiFi Module

This is a secondary module that handles fun things like cloud communication, it hosts an ESP8266EX package inside of a Tuya TYWE1S package that allows for WiFi/Cloud communication via the Tuya Smart app. This handles HTTPS and MQTTS transmissions utilised by the lock. This module makes the lock 'smart'.

![rsz_2rsz_1wifi_module_components-min.png](/assets/images/not_so_smart_lock/rsz_2rsz_1wifi_module_components-min.png)

## USB Module

A simple little module at the bottom of the lock for 'emergency power' when the batteries in the lock die. Intuition tells me that this USB port has ulterior motives, possibly a debug interface... ;)

![rsz_usb_pcb_components.png](/assets/images/not_so_smart_lock/rsz_usb_pcb_components.png)

## Fingerprint Module

A small module that hosts the fingerprint sensor, and a few small unlabelled components that likely store the fingerprints. Pineworld sell several devices with fingerprint sensors, so this is likely a component that they bolt onto all of said devices.

![Fingerprint_Module-min.png](/assets/images/not_so_smart_lock/Fingerprint_Module-min.png)

# Credential Storage

Before we move onto the fingerprint functionality, it is important to understand how the entry credentials are stored on the memory chip found on the main module. The chip in question is a SOP-8 Winbond flash chip, the contents of which are easily dumped with any programmer, such as a [Bus Pirate](http://dangerousprototypes.com/docs/Bus_Pirate).

## RFID Storage

An example credential can be seen below:

_0001 1003 764a 22c3_:

- _0001_ : Entry Number 1
- _1003_ : Entry Method Number 3 (RFID)
- _764a 22c3_ : 4-byte UID of the card (actually _4a76 c322_ but endianness magic)

Another clear flaw is that the credentials are stored in plaintext, fun fun!

## Passcode Storage

An example credential can be seen below:

_0002 1002 41c7 820f_:

- _0002_ : Entry number 2
- _1002_ : Entry method number 2 (passcode)
- _41c7 820f_ : Password converted to hexadecimal with its length appended to the front (8 20f41c7 -> 34554311)

More plaintext fun!

## Fingerprint Storage

An example credential can be seen below:

_0003 1001 0001 0000_:

- _0003_ : Entry number 3
- _1001_ : Entry method number 1 (fingerprint)
- _0001 0000_ : ID of fingerprint on module

Interesting that there is only a UID to request from the module, and no reference to the fingerprint itself.

# RFID

Let us start with the RFID functionality of the chip. It comes with two RFID cards, using a mobile phone with NFC capabilities, or something like a [proxmark3](https://lab401.com/products/proxmark-3-rdv4?variant=12406152560751), we can see that this is a Mifare Classic 1k card. These cards are notoriously cracked, and they use the broken CRYPTO-1 cypher to keep their memory blocks secure.

These cards are vulnerable to several attacks that allow simple retrieval of the keys that protect the blocks. The two main attacks are the [Nested Attack](http://www.cs.umd.edu/~jkatz/security/downloads/Mifare3.pdf), which requires knowledge of a key protecting another block on the device (usually a default key), and the [Darkside Attack](https://eprint.iacr.org/2009/137.pdf), which requires the NACK bug to be present (it is on the provided cards!). We are not off to a great start!

The cards identify themselves with a 4-byte UID (unique identifier), these are fixed. If you want to change the UID of the card, you need something called a magic card, and I used a proxmark3. These magic cards can be used to imitate/clone any Mifare Classic card in seconds, which is very useful. Some older locks utilised UID-only checks, which can be completely bypassed if you have a card with a writable UID!

## Security Mechanisms

The lock uses some primitive and flawed security mechanisms to prevent people from just cloning the card and getting in. When you add the lock as a user/administrator, the final memory block of the card is written with some data that is protected with an encryption key.

The first flaw comes from the fact that the encryption key used to protect the block is hardcoded in the blocks firmware, so if you already know the key, this extra protection is completely worthless. The second flaw is that the data written in the block isn't some random string that would be impossible to retrieve, it is simple the UID of the card. With knowledge of the hardcoded key, the security of this lock matches that of a lock that utilises UID-only checks.

![block63.PNG](/assets/images/not_so_smart_lock/block63.PNG)

## Attacks

The first attack is cloning the card. As the keys for the blocks can easily be cracked using the aforementioned attacks, the contents of the memory blocks can be cloned to a magic card. The UID of the card is easily read and can be copied to a magic card. If you have physical access to a card that can unlock the lock, then getting by the lock is trivial (provided the card is set up on the lock!).

The second attack is to sniff an unlock, or scan the card with an app that can retrieve the UID of the card. During the authentication process, the UID is broadcast, so with the right equipment, it can be captured. Thanks to the flawed protection system, a magic card can be used to easily construct an identical card, with the same encryption key and memory contents in block 63. The lock would not be able to tell the difference between your cloned card, and the original card.

Both of these attacks have been verified using a magic card and a proxmark3.

![rsz_new_card_proxmark.jpg](/assets/images/not_so_smart_lock/rsz_new_card_proxmark.jpg)

# Fingerprint

The fingerprint module is the most secure mechanism used by the lock, after seeing the state of the RFID system, that isn't an impressive feat! Despite being the best, the creators of the lock failed to consider the physical security of the lock, completely undercutting the decent security provided by the fingerprint module.

## Bypass

To bypass a lock set up with a fingerprint sensor, all you need is another fingerprint sensor from a Pineworld product, as they all use the same module. As seen above in the _Fingerprint Storage_ section, only a UID is used to determine the fingerprint that was detected on the fingerprint module. Do you see where this is going?

To make this attack even easier, all you need to do to swap out the fingerprint module with a new malicious one with your fingerprint loaded, is removing two easily accessible screws from behind the door handle. Swap out the existing one with your new one, scan your fingerprint, the fingerprint module will say to the main module _"I just scanned fingerprint 1"_, the lock will then look in the memory, see that fingerprint 1 is an admin, and unlock the lock. Easy!

This attack has been verified using another fingerprint sensor from another lock.

# Passcode

This unlocking method requires a 6-8 digit pin, after a few attempts, the lock will block further attempts for five minutes. No brute forcing here! We could try a timing attack, but that's not feasible as the lock makes a pretty jarring sound when an attempt fails, and the 5-minute block would still hold us back. Let's take a step back, remember that USB module I mentioned earlier? Let's take a look into that.

## Debug?

The humble USB cable is pretty simple, you have your _VCC_ (power), _GND_ (ground), and your _data+_ and _data-_ pins (you also have the _ID_ pin, but let's ignore that for now). Using a multimeter, we can see if there are any direct connections to the MCU, we know it can deliver power via _VCC_ and _GND_, but what about the data pins?

![lock_main_annotated.png](/assets/images/not_so_smart_lock/lock_main_annotated.png)

Interesting, the data pins connect directly to the pins for Serial Wire Debug (SWD), so this is a debug interface! Ripping apart a micro-USB cable, and hooking up the pins to the STLINK-V2 via the USB port, we can gain the full functionality of the debug interface using STM32CubeDebugger, with no protections to worry about.

![stlink.PNG](/assets/images/not_so_smart_lock/stlink.PNG)

## Attack 1: SRAM

Using the STM32CubeDebugger's _live update_ debug mode allows you to view the contents of the SRAM in almost real-time. While monitoring the SRAM, I noticed that if you entered a correct password/scanned a registered RFID card, the plaintext passcode/UID would appear in the SRAM for a brief period before being cleared. This makes sense, the passcode/UID has to go somewhere once its entered.

At one point however, I mistyped the password, and I saw the correct password pop-up in the SRAM at address _0xa00_ (SRAM starts at _0x20000000_, so _0x20000a00_). This means that you can walk up to one of these locks, hook up your STLINK-V2, enter an incorrect password, and (if you are quick enough) read out a valid passcode! They must be loading the plaintext password to compare to the entered code - not the best idea.

<iframe width="560" height="315" src="https://www.youtube.com/embed/OqZwMvRScLg" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

## Attack 2: Stack

The next attack is really simple (and you can also do the same thing to get an RFID UID), it exploits the fact that the contents of the external EEPROM are loaded into the stack when you enter any STM32CubeDebugger blocking debug mode:

- Hook up an STLINK-V2 to the USB port of the lock
- Turn the lock on by touching the keypad/attempting a fingerprint unlock
- Enter the **st-info --probe** command to enter debug mode
- Spin up OpenOCD to get your gdb instance running on the lock
- Dump the memory after the stack pointer using the **x/100x $sp** gdb command
- Identify and extract the encoded passcodes/RFID UID's
- Enter code or construct RFID card clone to unlock

![external_mem_access.png](/assets/images/not_so_smart_lock/external_mem_access.png)

# Summary

I never mentioned the fact that one of the physical entry mechanisms must be present for the device to operate properly, so this lock can be bypassed 100% of the time with physical access. The biggest find was definitely the debug interface, as that blows the RFID and Passcode unlocking methods wide open.

I have made this blog to highlight some of the most interesting findings of the investigation, I hope you enjoyed reading and hopefully took something away from this!
