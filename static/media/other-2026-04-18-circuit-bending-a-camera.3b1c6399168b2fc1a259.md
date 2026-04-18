---
published: true
title: "📷 Circuit Bending a Cheap Camera"
toc: true
toc_sticky: true
tagline: "The other day I stumbled across an Instagram reel about circuit bending cameras for cool effects, and decided to try it myself!"
tags:
    - Hardware
    - Fun/Creative
---

While AI cracks on taking my job, I decided to explore some more domains (outside of hacking) in my free time - so expect more blogs of me trying weird stuff I think is cool to cleanse my pallette from the existential dread - all electronics and tech related of course.

The first of which, is circuit bending. It's kind of in the same evolutionary branch as fault injection in a weird way (mainly crowbar glitching is probably the most direct comparison). In this blog, we'll be focusing on cameras, but circuit bending can also be applied to audio equipment to get cool effects.

# Circuit Bending

I'd never even considered circuit bending as a thing before, glitches have been tarnished with a bad reputation - circuit bending flips that on its head, and uses the glitches for desirable effects.

It really does give me the vibe of early hacking, devices with wires hanging out of the side, shorting them to break things in cool ways, bricking stuff when you short VCC to GND - super cool.

![circuit_bending.png](/assets/images/other/circuit_bending_cameras/circuit_bending.png)

I really recommend having a browse through [r/CircuitBending](https://www.reddit.com/r/CircuitBending/) on reddit, the effects people manage to get out of cameras are super cool, even as someone who isn't super into photography.

# Target

There aren't many tutorials online, but most of them focus on cheap toy cameras - I managed to snag one on Vinted for dirt cheap (with a 32gb SD card - score!).

![camera.png](/assets/images/other/circuit_bending_cameras/camera.png)

After ripping it apart, I had to find some nice points to mess with. The easiest way to bend cameras (according to the tutorials I read) is to short data pins around the connector for the camera sensor. Luckily, this camera was full of test points, so on this one, I didn't have to solder directly to the connector pads, which saves a headache. I have seen some people online bridge the pads, but it is hard to identify which pins yield cool bends without trial and error.

![pins.jpg](/assets/images/other/circuit_bending_cameras/pins.jpg)

# First Bend

At this point, I had just soldered wires to the data pin testpoints, and just started shorting stuff. This is the first glitch I got:

![first_bend.jpg](/assets/images/other/circuit_bending_cameras/first_bend.jpg)

Glitching the data pins on this camera can be pretty green-heavy, there is definitely a reason but I'm not that interested as to why - I just want to get cool bends!

# Assembling Camera

After a bit of trial and error and shorting various stuff (and somehow not blowing up the sensor), I found four pins that when shorted yielded cool glitches. I wired up a switch and three potentiometers, each one introducing a short of the associated pin when adjusted. This means I can have no shorts, or short any number of those four pins to allow more combinations and therefore effects.

Here is how it looks now - not the prettiest, but it gets the job done:

![finished_camera.jpg](/assets/images/other/circuit_bending_cameras/finished_camera.jpg)

# More Bends

Now that I have three potentiometers controlling which pins get shorted, and a switch to trigger another glitch, I can get some cooler shots with it by adjusting which glitches are in play, and how much they are in play with the potentiometers.

- This bend is super cool, it essentially makes the image black and white, but only lets red through, giving a cool glitchy effect on this red can:

![dr_pepper.jpg](/assets/images/other/circuit_bending_cameras/dr_pepper.jpg)

- The camera also has built in filters, which can help soften the colours of some of the crazier bends:

![kevin.jpg](/assets/images/other/circuit_bending_cameras/kevin.jpg)

- This bend makes the image very RGB heavy, the red bit is his tongue:

![kevin2.jpg](/assets/images/other/circuit_bending_cameras/kevin2.jpg)

- In this one, I liked how the brightness coming from the lamp was stepped and glitchy:

![lamp.jpg](/assets/images/other/circuit_bending_cameras/lamp.jpg)

- This is a good example of a more intense bend where its a bit trickier to see what is going on - cool colours though:

![livingroom.jpg](/assets/images/other/circuit_bending_cameras/livingroom.jpg)

- These demonstrate the effect of the switch when some more bends are applied:

![motorola1.jpg](/assets/images/other/circuit_bending_cameras/motorola1.jpg)
![motorola2.jpg](/assets/images/other/circuit_bending_cameras/motorola2.jpg)

- This one feels like a clustering algorithm has been run on the colours, pretty cool effect:

![pylon1.jpg](/assets/images/other/circuit_bending_cameras/pylon1.jpg)

-  More intense bends, the border around the pylon is interesting:

![pylon2.jpg](/assets/images/other/circuit_bending_cameras/pylon2.jpg)

- An old Motorola I have lying around looks super cool with these colours:

![v70e.jpg](/assets/images/other/circuit_bending_cameras/v70e.jpg)

- The camera also has an invert filter if you get sick of the heavy green bias:

![view.jpg](/assets/images/other/circuit_bending_cameras/view.jpg)

# Conclusion

I'm probably going to try and get my hands on a more sophisticated old camera, so I can get higher megapixel images with different effects as this was a super interesting experiment. I'm not a photographer at all, but these effects seem to make the most mundane of images look awesome - if you've got a soldering iron and some free time, have a go!