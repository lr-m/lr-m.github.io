---
published: true
title: "🎥 [1] Learning the Cameras Language"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Reverse Engineering
  - Cryptography
  - Protocol Analysis
tagline: "In the previous blog, we got our hands on some firmware, and extracted a large App file. In this blog, we will use this and the iCSee application, as well as app captures, to reverse the communication protocol for port 34567."
excerpt: "We've done our enumeration, now we need to learn how to communicate."
windowGradientStart: rgb(59, 59, 59)
windowGradientEnd: rgb(22, 22, 22)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(255, 255, 255)
maximizeButton: rgb(0, 0, 255)
closeButton: rgb(255, 0, 0)
---

# Reversing Communications

Lets get started on reversing these packets. It is worth noting that I always used the *Guest Login* feature to access the camera, and I never created an account to use with it.

## App Capture Analysis

We will start with the app captures we took and see if this shines any light on the packet format. The first message is sent from the app to the camera, and looks like this:

- *Header bytes:*
```
ff 01 00 00 9f 86 01 00 a8 02 00 00 63 00 85 05 aa 00 00 00 
```

- *JSON data:*
```
-json
{
  "Name": "OPMonitor",
  "OPMonitor": {
    "Action": "Claim",
    "Parameter": {
      "Channel": 0,
      "CombinMode": "CONNECT_ALL",
      "StreamType": "Main",
      "TransMode": "TCP"
    }
  },
  "SessionID": "0x000001869f"
}
```

The response from the camera is encrypted and base64 encoded so this isn't of any use.

![encrypted_response.png](/assets/images/video_call_camera_p2/encrypted_response.png)

The only other plaintext packet is sent from the app to the camera quite early on:

- *Header bytes:*
```
ff 01 00 00 10 00 00 00 b0 02 00 00 00 00 e9 03 80 00 00 00
```

- *JSON data:*
```
-json
{
  "AliveInterval": 30,
  "ChannelNum": 1,
  "DeviceType ": "IPC",
  "ExtraChannel": 0,
  "Ret": 100,
  "SessionID": "0x00000010"
}
```

It isn't much, but it should be enough to locate the handlers in the firmware.

## Finding Handlers

After stumbling around the code for a bit, the *TransMode* parameter led me to the below function:

```
-c
void parse_34567_msg(undefined4 param_1,astruct_7 *param_2,undefined4 param_3)
{
  undefined4 uVar1;
  int iVar2;
  char *pcVar3;
  basic_string.conflict abStack_2c [24];
  undefined4 *local_14;
  
  local_14 = &__stack_chk_guard;
  resolveReference(param_1,"Action");
  uVar1 = asCString();
  uVar1 = strcmp_wrapper_ting(&action_id_name_pair_struct_00618420,uVar1);
  param_2->action = uVar1;
  iVar2 = resolveReference(param_1,"Parameter");
  resolveReference(iVar2,"TransMode");
  uVar1 = asCString();
  uVar1 = strcmp_wrapper_ting(&action_id_name_pair_struct_006184a0,uVar1);
  param_2->transmode = uVar1;
  iVar2 = resolveReference(param_1,"Parameter");
  resolveReference(iVar2,"PlayMode");
  uVar1 = asCString();
  uVar1 = strcmp_wrapper_ting(&PTR_s_ByName_00618408,uVar1);
  *(undefined4 *)&(param_2->filename).field_0x58 = uVar1;
  iVar2 = resolveReference(param_1,"Parameter");
  resolveReference(iVar2,"Value");
  uVar1 = asInt();
  *(undefined4 *)&(param_2->filename).field_0x5c = uVar1;
  iVar2 = resolveReference(param_1,"Parameter");
  iVar2 = resolveReference(iVar2,"FileName");
  asString((char *)abStack_2c,iVar2);
  std::__cxx11::basic_string<>::operator=(&param_2->filename,abStack_2c);
  std::__cxx11::basic_string<>::_M_dispose();
  resolveReference(param_1,"StartTime");
  pcVar3 = (char *)asCString();
  sscanf(pcVar3,"%04d-%02d-%02d %02d:%02d:%02d",&(param_2->filename).field_0x18,
         &(param_2->filename).field_0x1c,&(param_2->filename).field_0x20,
         &(param_2->filename).field_0x28,&(param_2->filename).field_0x2c,
         &(param_2->filename).field_0x30);
  resolveReference(param_1,"EndTime");
  pcVar3 = (char *)asCString();
  sscanf(pcVar3,"%04d-%02d-%02d %02d:%02d:%02d",&(param_2->filename).field_0x38,
         &(param_2->filename).field_0x3c,&(param_2->filename).field_0x40,
         &(param_2->filename).field72_0x48,&(param_2->filename).field_0x4c,
         &(param_2->filename).field_0x50);
  iVar2 = resolveReference(param_1,"Parameter");
  resolveReference(iVar2,"StreamType");
  uVar1 = asInt();
  *(undefined4 *)&(param_2->filename).field_0x60 = uVar1;
  if (local_14 != &__stack_chk_guard) {
                    /* WARNING: Subroutine does not return */
    __stack_chk_fail();
  }
  return;
}
```

