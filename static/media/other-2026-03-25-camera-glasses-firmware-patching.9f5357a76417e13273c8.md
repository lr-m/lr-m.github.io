---
published: true
title: "😎 Patching Firmware on the Worlds Worst Smart 'Glasses'"
toc: true
toc_sticky: true
tagline: "I saw these rip-off Meta glasses on Aliexpress for cheap, another fun thing for the collection!"
tags:
    - Hardware Teardown
    - Firmware Analysis
---

This is the device we will be working with - you can barely tell the difference between this and the Meta/Raybans glasses...

![glasses.png](/assets/images/other/camera_glasses_firmware_patching/glasses.png)

I bought mine a good few months ago now when the amount sold was low, but it seems this product has become pretty popular. There's a few listings with *1000*+ sold at the time of writing.

![listing.png](/assets/images/other/camera_glasses_firmware_patching/listing.png)

# Teardown

As always, lets crack it open and assess the guts.

![dexter.png](/assets/images/other/camera_glasses_firmware_patching/dexter.png)

## Front

Plenty of stuff on this side:
- SD Card reader
- MCU
- Flash Memory
- UART RX Test Pad

![front.jpg](/assets/images/other/camera_glasses_firmware_patching/front.jpg)

### MCU

The MCU is a Generalplus chip, I couldn't get my hands on a datasheet for it, but it appears very common in small and cheap cameras.

![mcu.jpg](/assets/images/other/camera_glasses_firmware_patching/mcu.jpg)

### Flash

The flash is made by BoyaMicro, but its basically a run-of-the-mill SPI NOR flash chip - nothing special.

![flash.jpg](/assets/images/other/camera_glasses_firmware_patching/flash.jpg)

### UART

I could only locate the RX pin for the UART, but we still might get some insight from whatever it spits out, hopefully some boot logs - here is what I got:

```
BL load Run bin time 480 ms, spifc clock rate is 33000000
bus=0x00,div=2,ddr=0x50,rw=0
Ext RTC reliable is OK
ext_rtc_alarm_enable()_1: byValue=0x00000000 
ext_rtc_alarm_enable()_2: byValue=0x00000000 
0x3:0x80
0x3:0x80
set sd[1] bit_mode to 1
SYS_CLK=198
BUILD TIME: May 28 2025-19:00:16
0xD000004C = 0x3703 
0xC0000120 = 0x444444 
Delay 100ms
audio_task_init ... 
audio memory = 37992
decode memory -- 0x1bd63c
audio_task_entry ... 
task_display_init ... 
display_frame(cnt=8) addr = 0x3b84c0
display_frame_pool[1] addr = 0x3bea00
display_frame_pool[2] addr = 0x3c4f40
display_frame_pool[3] addr = 0x3cb480
display_frame_pool[4] addr = 0x3d19c0
display_frame_pool[5] addr = 0x3d7f00
display_frame_pool[6] addr = 0x3de440
display_frame_pool[7] addr = 0x3e4980
tft_st7789_n114_init
tft_st7789_n114_init finish!!!
task_display_entry ... 
task_display_entry ... 
audio_dac_task_entry ... 
task_periphstate_handleng_init ...ing_init .. 
task_peri.g_entry ..pheral_handl. 
ing_entry .load CRC.. 
 = c2 4f 5d 07
expect CRC = c2 4f 5d 07
Resource cache initial OK!
state_handling_init OK!
state_handling_entry ... 
###########ENTER MODE [100]
=>video_encode_entrance!!!
avi_encode_state_task_create ... 
avi_adc_record_task_create ... 
avi_audio_record_entry ... 
video_packer_task_create ... 
->[video_packer_task_entry:72]
video_packer_task_create ... 
->[video_packer_task_entry:72]
nv_open retry fail~~~~~~!
state_startup_init ... 
volume = 55
xml_file_buf_addr = 0x3f6500
task_storage_service_init ... 
 task_storage_service_init OK!
task_storage_service_entry ... 
effect length = 27648
@@@OPEN SPEAKER
Speaker had open[1]
state_startup_entry ... 
ap_peripheral_pw_key_exe
```

