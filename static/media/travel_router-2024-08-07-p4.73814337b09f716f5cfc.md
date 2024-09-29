---
published: true
title: "🌎 [3] Looking at some Newer Models"
toc: true
toc_sticky: true
categories:
  - VR
tags:
  - Android
  - Reverse Engineering
tagline: "After looking at the KuWfi C920 (ZTE MF910W), I wanted to see if these bugs were in other similar looking travel routers online, so I bought a couple more."
excerpt: "I purchased another travel router to see if the bugs are there - are they?"
---

# The New Target

The first new target is a generic 4G travel router with seemingly no associated brand, the model of the router is a ZTE *MF904-E* (according to a sticker on the back of the device).

![mf904_listing.png](/assets/images/travel_router_hacking_p4/mf904_listing.png)

I did a couple of packet captures, and the traffic seems to be almost identical to that of the other *MF910* travel router. It uses the same ***/goform*** endpoint for configuration, fetching values, etc

## Do the Bugs Work?

So, I tried out all of the bugs and pretty much everything except the directory traversal issues on the HTTP SHARE functionality are dead. However, they are no longer pre-auth like they were on the other router - so all of the pre-auth stuff we had in the other router is RIP.

## Differences

Lets compare the differences between the routers at a surface level and see if there is anything of note:
- The login packet is difference on the *MF904*, requiring both username and password, instead of just a password on the *MF910*
- ***/mmc2*** and ***/cgi-bin*** seem to have disappeared
- In the web UI of the *MF904*, there is a new *Download Driver* page, this seems to be an alternative to the CD-ROM functionality (but that is still on the *MF904* as well as the *MF910*)
- The UI of the new router is very similar, but has been rearranged slightly, and now has smooth(ish) animations - also different start/end screens
- The QR code functionality of the router is also missing
- All of the HTTP requests have a cookie in the *MF904* in the HTTP header called *JSESSIONID*
- When you factory reset the *MF904*, it comes up with text indicating the update step

# Getting the Firmware

The first thing that caught my eye was the *Download Driver* page - lets take a look at a request to download the ***readme.txt*** file:

![driver_download_request.png](/assets/images/travel_router_hacking_p4/driver_download_request.png)

So it looks to be doing a HTTP GET request to the ***/getfileForm*** endpoint, with the *filename* parameter set to be the file to download - surely not another directory traversal?

To make our lives easier, we can use the ***HTTPSHARE_ENTERFOLD*** directory traversal issue to find a file to download as a test, looking at the contents of the root directory, it is COMPLETELY different to the other routers filesystem - and looks to be Android. Lets test our directory traversal theory on the ***/system/build.prop*** file, here is the dodgy request:

![file_get_dir_traversal_request.png](/assets/images/travel_router_hacking_p4/file_get_dir_traversal_request.png)

And here is the response:

![file_get_dir_traversal_response.png](/assets/images/travel_router_hacking_p4/file_get_dir_traversal_response.png)

![prop_contents.png](/assets/images/travel_router_hacking_p4/prop_contents.png)

As you can see, works like a charm! This means we can just combine this with our ***HTTPSHARE_ENTERFOLD*** bug to read as much of the filesystem as we can (SELinux should block some stuff).

![filesystem.png](/assets/images/travel_router_hacking_p4/filesystem.png)

## Locating Web Server Code

I spent some time grepping the extracted filesystem for strings I'd observed, the first thing I saw was the code for the UI under the ***/system/TeleService/TeleService.apk***. I put this app into Jadx, there wasn't much code, but it did contain all of the assets used for the UI. 

Within the ***/system/TeleService*** directory, there is an ***oat/arm/TeleService.odex*** file which I assume will contain some code, lets extract it with *baksmali*, and view it in Jadx:

```
java -jar ~/Programs/baksmali-2.5.2.jar d -o out/ TeleService.odex 
```

Loading the ***out*** directory into Jadx, a bunch of code is loaded, the most notable is ***com.android.phone***. Unfortunately, there is absolutely no code to do with the web server in here - so where on Earth is it?

At this point I remembered that if you are running as an app SELinux context, you can't see the directories in ***/data/data***, therefore the ***HTTPSHARE_ENTERFOLD*** probably indicated that the directory was empty:

![data_data_enterfold.png](/assets/images/travel_router_hacking_p4/data_data_enterfold.png)

We probably missed a bunch of stuff in there! We know that the UI is under ***com.android.phone*** - we are able download ***/data/data/com.android.phone***, and we FINALLY get some matches for ***goform*** code in the cache:

![goform_matches.png](/assets/images/travel_router_hacking_p4/goform_matches.png)

