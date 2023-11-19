---
published: true
title: "💰 A Hands-on Guide to Building a Crypto Ticker"
toc: true
toc_sticky: true
categories:
  - Coding
tags:
  - ESP8266
  - Arduino
  - C++
  - PCB Design
  - 3D Printing
tagline: "I wanted to create something that I could use to monitor current prices for various crytpocurrencies, as well as my portfolio, at just a glance away from my screen. There existed some implementations for ESP8266 (small micro-controller devices), but they were all lacking, so I decided to make my own!"
excerpt: "I made a cryptocurrency monitoring tool to check coin prices and portfolio value at a glance. Existing ESP8266 solutions were lacking, so I made my own."
header:
  overlay_filter: 0.4
  teaser: /assets/images/a_hands_on_guide_to_building_a_crypto_ticker/teaser.jpg
  overlay_image: /assets/images/a_hands_on_guide_to_building_a_crypto_ticker/teaser.jpg
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

This blog highlights how I built my crypto ticker from scratch, and also act as a guide if you wanted to take my designs and construct your own! This blog is full of personal firsts - designing a very simple PCB, creating a 3D printed model, and interacting with API's using the ESP8266.

# ESP8266 Development

The ESP8266 is a small microcontroller that boasts WiFi functionality. It is commonplace in IoT devices, and is a staple of several hobbyist electronics projects. It has plenty of options to allow you to construct complex systems, and connect peripherals using the plethora of GPIO pins. I used the NodeMCU 1.0 ESP8266 development board for this project.

![nodemcu.png](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/nodemcu.png)