Nothing that interesting at the moment!

## Back

Not much on the back, just the connectors for the camera/display ribbon cables, and buttons for interacting with the camera.

![back.jpg](/assets/images/other/camera_glasses_firmware_patching/back.jpg)

# Firmware Analysis

As I didn't have much luck with UART or any other weird methods to get the firmware, I did a good old fashioned chip dump (check out my other blogs for more detail, loads of embedded devices use these SOP-8 flash chips).

![entropy.png](/assets/images/other/camera_glasses_firmware_patching/entropy.png)

That high-entropy region looks scary, but as its only about half of the chip, I doubt we will have to contend with encryption. It looks like a small bootloader at the start, the high entropy bit is likely the code blob, and this is followed by some other data with varying entropy at the end.

## Structure

Lets analyse the firmware dump and see if we can work out what the deal is.

![dump_header.png](/assets/images/other/camera_glasses_firmware_patching/dump_header.png)

So we have a couple of magic strings: **SPII** and **SPIy**? Looks like a few addresses might be kicking around as well, nothing that concrete right now.

However, *0x200* bytes down, there is some super obvious code (the patterns give it away) - most likely the bootloader:

![bootloader_code.png](/assets/images/other/camera_glasses_firmware_patching/bootloader_code.png)

After the bootloader, there isn't anything fun until the region of high entropy, which begins with a small header:

![gpcoderom.png](/assets/images/other/camera_glasses_firmware_patching/gpcoderom.png)

Looks like a magic string we might be able to locate in the bootloader once loaded. *0x200* bytes after this appears to be the main blob which will likely have all the code we are interested in:

![gpzp.png](/assets/images/other/camera_glasses_firmware_patching/gpzp.png)

**GPZP** sounds like a clue...

## Reversing Bootloader

The bootloader should give us some clues about how the main code region is unpacked/loaded from its current format. After extracting it from the chip dump, I threw it into **basefind2.py** to see what it thinks the base address is:

![basefind.png](/assets/images/other/camera_glasses_firmware_patching/basefind.png)

*173.91%*? I've never seen it be *THAT* confident before. That **0xf8028020** value feels familiar, if we look back at the header at the start of the dump, at address *0x8*, we see the exact same value (minus the endianness), so this must be the *load* address of the bootloader. Therefore, we can set this to be the base address, and we should get a solid disassembly in Ghidra.

At this point, I just guessed it would be ARM little-endian (its always ARM little-endian on these devices, or MIPS), and loaded it into Ghidra. Now we can start to figure out what its doing.

Lets use our insight from the structure earlier and search for some of those magic strings, specifically **GPCODEROM**.

![gpcoderom_parsing.png](/assets/images/other/camera_glasses_firmware_patching/gpcoderom_parsing.png)

Awesome, we have found the code that is parsing the smaller header before the big code blob, now we can just explore a bit more to find where its doing the extraction.

![gpzp_parsing.png](/assets/images/other/camera_glasses_firmware_patching/gpzp_parsing.png)

Nice, so now we have the function that appears to be doing the processing of the app blob to take it from this high entropy mess, to a nice executable application. If we trace the function down to something that looks like its processing data, copy and paste it into Claude (its 2026 after all), we get our answer - its a deflate decompressor! This makes sense, I assume the **ZP** in **GPZP** stands for ZIP.

## Unpacking Main App

Now that we know the algorithm that the app is packed with, we can extract it into a separate file, and write a Python script to inflate it:

```python
import zlib

with open('compressed_app.bin', 'rb') as f:
    data = f.read()

try:
    decompressed = zlib.decompress(data, -15)  # -15 = raw deflate
    with open('output.bin', 'wb') as f:
        f.write(decompressed)
    print(f"Success! Decompressed {len(decompressed)} bytes")
except Exception as e:
    print(f"Raw DEFLATE failed: {e}")
```