As it is in the cache, it MUST be getting loaded from somewhere, grepping for ***WEB-INF*** leads us the the ***/etc/TLR.db***, which for some reason doesn't contain the ***goform*** string - hence why it didn't get picked up earlier. Extracting this directory reveals the following structure:

![web_server.png](/assets/images/travel_router_hacking_p4/web_server.png)

Looks like a web server to me!

![we_got_him.jpg](/assets/images/travel_router_hacking_p4/we_got_him.jpg)

# Analysing Web Server

Now that we've finally got a web server to look at, lets take a look at the ***WEB-INF*** directory that contains the code we are interested in.

The ***web.xml*** file seems to specify how the classes in the code are used to form the web server, specifying authentication routines, endpoints, etc.

The following endpoints are available, and also their class mappings:

<!-- | Endpoint | Servlet | Class | 
| - | - | - |
| /goform/goform_get_cmd_process | goform_get_cmd_process | com.lr.web.GoformGet |
| /goform/goform_set_cmd_process | goform_set_cmd_process | com.lr.web.GoformSet |
| /jsontest | jsontest | com.lr.web.TestJson |
| /getfileForm | getfileForm | com.lr.web.GoformDownloadFile | 
| /uploadfileForm | uploadFileForm | com.lr.web.GoformUploadFile | 
| /updateForm | updateForm | com.lr.web.GoformUpdateForm |
| /uploadupdateFileForm | uploadupdatefileForm | com.lr.web.GoformUploadUpdateFile |
| /getsharefileForm | getsharefileForm | com.lr.web.GoformDownloadHttpShareFile |
| /adbenableForm.do | adbenableForm | com.lr.web.AdbEnableForm |
| /ttyForm.do | ttyForm | com.lr.web.TTLTestEnableForm |
| /wifienableForm.do | wifienableForm | com.lr.web.WifiEnableForm |
| /adbWifiDebugForm.do | adbWifiDebugForm | com.lr.web.AdbWifiDebugForm |
| /propertiesForm.do | propertiesForm | com.lr.web.PropForm |
| /ssidenableForm.do | ssidenableForm | com.lr.web.SSIDEnableForm |
| /ping/ | PingServlet | com.lr.web.PingServlet |
| /auth/ | AuthServlet | com.lr.web.AuthServlet |
| /portal/ | PortalServlet | com.lr.web.PortalServlet |
| /login/ | LoginServlet | com.lr.web.LoginServlet |
| /login4/ | Login4Servlet | com.lr.web.Login4Servlet |
| /loginValidate.do | LoginValidateServlet | com.lr.web.LoginValidateServlet |
| /loginValidateMe.do | LoginValidateMeServlet | com.lr.web.LoginValidateMeServlet |
| /unlocknetwork.do | UnlockNetworkServlet | com.lr.web.UnlockNetworkServlet |
| /gpio.do | GpioServlet | com.lr.web.GpioServlet |
| /gps.do | GpsServlet | com.lr.web.GpsServlet |
| /gw_message/ | GwMessageServlet | com.lr.web.GwMessageServlet |
| /PhoneTest.do | PhoneTestServlet | com.lr.web.GwMessageServlet |
| /GetCpuInfo.do | GetCpuTypeForm | com.lr.web.GetCpuTypeForm |
| /SetWifi.do | SetWifi | com.lr.web.SetWifiServlet |
| /SetBand.do | BandSetForm | com.lr.web.BandSetForm |
| /DeviceLockForm.do | DeviceLockForm | com.lr.web.DeviceLockForm |
| /TimeZoneForm.do | TimeZoneForm | com.lr.web.TimeZoneForm |
| unlockForm.do | unlockForm | com.lr.web.UnlockForm |
| jsonp_dashboard | jsonp_dashboard | com.lr.web.DashBoardFrom |
| operator | operator | com.lr.web.OperatorForm |
| jsonp_uapxb_wlan_security_settings | jsonp_uapxb_wlan_security_settings | com.lr.web.DashBoardWlanForm |
| simswitch | /SimSwitchForm.do | com.lr.web.SimSwitchEnableForm |
| imeiForm | /ImeiForm.do | com.lr.web.ImeiForm | -->

![endpoint_classes.png](/assets/images/travel_router_hacking_p4/endpoint_classes.png)

So now we have a directory mapping from endpoint to Java class!

## Goform Set/Get Methods

The available goform set methods are very similar to the *MF910* - a huge list of them is seen in the ***com.lr.web.util.SetFormUtil*** class. Each method has an associated class that performs the action, usually firing off an intent to something which will actually perform the action.

The story is very similar for the get methods, except instead of just fetching the values from a config, it uses Content Providers and various databases.

