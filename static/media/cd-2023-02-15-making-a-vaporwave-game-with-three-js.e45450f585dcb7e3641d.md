---
published: true
title : "💻 Making a Vaporwave Game with Three.js"
toc: true
toc_sticky: true
categories:
  - Games
tags:
  - three.js
  - JavaScript
  - Blender
  - GLSL
tagline: "I made a vaporwave-inspired game named VaporRacer using a JavaScript library called Three.js, which utilises WebGL to render graphics in web browsers. This blog goes over my design process, some of the skills I learned along the way, and a showcase of the finished product."
excerpt : "Three.js is a JavaScript library that utilises WebGL to create and display computer graphics in a web browser. Lets make a game with it!"
header:
  overlay_filter: 0.4
  teaser: /assets/images/making_a_vaporwave_game_with_three_js/postprocessing.PNG
  overlay_image: /assets/images/making_a_vaporwave_game_with_three_js/header.png
  #caption: "Photo credit: [**Unsplash**](https://unsplash.com)"
---

The game will follow a incremental difficulty template, such as Subway Surfers or Temple Run. It will also be space/vaporwave themed, so a person running doesn't make much sense - if you hadn't guessed from the name of the game, a car was used instead.

## Blender Model

Blender is a great piece of software for 3D-modelling, texturing, animation, and many other things! It's open-source, and you can make some really detailed models with it. I used this software to create the car model that I will use for the game. This was the first time I ever used Blender so I needed to watch several tutorials, my favourite was [this one](https://www.youtube.com/watch?v=nIoXOplUvAw&list=PLjEaoINr3zgFX8ZsChQVQsuDSjEqdWMAD), it's a great resource, and one of the best tutorials out there for Blender.

Here is the design I came up with:

![models.png](/assets/images/making_a_vaporwave_game_with_three_js/models.png)

As you can see, it's heavily inspired by the Toyota AE86 Trueno - an absolute classic. I felt it was very fitting to the environment, mainly because it looks very similar to a DeLorean. I added the engine-like models on the bottom as the car will be floating so it doesn't really make sense to have wheels!

![car_model.gif](/assets/images/making_a_vaporwave_game_with_three_js/car_model.gif)

I exported the model as a *.glb* file so that it can be loaded into the game easily, lets get started with three.js!

## Three.js Basics