Now we have decompressed the main app, and can start reverse engineering the code running on the camera.

## Loading Into Ghidra

We already know the architecture, and we can use the trusty **basefind2.py** script to get the base address (*0x0* this time).

![basefind_uncompressed_app.png](/assets/images/other/camera_glasses_firmware_patching/basefind_uncompressed_app.png)

Then its just a matter of throwing it into Ghidra, configuring the architecture, then we're good to go!

# Reverse Engineering Handlers

When the camera is put into WiFi mode it spins up a hotspot that the app uses for file transfer and other configuration. If we connect to the hotspot it spins up and run **nmap**, we can see what ports are available.

```
➜  AliGlasses nmap -p- 192.168.25.1
Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-03-28 16:59 GMT
Nmap scan report for 192.168.25.1
Host is up (0.021s latency).
Not shown: 65533 closed tcp ports (conn-refused)
PORT     STATE SERVICE
8080/tcp open  http-proxy
8081/tcp open  blackice-icecap

Nmap done: 1 IP address (1 host up) scanned in 55.84 seconds

```

So there are only two ports, *8080* and *8081*. 

Rather than reversing the firmware, we might be able to get a hint by throwing data into the port and observing what gets printed on the UART. 

Port 8080 looks RTSP related:

```
RTSP: remote IP 192.168.25.102 connected
port:10850
tcp client Keep alive
Handle unknown CSeq=0
rx_desp.sta->ampdu_tx_ssn=6
mgmt.u.action.u.addba_req.start_seq_num=96
```

And port 8081 mentions **socket_cmd**, which should give us a good idea where to look.

```
OK = 3!
scoket start
socket_cmd TCP Keep alive
gp cmd(6): skip cmd 0x68 0x65 0x6c 0x6c
backup_socket_cmd_client start
```

## 8080 - RTSP

The RTSP code is pretty much standard, the only interesting thing that caught my eye is that there is a stack overflow:

![rtsp_stack_buffer.png](/assets/images/other/camera_glasses_firmware_patching/rtsp_stack_buffer.png)

Then later on, if the device is set to use *h264* rather than *mjpg*, up to *0x80* bytes can be parsed into the *68* byte buffer, causing a stack overflow.

![rtsp_stack_overflow.png](/assets/images/other/camera_glasses_firmware_patching/rtsp_stack_overflow.png)

However, after some testing and looking through the code, this task is written so that it never exits. So even if we overflow registers saved on the stack, they will never be popped off of the stack! The only option we have are local variables, but none of these are used in noteworthy ways - so unfortunately this bug isn't of any use.

## 8081 - **socket_cmd_service**

The function to handle these commands seems to have a good chunk of it inlined, so its about *1400* lines of straight up handler. This summarises it pretty well:

| Command | Name | Notes |
|---------|------|-------|
| *0x0000* | Mode Change | Switches between record / browse / menu modes. Waits up to ~4s per step. |
| *0x0001* | Get Device Info | Returns 15 bytes of device info. |
| *0x0002* | Get XML Config | Returns the XML config file in *0x7F2*-byte chunks. |
| *0x0003* | Unknown | Returns a status code, no payload. |
| *0x0004* | Unknown | Returns a status code, no payload. |
| *0x0005* | Authentication | Challenge-response auth; returns 6 bytes. **Never enforced as a gate on any other command.** |
| *0x0006* | Get Info (SD / Flight) | Returns 3 bytes: SD card status + flight counter. |
| *0x0100* | Start/Stop Record | Toggles video recording. Returns error *0xFFFB* if busy. |
| *0x0101* | Start Preview | Starts live view. Only valid when in record mode (*camera_mode == 0*). |
| *0x0200* | Capture Photo | Takes a still photo. |
| *0x0300* | Playback Start | Starts playback of a file. Requires browse mode. Waits up to ~12.5s for start. |
| *0x0301* | Pause/Resume Playback | Pauses or resumes current playback. |
| *0x0304* | Get Thumbnail | Returns thumbnail image for a file. |
| *0x0302* | Get File Count | Returns 2-byte file count. |
| *0x0303* | Get File List | Returns variable-length file listing. |
| *0x0305* | File Download | Streams raw file data; double-buffered. Allocates heap buffers per transfer. |
| *0x0306* | Format SD Card | Formats the SD card. |
| *0x0307* | Get File Info | Returns 2 bytes of metadata for a specific file. |
| *0x0308* | Delete File | Deletes a file from the SD card. |
| *0x0401* | Set WiFi Credentials | Sets SSID and password. |
| *0x0400* | Get Parameter | *0x0300* → WiFi SSID, *0x0301* → WiFi password (plaintext). |
| *0x0500* | Firmware Upgrade Init | Allocates a 2 MB firmware buffer. |
| *0x0501* | Firmware Data Chunk | Appends chunk to firmware buffer. Chunk size *0x0000* signals end-of-transfer and triggers checksum verification. |
| *0x0502* | Firmware Verify/Apply | Flashes the uploaded firmware. Requires prior successful checksum pass (**firmware_upgrade_state* == 1*). |
| *0xFF00* | Set Time | Sets the device RTC. |
| default | Unknown | Returns error *0xFFFF*. |

A good amount of stuff in there, but not a huge amount of bugs. So in this blog I'll be focusing on the firmware upgrade commands - I've never done firmware patching in any of my projects before so this will be a first.

### Firmware Upgrade

After some reverse engineering, the firmware upgrade process looks like this:

1. Send *0x0500* with the total firmware size (32-bit) at [*0x0c*] and expected checksum (32-bit) at [*0x10*]. The device allocates a 2 MB heap buffer and a 2 KB temp buffer to receive the firmware.
2. Send one or more *0x0501* chunks. Each chunk carries a 16-bit little-endian data length at [*0x0c*] followed by the raw data at [*0x0e*]. The device appends each chunk to the firmware buffer and accumulates a running byte count.
3. Signal end-of-transfer by sending a final *0x0501* with chunk size *0x0000*. The device checks that the total bytes received matches the size declared in *0x0500*, then computes a byte-sum checksum over the entire buffer and compares it against the expected value. On match, sets **firmware_upgrade_state** = 1.
4. Send *0x0502*. The device checks **firmware_upgrade_state** == 1 and calls the flash/apply routine. On success it sets **firmware_upgrade_state** = 2.

# Patching Firmware

Now that we understand the firmware upgrade process, we can start messing with the firmware. First of all, we need to understand how to repackage a firmware image into something the device can boot. If we can apply an update, and the device still works, that will be a good indication that the firmware upgrade process is understood and works. Then we can start doing some fun stuff.

First of all, we need to deflate the firmware again after inflating it, but we need to know how aggressive our deflate should be to get as close to factory as possible. From looking at the bootloader, the only thing we can confirm is that the bootloader deflate uses fixed Huffman codes, so the strategy for the deflate must be **Z_FIXED** - other than that everything else is up to us.

After some trial and error, using these settings produced a compressed firmware which is basically indentical to the original:

```python
cobj = zlib.compressobj(
    level    = 9,
    method   = zlib.DEFLATED,
    wbits    = -15,          # raw deflate, no zlib wrapper
    memLevel = 9,
    strategy = zlib.Z_FIXED,
)
```

Here is the output of a script that inflates the original firmware, then deflates it with those settings, and compares them:

```
Decompressed: 0x1b0cb8 bytes (1,772,728)
Recompressed:  0xe710c bytes (946,444)
Original:      0xe711c bytes (946,460)
```

![close_enough.png](/assets/images/other/camera_glasses_firmware_patching/close_enough.png)

## Applying First Update

Cool, so now its a matter of cutting out the old **GPCODEROM** region and putting in our new \*patched\* one and seeing what happens.

