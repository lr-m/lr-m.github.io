---
published: true
title: "📡 Analysing a Dirt-cheap Router [5]: A Complex Payload"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Exploitation
  - MIPS
  - C
  - Cross compilation
  - Toolchains
tagline: "Now that we have custom shellcodes running, we can now do some work to get larger payloads executing on the router. To do this, we'll need to work out how to compile C code to MIPS assembly."
excerpt: "We established we can run MIPS assembly on the router - what about C?"
header:
  teaser: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_image: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_filter: 0.4
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

# Writing Large Payloads

If we want to get the router to execute some more interesting payloads, we need to solve a couple of issues. The first is that we cannot write to addresses that contain _0x00_ as it cuts off the remainder of the payload after this character. Secondly, in the current shellcode location, we can only execute roughly 200 instructions before we run into problems.

## Finding a Better Shellcode Location

We need to find a large chunk of memory that is unused, it doesn't really matter where it is, as long as we can write code to it and execute said code. The first obvious place is unused stack space, lets take a look at the output of the **os thread** command.

```
id    state    Pri(Set) Name              StackBase   Size   usage
-------------------------------------------------------------------
0001  RUN      31 ( 31) Idle Thread       0x802b50d8  2048   1136
0002  EXIT     10 ( 10) main              0x802b5f60  8192   3040
0003  SLEEP    6  ( 6 ) Network alarm     0x80297378  4096   1840
0004  SLEEP    7  ( 7 ) Network support   0x80295f64  4096   2348
0005  SUSP     30 ( 30) cpuload           0x80295680  2048   592
0006  SLEEP    8  ( 8 ) SYSLOG Daemon     0x8029a854  4096   1388
0007  SLEEP    4  ( 4 ) RtmpTimerTask     0x802da740  4096   936
0008  SLEEP    4  ( 4 ) RtmpCmdQTask      0x802d8438  4096   904
0009  SLEEP    4  ( 4 ) RtmpWscTask       0x80345f60  4096   304
0010  SLEEP    4  ( 4 ) RtmpMlmeTask      0x802d95e8  4096   1760
0011  SLEEP    8  ( 8 ) DHCP server       0x8029930c  5120   3972
0012  SLEEP    9  ( 9 ) DNS_daemon        0x802b342c  6144   2988
0013  SLEEP    15 ( 15) NTP Client        0x802b1110  8192   388
0014  SLEEP    8  ( 8 ) HTTPD_daemon      0x8026a794  4096   916
0015  SLEEP    8  ( 8 ) HTTPD_proc        0x8026b794  16384  5900
0016  RUN      8  ( 8 ) CLI_thread        0x80292ff0  8192   2688
0017  SLEEP    16 ( 16) upnp_main         0x802cdafc  4096   1020
0018  SLEEP    5  ( 5 ) monitor_thread    0x802675a0  8192   756
0019  SLEEP    10 ( 10) extender_check    0x80262c80  14336  5592
0020  SLEEP    8  ( 8 ) upnp_daemon       0x802a9a5c  8192   820
0021  SLEEP    8  ( 8 ) wsc msg monitor   0x802aeebc  8192   236
0022  SLEEP    8  ( 8 ) wscNLEventHandle  0x802abf6c  8192   584
```

If we take a closer look at the _HTTPD_proc_ thread, we can see that the size of the stack is _16384_ bytes, and it is only utilising _5900_ bytes - thats roughly _10000_ bytes that we may be able to utilise for our payload. Obviously there must be a reason they have allocated this much space for this thread, its usage may largely increase if something like the HTTP admin panel is in use, it could even be something to do with the HTTP firmware update mechanism. Either way, it looks like it may be a good place to investigate further.

### Stack Layout

On the **thread** output, there are three points of interest related to the stack: _StackBase_, _Size_, _usage_. If we read the memory for one of the tasks, in this case the _monitor_ thread, we can understand how the stack operates. The base address of the task stack is _0x802675a0_, and it has a length of _8192_ bytes so lets dump this memory region.

```
802675a0: deadbeefdeadbeefdeadbeefdeadbeef
...       *all deadbeef, unused stack space*
80269290: deadbeefdeadbeefdeadbeefdeadbeef
...       *space being used by stack*
802695f0: 00000000000000015f5354535f574d46
80269600: 4f464e49004e45004c70696b00747369
80269610: 6c610000000000000000000000000000
```

