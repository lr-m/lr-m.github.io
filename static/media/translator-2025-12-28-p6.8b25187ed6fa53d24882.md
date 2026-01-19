---
published: true
title: "🗺️ [5] Three More Exploits"
toc: true
toc_sticky: true
tagline: "I know I said I was done with this in the last blog, but I decided to do a talk on this for some reason... which means more exploits!"
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

After putting together exploits for the T11 Translator and Soyes XS11 - I decided to see if I could find some more devices impacted by the bug!

# Doogee X5

I was looking through the list of devices that featured a mali-400 GPU, and low-balling people selling them on vinted (as you do), and I came across this:

![small_af.jpg](/assets/images/translator/p6/doogee_listing.png)

Exactly what I need for a grand total of £9ish posted?

![score.gif](/assets/images/translator/p6/score.gif)

I have no idea where this phone even came from, as there are a grand total of zero listed on eBay at the time of writing. I waited for a few days for it to arrive, and was very happy when I discovered the vulnerable code in the kernel, and was able to crash it with a PoC very quickly!

Then its just a matter of using **mtkclient** to pull the kernel as we have done before.

## Device Specifics

In terms of differences from the Soyes XS11, the only annoying difference is that SELinux is enforcing, and thats about it.

| Property | Value |
| - | - |
| Model number | X5 |
| Chipset | MT6580 |
| GPU | ARM Mali-400 MP |
| Android version | 6.0 |
| Kernel version | 3.18.19 |
| Build number | **DOOGEE-X5-Android6.0-20170904** |
| SELinux | Enforcing |

## Exploit

I'll cover SELinux a bit quick as this wasn't on previous devices. All we have to do is find the global **enforcing** flag in memory and set it to 0, the address of which can easily be located in the disassembled kernel with this beauty:

![enforcing_locator.png](/assets/images/translator/p6/enforcing_locator.png)

Other than that, it is pretty much the same exploit as the Soyes XS11 one, but instead of getting the nice reliable delay the **gsl_config** kernel driver gives you to fix the corrupted freelist, I had to find another way.