![ladies_and_gentlemen.png](/assets/images/other/camera_glasses_firmware_patching/ladies_and_gentlemen.png)

### What Went Wrong?

I'm still not 100% sure where exactly it went wrong, but I have made some assumptions from the fix. The firmware buffer is *0x200000* bytes, so you'd expect that you have to fill that buffer with useful data, and then that gets written to the chip. So I was writing the full *0x200000* patched firmware to the buffer, and then triggering the upgrade to write it to flash.

What was happening, was that everything before *0x10000* was becoming *0xff*'s, and everything after would match the firmware perfectly. I was able to stop this from happening by only sending *0x1f0000* bytes of firmware rather than filling the entire buffer. 

My theory is that they start erasing the sectors of the chip from *0x10000* until the sector at *0x10000* + the firmware length has been erased, then they flash the firmware onto the chip. I think that when it reached *0x200000*, it wrapped around back to the first sector and erased that - I can't think of any other way that *0xff*'s would end up there.

## Making it Unbrickable

After taking the chip off for a second time, I decided to make this thing super easy to reprogram if needed, as messing with the firmware means I will probably break the device a lot. 

Here is what I came up with (and a heatsink on the chip because that thing gets HOT):

![unbrickable.jpg](/assets/images/other/camera_glasses_firmware_patching/unbrickable.jpg)

And now that its unbrickable, I flashed the original golden read back onto it, tweaked the flashing code to only send *0x1f0000* bytes of firmware, flashed the \*patched\* firmware, and it booted right up! We can see the upgrade process on the UART, looks like there is also an SD card method:

```
Upgrade  0%
Upgrade  3%
Upgrade  6%
Upgrade  9%
Upgrade 12%
Upgrade 16%
Upgrade 19%
Upgrade 22%
Upgrade 25%
Upgrade 29%
Upgrade 32%
Upgrade 35%
Upgrade 38%
Upgrade 41%
Upgrade 45%
Upgrade 48%
Upgrade 51%
Upgrade 54%
Upgrade 58%
Upgrade 61%
Upgrade 64%
Upgrade 67%
Upgrade 70%
Upgrade 74%
Upgrade 77%
Upgrade 80%
Upgrade 83%
Upgrade 87%
Upgrade 90%
Upgrade 93%
Upgrade 96%
Upgrade 99%
Upgrade100%
Upgrade OK
Remove SD card and restart now
Delete gp_cardvr_upgrade.bin
```

# Firmware Patching

Now that we are able to unpack, patch, and repack the firmware into a legit-ish firmware, we can start applying patches to the main app running on the camera.

## Simple Patches

I started off with simple patches, the first of which was patching a string that I could see in the RTSP logs via UART:

```
HIYA: remote IP 192.168.25.102 connected
```

Now instead of **RTSP**, it says **HIYA** - this simple test proves that there aren't any weird checksums I missed, or anything to prevent me from patching firmware.

Next I patched a version string, just to have something visual I could chuck in this blog - so now when you enter the menu and click the **VERSION** item, you'll see this:

![patched_version.jpg](/assets/images/other/camera_glasses_firmware_patching/patched_version.jpg)

## Code Execution

Next up is injecting our own code, as patching strings will only take us so far! I decided the best way to inject code was to hijack execution when the **VERSION** menu item is pressed. That way if we break something, the device will only crash when that button is pressed, saving us from having to flash the chip.

It didn't take long to figure out the function we will be patching by using XREFs to the version string:

![menu_version_handler.png](/assets/images/other/camera_glasses_firmware_patching/menu_version_handler.png)

So the plan is to just overwrite the first few instructions so that execution jumps to some controlled code cave in the firmware (the code we want to execute). 

```python
trampoline = bytes([
        0x0F, 0x40, 0x2D, 0xE9,  # PUSH {r0-r3, lr}
        0x04, 0x00, 0x9F, 0xE5,  # LDR  r0, [pc, #4]
        0x30, 0xFF, 0x2F, 0xE1,  # BLX  r0
        0x0F, 0x80, 0xBD, 0xE8,  # POP  {r0-r3, pc}
]) + struct.pack("<I", version_cave_addr)
```