It is a bit grim (thanks C++) but you can see it parsing the JSON payload and extracting parameters from the sent message, so this is a good start. I don't think this is the exact handler, but it got me on the right lines.

With this hint, I eventually came across a huge function that seems to handle every message type going. There are a set of *operators*, each one handling a few related messages. 

![operator_comment.png](/assets/images/video_call_camera_p2/operator_comment.png)

There is a big *if* statement at the top of the function that picks the operator for the message, then it branches to the associated function (this is probably a *switch* statement in the source code).

To find the functions that are responsible for handling the messages, I basically did this for each of the subfunctions:

1. Pick a function that you wish to find the handler for

![1_function_call.png](/assets/images/video_call_camera_p2/1_function_call.png)

2. The function will set **param_1** to be a pointer to a list of functions

![2_pointer_set.png](/assets/images/video_call_camera_p2/2_pointer_set.png)

3. Give the third function in the list a catchy name as this is the function that does the handling

![handler_call.png](/assets/images/video_call_camera_p2/handler_call.png)

![3_function_list.png](/assets/images/video_call_camera_p2/3_function_list.png)

Repeat this for all of the subfunctions and you get a complete list of the handlers!

## Bye Bye AES Encryption

We saw in the captures that the camera responses were encrypted, so I started looking around for some code related to encryption. I ended up finding some AES encrypt/decrypt functions that were being used in a subfunction of one of the handlers, and I spotted this snippet:

![encryption_snippet.png](/assets/images/video_call_camera_p2/encryption_snippet.png)

You can see at the top of the snippet the **param_2->encrypted** value being checked, and if its value is *0x63* (like it is in the first plaintext message I looked at in the app captures section) it will enter this decryption routine - so what happens if we send a message where this is not *0x63* and the routine is skipped?

Here is the message I sent:

```
00000000  ff 01 00 00 9f 86 01 00 01 00 00 00 00 00 85 05   |................|
00000010  b8 00 00 00 7b 22 4e 61 6d 65 22 3a 20 22 4f 50   |....{"Name": "OP|
00000020  4d 6f 6e 69 74 6f 72 22 2c 20 22 4f 50 4d 6f 6e   |Monitor", "OPMon|
00000030  69 74 6f 72 22 3a 20 7b 22 41 63 74 69 6f 6e 22   |itor": {"Action"|
00000040  3a 20 22 43 6c 61 69 6d 22 2c 20 22 50 61 72 61   |: "Claim", "Para|
00000050  6d 65 74 65 72 22 3a 20 7b 22 43 68 61 6e 6e 65   |meter": {"Channe|
00000060  6c 22 3a 20 30 2c 20 22 43 6f 6d 62 69 6e 4d 6f   |l": 0, "CombinMo|
00000070  64 65 22 3a 20 22 43 4f 4e 4e 45 43 54 5f 41 4c   |de": "CONNECT_AL|
00000080  4c 22 2c 20 22 53 74 72 65 61 6d 54 79 70 65 22   |L", "StreamType"|
00000090  3a 20 22 4d 61 69 6e 22 2c 20 22 54 72 61 6e 73   |: "Main", "Trans|
000000a0  4d 6f 64 65 22 3a 20 22 54 43 50 22 7d 7d 2c 20   |Mode": "TCP"}}, |
000000b0  22 53 65 73 73 69 6f 6e 49 44 22 3a 20 22 30 78   |"SessionID": "0x|
000000c0  30 30 30 30 30 30 30 30 30 31 22 7d               |0000000001"}    |
```