To write my code, I used [Arduino](https://www.arduino.cc/) as this makes everything easier and is the go-to for projects like these that involve microcontrollers. It is very easy to add your own libraries, search for and download additional libraries to include in your code, and building and uploading your code to the device. To get going, all you need to do is add the ESP8266 drivers to your board manager in Arduino, select the correct one, build and upload the blink example and you should be good to go.

I highly recommend the [Visual Studio Code extension for Arduino](https://github.com/microsoft/vscode-arduino), it makes writing libraries, Arduino sketches, and building/uploading code, easy to do on a single window. You can also easily view the Serial output of the device, which is very useful for debugging.

# Choices

In this section, I will justify the peripherals I chose, and some of the design decisions I made.

## Interaction

One of the things I was insistent on when I started developing this device is that I wanted it to be customisable without needing to touch the code. If you find a new coin you should be able to add this to the coins you are monitoring, and if you buy/sell something, you should be able to change your portfolio to reflect this.

To enable this customisation, the user must be able to interact with the device to make changes. There are a few options for this, such as buttons, but I decided that the easiest method would be to use an infrared (IR) remote. This means you can be far away from the device, and still be able to interact with it, and the components are quite cheap.

![ir.PNG](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/ir.PNG)

The library required to operate this peripheral is **IRremote**, and is available in Arduino's library manager.

## Screen

This device would be pretty useless if there was not a way of viewing the information! I wanted the screen to be sizeable, bright, and with colour. This means that things like a small OLED screen, or a large LED matrix are out of the question. I did some research, and came across a relatively cheap 160x128 1.77 inch TFT display that looks fitting and doesn't require additional power, perfect!

![st7735.PNG](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/st7735.PNG)

This peripheral requires the **Adafruit ST7735 & ST7789** and **Adafruit GFX** libraries to be installed, these libraries allow you to draw shapes, text, and give you control down to the pixel.

## Data

The whole point of this device is to pull current/recent cryptocurrency prices to build charts and display prices, so I need a source of price data. CoinGecko offers a great [free API](https://www.coingecko.com/en/api) for getting current prices, and a bunch of additional information if needed. The ESP8266 has WiFi capabilities, and is able to interact with this API with some setup, and an understanding of the API to construct requests.

# Device Layout

Now I need to connect the peripherals I selected to the device, I can use the various programmable GPIO pins on the ESP8266 to interact with the non-power relevant pins. The display requires the **BL** and **VCC** pins to have a **3.3V** supply, and the **GND** pin to be grounded - the remaining pins are connected to various GPIO pins. The IR receiver just needs **3.3V** power, **GND**, and a single GPIO pin for data.

After connecting all of these together, and testing to make sure everything was working, this is the final layout:

![layout.png](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/layout.png)

# The Code

I won't be going into extensive details as there would be a lot of code to talk about, but I will cover the general structure, and some of the more interesting components at a higher level.

## Keyboard

If you take a look at the layout of the IR remote, you can see that all we have is some directional keys, and a number pad. How can we use this to enter arbitrary text into the device? We need a keyboard.

The keyboard is pretty simple, it has four 'modes': _lower case_, _upper case_, _numbers_, and _special characters_. The keyboard uses the directional keys to allow the user to enter input into the device.

![keyboard.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/keyboard.jpg)

## WiFi and API Requests

To get the data, we have to interact with the CoinGecko API using the WiFi functionality of the ESP. I used the keyboard to allow a user to enter their WiFi credentials which are stored in the EEPROM. I should have encrypted these with a master key of some sort, but having to enter that every time you turn the device on would annoy me as a user, maybe upgrading to an ESP32 which offers secure storage would be the best thing to do.

The function starts by setting up a HTTPClient and a WiFiClient, these will be used to construct and send the HTTP request to the API, and retrieve the response. The URL is constructed by using the hard-coded URL start and end, and inserting the API names of the selected coins. Here is an example API request:

**https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum%2Ccardano&vs_currencies=GBP**

The above API request is requesting the price information for **bitcoin**, **ethereum**, and **cardano** in GBP (the currency can be changed between GBP, USD and EUR on this device). The API then responds with the contents which is parsed using a HTTP stream into an [ArduinoJson](https://arduinojson.org/) document. Here is the API response to the above sample:

```
-json
{
  "ethereum": {
    "gbp": 1395.22
  },
  "cardano": {
    "gbp": 0.33548
  },
  "bitcoin": {
    "gbp": 19483.92
  }
}
```

Each coin response is handled one by one by using the HTTP stream, this means we can use a smaller ArduinoJson document to reduce memory usage. Here is the code that does this:

```
-c
// Parse incoming JSON from stream
http.getStream().find("\"");
do {
  read_bytes = http.getStream().readBytesUntil('"', id_buffer, 32);
  id_buffer[read_bytes] = 0;

  http.getStream().find(':');
  deserializeJson(doc, http.getStream());

  // Add to coin or portfolio
  if (app_mode == 1) {
    for (int i = 0; i < selected_coins_count; i++) {
      if (strcmp(id_buffer, selected_coins[i] -> coin_id) == 0 &&
        doc[currency_options_lower[selected_currency]] > 0) {
        selected_coins[i] -> current_price = doc[currency_options_lower[selected_currency]];
        selected_coins[i] -> current_change = doc[currency_options_changes[selected_currency]];
        selected_coins[i] -> candles -> addPrice(doc[currency_options_lower[selected_currency]]);
        break;
      }
    }
  } else if (app_mode == 2) {
    int j = 0;
    while (portfolio_editor -> selected_portfolio_indexes[j] != -1) {
      if (strcmp(id_buffer, coins[portfolio_editor -> selected_portfolio_indexes[j]].coin_id) == 0 &&
        doc[currency_options_lower[selected_currency]] > 0) {
        coins[portfolio_editor -> selected_portfolio_indexes[j]].current_price =
          doc[currency_options_lower[selected_currency]];
        coins[portfolio_editor -> selected_portfolio_indexes[j]].current_change =
          doc[currency_options_changes[selected_currency]];
        break;
      }
      j++;
    }
  }
} while (http.getStream().findUntil(",\"", "}")); // Continue until last '}' reached
```

The function also shows how the information retrieved from the API request is loaded into the respective objects, for both the coin and portfolio modes. I chose to use this method in order to reduce overall memory usage as having huge buffers on the heap was causing some crashes (the WiFi/HTTP elements use a lot of memory!).

## Charts

One of the reasons I chose the larger ST7735 TFT display was so that I could draw some interesting charts - having just a price and coin name/ID on the screen isn't very interesting. So, I threw together a class for a candletick chart that could be used for each coin, and the portfolio. I also made it so that it could be more of a line-chart for the multi-coin mode. I think it turned out great and gives you more of a general idea of the state of the coin than just the current price/24 hour change.

I also added some settings that allows the user to change the period of each candle, ranging from five to sixty minutes. This gives the user a bit more flexibility and customisation, which is always good. The ESP just records when the chart was last incremented, and checks if the time since that point is over the selected time period.

![chart.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/teaser.jpg)

## Coin Entries

Each coin has the following main components:

- Candle chart
- Logo bitmap
- Foreground and background colours
- CoinGecko ID
- Coin Code
- Current price
- 24 hour change

I included the logo bitmap, foreground and background colour for a few reasons, the first of which was to make the coin information display look better, and also to add another way of representing the coin in charts, for example, in the portfolio pie chart. The bitmaps were generated using https://javl.github.io/image2cpp/, and the 5:6:5 packed RGB representations using http://greekgeeks.net/#maker-tools_convertColor. However, these can also be generated using the ESPIRAssist tool I wrote to aid with adding new 'default' coins. The bitmaps are stored in **bitmaps.c**, and are read by the **drawBitmap** function to set a pixel to a colour based on the value in the bitmap, sort of like a mask. Note that these bitmaps can be disabled by the user if they prefer a more minimalistic display.

The ID and code can be retrieved from the CoinGecko website pretty easily, and the candle chart is filled over time. All of these components come together to create quite a nice display for each coin:

![coin_display.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/coin_display.jpg)

I also wanted to add a mode where multiple coins were visible at the same time, this was achieved by removing the bitmaps, and using the smaller version of the candle chart. This allowed me to squeeze four entries onto the display, with their current price and 24 hour change still visible:

![multi_coin.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/multi_coin.jpg)

## Portfolio

All of the other projects I saw before that utilised an ESP8266 never had the option of adding your own portfolio, this was a feature I definitely wanted. I achieved this by adding an **amount** property to each coin, which indicates how much of the coin you own. There is a menu on the device which allows you to select one of the coins, and type the amount you own with the number keys on the IR remote. The device calculate the value of your portfolio by simply iterating over all of the coins, multiplying their price by the amount owned, and summing all of this to get the value.

I decided to have a simple 'breakdown' of the portfolio as the first mode, which lists all of the coins, how much you own, and the 24 hour change. This is great for assessing the value of each asset at a quick glance:

![port_decomposition.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/port_decomposition.jpg)

The next mode displays the percentage of the portfolio that each coin is, along with a pie chart to visualise this. This is great if you aim to maintain certain percentage values in your portfolio, e.g. 50% BTC, so you can check if this is holding with this mode:

![port_percentages.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/port_percentages.jpg)

The final mode is the candlestick chart mode, which basically just shows a candlestick chart for the entire portfolio. This chart also features minimum and maximum values, to give the user a bit more context. This is great for somebody that likes to keep up with the trend of their portfolio.

![port_candle.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/port_candle.jpg)

## Customisation

One of the aims of this device was to be highly-customisable, and I was able to achieve this by implementing a menu with sub-menu's that allows user to change several aspects of the device. Here are all of the options:

![menu.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/menu.jpg)

These options allow the user to change the list of coins that are displayed/have their prices recorded, change their portfolio, and even add new coins that aren't on the device originally (unfortunately without bitmaps). There are also options for customising the coin display and portfolio display settings, mainly for changing the candlestick chart period, and disabling automatic cycle - where the coins/portfolio modes are cycled through automatically on a timer. There are also buttons for clearing aspects of the device from the EEPROM memory, such as the portfolio.

Despite the fact that new coins with bitmaps can not be added, I wanted to make it as easy as possible for somebody to make this change to the sketch directly if they so wish. I did this by creating a tool called [ESPIRAssist](https://github.com/luke-r-m/ESPIR-Crypto-Ticker/tree/main/ESPIR_Assist), which can generate bitmap code, and directly modify the code to add new coins. I used tkinter to create the GUI:

![port_candle.jpg](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/port_candle.jpg)

## Interaction

In terms of general interaction with the device, the display modes can be changed with the up and down keys to cycle between the three modes : Coin display, multi-coin display, and portfolio. The left and right arrow keys are used to cycle between the displayed coins in the coin mode, and the portfolio representations in the portfolio mode. There is an option to automatically cycle through these options provided by the horizontal arrow keys, and the period of this can be altered/it can be disabled. The menu can also be entered at any point with the **OK** key of the remote.

## EEPROM

I wanted to ensure that the customisation options, any added coins, and the portfolio amount were consistent when power is turned off. I managed to do this by utilising the internal EEPROM of the ESP8266. Unfortunately, this memory is limited to 512 bytes, but this should be big enough.

For saving the coins, I used a sort of 'block' structure, where each block contains an indication that it is full, the index of the coin in the coin array (the index of the original coin that it replaced), the CoinGecko ID of the coin, its code, and also the selected colour. These coins are loaded from the EEPROM on boot and replace the default coins. The portfolio is saved to the EEPROM using a similar method, but it only needs the index of the coin entry, and the amount owned.

Finally, the settings are saved to the EEPROM by simply writing the ID of the selected option in the menu items, as well as the indexes of the selected coins. These are loaded from EEPROM from boot, and the settings/selected coins are exactly the same as they were before power was lost!

# PCB Design

Now that the software has been written, I need to make it look good. Step 1 of making it look good is to get the size of it down as at the moment its just wires connecting everything together which looks pretty terrible. The aim of this PCB is to connect all of the components together nicely, it won't be hosting any components, so this should be a really simple process.

I used [EasyEDA](https://easyeda.com/) to design my PCB, and this worked really well - there are plenty of great tutorials out there for this software as well. There is also a large collection of designs that other people have created, I used one of these to get the spacing of the ESP8266 pins correct which worked really well. I only needed a two-layers for my PCB, so the design process was pretty effortless, here is what I was left with:

![pcb.png](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/pcb.png)

Quite possibly the simplest PCB you will ever see! I used [JLCPCB](https://jlcpcb.com/) to manufacturer the PCB's, and they arrived in a few weeks.

# 3D Printing

Now we have the PCB put together, and everything fits first time (somehow), lets move on to creating the enclosure.

## Attempt 1

I used [Tinkercad](https://www.tinkercad.com/) to create the enclosure, it's really easy to use and reminds me of Google sketchup. Again, there are plenty of tutorials kicking about, as well as a library of models other people have made.

Here is the first design I came up with:

![attempt_1.gif](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/attempt_1.gif)

And here is how it looked after printing with the constructed device mounted inside:

![attempt_1.png](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/attempt_1.png)

It looks great, but the slots on the side are clearly too small, and the mounting to the back barely works (the back also looks terrible), so this needs a redesign.

## Attempt 2

I made the slots on the side larger and more towards the back, I took the name off of the back and extended the bottom design. I also hollowed out the bottom legs to give the print a shorter duration. The back now sits on a lip on the back of the main body, with screws that connect everything together. I also created an insert to support the NodeMCU, as when the USB cable is connected on the original, there was a lot of movement.

Here is the final design:

![attempt_2.gif](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/attempt_2.gif)

And here is how it looks fully assembled:

![attempt_2.png](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/attempt_2.png)

Looks good to me!

# Conclusion

Overall, I'm happy with how everything turned out. I also wrote an [instruction manual](https://drive.google.com/file/d/1oRMSnJ5hCsDvF1AvCW1pmuY895ZvOt5e/view?usp=sharing) which goes into more detail about all the functionality the device has. It was great to dip my toes into some very basic PCB design and 3D printing. All of the code/resources discussed in this blog are available in the [Github Repository](https://github.com/luke-r-m/ESPIR-Crypto-Ticker)!

![finished.gif](/assets/images/a_hands_on_guide_to_building_a_crypto_ticker/finished.gif)
