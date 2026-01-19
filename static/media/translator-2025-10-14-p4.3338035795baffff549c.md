---
published: true
title: "🗺️ [3] There is Always a Better Way"
toc: true
toc_sticky: true
tagline: "I found another driver I didn't spot on my first pass, yielding my first useful race condition - and annoyingly a much easier way to root this translator..."
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

I bought another phone online with the intention of rooting it (more on that in a future blog post) using the same method I discussed in the previous blog post, but I kept running into issues - however, finding ways around these issues presented some interesting bugs that are also present on the translator.

# Drivers

The drivers I found are the following in **/proc/driver**:

```
-rw-rw-r-- shell    system          0 2017-01-05 04:32 wmt_aee
-rw-rw-r-- shell    system          0 2017-01-05 04:32 wmt_dbg
```

As I am accessing the device via adb, I have access to these devices as I am running in the **system** group. They evaded me earlier as they're in **/proc/driver** and I didn't bother to check inside of directories... clearly, sometimes security by obscurity works.

## wmt_aee

As this is an old mediatek kernel, there is always source code online, lets look at the **fop** definitions and see how we can interact with this driver:

```c
static struct file_operations wmt_aee_fops = {
	.read = wmt_aee_read,
	.write = wmt_aee_write,
};
```

The **wmt_aee_write** method for this driver is stubbed out on every device I looked at, so I'll ignore that and focus on the **wmt_aee_read** method which we can interact with via a **read** sycall. Here is the code for that from some source code online:

```c
ssize_t wmt_aee_read(struct file * filp, char __user * buf, size_t count, loff_t * f_pos) {
    INT32 retval = 0;
    UINT32 len = 0;
    WMT_INFO_FUNC("%s: count %d pos %lld\n", __func__, count, * f_pos);

    if (0 == * f_pos) {
        pBuf = wmt_lib_get_cpupcr_xml_format( & len);
        g_buf_len = len;
        WMT_INFO_FUNC("wmt_dev:wmt for aee buffer len(%d)\n", g_buf_len);
    }

    if (g_buf_len >= count) {

        retval = copy_to_user(buf, pBuf, count);
        if (retval) {
            WMT_ERR_FUNC("copy to aee buffer failed, ret:%d\n", retval);
            retval = -EFAULT;
            goto err_exit;
        }

        * f_pos += count;
        g_buf_len -= count;
        pBuf += count;
        WMT_INFO_FUNC("wmt_dev:after read,wmt for aee buffer len(%d)\n", g_buf_len);

        retval = count;
    } else if (0 != g_buf_len) {

        retval = copy_to_user(buf, pBuf, g_buf_len);
        if (retval) {
            WMT_ERR_FUNC("copy to aee buffer failed, ret:%d\n", retval);
            retval = -EFAULT;
            goto err_exit;
        }

        * f_pos += g_buf_len;
        len = g_buf_len;
        g_buf_len = 0;
        pBuf += len;
        retval = len;
        WMT_INFO_FUNC("wmt_dev:after read,wmt for aee buffer len(%d)\n", g_buf_len);
    } else {
        WMT_INFO_FUNC("wmt_dev: no data avaliable for aee\n");
        retval = 0;
    }
    err_exit:
        return retval;
}
```

This function is clearly designed to fetch some information using **wmt_lib_get_cpupcr_xml_format**, and send it back to the user. It appears they also handle if the length of the data is greater than **WMT_PROC_AEE_SIZE**, chunking up large strings.

Here is an example response:

```xml
shell@hct6580_weg_c_m:/proc/driver $ cat wmt_aee
<main>
	<chipid>
		MT6580
	</chipid>
	<version>
		<rom>E2</rom>
		<branch>W1636MP</branch>
		<patch>20170220</patch>
		<wifi>NULL</wifi>
	</version>
	<issue>
		<classification>
			NULL
		</classification>
		<rc>
			NULL
		</rc>
	</issue>
	<hint>
		<time_align>NULL</time_align>
		<host>NULL</host>
		<client>
			<task>NULL</task>
			<irqx>NULL</irqx>
			<isr>NULL</isr>
			<drv_type>NULL</drv_type>
			<reason>NULL</reason>
			<pctrace>NULL</pctrace>
			<extension>NULL</extension>
		</client>
	</hint>
</main>
```

