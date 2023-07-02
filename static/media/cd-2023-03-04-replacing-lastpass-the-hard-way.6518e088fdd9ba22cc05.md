---
published: true
title : "⌨️ Replacing Lastpass the Hard Way - Vault"
toc: true
toc_sticky: true
categories:
  - Coding
tags:
  - ESP8266
  - Arduino
  - Cryptography
  - C++
  - Python
tagline: "There are plenty of great ways to store your passwords in a secure fashion. I used Lastpass for a while, but due to their not-so-good security record, I migrated to good old pen and paper. This leaves me with the problem of having a book full of my passwords protected only by the lock on my front door! This blog will detail a device I created to try and tackle this problem."
excerpt : "Lastpass has been under scrutiny recently for various breaches and terrible security practices - can we do a better job with the ESP8266?"
header:
  overlay_filter: 0.6
  teaser: /assets/images/replacing_lastpass_the_hard_way/teaser.PNG
  overlay_image: /assets/images/replacing_lastpass_the_hard_way/teaser.PNG
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

## Project Aims

Its always good to have an idea of what you would like to achieve when starting a project - I have a habit of getting to the end of a project and thinking of loads of extra features I could add to it, so having these aims is useful for me!

Here are the main aims:
- Ability to add/store password entries (username/password)
- Ability to add/store cryptocurrency wallet phrases
- Encrypted storage
- Device should be standalone
- Optional remote method to quickly edit stored entries

These objectives are intentionally vague, as I am not entirely sure how they will be completed at this point!

## Quick Crypto Intro

