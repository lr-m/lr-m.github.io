import * as THREE from "/assets/three.js/build/three.module.js";
import { ShaderPass } from "/assets/three.js/Shaders_Postprocessing/postprocessing/ShaderPass.js";

export default function Menu() {
	this.buttons = [];
	this.active = true;

	this.paused = false;
	this.pausePass;
	this.pausedTime;

	this.lastTimeWhenPaused;

	this.postprocessingEnabled = false;

	/**
	 * Toggles the pause menu.
	 */
	this.togglePauseMenu = function (composer, time, inHyper, car_x) {
		var time_difference = 0;

		if (this.paused) {
			this.paused = !this.paused;

			this.buttons[this.buttons.length-1].position.z -= 500;
			this.buttons[this.buttons.length-1].position.y -= 400;
			this.buttons[this.buttons.length-1].position.x = 0;
			
			if (this.postprocessingEnabled)
				composer.removePass(this.pausePass);

			this.hideGuide();

			time_difference =
				Math.round(new Date().getTime() / 1000) - this.pausedTime;

			return time + time_difference;
		} else if (!this.active) {
			this.paused = !this.paused;

			this.buttons[this.buttons.length-1].position.z += 500;
			this.buttons[this.buttons.length-1].position.y += 400;
			this.buttons[this.buttons.length-1].position.x = car_x;

			if (this.postprocessingEnabled)
				composer.insertPass(this.pausePass, 2);

			this.pausedTime = Math.round(new Date().getTime() / 1000);
			this.lastTimeWhenPaused = time;

			if (!inHyper) this.showGuide();
		}

		return time;
	};

	/**
	 * Turns on/off pause menu postprocessing effect.
	 */
	this.togglePostprocessing = function(){
		this.postprocessingEnabled = !this.postprocessingEnabled;
	}

	/**
	 * Return flag indicating if game is paused.
	 */
	this.isPaused = function () {
		return this.paused;
	};

	/**
	 * Initialises the textures and raycaster/mouse used by the menu.
	 */
	this.initialise = function (scene) {
		// // Initialise start button texture

		this.addButton(scene, "/assets/VaporRacerAssets/Images/start.png", 
			0, 1700, -2500, 730, 300, "Start");

		this.addButton(scene, "/assets/VaporRacerAssets/Images/title.png", 
			0, 2100, -2500, 2500, 500, "Title");
		
		this.addButton(scene, "/assets/VaporRacerAssets/Images/mute.png", 
			1250, 1700, -2500, 600, 200, "Mute");

		this.addButton(scene, "/assets/VaporRacerAssets/Images/postprocessing.png", 
			-1250, 1700, -2500, 1100, 200, "Postprocessing");

		this.addButton(scene, "/assets/VaporRacerAssets/Images/guide_display.png", 
			0, 800, -2500, 2750, 1500, "Instructions");
		
		// Initialise the raycaster for the menu
		this.mouse = new THREE.Vector2();
		this.raycaster = new THREE.Raycaster();

		// Initialise the grayscale shader/pass 
		// https://en.wikipedia.org/wiki/Grayscale
		const pauseShader = {
			uniforms: {
				tDiffuse: { value: null },
			},
			vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
            }
            `,
			fragmentShader: `
            uniform sampler2D tDiffuse;
            varying vec2 vUv;

            void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                gl_FragColor = vec4(vec3(gray), 1.0);
            }
            `,
		};

		this.pausePass = new ShaderPass(pauseShader);
		this.pausePass.renderToScreen = true;
	};

	/**
	 * Adds a button to the menu.
	 */
	this.addButton = function(scene, path, x, y, z, width, height, name){
		// Initialise start button texture
		var texture = new THREE.TextureLoader().load(
			path
		);
		var material = new THREE.MeshBasicMaterial({ map: texture });
		material.transparent = true;
		material.opacity = 0.85;

		var index = this.buttons.length;

		this.buttons[index] = new THREE.Mesh(
			new THREE.PlaneGeometry(width, height, 10),
			material
		);

		this.buttons[index].overdraw = true;
		this.buttons[index].position.x = x;
		this.buttons[index].position.y = y;
		this.buttons[index].position.z = z;
		this.buttons[index].name = name;

		scene.add(this.buttons[index]);
	}

	/**
	 * Indicates if the menu is currently active.
	 */
	this.isActive = function () {
		return this.active;
	};

	/**
	 * Sets active status of menu.
	 */
	this.setActive = function (active) {
		this.active = active;
	};

	/**
	 * Animates the buttons by moving them into view.
	 */
	this.moveIn = function () {
		for (let i = 0; i < this.buttons.length; i++) {
			if (this.buttons[i].position.z > -2500) this.buttons[i].position.z -= 50;
		}
	};

	/**
	 * Animates the buttons by moving them out of view.
	 */
	this.moveOut = function () {
		for (let i = 0; i < this.buttons.length; i++) {
			if (this.buttons[i].position.z < 1000) this.buttons[i].position.z += 50;
		}

		this.buttons[this.buttons.length-1].visible = false;
	};

	/**
	 * Checks for a button press using the passed camera and raycaster, return 
	 * pressed button if pressed, and false otherwise.
	 */
	this.checkForPress = function(overhead_camera, canvas, event) {
		// Get the actual rendered dimensions
		const rect = canvas.getBoundingClientRect();
		
		// Use the rect dimensions for normalization
		this.mouse.x = (event.offsetX / rect.width) * 2 - 1;
		this.mouse.y = -(event.offsetY / rect.height) * 2 + 1;
		
		// Set the raycaster for button press detection
		this.raycaster.setFromCamera(this.mouse, overhead_camera);
		
		// Rest of your intersection checking code...
		var intersects = this.raycaster.intersectObjects(this.buttons);
		if (intersects.length > 0) {
			for (let i = 0; i < intersects.length; i++) {
				if (intersects[i].object.name == "Start") {
					return "Start";
				}
				if (intersects[i].object.name == "Postprocessing") {
					return "Postprocessing";
				}
				if (intersects[i].object.name == "Mute") {
					return "Mute";
				}
			}
		}
		return false;
	};

	/**
	 * Updates the mouse position based on the passed event.
	 */
	this.updateMouse = function (canvas, event) {
		this.mouse.x = (event.offsetX / canvas.width) * 2 - 1;
		this.mouse.y = -(event.offsetY / canvas.height) * 2 + 1;
	};

	/**
	 * Sets the position of the buttons.
	 */
	this.setButtonsX = function (x) {
		this.buttons[0].position.x = x;
		this.buttons[1].position.x = x;
		this.buttons[2].position.x = x + 1250;
		this.buttons[3].position.x = x - 1250;
		this.buttons[4].position.x = x;
	};

	/**
	 * Hides the instructions from view.
	 */
	this.hideGuide = function () {
		this.buttons[this.buttons.length-1].visible = false;
	}

	/**
	 * Shows the instructions.
	 */
	this.showGuide = function(){
		this.buttons[this.buttons.length-1].visible = true;
	}
}