Earlier on in this Project when I was chatting to *sam4k* ([read his blog its 🔥](https://sam4k.com/)), he sent me a link to a black hat Europe 2021 talk: *"Achieving Linux Kernel Code Execution Through A Malicious USB Device*" \[[Talk](https://www.youtube.com/watch?v=ZEZIcjhsZEk)\]\[[Slides](https://i.blackhat.com/EU-21/Thursday/EU-21-Bogaard-Geist-Achieving-Linux-Kernel-Code-Execution-Through-A-Malicious-USB-Device.pdf)\].

In this talk, they use the behaviour of the freelist to get an arbitrary write primitive. They exploit the fact that the freelist next pointer is stored at the start of the free'd memory itself, so with a certain pattern of allocations with control of the freelist, an arbitrary write can be achieved! 

Although not directly applicable, I learned a bunch about how the freelist works and how manipulating it can be useful, but this is what stood out the most to me:

![hint1.png](/assets/images/translator/p6/hint1.png)

![hint2.png](/assets/images/translator/p6/hint2.png)

I've been trying to avoid corrupting the freelist this whole time, but why can't I just fix it after it has corrupted?

![it_all_makes_sense.png](/assets/images/translator/p6/it_all_makes_sense.png)

My revalation was this:
- The freelist is looped due to the double free (freeing it once will put it in the singly linked list, freeing it twice will put it in again, introducing the loop)
- We need to break the loop
- Do an allocation in the kmalloc-128 cache via JOP
- This should return memory with the freelist next pointer at the start which will be in the loop
- Set the freelist next pointer at the start to be zero
- The loop has been broken, and the freelist should start working again as normal (minus a few leaks)

![loop_diagram.png](/assets/images/translator/p6/loop_diagram.png)

I had to do some pretty gross workarounds due to a lack of gadgets for the zero write (I had to use **memcpy** instead to write the zero), but I was able to get this technique working:

![frels_doogee.gif](/assets/images/translator/p6/frels_doogee.gif)

And the reliability is significantly better, especially if you call the JOP-chain twice for some reason...

# Huawei P8 Lite

While researching more devices to have a look at, I discovered that the Huawei P8 Lite uses a Kirin 620 chip, which happens to feature a Mali Utgard GPU - and is also 64-bit, which we haven't encountered before.

I found a cheap one online, and made the mistake of submitting a low ball offer of £8, which the seller took as permission to send me their least-prized example. Here is what I was expecting:

![p8_lite_listing.png](/assets/images/translator/p6/p8_lite_listing.png)

And here is what I got:

![who_ran_over_this_phone.jpg](/assets/images/translator/p6/who_ran_over_this_phone.jpg)

To be fair to the seller, it is cracked, and it does work, so not technically false-advertising, right? Either way, as long as the USB works I'm happy.

## Firmware

Getting the firmware wasn't as trivial as the Mediatek devices, these phones are so old that searching for firmware for them is an almost-impossible tasks. It is basically a link graveyard, except Mediafire links for some reason?

I was able to find a firmware for the phone, and back in the good old days they didn't seem to mind you flashing firmwares, so I flashed **ALE-L21C432B560** (acquired from [here](https://xdaforums.com/t/guide-unlock-bootloader-root-the-device-and-install-any-custom-rom-ale-l23-21.3977067/) in **HW_Stock_Android_6.zip**) to the phone by uploading it to the SD card and pressing the magic button combinations. And also used some dodgy old software to extract the kernel from the update file: [HuaweiUpdateExtractor.exe](https://github.com/Project-Satori/HuaweiUpdateExtractor) (Wine runs it great though!).

Now we have the 64-bit kernel loaded into Ghidra, and we can get all the magic addresses and gadgets we need.

Here are the details of the device:

| Property | Value |
| - | - |
| Model number | ALE-L21 |
| Chipset | Kirin 620 |
| GPU | ARM Mali-450 MP4 |
| Android version | 6.0 |
| EMUI version | 4.0 |
| Kernel version | 3.10.86-g6a5da10 |
| Build number | **ALE-L21C432B560** |
| SELinux | Enforcing |

## Exploit

This is pretty much identical to the previous Doogee X5 exploit, just with a rewritten JOP-chain that doesn't use the **memcpy** workaround. This one also seems rock-solid when it comes to reliability.

![p8_lite.gif](/assets/images/translator/p6/p8_lite.gif)

# Blackview A60

I wanted to find the MT6580 with the most recent Android version I could find, after a browse around I found this one on ebay:

![blackview_a60_listing.png](/assets/images/translator/p6/blackview_a60_listing.png)

It was listed for £16, but I offered £10 and the rest is history.

![must_lowball.png](/assets/images/translator/p6/must_lowball.png)

The specs of the device are as follows:

| Property | Value |
| - | - |
| Model number | A60 |
| Chipset | MT6580 |
| GPU | ARM Mali-400 MP |
| Android version | GO (8.1.0) |
| Kernel version | 3.18.79+ |
| Build number | **A60_W168_EEA_V1.0_20201123V23** |
| SELinux | Enforcing |

Android 8.1.0, that came out like a few years ago right?

![oreo_title.png](/assets/images/translator/p6/oreo_title.png)

5th of December 2017? Damn.

![unc_status.gif](/assets/images/translator/p6/unc_status.gif)

## New Challenges

Annoyingly, they actually decided to harden the kernel with Android Oreo, the changes made can be seen [here](https://android-developers.googleblog.com/2017/08/hardening-kernel-in-android-oreo.html). 

Luckily we don't need to worry about all of those mitigations, specifically we can ignore KASLR because:

> *"Android 8.0 makes KASLR available in Android kernels 4.4 and newer."*

We are running kernel *3.18.79+*, so we got lucky with that one! We also don't need to worry about the *Hardened usercopy* stuff, but we do need to worry about:
- *Privileged Access Never (PAN) emulation* : So we can't put our JOP-chain in userland anymore, which isn't ideal
- *Post-init read-only memory* : We won't be able to use our strange write primitive as we have before, as patching a function address with a gadget means we write at an offset from the gadget, which we can no longer do as this is now read-only

So for this exploit, we have a few more hoops to jump through!

## Navigating Driver Changes

When trying to trigger the PoC on this device to see if it is vulnerable, I couldn't get it to crash. I looked into it a bit more, and discovered that they are using a later version of the 
driver than I had seen before, with this check in **_mali_free_allocation_mem**:

```c
if ((NULL != mali_alloc->cpu_mapping.vma) && (mali_alloc == (mali_alloc->cpu_mapping.vma)->vm_private_data))
		(mali_alloc->cpu_mapping.vma)->vm_private_data = NULL;
```

This check basically makes sure that if the **mali_alloc** has an associated mapping, the **vm_private_data** pointer is set to **NULL** to prevent it from pointing to free'd memory. 

Annoyingly, this actually prevents the method we used to trigger the bug on the previous frels exploits, because it sets the dangling **vm_private_data** we **munmap** to NULL, so **_mali_free_allocation_mem** isn't called again because it 'knows' that **mali_alloc** has already been free'd by the **ioctl** we sent:

![old_technique_new_check.png](/assets/images/translator/p6/old_technique_new_check.png)

But, there is a very simple way around it - all we have to do is add another **mmap**, and another **MALI_IOC_MEM_FREE** **ioctl** call, call **munmap** on the second mapping (as that is the one 'remembered' by the driver for this **mali_alloc**), then the first mapping will still have the dangling pointer!

![another_one.gif](/assets/images/translator/p6/another_one.gif)

Taking a closer look at **mali_mmap** illustrates the workaround:

```c
int mali_mmap(struct file *filp, struct vm_area_struct *vma)
{
	struct mali_session_data *session;
	mali_mem_allocation *mali_alloc = NULL;
	u32 mali_addr = vma->vm_pgoff << PAGE_SHIFT;
	struct mali_vma_node *mali_vma_node = NULL;
	mali_mem_backend *mem_bkend = NULL;
	int ret = -EFAULT;

	session = (struct mali_session_data *)filp->private_data;

  ...

	/* find mali allocation structure by vaddress*/
	mali_vma_node = mali_vma_offset_search(&session->allocation_mgr, mali_addr, 0);
	if (likely(mali_vma_node)) {
		mali_alloc = container_of(mali_vma_node, struct mali_mem_allocation, mali_vma_node);
		...
	} else {
		MALI_DEBUG_ASSERT(NULL == mali_vma_node);
		return -EFAULT;
	}

	...
  
out:
  ...
	vma->vm_private_data = (void *)mali_alloc;
	mali_alloc->cpu_mapping.vma = vma;

	mali_allocation_ref(mali_alloc);

	return 0;
}
```

You can see that the **mali_alloc** only 'remembers' the most recent mapping. Lets update the diagram:

![new_technique_new_check.png](/assets/images/translator/p6/new_technique_new_check.png)

## Making the Write Useful Again

To recap what we did before, we were using the write to patch a function address in a syscall handler fop table to a gadget, and we were getting the JOP-chain via the userland address of the buffer. 

```
c0419dac 04 10 80 e5     str      r1,[r0,#0x4]
c0419db0 00 00 81 e5     str      r0,[r1,#0x0]
```

But due to the nature of the write, **\*gadget+4** was also getting patched, which is fine when that memory is not read-only, but that is no longer the case.

![old_method.png](/assets/images/translator/p6/old_method.png)

So we need to find something writeable that contains a pointer to something writeable, and then patch that writeable pointer with something else writeable that we control.

To find something interesting to write, I had a brief look around for things to write that would yield code execution, starting with the **wmt_drv.ko**, which contains the **/proc/driver/wmt_aee** stuff that had previously been included in the kernel blob (worth going and taking a look at [\[3\] There is Always a Better Way](https://luke-m.xyz/translator/p4.md) if you haven't already).

I was having a play with the race condition, and discovered that the bug is still around on this device, but it can only read the **.bss** section of the **wmt_drv.ko** driver before it crashes the kernel, so less useful than previous devices.

Because of this, I was having a browse around some globals, and traced the fops for **wmt_aee** to this function:

![wmt_dev_proc_for_aee_setup.png](/assets/images/translator/p6/wmt_dev_proc_for_aee_setup.png)

Interestingly, we can leak **gWmtAeeEntry** with the race condition, so lets take a look at what **proc_create_data** is doing with those **wmt_aee_fops**:

![proc_create_data.png](/assets/images/translator/p6/proc_create_data.png)

Excuse the sloppy naming in that function, but the main takeaway is that the **fops** get saved at offset *0x24* into the **proc_dir_entry** that the **gWmtAeeEntry** points to (that this function returns).

The **fops** are in a writeable location, so all we need to do is put a fake **fop** table at that offset in the **proc_dir_entry**, this gives us control of **open()** and we can get code execution this way!

![new_plan.png](/assets/images/translator/p6/new_plan.png)

This should work for getting **pc** control, and while testing I also noticed that **r3** is still a pointer to the **fop** table that we control, so that will also solve our JOP-chain problem as we can just overlay it on top of the fake **fop** table!

## Getting Controlled Data Into the Kernel

At this point, we have **pc** control, and when we get **pc** control, we also control **r3** and intend on putting our JOP-chain there. Now we just have to find a way of getting memory at a known location in the kernel.

SELinux actually made this super painful, and it isn't like previous devices where you can just put memory into globals associated with a driver. I decided to go with a VERY rough method, just attempt to allocate a massive ION buffer via **/dev/ion** (*500mb* ish), hardcode a pointer, and hope that the memory lands there.

This technique is super unreliable, I'd say it hits about 20% of the time when using **0xcc921000**, and that gives me control of a decent chunk of memory, usually *0x400* bytes, which is plenty for the JOP-chain.

### Improvements

I wanted to try and make it a bit more reliable, so I ended up extending the JOP-chain with a couple of writes so I can debug:
- Overwrite the **pBuf** pointer, so we can use the **wmt_aee** **read** method to read arbitrary kernel memory from userland
- Put the actual **read** syscall handler for **wmt_aee** back in the JOP-chain (we use offset *0x8* for an important gadget, so I had to patch it in the JOP-chain after it has been used)

With those patches in place, it it now possible to get root, read arbitrary kernel memory, and find the most consistent location that appears most of the times we get root. I did have in the back of my mind the survivorship bias aspect of this approach, as we can only read when we have guessed correctly!

![survivorship_bias.png](/assets/images/translator/p6/survivorship_bias.png)


However, after getting a few memory dumps, the most consistent address ended up being: **0xD25C8400**. This significantly improves the reliability of the spray!

## Exploit

Cool, so now we have **pc** control, **r3** points to controlled memory, and we can get memory at a known location most of the time.

I spent some time writing a JOP-chain with very similar functionality to the previous JOP-chains (fix freelist, disable SELinux, **commit_creds(prepare_kernel_cred(NULL))**):

![blackview_a60.gif](/assets/images/translator/p6/blackview_a60.gif)

And that is another device exploited (and hopefully the last for this bug, at least for me)!

![another_one.png](/assets/images/translator/p6/another_one.png)

# Bug Not Present

Although I found a bunch of devices that were vulnerable, I also found just as many (if not more) that were not vulnerable!

| Device | Chipset | GPU | Android Version |
| - | - | - | - |
| Samsung Galaxy Star S5282 | Spreadtrum SC8810 | ARM Mali-400 | 4.1.2 |
| Samsung Galaxy S3 | Exynos 4412 | ARM Mali-400 MP | 4.3 |
| Samsung Galaxy S5 Mini | Exynos 3470 | ARM Mali-400 MP | 6.0.1 |
| Sony Xperia E4 | Mediatek MT6582 | ARM Mali-400 MP | 4.4.4 |
| Amazon Kindle Fire (7th Generation) | Mediatek MT8127 | ARM Mali-450 MP | 5.1.1 |

It looks like this bug is only appearing in more 'cheap' devices, the above phones use a very different driver to the open-source one, which I haven't looked at.

# Conclusion

Overall, I had a blast writing these exploits and gradually building up the mitigations/difficulty - it is a great way to learn this stuff. This turned into a way bigger project than I anticipated.

If anyone gets this far, thanks for following along! And if you are coming from my DistrictCon Junkyard talk, I hope at least one of my exploits worked on stage... good luck future me!

![future_me_problem.png](/assets/images/translator/p6/future_me_problem.png)