Based on this, it appears that the memory used for the stack is initialised to be _0xdeadbeef_. We can also see that the stack doesn't grow away from the _base address_, it starts at _base address + length_, and grows towards the _base address_. This is useful to know as we ideally don't want to overwrite used stack space as we will likely get a crash.

This indicates that we should start writing our shellcode at the base address of the _HTTPD_proc_ thread, and we shouldn't write too much as we risk colliding with the stack.

## Writing to Addresses that Contain _0x00_

This was a simple problem to solve for addresses that end in _0x00_, the binaries we are uploading shouldn't result in any other byte in the address being _0x00_, so this should be good enough for what we want to do. All we have to do is use a gadget that writes memory to an offset from the provided address, resulting in the target address that contains _0x00_. We can then just detect when we need to use the alternate gadget on the Python side, here is the gadget at address _0x8018c2bc_:

```
-mipsasm
sw $s0, 0x10($s1)
lw $ra, 0xc($sp)
lw $s1, 8($sp)
lw $s0, 4($sp)
jr $ra
addiu $sp, $sp, 0x10
```

The improved shellcode location, and the ability to write to addresses that contains _0x00_ at the end, means we can write much larger shellcodes to the router.

# Executing Functions on a Separate Task

Rather than running a shellcode payload once and jumping back to normal execution in the UPnP task, it would be far better if we could spin up our own task that runs a function we control. This also means we could make some new services that continue running in the background without causing a crash.

## Creating a Thread

To create a thread, we first need to locate the function that creates threads, which has already been done during the earlier reverse engineering of the command line. The function takes a few arguments that we need to put into the correct registers in the shellcode:

| Register | Use                  |
| -------- | -------------------- |
| _a0_     | Priority of the task |
| _a1_     | Thread function      |
| _a2_     | Entry data           |
| _a3_     | Thread name          |
| _t0_     | Stack base           |
| _t1_     | Stack size           |
| _t2_     | Thread handle        |
| _t3_     | Thread itself        |

Obviously thats a lot of parameters we need to understand and construct, surely theres an easier way?

## Hijacking the _cpuload_ Thread

We know that the _cpuload_ thread is sat there completely idle (until you execute the **cpuload** command in the command line). Therefore, its already got constructed structs, and a properly allocated stack of _4096_ bytes. This is perfect for being hijacked and running our code instead.

Taking a look at the function in Ghidra, it is straightforward to workout the addresses that are being used in the function call for configuring the cpuload thread. As the calling convention is weird, Ghidra doesn't understand whats going on past the fourth parameter, hence the parameters do not appear in the decompilation.

Once we have the addresses the thread uses, we can simply call the _create_thread_ function with our own name, and our own function, with the other parameters set to be the discovered memory addresses. You'd expect an error to occur, but as the thread is already suspended, there doesn't appear to be an issue.

## Running our Function

When a thread is created in eCos, it must be resumed before it actually does something. Luckily, this is just another function call with the thread handle. We can put this in our normal payload after the _create_thread_ call.

As a PoC, I created a simple thread with an infinite loop that prints the string 'hello', then sleeps for a second before looping again.

```
-mipsasm
/* our custom function loop */
infinite:
/* printf("hello") */
li $a0, 0x801d3754
li $v0, 0x8019a3a0
jalr $v0
nop
/* sleep(100) */
li $a0, 100
li $v0, 0x8019abac
jalr $v0
nop
b infinite
nop
```

Storing this function at the empty stack space we found earlier and creating a new task to use this function works great and prints 'hello' every second as expected. So now we have our own thread that runs shellcode that we control!

# Building a Toolchain for C Compilation

When you compile some code, it will usually assume you are going to be running the code on the device it was compiled on. However, we aren't going to be compiling our code on a 32-bit MIPS little endian device. We'll need to create a toolchain that can be used to cross-compile our code.

## What is Cross Compilation?

Cross compilation is the process of compiling code on a host system for use on another system. This is exactly what we need to do to get code running.