The [documentation for three.js](https://threejs.org/docs/index.html#manual/en/introduction/Creating-a-scene) is very comprehensive, and probably does a better job of explaining things than I can! They also have [loads of examples](https://threejs.org/examples/#webgl_animation_keyframes) if you want to see what this library is truly capable of.

The easiest way to get started with this library is to download an example and adapt it to what you want to do, querying the documentation when you get stuck - that's how I learned! I will briefly describe some of the most important aspects of the file. 

Start by creating your HTML document, it should look something like this:

```
-html
<html lang="en">
  <head>
    <title>VaporRacer</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, user-scalable=no, minimum-scale=1, maximum-scale=1" />
  </head>
  <body>
    <div id="container"></div>
    <script type="module">
      import * as THREE from "/assets/three.js/build/three.module.js";
      /* This is where our JavaScript goes */
    </script>
  </body>
</html>
</html>
```

We need two functions : *init*, and *animate*. *Init* starts everything up, and defines important elements of the sketch such as the renderer and camera elements. Think of *Animate* as a loop, constantly updating the sketch - similar to Arduino.

The first things you need to configure are the renderer and the scene (what gets rendered), otherwise you won't get very far - I used the [*WebGLRenderer*](https://threejs.org/docs/index.html?q=WebGLR#api/en/renderers/WebGLRenderer):

```
-javascript
// To get the containing HTML element
container = document.getElementById("container");

// Initialise scene
scene = new THREE.Scene();

// Define the renderer
renderer = new THREE.WebGLRenderer({
  antialias: true
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(document.getElementById("container").clientWidth,
  document.getElementById("container").clientWidth * 9 / 16);
container.appendChild(renderer.domElement);
```

Next you will need a camera to actually see your scene, I used a [*PerspectiveCamera*](https://threejs.org/docs/index.html?q=Perspective#api/en/cameras/PerspectiveCamera) for this. You need to tell it where it goes, its aspect, and what it should be looking at - this defines the viewing frustrum of the camera:

```
-javascript
// Define the camera
camera = new THREE.PerspectiveCamera(60,
  canvas.width / canvas.height, 1, 50000);
camera.position.set(0, current_camera_y, current_camera_z);
camera.lookAt(0, 950, -5000);
```

Note that these should be global so you can access them in your animate function. At the moment, all the animation functions needs is this:

```
-javascript
requestAnimationFrame(animate);
renderer.render(scene, camera);
```

This requests the animation frame, and tells the renderer to render the created scene from the perspective of the created camera.

Those are the basics, simple enough!

## Scenery

As I mentioned earlier, vaporwave/space is the intended theme. Here are some of the inspiration images for the scenery:

![inspo.png](/assets/images/making_a_vaporwave_game_with_three_js/inspo.png)

The main components of the scenery are the sun with the orange-pink gradient, dark mountains with the colourful grid lines, and the flat middle-plane. This seems perfect for the style of game I want to create, so lets aim for a similar environment.

### Mountains

The first task was to generate the heights used by the mesh that will act as the mountains. I decided to go with Perlin noise and proceduraly generate the floors throughout the game. This requires two panels that are contantly jumping to the end of the view in front of the player when they go out of the view behind the player - rendering a massive panel wouldn't go well!

I used three.js **ImprovedNoise** to generate the heights, [this example](https://threejs.org/examples/webgl_geometry_terrain.html) was very useful for this. I also added some variables that would completely flatten the area in the middle of the mesh, and also make the height of the mountains peak in the middle of the two sides - this hides any dodgy edge lines and keeps everything looking smooth.

```
-javascript
this.generateHeight = function(width, height) {
  const size = width * height,
    data = new Uint8Array(size);
  let quality = 50;

  for (let i = 0; i < size; i++) {
    const x = i % width,
      y = width - ~~(i / width);

    // Used to create flat area in middle and flat edges
    var influence =
      Math.abs(width / 4 - Math.abs(Math.abs(x - width / 2) - width / 4)) /
      100;
    var close_to_centre = (Math.abs(x - width / 2) - 25) / 4;

    // Used perlin noise to get value if not in the flat area
    if (Math.abs(x - width / 2) > 25) {
      data[i] +=
        influence *
        close_to_centre *
        Math.abs(
          this.perlin.noise(
            x / quality,
            ((width - 1) * this.iters + y) / quality,
            this.z
          ) * quality
        );
    }
  }

  this.iters++;
  return data;
};
```

Now that we have some heights generated, we need to create our texture to go onto the mesh. The function I used to generate the mesh's is pretty big and ugly, so I will omit it here. The function basically just creates an image with a colour gradient from black in the middle, to a dark purple on the outside. It then adds the grid lines with a gradient from light turquoise to light green. It writes the RGB values to the image object directly, and then constructs the created image to be applied to the mesh.

With both of these ingredients completed, we can now generate the meshes that will be used with the following function:

```
-javascript
this.initialiseFloors = function(scene, z_offset) {
  // For floor mesh 1
  var data = this.generateHeight(this.worldWidth, this.worldDepth);
  var geometry = new THREE.PlaneGeometry(
    this.plane_x,
    this.plane_y,
    this.worldWidth - 1,
    this.worldDepth - 1
  );
  geometry.rotateX(-Math.PI / 2);

  // Amplify the generated height y values, and move down by z offset
  var vertices = geometry.attributes.position.array;
  for (let i = 0, j = 0, l = vertices.length; i < l; i++, j += 3) {
    vertices[j + 1] = data[i] * 10;
    vertices[j + 2] -= z_offset;
  }

  // Generate the first floor panel texture and mesh
  this.floor_texture_1 = new THREE.CanvasTexture(
    this.generateTexture(data, this.worldWidth, this.worldDepth, false)
  );
  this.floor_texture_1.wrapS = THREE.ClampToEdgeWrapping;
  this.floor_texture_1.wrapT = THREE.ClampToEdgeWrapping;

  this.floor_mesh_1 = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      map: this.floor_texture_1
    })
  );
  this.floor_mesh_1.name = "Floor Mesh 1";
  scene.add(this.floor_mesh_1);

  // Do the same for the second panel ...
};
```

The function generates the heights, creates a Plane with the [*PlaneGeometry*](https://threejs.org/docs/index.html?q=PlaneG#api/en/geometries/PlaneGeometry) object, and sets the vertices of the created plane object to the generated vertices (while also amplifying the bumps of the mesh). The texture image is then generated, and placed into a [*CanvasTexture*](https://threejs.org/docs/index.html?q=Canvas#api/en/textures/CanvasTexture) object. The generated geometry and texture are then used to create a [*MeshBasicMaterial*](https://threejs.org/docs/index.html?q=MeshBasic#api/en/materials/MeshBasicMaterial) (our final mesh), which is added to the scene. This process is reapeated for the second mesh as well, but positioned further away from the camera.

Lets see how it looks:

![hills_textured.PNG](/assets/images/making_a_vaporwave_game_with_three_js/hills_textured.PNG)

### Sun

The next job is to add the sun to the scene, all I had to do was add a circular mesh, and colour it with a gradient using a GLSL shader:

```
-javascript
this.initialiseSun = function(scene) {
  // Init sun geometry
  const sun_shape = new THREE.Shape();
  sun_shape.absarc(0, 0, 8000);
  const geometry = new THREE.ShapeGeometry(sun_shape, 50);

  // Generate the shader material used for the suns gradient
  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
      }`,
    fragmentShader: `
      varying vec2 vUv;

      void main() {
        float st = abs(vUv.y / 7000.0);

        vec3 color1 = vec3(1.0, 0.65, 0);
        vec3 color2 = vec3(1.0, 0.0, 0.65);

        float mixValue = st;
        vec3 gradient = mix(color1,color2,mixValue);

        gl_FragColor = vec4(gradient, 1.);
      }`,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // Set sun position (far away from player to reduce parallax)
  mesh.position.y = 0;
  mesh.position.z = -49500;

  scene.add(mesh);
};
```

You can see in the function that we initialise the geometry of the Sun as a circular shape with 50 segments, we then create the [*ShaderMaterial*](https://threejs.org/docs/index.html?q=ShaderM#api/en/materials/ShaderMaterial) that contains the shader. The shader is split into two components : a *vertex shader* and a *fragment shader*. The vertex shader is run once for each **vertex** in a mesh, so it primarily impacts things like position and sometimes colour. The fragment shader is run once for each **pixel** that a primitive covers, and can change the colour of a shape on a pixel-by-pixel basis. As we want a gradient, we only really need to do work in the fragment shader.

The fragment shader seen above calculates the mix value, which is the y coordinate of the pixel divided by 7000 (the height of the mesh). This is then used to map the pixel colour between the two colours (**color1** and **color2**) using the **mix** function. The pixel colour is then set by setting the **gl_FragColor** variable to the **gradient** colour (plus the alpha channel). Now we have a sun with a great-looking gradient:

![hills_with_sun.PNG](/assets/images/making_a_vaporwave_game_with_three_js/hills_with_sun.PNG)

### Buildings

I still felt like the edges of the scenery were a bit empty, so I decided to add some buildings to the edges to fill up the space. These buildings are essentially cyclinders and cuboids with varying height/width, with a coloured top that is either light green or light blue. The function that initialises the buildings basically fills up the sides of the view with buildings until they are outside of the view of the player. As the car goes forward, the buildings that go out of view behind get shifted back in front of the player, much like the hills. 

I wanted the hills to be reflective, so I set the **emissive** property of the material - meaning it will reflect light with a specified colour. This means without light, it doesn't look very good! So lets sort that out in the next section.

## Lighting

Lighting is a very important aspect of the game, especially now that the buildings are reflective. I added a total of three light sources, some are far more noticeable than others:
- *Ambient* : This is light that is always present, it doesn't come from a source so it doesn't cast any shadows - kind of like the light when it is a foggy day. We use [*AmbientLight*](https://threejs.org/docs/index.html?q=Ambient#api/en/lights/AmbientLight) for this.
- *Sun* : The Sun is obviously the main source of light, and it comes from a point, so we can use a [*SpotLight*](https://threejs.org/docs/index.html?q=SpotLight#api/en/lights/SpotLight) for this.
- *Headlights* : These lights come from the car, so they can also be a *SpotLight*, but a much lower intensity than the Sun!

You can see the initialisation of the light sources below:
```
-javascript
this.initialiseLighting = function(scene, camera) {
  // Add ambient light
  const color = 0xffffff;
  const intensity = 0.2;
  const light = new THREE.AmbientLight(color, intensity);
  scene.add(light);

  // Add sun spotlight
  var sunlight = new THREE.SpotLight(0xff9900);
  sunlight.intensity = 0.5;
  sunlight.position.set(
    camera.position.x,
    camera.position.y + 2500,
    camera.position.z - 50000
  );
  sunlight.target.position.set(0, camera.position.y, camera.position.z);
  scene.add(sunlight);
  scene.add(sunlight.target);

  // Add headlight spotlight
  var headlights = new THREE.SpotLight(0xffffff, 0.5);
  headlights.target.position.set(
    camera.position.x,
    camera.position.y + 1000,
    camera.position.z - 50000
  );
  headlights.position.set(0, camera.position.y, camera.position.z - 3100);
  scene.add(headlights);
  scene.add(headlights.target);
};
```

I also added some fog to the scene for an orange glow around the Sun, this was done in the *init* function with **scene.fog = new THREE.FogExp2(0xe98c00, 0.00003);**. Here is how is looks with the new buildings, lighting, and fog:

![completed_scenery.PNG](/assets/images/making_a_vaporwave_game_with_three_js/completed_scenery.PNG)

## Postprocessing

Postprocessing refers to additional steps taken after rendering to add visual effects, a good example is blur. In my case, as the game is aiming for a retro-style, I'd like to simulate a CRT monitor with scanlines and a slightly rounded screen shape. 

In three.js, you can add postprocessing by adding an [*EffectComposer*](https://threejs.org/docs/index.html?q=compose#examples/en/postprocessing/EffectComposer), which you can use to add multiple *Pass* objects to your scene, think of these like filters. You need to have a time variable (mine is called **delta_time**), and obviously the *EffectComposer* variable. You can add the composer in *init* like so:
```
-javascript
composer = new EffectComposer(renderer);
composer.setSize(canvas.width, canvas.height);
composer.addPass(new RenderPass(scene, camera));
```

You can then use the composer in the *animate* function like this:
```
-javascript
delta_time = Math.round(new Date().getTime() / 1000);
renderer.render(scene, camera);
composer.render(delta_time);
```

### Bloom

Once the composer is initialised, you can start adding passes with the **addPass** function. I imported a bloom pass (*UnrealBloomPass*) that comes with three.js as this makes brighter elements stand out, and improves the visual appearance of the game. To add this pass, I added the following to the *init* function after I added the *RenderPass*:
```
-javascript
bloomPass = new UnrealBloomPass(
  10, 0.75, 1, 0.6);
composer.addPass(bloomPass);
```

### CRT

To get the CRT effect, I will need to create my own shader, and utilise the *ShaderPass* three.js object:

```
-javascript
// Initialise the crt shader
const crtShader = {
  uniforms: {
    tDiffuse: {
      value: null
    },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * 
	    modelViewMatrix * vec4(position, 1);
    }`,
  fragmentShader: `
    #define SCAN_LINE_DENSITY 1000.0

    varying vec2 vUv; // From vertex shader

    uniform sampler2D tDiffuse;

    void main() {
      // Curve amounts for x and y
      vec2 curve = vec2(0.2, 0.4); 

      // Distances from the center
      vec2 distances = vec2(abs(0.5 - vUv.x), 
          abs(0.5 - vUv.y));

      // Square the distances to smooth the edges
      distances *= distances;

      // Modifiable vUv
      vec2 vUv_copy = vec2(vUv.x, vUv.y);

      // Apply the curvature
      vUv_copy.x -= 0.5;
      vUv_copy.x *= 1.0 + (distances.y * curve.x);
      vUv_copy.x += 0.5;

      vUv_copy.y -= 0.5;
      vUv_copy.y *= 1.0 + (distances.x * curve.y);
      vUv_copy.y += 0.5;

      // Get texture pixel
      vec4 tex_pixel = texture2D(tDiffuse, 
          vec2(vUv_copy.x, vUv_copy.y));

      // Add scanline
      tex_pixel.rgb += 0.1 * sin(vUv_copy.y * SCAN_LINE_DENSITY);

      /* Cut off the corners by setting corners to black 
      if not in range */
      if(vUv_copy.x > 1.0 || vUv_copy.y > 1.0 || 
        vUv_copy.x < 0.0 || vUv_copy.y < 0.0)
          tex_pixel = vec4(0.94, 0.83, 0.706, 1);

      gl_FragColor = tex_pixel;
    }`,
};

crtPass = new ShaderPass(crtShader);
```

The most interesting part of this shader is the fragment shader, what this does is calculate the pixels distance from the center, and 'moves' the pixel towards the centre based on this distance to get the desired curvature. It then applies the scan line based on the y coordinate of **vUv** and the **SCANLINE_DENSITY** value, finally cutting off the corners and filling them with the desired RGB colour. Adding this shader to the pass resulted in the desired CRT effect, which looked great with the bloom:

![postprocessing.PNG](/assets/images/making_a_vaporwave_game_with_three_js/postprocessing.PNG)

## Adding the Car

One of the main components of the game is the car. We will need to import the model created earlier, allow the user to control the car, and add any additional functionality we would like.

### Importing Model

The model was exported from blender as a *.glb* file, so we need to be able to read this file and import it into our scene. To do this, three.js has a pre-made loader called [*GLTFLoader*]() which allows us to read these files. The function below defines the GLTFLoader object, reads the *car.glb* file and loads it into a mesh, scales/positions it, then adds it to the scene.

```
-javascript
const modelLoader = new GLTFLoader();

// Load the car mesh
modelLoader.load(
  "/assets/VaporRacerAssets/Models/car.glb",
  function(gltf) {
    car_mesh = gltf.scene.children.find(
      (child) => child.name === "Car"
    );
    car_mesh.scale.set(
      car_mesh.scale.x * 200,
      car_mesh.scale.y * 200,
      car_mesh.scale.z * 200
    );
    car_mesh.position.y = 375;
    car_mesh.position.z = 1000;
    car_mesh.name = "Car_mesh";

    scene.add(car_mesh);
  },
  undefined,
  function(error) {
    console.error(error);
  }
);
```

### Speed

Now that we have the model imported, scaled, and positioned, it's time to make the game playable - we need to give the car some speed. The car starts off slow and accelerates, with the acceleration decreasing as it gets closer to its maximum speed. 

To stop the game from using outrageously large distances, instead of moving the car, we will move the scenery towards us to give the illusion of speed. I also added a rocking motion to the car so it looks like it is gliding through space.

I put all of the scenery into its own class, as it is much easier to manage - here is the function that moves the scenery:

```
-javascript
this.move = function(scene, speed) {
  for (let i = 0; i < this.buildings.length; i++) {
    if (this.buildings[i] != undefined) {
      // Move buildings towards player
      this.buildings[i].position.z += speed;
      this.building_tops[i].position.z += speed;

      // Move back if out of view
      if (this.buildings[i].position.z > -250) {
        this.buildings[i].position.z -= 50000;
        this.building_tops[i].position.z -= 50000;
      }
    }
  }

  this.moveFloors(scene, speed);
};
```

The *moveFloors* function essentially does the same thing as the buildings, but as it uses Perlin noise, it needs to regenerate the next pattern on-the-fly and make sure it connects with the previous floor mesh correctly.

Adding the speed and ambient movement to the car was simple enough. As with the scenery, I put all of the car elements into its own file, and created a *move* function that contained the following code:

```
-javascript
// Move car forwards when game started
if (this.car_mesh.position.z > -2500)
  this.car_mesh.position.z += (-2500 - this.car_mesh.position.z) * 0.05;

// Update car speed
if (!this.lane_change && !this.height_change) {
  if (this.car_speed < this.initial_max_speed)
    this.car_speed +=
    (this.initial_max_speed - this.car_speed) / this.initial_max_speed;

  if (this.car_speed < this.car_speed_cap)
    this.car_speed +=
    0.05 *
    (this.car_speed_cap - this.car_speed) / this.car_speed_cap;

  if (this.car_speed > this.initial_max_speed)
    this.lane_change_iters = 45 - Math.round(this.car_speed / 10);
}

// Ambient movement
if (!this.lane_change && this.car_mesh != undefined) {
  this.car_mesh.rotation.z =
    Math.sin((this.sin_z += 0.05 * Math.random())) / 10;
  this.car_mesh.rotation.y =
    Math.sin((this.sin_y += 0.03 * Math.random())) / 25;
}
```

To really sell the movement, I decided to add some particles that would come out of the brake lights towards the player. I made a bunch of tiny coloured meshes that come from the rear of the car that move back when they reach a position behind the camera. There is a lot of code for this, so I'll just show you the final result:

![car_movement.gif](/assets/images/making_a_vaporwave_game_with_three_js/car_movement.gif)

### Controls

The area is divided into a 3x2 grid - the car should be able to move between them, so I used the *WASD* keys for the directional controls. When you use the horizontal keys, the car spins to the direction you choose. And when you use the vertical keys, the car rises or falls to the desired height - as they don't impact eachother, you can start a vertical movement in the middle of a horizontal movement. 

I also wanted to be able to access any square from any other square in a single movement, so I made the animation detect if a horizontal press in the same direction as the existing movement has been pressed, and if so, it moves to the next square over.

The key-press handling works by listening for key-presses on the HTML document. The car movement functions are pretty simple so I will omit them from the blog - they basically just move and rotate the car:

```
-javascript
document.onkeydown = function(e) {
    switch (e.keyCode) {
      case 65: // Move left
        car.moveLeft();
        break;
      case 68: // Move right
        car.moveRight();
        break;
      case 87: // Move up
        car.moveUp();
        break;
      case 83: // Move down
        car.moveDown();
        break;
    };
```

So now we have a 'moving' car that we can control!

The game would not be complete without some sort of power-up, so I added the *hyperdrive* power-up. This hugely increases your speed for a short period of time, and plays a cool rotation animation which spins the camera and adds some white meshes that fly towards you. I also wanted there to be a colour change, so I created another shader that applies a blue-ish filter when the hyperdrive is active by multiplying the old colour with the desired colour (RGB components are between 0 and 1 so this works):

```
-javascript
uniforms: {
    tDiffuse: {
      value: null
    },
    colour: {
      value: new THREE.Color(0xff28ffff)
    },
  },
  vertexShader: `
	varying vec2 vUv;
	void main() {
      vUv = uv;
	  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
	}`,
  fragmentShader: `
	uniform vec3 colour;
	uniform sampler2D tDiffuse;
	varying vec2 vUv;

	void main() {
	  // Get previous pass colours
	  vec4 previousPassColour = texture2D(tDiffuse, vUv);

	  // Set the new colour by multiplying old with desired colour
	  gl_FragColor = vec4(
		previousPassColour.rgb * colour,
		previousPassColour.a);
}`,
```

Here is how it looks:

![hyperdrive.gif](/assets/images/making_a_vaporwave_game_with_three_js/hyperdrive.gif)

## Obstacles/Levels

With everything else working, we need to add some obstacles! To detect collisions with the vehicle, I added a rectangular hitbox to the car, we will use this to detect collisions with obstacles:

```
-javascript
this.car_hitbox = new THREE.Mesh(cubeGeometry, wireMaterial);
this.car_hitbox.position.set(0, 450, -2500);
this.car_hitbox.visible = false;
this.car_hitbox.name = "Car Hitbox";
scene.add(this.car_hitbox);
```

### Levels

I added three obstacle levels, all of the used models were created in Blender:
- *Asteroid Field* : This is the default level, and it consists of loads of asteroids that travel towards the player at the speed of the car (so fixed position in the world from player perspective).
- *Solar System* : This is a level that consists of a bunch of planets, each planet takes up four squares so the user must naviagate to one of the two safe squares every time there is a planet. I added bumpmaps to the planets to give them texture, but you can't really tell during gameplay!
- *Comet Trail* : This is a level that basically takes the asteroid level and gives the asteroids a tail and a high velocity towards the player.

The modes flip between the *asteroid field* level, randomly either the *solar system* or *comet trail* levels - repeating throughout the game. Every time a non-default mode appears, the hyperdrive charges by 50%. I'll let you find out what the levels look like when you play the game!

### Collision

We need to be able to work out if a collision has occured between an object and the car, if a collision is seen, the game should end. We already have the collision hitbox for the car, so we just need the object side of things to be sorted.

I added a function to the car class that takes an instance of the obstacles class, iterates over the current list of objects, and uses a [*Raycaster*](https://threejs.org/docs/index.html?q=RayC#api/en/core/Raycaster) object to detect collisions between the car hitbox and any of the objects:

```
-javascript
this.collisionDetection = function(obstacles) {
  if (this.car_hitbox != undefined) {
    this.updateHitBox(); // Move the cars hit box to get recent position

    var originPoint = this.car_hitbox.position.clone();
    const globalVector = new THREE.Vector3();

    for (
      var vertexIndex = 0; vertexIndex < this.car_hitbox.geometry.attributes.position.count; vertexIndex++
    ) {
      // For ray direction
      globalVector.fromBufferAttribute(
        this.car_hitbox.geometry.attributes.position,
        vertexIndex
      );
      globalVector.applyMatrix4(this.car_hitbox.matrixWorld);

      var directionVector = globalVector.sub(this.car_hitbox.position);

      // Create the raycast
      var ray = new THREE.Raycaster(
        originPoint,
        directionVector.clone().normalize()
      );

      // See if the ray intersects an obstacle
      var collisionResults = ray.intersectObjects(obstacles.obstacles);
      if (
        collisionResults.length > 0 &&
        collisionResults[0].distance < directionVector.length()
      ) {
        return true;
      }
    }
    return false;
  }
}
```

If any collision with the obstacles is detected, then it indicates that a collision has been observed so the game should end. I added some animation to the car when the game ends, namely the engines falling off, a small explosion from the car, and the car spinning as it falls to the floor.

That's all the gameplay completed!

## Finishing Touches

### Audio

To complete the atmosphere, I added some sounds when actions in the game are taken. I added an explosion sound when the game ends, a teleport-like noise when the car changes lane, and a sci-fi acceleration noise for the hyperdrive. I also added a background track that I felt matched the game well. This was achieved by adding an [*AudioListener*](https://threejs.org/docs/index.html?q=Audio#api/en/audio/AudioListener) to the camera, importing the sounds using an [*AudioLoader*](https://threejs.org/docs/index.html?q=AudioLoa#api/en/loaders/AudioLoader), and playing them with the **.play()** function when their relevant events occur.

### Dash

I needed a way to display the current speed, and the current hyperdrive charge. I decided to add a dashboard to the screen, with an analog speedometer, and a red-green gradient for the hyperdrive charge indicator. I made it transparent so it doesn't impact the players view as much.

![dash.png](/assets/images/making_a_vaporwave_game_with_three_js/dash.png)

### Menu

One of the last things we need is a menu for starting the game and adjusting settings. I added a button for turning on/off the postprocessing, muting audio, and starting the game. I used [cooltext.com](https://cooltext.com/) to generate the font used for the title and buttons, the bloom pass really makes it stand out! I added an event listener for mouse presses (**document.addEventListener("mousedown", onMouseDown, false);**), and shoot a raycast (using a [*Raycaster*](https://threejs.org/docs/index.html?q=RayC#api/en/core/Raycaster)) into the world, if this raycast intersects one of the buttons, the name of this button is returned and the appropriate action is taken!

```
-javascript
this.checkForPress = function(overhead_camera, canvas, event) {
  this.mouse.x = (event.offsetX / canvas.width) * 2 - 1;
  this.mouse.y = -(event.offsetY / canvas.height) * 2 + 1;

  // Set the raycaster for button press detection
  this.raycaster.setFromCamera(this.mouse, overhead_camera);

  // Check if button was pressed 
  var intersects = this.raycaster.intersectObjects(this.buttons);
  if (intersects.length > 0) {
    for (let i = 0; i < intersects.length; i++) {
      if (intersects[i].object.name == "Start")
        return "Start";

      if (intersects[i].object.name == "Postprocessing")
        return "Postprocessing";

      if (intersects[i].object.name == "Mute")
        return "Mute";
    }
  }
  return false;
};
```

### Pause Menu

Finally, I added a pause menu - allowing the player to pause the game with the *esc* key. To indicate the game is paused, I reused the hyperdrive shader with a grey-colour to give everything a monochrome appearance. To pause the game, it is good enough to just stop calling the movement functions for the elements of the game. Here is how that looks:

![paused.png](/assets/images/making_a_vaporwave_game_with_three_js/paused.png)

## Conclusion

So thats the game completed! This was a fun project and I enjoyed learning all the fun intricacies of Javascript and three.js. 

As this is a web-based game, I can host it on the website. If you go back to the main menu, click the top left square to play VaporRacer - enjoy!

<!-- ## Final Result

The controls and game are below, it should be playable if you are viewing on a device with a keyboard - just click **START**. Here are the controls:
- **W** : Move up
- **A** : Move left
- **S** : Move down
- **D** : Move right
- **H** : Activate hyperdrive
- **Esc** : Pause the game
- **C** : Change camera mode
- **M** : Toggle sound enabled
- **P** : Toggle the Postprocessing effects

***Note:*** *Works well on Edge and Firefox* -->
