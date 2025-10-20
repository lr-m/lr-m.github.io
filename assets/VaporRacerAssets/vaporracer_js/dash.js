import * as THREE from "/assets/three.js/build/three.module.js";

export default function Dash() {
  this.dial_x = -445;
  this.dial_length = 200;

  this.charge_height = 5;
  this.charge_x = 450;

  this.last_hyper = 0;

  this.initialiseText = function(scene, container) {
    // Calculate viewport-relative positions
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    
    // Common styles function to avoid repetition
    const applyCommonStyles = (element) => {
      element.style.position = "absolute";
      // Smaller font size on mobile (below 768px)
      if (vw < 768) {
        element.style.fontSize = "clamp(1rem, 2.5vw, 1.5rem)";
      } else {
        element.style.fontSize = "clamp(1.5rem, 4vw, 2.5rem)";
      }
      element.style.fontFamily = "digital_font";
      element.style.color = "white";
      element.style.top = "min(60px, 8vh)"; // Reduced top position for mobile
    };
  
    // Initialize score text
    this.score_text = document.createElement("div");
    applyCommonStyles(this.score_text);
    this.score_text.style.right = vw < 768 ? "max(3vw, 10px)" : "max(5vw, 20px)"; // Smaller margin on mobile
    
    // Initialize status text
    this.status_text = document.createElement("div");
    applyCommonStyles(this.status_text);
    this.status_text.style.left = vw < 768 ? "max(3vw, 10px)" : "max(5vw, 20px)"; // Smaller margin on mobile
  
    // Add resize handler for responsive updates
    const updatePositions = () => {
      const newVw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const newVh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      
      // Update positions and sizes based on new viewport size
      const isMobile = newVw < 768;
      
      // Update font size based on screen size
      [this.score_text, this.status_text].forEach(element => {
        element.style.fontSize = isMobile 
          ? "clamp(1rem, 2.5vw, 1.5rem)"
          : "clamp(1.5rem, 4vw, 2.5rem)";
        element.style.top = `min(${isMobile ? '60px' : '100px'}, ${newVh * (isMobile ? 0.08 : 0.15)}px)`;
      });
  
      // Update margins
      this.score_text.style.right = isMobile ? "max(3vw, 10px)" : "max(5vw, 20px)";
      this.status_text.style.left = isMobile ? "max(3vw, 10px)" : "max(5vw, 20px)";
    };
  
    // Add event listener for resize
    window.addEventListener('resize', updatePositions);
    
    // Add to page
    document.body.appendChild(this.score_text);
    document.body.appendChild(this.status_text);
  };

  /**
   * Resets the position of the HTML text on screen so that is matches
   * with its position on the dashboard texture.
   */
  this.initialise = function (scene) {
    // Initialise the dash texture
    var texture = new THREE.TextureLoader().load(
      "/assets/VaporRacerAssets/Images/dash.png"
    );

    var material = new THREE.MeshBasicMaterial({ map: texture });
    material.transparent = true;
    material.opacity = 0.85;

    this.dash = new THREE.Mesh(new THREE.PlaneGeometry(1269, 325), material);
    this.dash.overdraw = true;
    this.dash.position.x = 0;
    this.dash.position.y = 230;
    this.dash.position.z = -1600;
    this.dash.name = "Dash";

    // Initialise the speed dial hand
    const geometry = new THREE.PlaneGeometry(this.dial_length, 6);
    const white = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    this.speed_dial = new THREE.Mesh(geometry, white);
    this.speed_dial.position.x = this.dial_x;
    this.speed_dial.position.y = 120;
    this.speed_dial.position.z = -1585;

    // Initialise the hyperdrive charge indicator
    const hyperGeometry = new THREE.PlaneGeometry(50, this.charge_height);

    const hyper_material = this.generateHyperMaterial(
      "rgb(255, 0, 0)",
      "rgb(0, 255, 0)"
    );

    this.hyper_charge = new THREE.Mesh(hyperGeometry, hyper_material);
    this.hyper_charge.position.x = this.charge_x;
    this.hyper_charge.position.y = 165;
    this.hyper_charge.position.z = -1585;
    this.hyper_charge.scale.y = 0;

    // Add all to the scene
    scene.add(this.dash);
    scene.add(this.hyper_charge);
    scene.add(this.speed_dial);
  };

  /**
   * Updates the components of the dash.
   */
  this.update = function (
    car_speed,
    score,
    x_position,
    current_hyperdrive_charge,
    full_hyperdrive_charge
  ) {
    this.dash.position.x = x_position;

    // Set speed and score text
    this.score_text.innerHTML = "Score: " + Math.round(score);

    // Set the rotation of the speed dial
    var l = this.dial_length / 2;
    var angle = ((-Math.PI / 2) * car_speed) / 300;

    this.speed_dial.rotation.z = angle;

    this.dial_x = this.dash.position.x - 445;

    this.speed_dial.position.x = this.dial_x + (l - l * Math.cos(-angle));
    this.speed_dial.position.y = 120 + l * Math.sin(-angle);

    // Set the size of the charge indicator
    this.charge_x = this.dash.position.x + 450;

    this.hyper_charge.position.x = this.charge_x;

    var current_hyper_height =
      (current_hyperdrive_charge / full_hyperdrive_charge) *
      (150 / this.hyper_charge.geometry.parameters.height);

    // Update the current charge indicator material if change detected
    if (current_hyperdrive_charge != this.last_hyper) {
      this.hyper_charge.scale.y = current_hyper_height;
      this.last_hyper = current_hyperdrive_charge;

      var green = Math.round(
        (current_hyperdrive_charge / full_hyperdrive_charge) * 255
      );
      var red = Math.round(
        255 - (current_hyperdrive_charge / full_hyperdrive_charge) * 255
      );

      if (red <= 255 && green <= 255)
        this.hyper_charge.material = this.generateHyperMaterial(
          "rgb(255, 0, 0)",
          "rgb(" + red + ", " + green + ", 0)"
        )
    }

    this.hyper_charge.position.y =
      165 + (current_hyper_height / 2) * this.hyper_charge.geometry.parameters.height;
  };

  /**
   * Generates the shader material used to colour the hyperdrive charge 
   * indicator.
   * @param col1 First colour to be used in the gradient
   * @param col2 Second colour to be used in the gradient
   * @returns Created ShaderMaterial
   */
  this.generateHyperMaterial = function (col1, col2) {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        botCol: { type: "c", value: new THREE.Color(col1) },
        topCol: { type: "c", value: new THREE.Color(col2) },
      },
      vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
			}
			`,
      fragmentShader: `
			varying vec2 vUv;
            uniform vec3 botCol;
            uniform vec3 topCol;

			void main() {
				float st = abs(vUv.y);

				float mixValue = st;
				vec3 color = mix(botCol,topCol,mixValue);

				gl_FragColor = vec4(color,mixValue);
			}
			`,
    });
  };
  /**
   * Shows the dashboard when called.
   */
  this.show = function () {
    this.dash.visible = true;
    this.speed_dial.visible = true;
    this.hyper_charge.visible = true;

    this.status_text.style.opacity = 1.0;
    this.score_text.style.opacity = 1.0;
  };

  /**
   * Hides the dashboard when called.
   */
  this.hide = function () {
    this.dash.visible = false;
    this.speed_dial.visible = false;
    this.hyper_charge.visible = false;

    this.status_text.style.opacity = 0.0;
    this.score_text.style.opacity = 0.0;
  };

  /**
   * Resets the position of the HTML text on screen so that is matches
   * with its position on the dashboard texture.
   */
  this.resetText = function (container) {
    var top_offset = container.parentElement.offsetTop + container.parentElement.offsetHeight + 20;

    // Initialise score text
    this.score_text = document.createElement("div");
    this.score_text.style.position = "absolute";
    this.score_text.style.fontSize = 20 + "px";
    this.score_text.style.fontFamily = "digital_font";
    this.score_text.style.top = top_offset + "px";
    this.score_text.style.right = (container.parentElement.offsetLeft + 20) + "px";
    this.score_text.style.color = "white";

    // Initialise status text
    this.status_text = document.createElement("div");
    this.status_text.style.position = "absolute";
    this.status_text.style.fontSize = 20 + "px";
    this.status_text.style.fontFamily = "digital_font";
    this.status_text.style.top = top_offset + "px";
    this.status_text.style.left = (container.parentElement.offsetLeft + 20) + "px";
    this.status_text.style.color = "white";
  };

  /**
   * Sets the status visible on the dash.
   */
  this.updateStatus = function (status) {
    this.status_text.innerHTML = status;
  };
}