And here is the response I get:

```
00000000  ff 01 00 00 9f 86 01 00 01 00 00 00 00 00 86 05   |................|
00000010  ce 02 00 00 7b 20 22 42 69 74 73 22 20 3a 20 31   |....{ "Bits" : 1|
00000020  30 32 34 2c 20 22 44 61 74 61 45 6e 63 72 79 70   |024, "DataEncryp|
00000030  74 69 6f 6e 54 79 70 65 22 20 3a 20 7b 20 22 41   |tionType" : { "A|
00000040  45 53 22 20 3a 20 74 72 75 65 2c 20 22 41 45 53   |ES" : true, "AES|
00000050  56 32 22 20 3a 20 74 72 75 65 2c 20 22 56 45 4b   |V2" : true, "VEK|
00000060  45 59 31 22 20 3a 20 74 72 75 65 20 7d 2c 20 22   |EY1" : true }, "|
00000070  45 6e 63 72 79 70 74 41 6c 67 6f 22 20 3a 20 22   |EncryptAlgo" : "|
00000080  52 53 41 5f 56 31 2e 35 22 2c 20 22 4c 6f 67 69   |RSA_V1.5", "Logi|
00000090  6e 45 6e 63 72 79 70 74 69 6f 6e 54 79 70 65 22   |nEncryptionType"|
000000a0  20 3a 20 7b 20 22 4d 44 35 22 20 3a 20 74 72 75   | : { "MD5" : tru|
000000b0  65 2c 20 22 4e 4f 4e 45 22 20 3a 20 74 72 75 65   |e, "NONE" : true|
000000c0  2c 20 22 52 53 41 22 20 3a 20 74 72 75 65 2c 20   |, "RSA" : true, |
000000d0  22 54 4f 4b 45 4e 22 20 3a 20 74 72 75 65 20 7d   |"TOKEN" : true }|
000000e0  2c 20 22 4e 6f 74 45 6e 63 72 79 70 74 4d 73 67   |, "NotEncryptMsg|
000000f0  49 44 22 20 3a 20 5b 20 31 30 30 30 2c 20 31 30   |ID" : [ 1000, 10|
00000100  30 31 2c 20 31 30 30 38 2c 20 31 30 30 39 2c 20   |01, 1008, 1009, |
00000110  31 30 31 30 2c 20 31 30 31 31 2c 20 31 30 35 30   |1010, 1011, 1050|
00000120  2c 20 31 30 35 34 2c 20 31 34 31 32 2c 20 31 34   |, 1054, 1412, 14|
00000130  31 33 2c 20 31 34 31 34 2c 20 31 34 32 32 2c 20   |13, 1414, 1422, |
00000140  31 34 32 34 2c 20 31 34 32 35 2c 20 31 34 32 36   |1424, 1425, 1426|
00000150  2c 20 31 34 33 32 2c 20 31 34 33 33 2c 20 31 34   |, 1432, 1433, 14|
00000160  33 34 2c 20 31 34 33 35 2c 20 31 34 34 39 2c 20   |34, 1435, 1449, |
00000170  31 35 32 32 2c 20 31 35 37 32 2c 20 31 35 37 36   |1522, 1572, 1576|
00000180  2c 20 31 35 38 30 2c 20 31 35 38 32 2c 20 31 36   |, 1580, 1582, 16|
00000190  34 35 2c 20 32 30 36 32 2c 20 32 30 36 33 2c 20   |45, 2062, 2063, |
000001a0  32 31 32 33 2c 20 32 31 34 30 2c 20 33 30 31 36   |2123, 2140, 3016|
000001b0  2c 20 33 35 30 32 20 5d 2c 20 22 50 75 62 6c 69   |, 3502 ], "Publi|
000001c0  63 4b 65 79 22 20 3a 20 22 38 39 44 38 46 46 38   |cKey" : "89D8FF8|
000001d0  44 36 42 45 31 31 33 34 45 39 32 46 43 35 33 36   |D6BE1134E92FC536|
000001e0  32 46 31 34 31 30 42 37 32 36 36 32 37 38 39 38   |2F1410B726627898|
000001f0  38 45 33 34 34 42 36 36 43 36 39 34 42 31 38 35   |8E344B66C694B185|
00000200  36 46 42 36 44 33 42 32 32 34 32 45 37 45 32 44   |6FB6D3B2242E7E2D|
00000210  37 31 31 45 32 30 46 45 36 46 39 39 38 33 43 31   |711E20FE6F9983C1|
00000220  42 38 37 36 30 43 36 45 39 39 38 32 35 37 35 30   |B8760C6E99825750|
00000230  35 39 39 44 37 37 41 39 46 34 35 43 42 37 37 44   |599D77A9F45CB77D|
00000240  46 36 33 31 39 37 41 31 30 35 44 36 32 44 45 39   |F63197A105D62DE9|
00000250  44 36 30 44 38 41 35 42 31 39 31 42 38 41 41 31   |D60D8A5B191B8AA1|
00000260  38 42 44 45 41 45 36 42 37 32 34 44 39 39 39 43   |8BDEAE6B724D999C|
00000270  39 46 44 42 42 39 36 45 35 43 31 34 31 32 36 35   |9FDBB96E5C141265|
00000280  45 41 38 35 43 42 38 42 37 39 32 33 33 32 45 43   |EA85CB8B792332EC|
00000290  41 39 35 38 33 30 34 37 32 44 46 31 30 30 44 45   |A95830472DF100DE|
000002a0  42 37 44 41 31 33 46 46 41 32 42 42 46 36 30 30   |B7DA13FFA2BBF600|
000002b0  41 38 36 31 33 30 34 33 37 35 31 31 37 45 32 37   |A861304375117E27|
000002c0  42 35 39 45 33 44 39 34 33 2c 30 31 30 30 30 31   |B59E3D943,010001|
000002d0  22 2c 20 22 52 65 74 22 20 3a 20 31 30 30 20 7d   |", "Ret" : 100 }|
000002e0  0a 00                                             |..              |
```