The above snippet simply saves some stuff to the stack, loads the address of the code cave, branches to it (assuming its a function at this point), then when that returns, pop the values back off of the stack. We don't need to preserve the original function, it doesn't really matter to us if the version doesn't get written to the screen anymore.

When it comes to code cave location, I figured there is a bunch of space at the end of the **GPCODEROM** segment. So all we have to do is bolt the code cave onto the end of it, update the header to tell the bootloader to also inflate any extra sectors, and we're good.

![code_cave_hello.png](/assets/images/other/camera_glasses_firmware_patching/code_cave_hello.png)

Cool, so now we have arbitrary code execution and can do some more interesting stuff!

# Slots

For this project, I figured I'd carry on the gambling theme of the [eCos router (blackjack server)](https://luke-m.xyz/router), and figured a slot machine would be fun to patch into the firmware. There are a few things we are going to need to reverse out first!

## Screen

This was actually very straightforward as the answer is in the **print_version_on_screen** function we patched:

![framebuffer.png](/assets/images/other/camera_glasses_firmware_patching/framebuffer.png)

Or if we convert it to a nice C function that fetches it for us:

```c
static uint16_t *get_fb(void)
{
    uint32_t *outer = *(uint32_t **)0x0002b860u;
    if (!outer) return 0;
    uint32_t *inner = *(uint32_t **)outer;
    if (!inner) return 0;
    return (uint16_t *)(inner[0] + inner[1]);
}
```

The colour format is RGB 5:6:5, so nice and easy to fill up the framebuffer with a colour to prove we can modify it.

![red.jpg](/assets/images/other/camera_glasses_firmware_patching/red.jpg)

## Buttons

This was also nice and simple thanks to the debug strings on the UART leading me straight to the callback functions for each button. Simply add another code cave for each button and patch the handlers functions to jump to those instead of the default, and you have button functionality!

![push_the_button.png](/assets/images/other/camera_glasses_firmware_patching/push_the_button.png)

## Jackpot

Now onto the fun stuff. When the version button is pressed, the plan is to:

1. Hijack the button handler functions so we can use them
2. Spawn a FreeRTOS task that will be doing the slot machining (if the task already exists, resume it instead)
3. When the power button is pressed, button handlers will be patched back to the original ones, and it will return to the menu

Like so:

```c
if (*active == 0) {
    uint32_t task_fn_addr = get_slot_task_addr();
    *active = 1;
    ((os_task_create_fn)OS_TASK_CREATE)(
        (void *)task_fn_addr,
        "slots",
        0x200,  /* stack: 0x200 << 2 = 0x800 words = 8KB */
        0,
        2,
        0
    );
    dbg_print("version_cave: slot task spawned\n");
} else {
    *active = 1;
    dbg_print("version_cave: slot task resumed\n");
}
```

Inside the task itself, it is a super simple game loop, press the WiFi button to spin the slots, did you match three? If yes play jackpot sound and display "Jackpot", otherwise play nothing and display "Try again". I displayed text by using their weird menu title display functions, which worked pretty well.

Adding simple sounds was straightforward as I could use the clips already available on the device. When clicking through the menu there is a clicking sound, so I stole that to play during the slot machine spinning sequence. And secondly the jackpot sound is just the boot sound, it does sound very jackpot-esque.

After some fiddling with sprites, making a cool-looking handle that looks like it is being pulled, and some super janky RNG, we get this:

![jackpot.gif](/assets/images/other/camera_glasses_firmware_patching/jackpot.gif)

# Conclusion

Another Aliexpress device bites the dust! I'm usually more of a corrupt some memory and get code execution that way kinda guy, but the firmware patching method worked very well for this device (and for once it was the easiest way to get code execution on this thing). Hope you enjoyed following along!