### Authentication

In the ***web.xml*** file, there is the concept of an *AuthFilter* which can be applied to URLs:

![auth_filter.png](/assets/images/travel_router_hacking_p4/auth_filter.png)

The *com.lr.main.filter.AuthFilter* is specifically designed for the goform set handler, and the request will only be handled pre-auth if the request is one of the following types:
- LOGIN
- ENTER_PIN
- ENTER_PUK
- ENABLE_PIN
- DISABLE_PIN
- SET_WEB_LANGUAGE

This is what makes the pre-auth HTTP share commands in the *MF910* post-auth on the *MF904*.

When a user logs in, the device returns a cookie, this is what the *JSESSIONID* cookie is for. Any request to any of the goform set methods not in the above list requires this cookie in the HTTP headers.

# Post-auth Bugs

Usually its much easier to find bugs in post-auth functionality (as the attack surface is much larger), so lets start with this.

## ADB Shell Access

When I was looking through the list of endpoints I discovered, the ones with ***adb*** in the name really stood out.

I spent some time reversing the ***com.lr.web.AdbWifiDebugForm*** which implements the ***/adbWifiDebugForm.do*** endpoint, and used the following request to enable adb over WiFi on the device:

![root_shell.png](/assets/images/travel_router_hacking_p4/root_shell.png)

There is a check at the start of the ***/adbWifiDebugForm.do*** handler to ensure the user is logged in, but this is still very handy to have.

![root_shell_adb.png](/assets/images/travel_router_hacking_p4/root_shell_adb.png)

## Command Injection

After having a look at some of the various post-auth goform set command handlers in ***com.lr.web.util.SetFormUtil***, I was looking at the handler for ***ADD_IP_PORT_FILETER***.

![root_shell_adb.png](/assets/images/travel_router_hacking_p4/ip_port_fileter.png)

The handler for this functionality basically constructs a rule that contains all of the port filtering info, it then saves this constructed string to the shared preferences under ***IPPortFilterRules_\*ID\****. With the new rule saved, it calls ***sendFilterBroadcast*** to construct a ***com.lr.ip_filter*** intent - which is then broadcast. 

The intent is received by the ***TeleService*** app, which spins up an ***ipFilterThread***, which just calls ***runIpFilter***:

![root_shell_adb.png](/assets/images/travel_router_hacking_p4/cmd_injection.png)

As you can see in the function above, this just loads the ***IPPortFilterRules_*ID**** string that was saved earlier, and passes this into a call to ***runShellScript*** - this function just takes the first string and all the arguments, appends them, then runs this as root.

As there are no checks on the contents of this string before it is saved or after it is loaded, we can get a command injection by setting the ***command*** parameter we pass into the initial request to *** ; touch /data/local/tmp/pwned ; *** for example.

# Auth Bypasses

With the post-auth bugs covered, I started looking at the limited pre-auth surface of the web server. I ended up discovering a couple of ways to trivially bypass the admin password authentication.

## Auth Bypass 1 - Hardcoded Credentials

The first auth bypass is in the handler for the ***LOGIN*** goform set command:

![bypass1.png](/assets/images/travel_router_hacking_p4/bypass1.png)

In the above function, you can see it comparing the provided credentials with the admin username and admin password - however, it also compares them both against a hardcoded string: **hebangadmin**. Logging in with this string as the username and password will yield a successful login.

## Auth Bypass 2 - Goform Get

In the last router, the goform get method had a subset of config values that could be retrieved before a valid login. However, on this router, there is absolutely zero authentication required to use this endpoint. Therefore, we can just ask nicely for the *admin_Password* without logging in:

![bypass2.png](/assets/images/travel_router_hacking_p4/bypass2.png)

# What About the Other Router?

At this point, I have only talked about the *MF904* travel router, but I did in fact buy a different model as well. I bought the second router mostly because it looked cool, but also because it was another KuWfi device so I figured the bugs had a higher chance of being on it:

![orange_router.png](/assets/images/travel_router_hacking_p4/orange_router.png)

The exact model is an *MF931*, and the firmware on this one is basically identical to that of the *MF904* - so all the issues we found on the *MF904* also impact the *MF931* which has a very different appearance. Maybe these bugs impact quite a good chunk of these dodgy Aliexpress ZTE devices?

# Conclusion

Although most of our bugs from the previous blogs weren't present in this router, it didn't take long for us to find some replacements that we can chain to get us a pre-auth root shell over LAN. I hope my hacking blogs have taught you not to trust cheap stuff off of Aliexpress!

![bounty.gif](/assets/images/travel_router_hacking_p4/dolla.gif)