Seems pretty uninteresting right?

### Race Condition -> Memory Leak

The main thing to note here is that there is no locking on this function (they added locking on more recent devices, but I couldn't find a CVE for the bug so maybe it was fixed interally). We can issue multiple **read** syscalls to the device on different *fd*s, but what does this give us?

**g_buf_len** is a global that tracks the number of bytes available to be read from a buffer, both of our **read** syscalls will be able to modify this at the same time, consider the following:
- First create two **fd**s for the driver using **open**
- On both of them, read 8 bytes into a buffer
  - This will set the **f_pos** for both of them to be non-zero, meaning **g_buf_len** will not be set (if **f_pos** is zero, **wmt_lib_get_cpupcr_xml_format** gets called, and **g_buf_len** gets set to the length of the buffer again)
- Now race two threads to call **read(my_fd, buf, 300)** on each of the **fd**s
  - What we want to happen here is for both of the threads to hit **g_buf_len >= count** before **g_buf_len** gets decremented, **count** will be *300*, and if **g_buf_len** is initialised to *512* (observed) it will be *504* at this point
- If both threads pass this check, they will both decrement the **g_buf_len** global by *300*, making it underflow and become huge
- Once the **g_buf_len** is massive, **g_buf_len >= count** becomes completely redundant and we can read as much memory as we please, letting us read out of bounds of the **pBuf** and into kernel memory!

After implementing this, compiling it and running it on the phone, the following cases are observed:

- *Miss*: One thread reads *300* bytes, the other reads *203* bytes, meaning the race wasn't hit

```
[Attempt 646]
Initial read fd1: 8 bytes (f_pos=8)
Initial read fd2: 8 bytes (f_pos=8)
Thread 0 (fd=3): read 300 bytes
Thread 0 data: 3c 63 68 69 70 69 64 3e 0a 09 09 4d 54 36 35 38 
                30 0a 09 3c 2f 63 68 69 70 69 64 3e 0a 09 3c 76 
                65 72 73 69 6f 6e 3e 0a 09 09 3c 72 6f 6d 3e 45 
                32 3c 2f 72 6f 6d 3e 0a 09 09 3c 62 72 61 6e 63 
                68 3e 57 31 36 33 36 4d 50 3c 2f 62 72 61 6e 63 
                68 3e 0a 09 09 3c 70 61 74 63 68 3e 32 30 31 37 
                30 32 32 30 ... (200 more bytes)
Thread 1 (fd=4): read 203 bytes
Thread 1 data: 0a 09 09 09 3c 74 61 73 6b 3e 4e 55 4c 4c 3c 2f 
                74 61 73 6b 3e 0a 09 09 09 3c 69 72 71 78 3e 4e 
                55 4c 4c 3c 2f 69 72 71 78 3e 0a 09 09 09 3c 69 
                73 72 3e 4e 55 4c 4c 3c 2f 69 73 72 3e 0a 09 09 
                09 3c 64 72 76 5f 74 79 70 65 3e 4e 55 4c 4c 3c 
                2f 64 72 76 5f 74 79 70 65 3e 0a 09 09 09 3c 72 
                65 61 73 6f ... (103 more bytes)
```

- *Hit*: Both threads read *300* bytes meaning **g_buf_len** was decremented twice, and we can now read as much as we want!

```
[Attempt 659]
Initial read fd1: 8 bytes (f_pos=8)
Initial read fd2: 8 bytes (f_pos=8)
Thread 1 (fd=4): read 300 bytes
Thread 1 data: 3c 63 68 69 70 69 64 3e 0a 09 09 4d 54 36 35 38 
                30 0a 09 3c 2f 63 68 69 70 69 64 3e 0a 09 3c 76 
                65 72 73 69 6f 6e 3e 0a 09 09 3c 72 6f 6d 3e 45 
                32 3c 2f 72 6f 6d 3e 0a 09 09 3c 62 72 61 6e 63 
                68 3e 57 31 36 33 36 4d 50 3c 2f 62 72 61 6e 63 
                68 3e 0a 09 09 3c 70 61 74 63 68 3e 32 30 31 37 
                30 32 32 30 ... (200 more bytes)
Thread 0 (fd=3): read 300 bytes
Thread 0 data: 3c 63 68 69 70 69 64 3e 0a 09 09 4d 54 36 35 38 
                30 0a 09 3c 2f 63 68 69 70 69 64 3e 0a 09 3c 76 
                65 72 73 69 6f 6e 3e 0a 09 09 3c 72 6f 6d 3e 45 
                32 3c 2f 72 6f 6d 3e 0a 09 09 3c 62 72 61 6e 63 
                68 3e 57 31 36 33 36 4d 50 3c 2f 62 72 61 6e 63 
                68 3e 0a 09 09 3c 70 61 74 63 68 3e 32 30 31 37 
                30 32 32 30 ... (200 more bytes)
```

Here is some heap memory to enjoy:

![heap_memory.png](/assets/images/translator/p4/heap_memory.png)

This can be used to easily scan for structures, and if in some other dimension there is kASLR on some cheap old mediatek device it could be used to bypass that as well!

![forbidden_memory.png](/assets/images/translator/p4/forbidden_memory.png)

## wmt_dbg

This device seems to be for some sort of chipset debugging, gives you access to various interesting functionality via **write** (**read** is pretty boring so I'll leave it out).

### write

Lets take a peek at the code:

```c
ssize_t wmt_dbg_write(struct file * filp,
    const char __user * buffer, size_t count, loff_t * f_pos) {
    INT8 buf[256];
    PINT8 pBuf;
    unsigned long len = count;
    INT32 x = 0, y = 0, z = 0;
    PINT8 pToken = NULL;
    PINT8 pDelimiter = " \t";

    WMT_INFO_FUNC("write parameter len = %d\n\r", (INT32) len);
    if (len >= osal_sizeof(buf)) {
        WMT_ERR_FUNC("input handling fail!\n");
        len = osal_sizeof(buf) - 1;
        return -1;
    }

    if (copy_from_user(buf, buffer, len)) {
        return -EFAULT;
    }
    buf[len] = '\0';
    WMT_INFO_FUNC("write parameter data = %s\n\r", buf);

    pBuf = buf;
    pToken = osal_strsep( & pBuf, pDelimiter);
    x = NULL != pToken ? osal_strtol(pToken, NULL, 16) : 0;

    pToken = osal_strsep( & pBuf, "\t\n ");
    if (pToken != NULL) {
        y = osal_strtol(pToken, NULL, 16);
        WMT_INFO_FUNC("y = 0x%08x\n\r", y);
    } else {
        y = 3000;
        /*efuse, register read write default value */
        if (0x11 == x || 0x12 == x || 0x13 == x) {
            y = 0x80000000;
        }
    }

    pToken = osal_strsep( & pBuf, "\t\n ");
    if (pToken != NULL) {
        z = osal_strtol(pToken, NULL, 16);
    } else {
        z = 10;
        /*efuse, register read write default value */
        if (0x11 == x || 0x12 == x || 0x13 == x) {
            z = 0xffffffff;
        }
    }

    WMT_INFO_FUNC("x(0x%08x), y(0x%08x), z(0x%08x)\n\r", x, y, z);

    if (osal_array_size(wmt_dev_dbg_func) > x && NULL != wmt_dev_dbg_func[x]) {
        ( * wmt_dev_dbg_func[x])(x, y, z);
    } else {
        WMT_WARN_FUNC("no handler defined for command id(0x%08x)\n\r", x);
    }
    return len;
}
```

They take a command as a string that looks like **x y z** where:
- **x** is the index of the function you wish to execute (also passed as the first argument of the function for some reason)
- **y** is the second argument of the function
- **z** is the third argument of the function

For example **3 10 10** can be imagined like **functions[3](3, 10, 10)**.

But what functions are available? Lets just consider the translator as those are the most interesting:

```c
static const WMT_DEV_DBG_FUNC wmt_dev_dbg_func[] = {
	[0x0] = wmt_dbg_psm_ctrl,
	[0x1] = wmt_dbg_quick_sleep_ctrl,
	[0x2] = wmt_dbg_dsns_ctrl,
	[0x3] = wmt_dbg_hwver_get,
	[0x4] = wmt_dbg_assert_test,
	[0x5] = wmt_dbg_inband_rst,
	[0x6] = wmt_dbg_chip_rst,
	[0x7] = wmt_dbg_func_ctrl,
	[0x8] = wmt_dbg_raed_chipid,
	[0x9] = wmt_dbg_wmt_dbg_level,
	[0xa] = wmt_dbg_stp_dbg_level,
	[0xb] = wmt_dbg_reg_read,
	[0xc] = wmt_dbg_reg_write,
	[0xd] = wmt_dbg_coex_test,
	[0xe] = wmt_dbg_rst_ctrl,
	[0xf] = wmt_dbg_ut_test,
	[0x10] = wmt_dbg_efuse_read,
	[0x11] = wmt_dbg_efuse_write,
	[0x12] = wmt_dbg_sdio_ctrl,
	[0x13] = wmt_dbg_stp_dbg_ctrl,
	[0x14] = wmt_dbg_stp_dbg_log_ctrl,
	[0x15] = wmt_dbg_wmt_assert_ctrl,
	[0x16] = wmt_dbg_stp_trigger_assert,
	[0x17] = wmt_dbg_ap_reg_read,
	[0x18] = wmt_dbg_ap_reg_write,
	[0x19] = wmt_dbg_fwinfor_from_emi,
	[0x1a] = wmt_dbg_set_mcu_clock,
	[0x1b] = wmt_dbg_poll_cpupcr,
	[0x1c] = wmt_dbg_jtag_flag_ctrl,
```

Plenty of interesting stuff to look into, made twice as interesting by the fact there is no locking on this driver either!

### Arbitrary Write

**wmt_dbg_ap_reg_write** looks interesting, I wonder what that does?

![arb_write.png](/assets/images/translator/p4/arb_write.png)

![uhhhhhh.png](/assets/images/translator/p4/uhhhhhh.png)

I think that probably should have been left out of the production build... if you haven't seen it, **\*(uint32_t\*)address = value** isn't the best thing to do in the kernel if the user controls both **address** and **value**.

### Arbitrary Read

To pair with the **wmt_dbg_ap_reg_write** function, there is also a **wmt_dbg_ap_reg_read** function that lets you read an arbitrary address, the result being printed to **dmesg**.

![arb_read.png](/assets/images/translator/p4/arb_read.png)

Here is an example read as seen in the **dmesg** of the translator:

![example_read.png](/assets/images/translator/p4/example_read.png)

# Another Way to Root

Now that we have an arbitrary write without having to worry about scary stuff like heap allocations, it now becomes super easy to root! 

1. Allocate an **ion** buffer
2. Use the arbitrary write to patch the **free** method for that **ion** buffer type to a userspace function that calls **commit_creds(prepare_kernel_cred(NULL));** for the kernel to execute
3. Free the **ion** buffer to call the function
4. Patch it back to the original value using the write
5. Spawn a root shell!

![another_root.png](/assets/images/translator/p4/another_root.png)

# Conclusion

In this blog, we found a handful of bugs, including my first useful race condition and free read/write primitives! We used the arbitrary write to escalate priviliges to root in a much easier (and less impressive) fashion than the mali method. Two ways to root is better than one!

![better_way.png](/assets/images/translator/p4/better_way.png)