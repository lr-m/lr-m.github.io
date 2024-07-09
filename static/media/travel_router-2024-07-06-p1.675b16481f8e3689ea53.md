---
published: true
title: "🌎 [0] Getting Started + Reversing Web Server"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Hardware
  - ARM
  - Debug Interfaces
  - Reverse Engineering
tagline: "Let's take a look at the KuWfi C920 travel router. We will perform an initial enumeration + hardware teardown, search for debug interfaces, and dump some memory chips if necessary. Once we have gained access to the web server, we can reverse engineer it and start poking around. The overall goal of this project is to achieve pre-auth code execution over LAN."
excerpt: "Lets get started on this project by tearing down a KuWfi C920 travel router."
header:
  teaser: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_image: /assets/images/analysing_a_dirt_cheap_router/mcu.jpg
  overlay_filter: 0.4
---

![admin_panel.png](/assets/images/travel_router_hacking_p1/router.png)

# Getting Started

As per all my other projects, we perform some initial enumeration of the target using Nmap, Wireshark, etc.

## Port Scans

On the TCP side of things, there isn't much going on:

```
Starting Nmap 7.94SVN ( https://nmap.org ) at 2024-07-06 20:16 BST
Nmap scan report for _gateway (192.168.2.1)
Host is up (0.031s latency).
Not shown: 65533 closed tcp ports (conn-refused)
PORT   STATE SERVICE
53/tcp open  domain
80/tcp open  http

Nmap done: 1 IP address (1 host up) scanned in 6.90 seconds
```

And nothing of note on the UDP side.

## Web Interface

The web interface appears to be pretty standard, whereupon you are presented with a login prompt requesting the admin password (and you can also adjust the language).

![admin_panel.png](/assets/images/travel_router_hacking_p1/admin_panel.png)

And once logged in, you will find a selection of standard 4G router settings - minus the 'SD Card' option. You can view connected devices, access SMS functionality, adjust settings, modify the phonebook - standard features.

![web_panel.png](/assets/images/travel_router_hacking_p1/web_panel.png)

### HTTP Share

When browsing through the available settings on the router, I discovered an 'SD Card' submenu, which includes a 'HTTP Share' submenu.

![sd_card_panel.png](/assets/images/travel_router_hacking_p1/sd_card_panel.png)

After spending some time exploring it, I found that it essentially provides remote access to the files on the SD card (subject to the constraints set in the available settings). It also allows files to be uploaded to the SD card through the interface. It's effectively a small Network-Attached Storage (NAS) device, and an interesting attack surface.

![http_share_panel.png](/assets/images/travel_router_hacking_p1/http_share_panel.png)

Interestingly, when the router is configured to use HTTP Share, the option to view the SD card contents becomes available on the login screen.

![http_share_pre_login.png](/assets/images/travel_router_hacking_p1/http_share_pre_login.png)

## Packet Captures

To investigate further, let's examine the packets being exchanged between the router and the web interface:

![web_traffic.png](/assets/images/travel_router_hacking_p1/web_traffic.png)

As you can see, HTTP traffic, with a bunch of requests to ***/goform/goform_get_cmd_process*** (which appears to fetch properties of the router), and one to ***/goform/goform_set_cmd_process*** (which is sent when settings are changed).

### ***goform_get_cmd_process***

This is a HTTP GET request, and the command is specified by the *cmd* parameter (or the data to be fetched from the configuration). The *isTest*, *multi\_data*, and *_* parameters appear to be of interest.

![get_cmd_process.png](/assets/images/travel_router_hacking_p1/get_cmd_process.png)

### ***goform_set_cmd_process***