Just in case you are not familiar with some of the basic cryptography terminology I will use in this blog, here is a quick rundown. A great tool to mess about with various cryptographic algorithms is [CyberChef](https://gchq.github.io/CyberChef/).

### Encoding

Encoding is the process of converting data from one format, such as encrypted bytes, into another format that can be easily processed by a computer or transmitted over a network. A very common form of encoding is base64, which is a type of binary-to-text encoding scheme that represents binary data in an ASCII string format. It is very useful for transmitting data over networks that cannot handle binary data, and is quite easy to recognise with the '=' padding at the end.

Note that encoding ***IS NOT*** encryption, a base64 string can easily be decoded with no cryptographic material to get the original text. For example, here is the encoded form of **helloworld** using CyberChef:

![to_base64.PNG](/assets/images/replacing_lastpass_the_hard_way/to_base64.PNG)

And here is the decoding result:

![from_base64.PNG](/assets/images/replacing_lastpass_the_hard_way/from_base64.PNG)

### Encryption

Encryption is the process of transforming data in such a way that it can only be read or accessed by authorized parties who have the key to decrypt the data. It means that people who acquire the data will not be able to retrieve the original plaintext without having the key - it keeps things confidential.
 
A very commonly used standard of encryption is AES (Advanced Encryption Standard), it encapsulates lots of modes including *CTR*, *ECB*, and *OFB*. It is a block cipher (which means it encrypts the data in fixed-size chunks), and the key size is 128-256 bits. There exists [an implementation of these encryption methods](https://rweather.github.io/arduinolibs/crypto.html) for Arduino, so we will utilise these - never roll your own crypto!

If you have ever heard about ransomware in the news, encryption is utilised by this malicious software to encrypt all of the data on the computer. It will then force the user to do something to get the key and decrypt their data - usually involving cryptocurrencies. They are unable to decrypt their data as they do not know the key used to encrypt it!

![wannacry.PNG](/assets/images/replacing_lastpass_the_hard_way/wannacry.PNG)

### Hashing

Hashing is a very useful cryptographic tool - it is theoretically a one-way function. If you feed a string into the algorithm, and give someone the result, they should not be able to retrieve the original plaintext that was fed into the algorithm. It is very useful for verification purposes, e.g., password checks and data integrity checks.

It is useful in password storage as you never have to store the original password anywhere, you can just store the hash. To check an entered password, you can simply hash the provided input, and compare it with what you have stored. Simple enough!

![hashing.PNG](/assets/images/replacing_lastpass_the_hard_way/hashing.PNG)

## Components

With that out of the way, lets talk about how we are going to make this work, and the components we will use for the device:
- ***ESP8266 NodeMCU v1.0*** : The best microcontroller I've used (so far). Can be programmed with the Arduino IDE and it's great to work with. This will be the heart of the device.
- ***IR Reciever and Remote*** : This will provide the interaction for the device, I'm familiar with this as I've used it for my previous [ESP8266 project](https://luke-r-m.github.io/coding/a-hands-on-guide-to-building-a-crypto-ticker/).
- ***ST7735 1.77" LCD Display*** : This will help the user see what they are doing, and remove the need for some external screen. Again, I've used this in a previous project so all good!
- ***ATMEL 24C256 EEPROM*** : This is an external EEPROM (Electrically Erasable Programmable Read-Only Memory) that will be used for the storage of credentials. This is necessary as the internal ESP8266 EEPROM is only 512 bytes. This device uses [I2C](https://learn.sparkfun.com/tutorials/i2c/all), so only requires a couple of pins to be connected (aside from power).

Here is everything connected together:
![layout1.PNG](/assets/images/replacing_lastpass_the_hard_way/layout1.PNG)

## Software

The code for the device is simple enough - the most difficult element was incorporating the cryptography into the device to keep everything secure. This section will focus on some of the more interesting aspects of the device that help satisfy the initial project aims.

### Master Key Storage

As mentioned in the Encryption section above, it is necessary to have a key to encrypt/decrypt data. I decided to go with a pretty standard master key solution, similar to that used by Lastpass. It is convenient as you only need to remember a single password instead of loads of (hopefully unique) passwords. The disadvantage is that all of your passwords essentially become this single password, if someone knows the master password they know them all, so make sure its very secure!

For master password storage, I used a SHA-512 hash of the password, and stored this in the internal EEPROM of the ESP8266. I could have used SHA-256 and this would have provided pretty much the same level of security, the only advantage of SHA-512 over SHA-256 is collision avoidance - it is far more difficult to get the same hash output for different inputs. This means I do not have to store the master password in plaintext which is good!

I could have made this more secure by using some sort of salt (adding random data to the password before it is hashed to make cracking it with [rainbow tables](https://www.beyondidentity.com/glossary/rainbow-table-attack) more difficult). I deemed this unnecessary as physical access to the device would be needed to get the hash, let alone crack it! And what would be harder to crack with physical access, a SHA-512 hash of the master password, or a nicely laid out book full of your passwords? I know what I would prefer!

![drift_meme.jpg](/assets/images/replacing_lastpass_the_hard_way/drift_meme.jpg)

When the device is turned on, it immediately requests the master password from the user which is entered using the IR remote and keyboard that I stole from my previous ESP8266 project (but changed the orientation). Once entered, it hashes the input and compares it with the hash stored on the internal storage - granting access if they match (and decrypting the credentials on the external storage, more on that later).

![master.jpg](/assets/images/replacing_lastpass_the_hard_way/master.jpg)

### Reading/Writing External EEPROM

As mentioned earlier, far more storage is going to be required to store passwords/wallet phrases than that available on the internal storage of the ESP8266 (512 bytes). Therefore, I will be utilising an [AT24C256 I2C EEPROM](https://ww1.microchip.com/downloads/en/DeviceDoc/doc0670.pdf) for credential storage. This chip will give us 32768 bytes of space to play with, which should be plenty!

The device is designed for *I2C* (Inter-Integrated Circuit), which is a two-pin (*SCL* and *SDA*) serial communication protocol used for data transmission between IC's. The *SCL* pin is a serial clock line, and the *SDA* pin is a serial data line. So we will need to use this protocol to interact with the chip. 

Arduino has a [**Wire**](https://github.com/esp8266/Arduino/blob/master/libraries/Wire/Wire.h) library that can talk using this protocol, which is useful. To *read* the external EEPROM, all we need to do is send to the EEPROM the address we would like to read from, and it will send back the value at that address:

```
-c
// Function to read from EEPROM
byte EEPROM_Manager::readExternalEEPROM(int address)
{
  // Define byte for received data
  byte rcvData = 0xFF;
 
  // Begin transmission to I2C EEPROM
  Wire.beginTransmission(EEPROM_I2C_ADDRESS);
 
  // Send memory address as two 8-bit bytes
  Wire.write((int)(address >> 8));   // MSB
  Wire.write((int)(address & 0xFF)); // LSB
 
  // End the transmission
  Wire.endTransmission();
 
  // Request one byte of data at current memory address
  Wire.requestFrom(EEPROM_I2C_ADDRESS, 1);
 
  // Read the data and assign to variable
  rcvData =  Wire.read();
 
  // Return the data as function output
  return rcvData;
}
```

The *write* function is even simpler - we just need to specify the address like we did above, but this time we need to send the value to write to the chip before we end the transmission:

```
-c
// Function to write to EEPROOM
void EEPROM_Manager::writeExternalEEPROM(int address, byte val)
{
  // Begin transmission to I2C EEPROM
  Wire.beginTransmission(EEPROM_I2C_ADDRESS);
 
  // Send memory address as two 8-bit bytes
  Wire.write((int)(address >> 8));   // MSB
  Wire.write((int)(address & 0xFF)); // LSB
 
  // Send data to be stored
  Wire.write(val);
 
  // End the transmission
  Wire.endTransmission();
 
  // Add 5ms delay for EEPROM
  delay(5);
}
```

The **delay(5)** is there so the chip has time to write, as this takes longer to complete than a simple read.

### Displaying Credentials

So we have our master password stored, and we can write to the external EEPROM, now we need to figure out how we are going to show the passwords/wallet phrases to the user on the screen.

Once the password is entered, the user can select if they want to view passwords or wallet entries:

![home.jpg](/assets/images/replacing_lastpass_the_hard_way/home.jpg)

#### Passwords

The password entries consist of three elements:
- *Name*
- *Username/email*
- *Password*

When the user specifies they want to view passwords, the device prints a navigatable list of password names in alphabetical order - this makes locating the passwords a quicker process. The IR remote is then used to specify which password the user would like to view, and the *OK* button on the remote is pressed to bring up all of the password details. The user can then navigate back to the password list with '#' on the remote.

![pwd.PNG](/assets/images/replacing_lastpass_the_hard_way/pwd.PNG)

Obviously screen space is limited, so I have tried to strike a balance between optimising the screen space, and minimising a 'cramped' feel when using the device.

#### Wallet Phrases

The wallet entries consists of the following elements:
- *Name*
- *1 - 24 Phrases*

Due to the ability to have up to 24 phrases, we will need to be able to cycle through the phrases when viewing a wallet entry. I decided against using the same method of viewing as the password entries, as a user is far less likely to have a large amount of wallets. 

When you select wallet entries on the home menu, the first saved entry is automatically displayed, and the horizontal arrow keys on the remote can be used to see the other entries. For the larger entries, the vertical keys can be used to view the next/previous 10 elements.

![wlt.PNG](/assets/images/replacing_lastpass_the_hard_way/wlt.PNG)

## External Credential Storage

This project wouldn't be much of a solution to Lastpass if I couldn't store any passwords/wallet phrases - so let's figure out how we are going to do that.

### Encryption

For the storage of passwords, I am going to be using AES-ECB (Electronic Codebook) with a 128-bit key. AES-ECB has a pretty big issue that we will need to address somehow, the following image illustrates the issue - which should be clear to any cryptography nerds out there:

![ecb_penguin.PNG](/assets/images/replacing_lastpass_the_hard_way/ecb_penguin.PNG)

AES-ECB is semantically insecure - meaning you can derive information about the plaintext from the cipher text, a.k.a, not a good thing. For example, you can tell from the AES-ECB encrypted image that it is in fact an image of a penguin. This occurs for a couple of reasons:
- Each encrypted block does not depend on previous information, unlike CBC mode
- Identical blocks encrypted with the same key result in the same output

This means if we encrypt two identical passwords with the same key, we get identical outputs, so an attacker would be able to derive which accounts were using the same password - not ideal. As a side note, Lastpass actually used to use AES-ECB for vault encryption, and used their own implementations! 

I decided to tackle this by including some random bytes in the encrypted text blocks so that identical passwords will very rarely produce the same encrypted output (think of the random bytes like an IV (Initialisation Vector) used in other AES modes such as CBC). I also use fixed blocks of 32-bytes so length information cannot be derived from the ciphertext. It isn't perfect by any means, but it puts a band-aid on the main issues with ECB, and after all, we aren't aiming for full security - just better than pen and paper!

![ecb_meme.jpg](/assets/images/replacing_lastpass_the_hard_way/ecb_meme.jpg)

***Disclaimer***: I don't recommend using AES-ECB as its essentially a broken mode, it's just very easy to work with - and secure enough for this project! Plus, it wouldn't be too hard to swap this out with a more secure mode of AES in the future.

### Passwords

Now that we have decided how we are going to store our sensitive information, we need to abstract to storing entire password entries. The approach I decided to use is pretty intuitive and simple - similar to a heap. The structure of the password storage consists of two parts:
- A series of bits which indicate the occupied blocks
- 96-byte blocks that contains the encrypted password entries

It should be pretty clear how this is going to work, when a block is occupied by an entry, the corresponding bit at the start is set, and vice versa. This means when a password is deleted, all the other entries do not need to be shifted down, the block can simply be left as is until a new entry is added to fill the space.

I allocated 32 bytes for the block indicator bits, meaning we can store 256 password entries, this should be plenty. This means the space for actually storing the passwords is 96 bytes x 256, so 24576 bytes - that's a pretty big chunk of the external EEPROM!

The image below shows the bits and their associated blocks being allocated and randomly released - note that it only shows 64 entries instead of the full 256 on the actual device:

![block1.jpg](/assets/images/replacing_lastpass_the_hard_way/block1.png)

### Wallet Phrases

The way we are going to store wallet entries is slightly different to passwords. We have to deal with wallet entries having varying numbers of phrases, storing them in sequence would result in storage inefficiencies after repeated additions and deletions of wallet keys. If we were to delete an entry in the middle, we would have to move all of the memory after the entry down, which is a lot of temporarlly expensive memory writes.

I fixed this issue by having a large array of 'blocks' that store 32 bytes, similar to that seen in the password storage mechanism. Instead of storing a list of words, I store a list of indexes that store the words that comprise the entry. This minimises the storage inefficiencies, and drastically reduces the amount of write operations needed.

When an entry is added, free blocks are found to store the name (using a list of bits indicating if the associated block is free), and the phrases that make up the wallet key. A 'layout block' is created, which indicates the number of phrases, the index of the block containing the encrypted name, and the indexes that store the phrases. When an entry is deleted, all the layout blocks after the deleted one are pulled back down, and the blocks are cleared. The image below demonstrates how this works:

![block2.jpg](/assets/images/replacing_lastpass_the_hard_way/block2.png)

It can probably be improved, but it works well enough for now!

## Remote Mode

So at this point, we have a working wallet phrase and password storage device that can be interacted with using the IR remote. However, imagine if you had a book of 20 strong passwords, and you could only use an IR remote to add them all - that would take ages. It would be great if we could somehow remotely interact with the device to add, remove and view entries. 

I considered using the ESP8266 serial interface for this (via the micro USB), but decided against this as only the ESP8266 dev boards usually have that feature. So I decided to use a WiFi network connection, with a Python client running on another device connected to the same network. I could have used TLS for securing the communications, but I felt it would be a better learning experience to manually implement the security - yes, I know it's a terrible idea, but I'm going to do it anyway in the name of science.

How are we going to store the WiFi credentials? Well, conveniently, we have a master key that we can encrypt them with. The user is prompted for credentials when the device is set up, and these are decrypted for later use when the user want to use remote mode. These are stored with the master password hash on the ESP8266 internal EEPROM.

### Securing Communications

Here is the hard bit - we need to somehow construct a protocol that authenticates the user, doesn't authenticate other people on the network that try and talk to the device, and keeps the communications hidden. First, I'll describe the protocol I came up with to get the job done, and explain how these issues are tackled:
- User enters *Remote Mode* on the vault, which generates and prints a session key along with the IP address of the device.
- User instantiates the Python client, providing it with the session key, master key, and IP address.
- User uses the client command line to enter a request for the vault:

```
[?] Enter command:
    pwd read

[?] Enter entry name:
    HackTheBox
```

- Client sends an authentication request to the device, from this point, all communications are encrypted with the session key (not including this nonce response):

```
-json
[*] Sending auth request
{
    "req": "auth"
}
```

- Vault recieves this, creates a challenge nonce, and encrypts this with the randomly generated session key:

```
-json
[+] Received challenge
{
    "nonce": "C194ABFE39A379762536411C5BD4EEE42F88BEB4A39604C96BB34A4B3809A9DF"
}
```

- Client gets the nonce, decrypts it with the user-provided session key, and re-encrypts it with the master key.
- Client sends the master-key encrypted nonce, as well as the request - this entire packet is encrypted with the session key:

```
-json
[*] Sending command + token
[*] Original message being sent:
{
    "type": 0,
    "name": "WNWYKnxrd1Bzmiaw2aCOPfz9m7goXn/p2SuEjwZ56Ik=",
    "token": "4A37312ECF9F15E891C0265615EEB055CE60462DE9E1DDE309CE07814C8BF7EB"
}
[*] Encrypted message being sent:
"urbfh0nGW0wFBm08ebqPiQf+2EbtN3JzvgExpKQZqrDepR1OVRiXgwGOuIJJEkGnVBx7gS9YeHG0s9zuDUmQnBOa0ee4b9W7f3rNeWPtwP4r7vLaLRBoxDDEnJ1HNe+I99k1XG9UgCVxCW+iMZ7q9ADSvjLn8RTCbUrC6b0XVWWWfMRMVwjK2dpKa8u9dpxunJ1HNe+I99k1XG9UgCVxCW+iMZ7q9ADSvjLn8RTCbUrC6b0XVWWWfMRMVwjK2dpKa8u9dpxu"
```

- Vault recieves the data, decrypts with the session key, and checks if the recieved encrypted nonce bytes match the generated nonce encrypted with the correct master key. If so, it handles the request and responds, otherwise, it responds with an error.
- Client gets the response, decrypts with the session key, and presents the response to the user:

```
-json
[+] Received response
[*] Closing connection
[*] Encrypted response:                                                                                                    
"urbejVzRFxdIU2MmeYarkRD3mxe7Ak4R1D06koEW0YXTvAF5VkaioyWru65IF0+qAzds5ztdbDzM+4eWSB6qhFnXj6O4IZi/aGyVcRD5xMlAnLKvKBFT5FDtxcoxco6dLKAgLtQJzgn91Z9Ch/kb9vdwnqNtyaotVH7KHuGrfgkZVw="
[*] Decrypted response:
{
    "username": "REur+yqtbr53weNWkJwwtuVtlTckueV8h9j8syId7G8=",
    "password": "orxz2S60vXEsD7DxfYohb8yd94RWMbEFFIF2vkptsLo="
}
[+] Decrypted response

[$] Username/Email:      Super
[$] Password:            Secure
```

The provided example is the verbose output of the client when sending a request for the **HackTheBox** password entry. 

To verify that the user has physical access to the device, the session key is used as a test - the user doesn't know this key if they can't see the screen. Even if they can see the screen, the would also need to know the master key. The challenge nonce exchange verifies the user making the request knows both of these keys.

The encryption used for the communications is [AES-CTR](https://rweather.github.io/arduinolibs/classCTR.html), another AES mode that uses an initialisation vector - I used the generated nonce for this as both sides know it after the initial challenge nonce exchange (if the keys match). This keeps the communications secure from prying eyes.

Note the use of base64 encoding throughout the communication protocol (also a bit of hexdump for the nonces to spice things up), this allows the encrypted bytes to be sent between the client and the vault without any issues.

More could be done to enchance the security of this element of the device, such as exiting remote mode when malformed entries are detected, the session/master key checks fail, or a period of time with no requests passes. This is left as an exercise to the reader ;)

### Python Client

The Python client was quite nice to implement, programming this stuff is much more fun when you don't need to worry about buffer sizes!

#### Structure/Features

This 'client' is a pretty simple terminal based program, sort of like a command line. It has the following commands:

![init.PNG](/assets/images/replacing_lastpass_the_hard_way/init.PNG)

If the IP address is wrong, the master password is incorrect, or the session key is wrong, this client won't be very useful! I've tried to design it with users that are not familiar with command line interfaces in mind, and tried to provide useful feedback when things aren't working.

Each command represents a function stored in a dictionary of command handler functions that achieve the desired functionality. The handler will prompt for more information about the requsted entry from the user if this is required.

#### Pretty Colours

To try and make the client a little bit more exiting, I opted to add a sprinking of ASCII art, as well as use ANSI color escape codes to jazz up the colours a little bit. 

To create the ASCII art **VAULT** banner, I used [Figlet](http://www.figlet.org/), which has a python library **pyfiglet** that can generate these ASCII fonts without having to manually print the strings yourself. I opted for the *slant* font as this is simple and looks good! Here is the code that prints the ASCII art:

![figlet.PNG](/assets/images/replacing_lastpass_the_hard_way/figlet.PNG)

You are probably wondering what the weird **\033** and **0m** stuff is - this is what gives the banner its colour! These are [ANSI color escape codes](https://stackoverflow.com/questions/4842424/list-of-ansi-color-escape-sequences), and its a way of messing with the colour of printed text on various terminals. It's worth noting that not all terminals support this, but pretty much any modern terminal will (works good on Windows for example).

So, lets work our way through the weirdness. The first weird bit is the **\033[**, the **\033** is ESC, and the **[** after the ESC forms a kind of escape sequence known as a Control Sequence Introducer. You can then pass parameters after this **ESC[** sequence to change the appearance of the text. We pass a random int between 31 and 37 as the first parameter, which gives the text its colour (refer to the tables in the stack overflow link above for other options). After we have specified our options, we put **m** to indicate the end of the ANSI escape sequence. We then print the VAULT ascii art, and clear all the options we selected earlier with the **\033[0m** at the end of the string.

The **\033XXXm** command at the start is also part of the *Select Graphic Rendition* group of escape sequences, where **XXX** are semicolon-separated options. As you can see in other parts of the code (shown below), I was able to use more parameters to get the print to be bold and italic - you can do some really cool things with ansi escape sequences, I've just scratched the surface!

![help.PNG](/assets/images/replacing_lastpass_the_hard_way/help.PNG)

#### Crypto

It was MUCH easier to implement the client side of the crypto, there are plenty of ready-made libraries that can be imported and work pretty much first try. I used the **base64**, **json**, and **Crypto.Cipher** libraries to get everything I needed to talk to the vault - including both ECB and CTR AES modes.

With all of the necessary functionality, it was pretty simple to implement the communication protocol, there were far more quirks that had to be dealt with on the C++ side.

## Conclusion

This was a pretty fun project, it allowed me to prove to myself that I understand basic cryptography, and I can incorporate it into a simple client-server infrastructure. If you want to check out all of the code, it is [on my github](https://github.com/luke-r-m/Vault), feel free to take it and improve (or fix) it. 

At the end of the day, this device does an excellent job over the standard pen and paper approach of password storage, but using some offline password storage solution such as [Keepass](https://keepass.info/), and storing the database on an encrypted USB stick, will offer much more security than my attempt - so use this at your own risk!

![logo.png](/assets/images/replacing_lastpass_the_hard_way/logo.png)