Cross compilers are heavily used in industries such as embedded systems, as you will rarely be developing and compiling code on the target devices (unless you're using Windows NT in our case - which actually supported the MIPS architecture!).

To allow cross compilation, you will need the correct toolchain.

## What is a Toolchain?

In the context of cross compilation, a toolchain is a collection of software/tools that are configured to work together for the purpose of building software for a target platform or architecture different than that of the host system.

This typically includes:

- _Compiler_: This is the core component of the toolchain, it is responsible for compiling the source code (C in our case) into machine code for the target platform.
- _Assembler_: It converts assembly language code (MIPS assembly in our case) into machine code.
- _Linker_: This tool combines various object files and libraries to create the final executable binary for the target system.
- _Libraries_: These are precompiled collections of code that provide various functionalities and are specific to the target platform.

Pre-built toolchains are typically available for download. The only one I found for MIPS little endian was to be used on a 32-bit Intel processor, which I don't have. Looks like we need to build our own!

![chain_of_tools.jpg](/assets/images/analysing_a_dirt_cheap_router_part_5/chain_of_tools.jpg)

## _Crosstools-ng_

Luckily for us, there are plenty of tools out there for building toolchains. A popular one is _crosstools-ng_, it basically fetches all of the source code/necessary files and builds the toolchain for you - handy!

### Installation

To build the latest version, we can clone the repo from Github and install that way, like so:

```
-console
git clone https://github.com/crosstool-ng/crosstool-ng.git
cd crosstool-ng
sudo apt-get install autoconf help2man gperf bison flex texinfo libtool-bin libncurses5-dev
./bootstrap
./configure --prefix=/opt/crosstool-ng
make
sudo make install
export PATH="/opt/crosstool-ng/bin:$PATH"
```

Now you should have the _crosstool-ng_ binaries in your path.

### Configuring and Building

We can create a new toolchain config with the following command:

```
ct-ng menuconfig
```

This will put you into a menu with lots of options:

![crosstools_menu.png](/assets/images/analysing_a_dirt_cheap_router_part_5/crosstools_menu.png)

We only really need to mess with the _Target Options_ submenu, the defaults work fine for everything else. Here is the _Target Options_ submenu:

![crosstools_target_options.png](/assets/images/analysing_a_dirt_cheap_router_part_5/crosstools_target_options.png)

In this submenu, we need to change the _Target Architecture_ to mips:

![crosstools_target_architecture.png](/assets/images/analysing_a_dirt_cheap_router_part_5/crosstools_target_architecture.png)

This will give the menu some extra options:

![crosstools_mips_menu.png](/assets/images/analysing_a_dirt_cheap_router_part_5/crosstools_mips_menu.png)

We need to make sure we set the _Endianness_ option to little endian:

![crosstools_endianness.png](/assets/images/analysing_a_dirt_cheap_router_part_5/crosstools_endianness.png)

And finally, set the _Bitness_ to 32-bit:

![crosstools_bitness.png](/assets/images/analysing_a_dirt_cheap_router_part_5/crosstools_bitness.png)

Now you can exit back to the main menu, if you then exit again you should get a prompt to save the config - select _Yes_ and press enter.

Now that we have configured the toolchain config, we can simply run **ct-ng build** to build the toolchain (it takes a little while to build)!

![15_minutes_later.jpg](/assets/images/analysing_a_dirt_cheap_router_part_5/15_minutes_later.jpg)

Once the build has completed, if you didn't deviate from the defaults, you should now have a directory called **~/x-tools/mips-unknown-elf/bin** which will contain all the toolchain goodness, including the compiler and objdump which we will need.

To add this to the path, add the following command to your **~/.bashrc** file:

```
-console
export PATH="~/x-tools/mipsel-unknown-elf/bin:$PATH"
```

You will now be fully set up to compile some binaries for the router!

# Getting C to Run

Now that we have a cross compiler for the target architecture, there are a couple more things we need to do to create compiled code that will successfully execute on the router.

![running_c.jpg](/assets/images/analysing_a_dirt_cheap_router_part_5/running_c.jpg)

## Calling Router Functions

As there is no ASLR or any movement in the memory addresses of functions, we can just slap in the addresses of functions. We can define things like _printf_, _sprintf_, _sleep_, _socket_, _send_, _recv_, etc. We just need to make sure we specify the correct arguments for the functions when we construct them.

## The Setup

To create code that we can simply jump to, we need to create a few files.

### _linker.ld_

When we compile C, we need to let it know where exactly it is by providing a base address. Otherwise it will get very confused and completely mess up the payload.

We can do this by constructing our own Linker script with the address of the custom function in the stack, this way the compiler will be able to construct the code such that it runs in the location we put it.

```
-ld
OUTPUT_ARCH(mips:isa32r2)

__base = 0x8026b870;

ENTRY(_start)

PHDRS {
    start_seg PT_LOAD FLAGS(7);
}

SECTIONS {
    . = __base;
    __self_start = .;

    .start : { *(.start) } :start_seg = 0

    . = ALIGN(32);
    .text : {
        *(.text)
        *(.text.*)
    }
    .rodata : {
        *(.rodata)
        *(.rodata.*)
    }
    .data : {
        *(.data)
        *(.data.*)
        *(.sdata)
        *(.sdata.*)
    }
    .bss : {
        *(.sbss)
        *(.sbss.*)
        *(COMMON)
        *(.bss)
        *(.bss.*)
        LONG(0)
    }
}
```

### _Init.S_

I also constructed a simple _Init.S_ assembly file, which allows us to execute MIPS instructions before we jump to our payload. This is useful for stuff like register preservation, or fixing the stack after execution. Assembly can provide much more granular control.

```
-mipsasm
.text
.section .start,"ax",@progbits
.align 1
.global _start
.type   _start, @function

.extern PayloadEntry

_start:
    # Jump to entry
    jal PayloadEntry
    nop

    # Return
    jr $ra
    nop

    .align 2
```

As we are hijacking the _cpuload_ stack, we needn't worry about register restoration and fixing up the stack. We can just slap an infinite while loop at the end of the payload, or just put **PayloadEntry** in a loop and keep restarting. At the moment, we simply import the **PayloadEntry** code from the C file, and jump to it.

### payload.c

This payload simply prints the string 'Hello' every second to the command line:

```
-c
typedef int uint32_t;
typedef short uint16_t;
typedef char uint8_t;

int PayloadEntry();

#define printf(format, ...) \
do { \
    typedef void (*PrintfFunc)(const char*, ...); \
    PrintfFunc func = (PrintfFunc)0x8019a3a0; \
    func(format, ##__VA_ARGS__); \
} while(0)

#define sleep(centiseconds) \
do { \
    typedef void (*SleepFunc)(uint32_t); \
    SleepFunc func = (SleepFunc)0x8019abac; \
    func(centiseconds); \
} while(0)

int PayloadEntry()
{
    while(1){
        printf("Hello\r\n");
        sleep(100);
    }
    return 0;
}

```

You can see the constructed macros for the **printf** and **sleep** functions.

## Putting it Together

We can compile our code with the following command, this creates an ELF. All of the options are there to specify our linker script, and also reduce the size of the binary as much as possible.

```
mipsel-unknown-elf-gcc payload.c Init.S -nostdlib -Wl,-T,Linker.ld -o payload.elf -Os -ffunction-sections -fdata-sections -Wl,--gc-sections -s
```

We can then extract the binary section we want using _objcopy_ and the following command:

```
mipsel-unknown-elf-objcopy -O binary payload.elf payload.bin
```

# Making a Fun Payload

With the thread functions we used in our assembly earlier, and our toolchain for cross compiling code built, we can move on to creating an interesting payload!

## Payload Plan

I had a think about something that just makes no sense to be running on a router, but also works and is entertaining. I settled for some sort of game with some sort of central entity that players connect to and can interact with.

I decided it would be funny to implement the card game Blackjack:

- The router acts as the blackjack dealer, and is responsible for player connections and the game logic.
- Players connect on the LAN using netcat, as it is a router, sockets shouldn't be a problem!
- It's a pretty simple game, so the size of the payload shouldn't be too large, and it should fit in the extra space we discovered earlier.

## How it works

- Game creates a TCP socket and waits for any incoming connections
- When the first player joins, they are prompted for the total number of players
- The game will keep accepting connections until the expected amount of players has joined
- Once all players are in, each player is allowed to place their bet for the round
- With all bets in, the Blackjack round begins and is played as per standard blackjack rules
- At the end of the round, players total funds are updated, and the next round begins!

## Example Game from Player 1 Perspective

It's probably safe to assume if you are reading this you aren't going to go and buy a router to play Blackjack on it, so here is an example game from player 1's perspective:

```

   ___  __         __     _          __
  / _ )/ /__ _____/ /__  (_)__ _____/ /__
 / _  / / _ `/ __/  '_/ / / _ `/ __/  '_/
/____/_/\_,_/\__/_/\_\_/ /\_,_/\__/_/\_\
                    |___/

Welcome player 1!
Enter player count (including yourself)
> 3

Waiting for 2 other players to join...
Game starting!


As it stands:
- Player 1 has $250
- Player 2 has $250
- Player 3 has $250

Place your bet player 1...
> 10
Player 1 has bet $10

Player 2 is placing their bet
Player 2 has bet $10

Player 3 is placing their bet
Player 3 has bet $10

Player 1 cards:
 _______   _______
|Q _ _  | |J  ^   |
| ( v ) | |  / \  |
|  \ /  | |  \ /  |
|   .   | |   .   |
|______Q| |______J|

Player 2 cards:
 _______   _______
|7  ^   | |3 _ _  |
|  / \  | | ( v ) |
|  \ /  | |  \ /  |
|   .   | |   .   |
|______7| |______3|

Player 3 cards:
 _______   _______
|10 ^   | |A _ _  |
|  / \  | | ( v ) |
|  \ /  | |  \ /  |
|   .   | |   .   |
|_____10| |______A|

Player 3 has blackjack!

Dealers card:
 _______
|K  .   |
|  /.\  |
| (_._) |
|   |   |
|______K|

Player 1's move, current hand:
 _______   _______
|Q _ _  | |J  ^   |
| ( v ) | |  / \  |
|  \ /  | |  \ /  |
|   .   | |   .   |
|______Q| |______J|

Stick or twist?
> s

Player 1 chose to stick

Player 1 final score: 20

Player 2's move, current hand:
 _______   _______
|7  ^   | |3 _ _  |
|  / \  | | ( v ) |
|  \ /  | |  \ /  |
|   .   | |   .   |
|______7| |______3|

Player 2's chose to twist, current hand:
 _______   _______   _______
|7  ^   | |3 _ _  | |8  .   |
|  / \  | | ( v ) | |  /.\  |
|  \ /  | |  \ /  | | (_._) |
|   .   | |   .   | |   |   |
|______7| |______3| |______8|

Player 2 chose to stick

Player 2 final score: 18

All players done...

The dealers full hand is:
 _______   _______
|K  .   | |3  .   |
|  /.\  | |  /.\  |
| (_._) | | (_._) |
|   |   | |   |   |
|______K| |______3|

Dealer is twisting

Dealers current hand:
 _______   _______   _______
|K  .   | |3  .   | |A  .   |
|  /.\  | |  /.\  | |  /.\  |
| (_._) | | (_._) | | (_._) |
|   |   | |   |   | |   |   |
|______K| |______3| |______A|

Dealer is twisting

Dealers current hand:
 _______   _______   _______   _______
|K  .   | |3  .   | |A  .   | |J _ _  |
|  /.\  | |  /.\  | |  /.\  | | ( v ) |
| (_._) | | (_._) | | (_._) | |  \ /  |
|   |   | |   |   | |   |   | |   .   |
|______K| |______3| |______A| |______J|

Dealer is bust!

You won $10!

```

The final size of this payload is about _6000_ bytes. It seems to work most of the time without issues (provided the cache flush delay is proportional to the payload size - thanks Oscar for pointing that one out).

# Conclusion

So we managed to get C compiled and running on the router! This means it is much easier to write interesting payloads without losing brain cells debugging assembly.

To summarise, we can now write to addresses ending in _0x00_, we spent some time making a more complex payload as a PoC, and learned about toolchains and cross compilers, and finally implemented a blackjack server on the router. It's impressive how much you can learn from messing with a < £10 router!

I hope you enjoyed this blog, the [usual github repo](https://github.com/luke-r-m/Chaneve-Router-Analysis) has been updated with the files described earlier.