This is a HTTP POST request, and it appears that the command to be performed on the data is specified by the *goformId* parameter, while the other parameters are expected data (excluding *isTest*, which doesn't seem to do anything).

![set_cmd_process.png](/assets/images/travel_router_hacking_p1/set_cmd_process.png)

### ***cgi-bin/zte_httpshare***

I also captured a HTTP POST request that results in a file being uploaded via HTTP share, the request is sent to ***cgi-bin/zte_httpshare***:

![cgi_bin_httpshare.png](/assets/images/travel_router_hacking_p1/cgi_bin_httpshare.png)

# Teardown

Now that we have had a look at what we can talk to, lets take it to pieces and see what we are working with!

## Taking a Look Inside

![front.png](/assets/images/travel_router_hacking_p1/front.png)

![no_metal_covers.png](/assets/images/travel_router_hacking_p1/no_metal_covers.png)

## Debug Interfaces

Taking a look at the pictures above, there are two interfaces, a JTAG and a UART. I don't have any equipment to poke the 1.8V JTAG, so we'll have to stick with the UART.

The baud rate of the UART is *921600*, which is the fastest baud rate I have ever seen. Unfortunately, the UART shell is password protected, so they haven't given us a nice easy root shell, but we do get a bunch of debug logs during the boot process - the only interesting part being that the router uses a *ZX297520V3 ARMv7* chip.

The bootlog is pretty similar to the one seen [here](https://www.natthapol89.com/2022/08/4g-wireless-router-lm321.html).

*Note from future Luke:* If anyone wants to have a go at cracking it, be my guest, its an md5crypt hash:

```
admin:$1$CIFeJAO5$CA0KJBqrSX6ciPKBlKV8J/:0:0:root:/:/bin/sh
```

## Chip Dump

As the debug interfaces were pretty fruitless, we'll have to take the chip off and dump it. The Paragon memory chip is a *WSON-8* package, which means it has a large ground connection on the bottom that requires a significant amount of heat to melt it.

To dump the chip once removed, I mounted it to a *WSON-8* breakout board so that the chip could be placed in the *T48* memory programmer I use for all my reads.

![chip.jpg](/assets/images/travel_router_hacking_p1/chip.jpg)

Now the chip is put into the programmer, and the contents are read. Once we have the contents, we can place the chip back on the board (shout out Adam for fixing my dodgy soldering).

### Analysis and Extraction

Lets throw the binary into [binvis.io](https://binvis.io) and see what we are working with:

![binvis.png](/assets/images/travel_router_hacking_p1/binvis.png)

Nice, doesn't appear that there's any encryption to deal with. It seems like a bootloader at the beginning and then the main binary (followed by maybe some recovery binary?). There is a pretty consistent pattern visible throughout the binary, which likely represents ECC, so we can simply put it into a hex editor, identify the ECC manually, and create a Python script to remove it.

With the ECC gone, lets throw it into [unblob](https://github.com/onekey-sec/unblob) and see what we get:

![binvis.png](/assets/images/travel_router_hacking_p1/extracted.png)

We get several ubifs and jffs2 file systems, one of which is the *rootfs*, which we're most interested in since it likely contains the web server we'll be targeting:

![binvis.png](/assets/images/travel_router_hacking_p1/rootfs.png)

Is this what I think it is?

![binvis.png](/assets/images/travel_router_hacking_p1/adb.png)

After messing with the *SET_DEVICE_MODE* goform set method (I think), I eventually got to this via the USB port and running ***adb shell***:

![binvis.png](/assets/images/travel_router_hacking_p1/shell.png)

After a bit of a browse, I found the routers config located in ***/mnt/userdata/etc_rw/nv/main/cfg***, and a copy of it is stored in ***/mnt/userdata/etc_rw/nv/backup/cfg***.

The admin password is stored under the *admin_Password* entry. The exact model of the router is also found in here, it is a *ZTE MF910W*.

# Web Server

I located the web server in the extracted rootfs by grepping for some of the strings we observed in the packet captures, and found that the binary is located in ***/bin/goahead***.

## Endpoints

Opening the binary in Ghidra (since it's an ELF, Ghidra does most of the heavy lifting for us - no need to manually locate base addresses) and searching for ***goform.html***, we locate the functions that create the endpoints, and their respective handlers:

![binvis.png](/assets/images/travel_router_hacking_p1/goform_init.png)

### ***/goform***

We'll start by looking at the ***/goform*** handler, as it seems that most of the functionality goes via this endpoint.

![binvis.png](/assets/images/travel_router_hacking_p1/goform_handler.png)

In the above function, it is clear that it parses the URL to get the form name after ***/goform***, in this case either ***goform_get_cmd_process*** or ***goform_set_cmd_process***. Once the handler is located, it is called.

To summarize the ***goform_get_cmd_process*** handler, it first checks if the user is logged in by looking at the *user_ip_addr* config value and comparing it to that of the request; also checking if the *loginfo* config value has been set to "ok", which is done upon successful login. 

If the user is not logged in, they only have access to a small subset (*44*) of the config values. If the user is logged in, they have access to *30* additional handlers and can access any config value they like. There is also an optional *multi_data* parameter that allows multiple config values to be requested in a single request.

As for the ***goform_set_cmd_process*** handler, there is a small whitelist of commands that can be accessed without auth:

- *SET_WEB_LANGUAGE*
- *LOGIN*
- *LOGOUT*
- *ENTER_PIN*
- *ENTER_PUK*
- *GOFORM_HTTPSHARE_CHECK_FILE*
- *HTTPSHARE_ENTERFOLD*
- *HTTPSHARE_FILE_RENAME*
- *HTTPSHARE_NEW*
- *HTTPSHARE_DEL*
- *SET_DEVICE_MODE*
- *REBOOT_DEVICE*

If the user is authenticated, they can access any of the *100* handlers.

### ***/mmc2***

This endpoint is used to fetch files from the HTTP share - for example, a HTTP GET request to ***/mmc2/test.jpg*** will attempt to read the ***test.jpg*** file from the SD card.

### ***/cgi-bin***

This endpoint is mainly used for uploading files to the HTTP share via ***/cgi-bin/zte_httpshare***. There is also a ***/cgi-bin/zte_upload*** endpoint which appears to be for firmware updates.

### Last

This is the last endpoint in the chain, and it's reached when none of the earlier endpoints in the chain match the URL.

There are a couple of interesting things about this handler; the first one is that you can use it to fetch the network credentials encoded in a QR code by requesting ***img/qrcode_ssid_wifikey.png***.

![binvis.png](/assets/images/travel_router_hacking_p1/qrcode_ssid_wifikey.png)

There also seems to be functionality for fetching ***/tmpl*** files.

# Conclusion

In this blog, we conducted some initial enumeration, tore down the device, dumped the flash chip, extracted the filesystem, gained a shell, and began reversing the web server. I always find the start of a project is the most tedious part, but I hope you found something useful in reading this!