That looks plaintext to me! Lets tidy up that JSON:

```
{
  "Bits": 1024,
  "DataEncryptionType": {
    "AES": true,
    "AESV2": true,
    "VEKEY1": true
  },
  "EncryptAlgo": "RSA_V1.5",
  "LoginEncryptionType": {
    "MD5": true,
    "NONE": true,
    "RSA": true,
    "TOKEN": true
  },
  "NotEncryptMsgID": [
    1000,
    1001,
    1008,
    1009,
    1010,
    1011,
    1050,
    1054,
    1412,
    1413,
    1414,
    1422,
    1424,
    1425,
    1426,
    1432,
    1433,
    1434,
    1435,
    1449,
    1522,
    1572,
    1576,
    1580,
    1582,
    1645,
    2062,
    2063,
    2123,
    2140,
    3016,
    3502
  ],
  "PublicKey": "89D8FF8D6BE1134E92FC5362F1410B7266278988E344B66C694B1856FB6D3B2242E7E2D711E20FE6F9983C1B8760C6E99825750599D77A9F45CB77DF63197A105D62DE9D60D8A5B191B8AA18BDEAE6B724D999C9FDBB96E5C141265EA85CB8B792332ECA95830472DF100DEB7DA13FFA2BBF600A861304375117E27B59E3D943,010001",
  "Ret": 100
}
```

So it looks like we are going to need RSA at some point, as the *EncryptAlgo* parameter is *RSA_V1.5* and we are provided with a public key.

It is also worth noting the list of message ID's - it seems like this should be *NotLoginMsgID* as it looks like these messages cannot be accessed without logging in.

## Reversing the Header

At some point we will have to move on from simply replaying modified app messages, so now that we have a few message samples, we can make some progress on reversing the header values.

Looking at one of the encrypted responses, it is clear that the header is *0x14* bytes. By looking at the captures and the header parsing logic, I reversed out this information:

| Size | Purpose |
| - | - | 
| 0x4 | Fixed header (0xff 0x01 0x00 0x00) |
| 0x4 | Session ID |
| 0x4 | Sequence Number |
| 0x2 | Unknown |
| 0x2 | Message Type |
| 0x4 | Payload Size |

With this knowledge, we can easily create message headers in Python for our own messages:

```
-python
header = struct.pack(
  '<4sIIhhI',
  fixed_header,      # Fixed 4 bytes
  session_id,        # Session ID (4 bytes)
  sequence_number,   # Sequence number (4 bytes)
  0x0000,            # Unknown field (2 bytes)
  0x3e8,             # Message ID (2 bytes)
  payload_size       # Payload size (4 bytes)
)
```

# Logging In

I spent some time messing with some of the accessible messages, but I'd like to be able to poke every single handler, so I will need to reverse the login process.

## Login Message Parser

I assumed that the login message would be one of the first messages sent to the camera, and it will also be in the list of available messages before login that the camera responded with. Message type *0x3e8* seems to fit the part as it is the second message sent to the camera, and it is in the list.

I found the handler and started reversing the payload:

![login_handler.png](/assets/images/video_call_camera_p2/login_handler.png)

At the start of the handler, it has the encryption check I mentioned earlier, so we can just change that byte to something that isn't *0x63*, which allows us to send a plaintext payload.

The payload contains the following parameters:
- EncryptType
- LoginType
- PassWord
- UserName
- CommunicateKey

![login_parameters.png](/assets/images/video_call_camera_p2/login_parameters.png)

The *UserName* and *PassWord* parameters are decrypted using RSA 1.5 which makes sense, it looks like this is what the public key we are sent is used for. I wrote some Python code to extract the modulus and exponent, and used this to encrypt a provided username/password for our own login messages.

The code provides useful error codes, allowing me to see where my payload was going wrong. After some more reversing to get the required parameters (and some trial and error) I eventually got to the *incorrect credentials* error code.

Here is the payload I sent with the login message:

```
-json
JSON Payload:
{
  "EncryptType": "MD5",
  "LoginType": "DVRIP-NVR",
  "UserName": "4FB1A9EC8CF11C7D1D3F185DDA4C38740876D068E1AAE16BABAF14118832F35744E5C24A8243ABCC879F8CFF5AC085CB04764787D87BFE3B69987AF62BEFB22E459219E8ED2F35FAD870EC60037CCC07AEC580DF7F6BEFE11B8CDFBC664F6CC90CFAB53A34FD7E8C7BA8DB6235EF8E409BBF8FCACF6835AD28FBB72233072EC0",
  "PassWord": "787CE4485A26CC628584589728281081193E52B0465EF116EA3ABCEB7AF0B48AC442C39F61E2995FE99942BA8D4274AAD40FBCE2BE5DD235F480C706BAF29561772E065D17CF2052D5325042E028AF61A6B53EE4E5CF552887C2E282D28F95417BE166B4E7EE6C389AE063D159964902F312011EA8A1046CA0EF16583744F284"
}
```

And here is the failed login response:

```
-json
=== PARSED LOGIN RESPONSE ===
Header Information:
Fixed Header: 0xff 01 00 00
Session ID: 0x0001869f
Sequence Number: 0x00000002
Unknown Field: 0x0000
Message ID: 0x03e9
Payload Size: 58
Header Size: 20

Decoded JSON Payload:
{
  "Name": "",
  "Ret": 205,
  "SessionID": "0x0001869f"
}
```

I had a poke around the extracted firmware to see if there were any obvious username/password pairs in the config files, and I did find this in the *7D0458* *jffs2* filesystem:

```
-json
{
  "User" : [ 
    { 
      "Name" : "yawh", 
      "Password" : "", 
      "PasswordV2" : "1D5/TelmcxdCgTn/dMLp1A=="
    }
  ]
}
```

I assume the *PasswordV2* parameter is a base64 encoded hash of the password, at this point I turned to the app to see if we could find the answer there. 

## Finding Credentials in iCSee Application

I downloaded the app from *ApkPure*, opened it in *Jadx*, and had a browse. Eventually I discovered that most of the functionality to do with the camera is in **LibFunSDK.so**, a shared object used by the app. Pretty much all of the cheap IoT apps are just a bunch of shared objects stitched together with some Java code to make it look pretty.

Anyway, I loaded this shared object into *Ghidra* and started hunting for RSA related code. It didn't take long to find a function handily called **RSAV15**, which was used by a function called **NewLoginPTL** - this sound like what we need.

Now it is just a matter of attaching *frida*, and seeing what is given to this function to encrypt, hopefully giving us the username/password used for the guest login.

## Attaching Frida and Extracting Credentials

