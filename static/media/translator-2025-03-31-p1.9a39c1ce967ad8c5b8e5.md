---
published: true
title: "🗺️ [0] Dumping Filesystem + Unlocking ADB Shell"
toc: true
toc_sticky: true
tagline: "I was browsing Aliexpress one day, and I came across a weird-looking translator. I'd never seen one of these before so it bought it immediately! In this blog, we'll crack it open and take a peek under the hood."
windowGradientStart: rgb(0, 11, 130)
windowGradientEnd: rgb(8, 0, 165)
windowBorder: rgb(0, 0, 0)
minimizeButton: rgb(47, 255, 0)
maximizeButton: rgb(255, 162, 0)
closeButton: rgb(255, 0, 0)
tags:
  - Hardware Teardown
  - Android
---

![listing.png](/assets/images/translator/p1/listing.png)

# Looking Around

Once the device arrived, I had a quick play with some of its features. I didn't connect it to the Internet, so I won't cover the online aspect, but I imagine there might be some API keys hanging around for things like ChatGPT (which this device supports).

![translator.jpg](/assets/images/translator/p1/translator.jpg)

The device comes pre-loaded with some translation models which work. This seems to be a decent use for all of those old chipsets lying around! It also includes apps for practicing other languages.

Outside of its intended functionality, there isn't really much to talk about. You can't install your own apps onto it, ADB is not enabled, there isn't very much information at all in settings - so this thing seems pretty locked down at a glance.

![this_cant_be.gif](/assets/images/translator/p1/this_cant_be.gif)

# Hidden Functionality

After some poking, I found a few interesting hidden menu's - lets take a closer look:

## AgingTest

If you navigate to ***Settings*** -> ***About us*** and tap the ***Mode:*** window 12 times, you are taken to the following screen:

![aging_test.jpg](/assets/images/translator/p1/aging_test.jpg)

This is obviously some sort of test utility used during production, nothing that interesting!

## About Us Pop-Up

In ***Settings*** -> ***About us***, if you tap the top bar that says ***About us*** 12 times, you get this strange pop-up:

![about_us.jpg](/assets/images/translator/p1/about_us.jpg)

## system version

In ***Settings*** -> ***About us***, tapping the ***system version:*** entry 12 times yields a *VERY* interesting pop-up:

![pwd.jpg](/assets/images/translator/p1/pwd.jpg)

It presents a Nokia-esque keyboard where you can enter characters, numbers, and a few special characters. We need to get our hands on this password and figure out what it does!

## Nameless Pop-Up

In ***Settings*** -> ***About us***, if you tap the empty space below the ***system version:*** bar some information about the screen appears:

![screen_info.jpg](/assets/images/translator/p1/screen_info.jpg)

## Settings Pop-Up

If you navigate to ***Settings*** and click the top bar that says ***Settings*** 10 times, you'll see this window:

![full_test.jpg](/assets/images/translator/p1/full_test.jpg)

With some Google Lens magic:

![translated.jpg](/assets/images/translator/p1/translated.jpg)

There are a bunch of fun little tests in here, but nothing hugely interesting from our perspective.

## Pre-boot Information

If you hold down the power and volume down buttons, the following menu appears:

![boot.jpg](/assets/images/translator/p1/boot.jpg)

![boot_translated.jpg](/assets/images/translator/p1/boot_translated.jpg)

And entering the version tab, we get a bunch of useful info:

![versions.jpg](/assets/images/translator/p1/versions.jpg)

Good, so we are working with a Mediatek MT6580 chipset, running Linux Kernel version 3.18.35. No hints on the exact Android version however.

# Hardware

Taking a look at the hardware probably won't yield much, but I couldn't resist taking it apart and having a look!

## Front

Nothing too crazy on this side, just the buttons, speakers and ports. However, a few of those test points seem interesting, I see a UART and I2C kicking about.

![front.jpg](/assets/images/translator/p1/front.jpg)

The funniest thing about this side is that the STB button between the volume buttons is completely inaccessible unless you take the device apart, I wonder if anything actually uses it?

## Back

![back.jpg](/assets/images/translator/p1/back.jpg)

## Chipset

![chipset.jpg](/assets/images/translator/p1/chipset.jpg)

Well that doesn't look like an MT6580 to me? This is an MT8321A chip - it turns out this chip is just a [renamed MT6580](https://wiki.postmarketos.org/wiki/MediaTek_MT6580).

# Dumping Files with mtkclient

As the device is based on a Mediatek chip, I figured we could give *mtkclient* a shot to get the files off of it - I doubt they've patched anything.

[mtkclient](https://github.com/bkerler/mtkclient) works by interacting with the Mediatek chipset before it boots, using their Boot ROM protocol commands. It lets you do a bunch of cool stuff, like reading/writing memory partitions, and therefore rooting a device if you wanted to (but for some reason I'd rather do it the hard way). 

![mtkclient.png](/assets/images/translator/p1/mtkclient.png)

Okay, so now we have connected to *mtkclient*, we can see it is clearly identified as an MT6580 chipset. 

As we want to attempt to recover that password from one of the hidden windows, I went ahead and dumped the ***system*** partition. With that completed, it can be mounted like so:

```
sudo mount -t ext4 -o loop,ro system.bin /mnt/temp_mount
```

And we can have a poke around!

![system_files.png](/assets/images/translator/p1/system_files.png)

# Unlocking ADB

Now that we have some files to work with, we can begin hunting down the code responsible for the weird keyboard/password functionality we discovered earlier - and hopefully work out the password for it!

I had a brief look through a bunch of APK's using JADX, but I didn't end up finding anything that was obviously responsible for the password. I did however come across an app named: **Translator_N_24_ACOFA_WXSD.apk** which contains the weird string that appeared in one of the pop-ups earlier.

I didn't find any clear hints, but I decided to take a look at the imported shared libraries just in case I was missing something.

As a complete fluke, I opened up the **libddgif.so** library, and stumbled across a 6-digit code near the top of the **Defined Strings** window surrounded by weird signature-like strings. 

![interesting_strings.png](/assets/images/translator/p1/interesting_strings.png)

I figured that there is no way this is the code, but to my surprise I entered "*320210*" and the following appeared!

![we_in.jpg](/assets/images/translator/p1/we_in.jpg)

And if we now run ***adb shell***, we get a shell!

![adb_shell.png](/assets/images/translator/p1/adb_shell.png)

## Exploring

Now that we have ADB shell access, we are able to do pretty much whatever we want - note that this device is not rooted, so this isn't a full root shell unfortunately.

We can start by getting rid of that lousy default launcher, and installing a more-standard variant. I went with [Nova Launcher](https://novalauncher.com/) as I used it all the time back in the day.

![nova_launcher.jpg](/assets/images/translator/p1/nova_launcher.jpg)

As you can see from the icons, I also installed Flappy Bird which ran great!

We can also use the settings app from the new launcher to get more information about the Android running on the device:

![android_version.jpg](/assets/images/translator/p1/android_version.jpg)

Nice, we have 9 years of missing updates which should give us some interesting bugs to work with!

# Conclusion

In this blog, we took a look around a strange translator device, uncovered some hidden menu's, had a look at the hardware, and finally unlocked a non-root ADB shell! In the next blog, I'll start the long journey of trying to find vulnerabilities in the kernel to pop a root shell!

![just_getting_started.gif](/assets/images/translator/p1/just_getting_started.gif)