I figured this would be a straight forward job, but unfortunately they decided to add anti-*frida* checks on the latest version of the app (*7.4.2* at the time of writing). However, there is a pretty easy way around this, just use an older version that still works with the camera that doesn't have these checks.

I decided to go back to the latest release of the latest major version (*6.9.8*) and tested this version to see if the camera still functioned. It all functioned fine except the video call feature which doesn't seem to be present on this version of the app.

I was then able to use *frida* on this version of the app, and wrote this script to hook the **RSAV15** function in the **libFunSDK.so** shared object:

```
-javascript
const ghidraImageBase = 0x100000;
const moduleName = "libFunSDK.so";
const moduleBaseAddress = Module.findBaseAddress(moduleName);
const functionRealAddress = moduleBaseAddress.add(0x4ffc70 - ghidraImageBase);

Interceptor.attach(functionRealAddress, {
    onEnter: function (args) {
        console.log("=== RSAV15 Arguments ===");
        
        // param_1 (char* - output buffer)
        console.log("param_1 (char* output):", args[0]);
        
        // param_2 (int - buffer size)
        this.bufferSize = args[1].toInt32();
        console.log("param_2 (buffer size):", this.bufferSize);
        
        // param_3 (SZString*)
        console.log("param_3 (SZString*):", args[2]);
        if (!args[2].isNull()) {
            const stringData = args[2].add(8).readPointer();
            if (!stringData.isNull()) {
                console.log("param_3 string content:", stringData.readUtf8String());
            }
        }
        
        // param_4 (CXJson*)
        console.log("param_4 (CXJson*):", args[3]);
        
        // param_5 (void* - input data)
        console.log("param_5 (void* input):", args[4]);
        if (!args[4].isNull()) {
            // Try to read as string first
            console.log("param_5 as string:", args[4].readUtf8String());
            console.log("param_5 hexdump:");
            console.log(hexdump(args[4], { length: args[5].toInt32() }));  // Only dump the actual input length
        }
        
        // param_6 (int - input length)
        console.log("param_6 (input length):", args[5].toInt32());
        
        // Store buffer for onLeave
        this.outputBuffer = args[0];
    },
    onLeave: function(retval) {
        console.log("=== RSAV15 Result ===");
        console.log("Return value:", retval);
    }
});
```

And here is the output:

```
     ____
    / _  |   Frida 16.5.6 - A world-class dynamic instrumentation toolkit
   | (_| |
    > _  |   Commands:
   /_/ |_|       help      -> Displays the help system
   . . . .       object?   -> Display information about 'object'
   . . . .       exit/quit -> Exit
   . . . .
   . . . .   More info at https://frida.re/docs/home/
   . . . .
   . . . .   Connected to RG353P (id=39630918ec970e07)
                                                                                
[RG353P::iCSee ]-> === RSAV15 Arguments ===
param_1 (char* output): 0x72302a4598
param_2 (buffer size): 512
param_3 (SZString*): 0x72302a4468
param_3 string content: MD5
param_4 (CXJson*): 0x72302a4498
param_5 (void* input): 0xb40000720534b000
param_5 as string: yawh
param_5 hexdump:
                   0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F  0123456789ABCDEF
b40000720534b000  79 61 77 68                                      yawh
param_6 (input length): 4

=== RSAV15 Arguments ===
param_1 (char* output): 0xb4000071e916e200
param_2 (buffer size): 512
param_3 (SZString*): 0x72302a4468
param_3 string content: MD5
param_4 (CXJson*): 0x72302a4498
param_5 (void* input): 0x72302a4558
param_5 as string: mLxvAtwn
param_5 hexdump:
             0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F  0123456789ABCDEF
72302a4558  6d 4c 78 76 41 74 77 6e                          mLxvAtwn
```

As you can see, there are two strings that are encrypted with this function - the username we came across earlier, and what I presume to be a password: *mLxvAtwn*.

So, if we use the following credentials, we should get a successful login:

| Username | Password |
| - | - |
| yawh | mLxvAtwn |

## Successfully Logging In

Lets create a packet to login to the device and see what happens:

```
-json
=== PARSED LOGIN RESPONSE ===
Header Information:
Fixed Header: 0xff 01 00 00
Session ID: 0x00000008
Sequence Number: 0x00000002
Unknown Field: 0x0000
Message ID: 0x03e9
Payload Size: 191
Header Size: 20

Decoded JSON Payload:
{
  "AdminToken": "dSFv3QUWC2MEY+QLybbMHO3nVrluqonIy2WFJpJBGBY=",
  "AliveInterval": 30,
  "ChannelNum": 1,
  "DeviceType ": "IPC",
  "ExtraChannel": 0,
  "Ret": 100,
  "SessionID": "0x00000008"
}
```

That is more like it!

Now that we have logged in, we can access all of the message types now instead of the small subset that were available before. As an example, here is a response of a message that gets a bunch of system information:

```
-json
=== PARSED SYSTEM INFO RESPONSE ===
Header Information:
Fixed Header: 0xff 01 00 00
Session ID: 0x0001869f
Sequence Number: 0x00000003
Unknown Field: 0x0000
Message ID: 0x03fd
Payload Size: 710
Header Size: 20

Decoded JSON Payload:
{
  "Name": "SystemInfo",
  "Ret": 100,
  "SessionID": "0x0001869f",
  "SystemInfo": {
    "AlarmInChannel": 0,
    "AlarmOutChannel": 0,
    "AudioInChannel": 1,
    "BuildTime": "2024-06-27 10:33:41",
    "CombineSwitch": 0,
    "DeviceModel": "IPC_GK7201V300_G2-WR-V_S38",
    "DeviceRunTime": "0x0000132e",
    "DeviceType": 7,
    "DigChannel": 0,
    "EncryptVersion": "Unknown",
    "ExtraChannel": 0,
    "HardWare": "IPC_GK7201V300_G2-WR-V_S38",
    "HardWareVersion": "Unknown",
    "Pid": "A909409U5000000N",
    "SerialNo": "bf7816d59506ec06",
    "SoftWareVersion": "V5.00.R02.000949U5.10000.141324.0000010",
    "TalkInChannel": 1,
    "TalkOutChannel": 1,
    "UpdataTime": "",
    "UpdataType": "0x00000000",
    "VideoInChannel": 1,
    "VideoOutChannel": 1
  }
}
```

## Hmmmm, That's Strange

After I had logged in using the extracted credentials, I was looking around the settings and noticed the following:

![user_pass_in_app.jpg](/assets/images/video_call_camera_p2/user_pass_in_app.jpg)

The username we extracted matches, but the password is different?

![confused_tom.png](/assets/images/video_call_camera_p2/confused_tom.png)

### Weird Password Encoding

After poking around the **NewLoginPTL** which constructs the login payload in **libFunSDK.so**, I found a function called **EncDevPassord** (not a typo):

![enc_dev_password.png](/assets/images/video_call_camera_p2/enc_dev_password.png)

This function ends up calling **XMMD5Encrypt**:

![XMMD5Encrypt.png](/assets/images/video_call_camera_p2/XMMD5Encrypt.png)

Long story short, this function MD5's the input, then does some rearranging. I'm not entirely sure in what world this is more secure than ordinary MD5, security by obscurity I guess. Here is a Python function that does the same thing:

```
-python
def xm_md5_encrypt(input_bytes: bytes) -> bytes:
    if not input_bytes:
        input_bytes = b""
    
    # Calculate MD5 hash of input
    md5_hash = hashlib.md5(input_bytes).digest()
    
    # Generate output bytes using pairs of bytes
    output = bytearray(8)
    for i in range(8):
        # Add pair of bytes and take modulo 62
        val = (md5_hash[i*2] + md5_hash[i*2 + 1]) % 62
        
        # Map to output byte
        if val < 10:
            # 0-9
            output[i] = ord('0') + val
        elif val < 36:
            # A-Z
            output[i] = ord('7') + val
        else:
            # Other characters
            output[i] = ord('=') + val
    
    return bytes(output)
```

If you give the function the password we see in the app, *mw5r5t*, the output of the function is *mLxvAtwn* - mystery solved!

# Conclusion

In this blog, we reverse engineered the cameras login process using the binary we extracted from the chip dump, and the *iCSee* application that the camera works with. In the next blog, we can start looking at this newly expanded attack surface for some bugs!

![mii_need_0_days.png](/assets/images/video_call_camera_p2/mii_need_0_days.png)
