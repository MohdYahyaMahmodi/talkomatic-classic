// Party theme for Talkomatic's first birthday

const canvas = document.getElementById('party-canvas');
const ctx = canvas.getContext('2d');
let emojiConfettis = [];
let paperConfettis = [];
let explosionConfettis = [];

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const newThreshold = canvas.height + 20;
    emojiConfettis.forEach(confetti => { if(!confetti.config.explosion) confetti.config.resetThreshold = newThreshold; });
    paperConfettis.forEach(confetti => { if(!confetti.config.explosion) confetti.config.resetThreshold = newThreshold; });
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const emojis = ['🎉', '🥳', '🎂', '💃', '🕺', '🍰'];
const numEmoji = Math.floor(canvas.width / 80); // reduced count

class Confetti {
    constructor(config) {
        this.config = Object.assign({
            x: Math.random() * canvas.width,
            y: -20,
            vy: 0,
            vx: 0,
            speed: 1,
            offset: Math.random() * 360,
            angle: Math.random() * 360,
            rotationSpeed: 0,
            resetThreshold: canvas.height + 20,
        }, config);
        this.x = this.config.x;
        this.y = this.config.y;
        this.speed = this.config.speed;
        this.offset = this.config.offset;
        this.angle = this.config.angle;
        this.rotationSpeed = this.config.rotationSpeed;
        this.vx = config.vx !== undefined ? config.vx : ((Math.random() - 0.5) * 2);
        this.vy = config.vy !== undefined ? config.vy : this.config.speed;
        this.gravity = config.gravity !== undefined ? config.gravity : 0.25;
        this.drag = config.drag !== undefined ? config.drag : 0.98;
    }
    reset() {
        this.x = Math.random() * canvas.width;
        this.y = -20;
        this.vy = this.config.speed;
        this.offset = Math.random() * 360;
        this.angle = Math.random() * 360;
    }
    update() {
        this.vx *= this.drag;
        this.vy *= this.drag;
        this.vy += this.gravity;
        this.x += this.vx;
        this.y += this.vy;
        this.angle += this.rotationSpeed;
        // if (!this.config.explosion && this.y > this.config.resetThreshold) { this.reset(); }
    }
    draw() { }
}

class EmojiConfetti extends Confetti {
    constructor(config) {
        const defaults = {
            speed: 1 + Math.random() * 4,
            fontSize: 10 + Math.random() * 20,
            emoji: emojis[Math.floor(Math.random() * emojis.length)]
        };
        super(Object.assign(defaults, config));
        this.fontSize = this.config.fontSize;
        this.emoji = this.config.emoji;
    }
    reset() {
        super.reset();
        this.fontSize = 16 + Math.random() * 12;
        this.emoji = emojis[Math.floor(Math.random() * emojis.length)];
        this.speed = 1 + Math.random() * 4;
    }
    draw() {
        ctx.font = `${this.fontSize}px serif`;
        ctx.fillText(this.emoji, this.x, this.y);
    }
}

class PaperConfetti extends Confetti {
    constructor(config) {
        const hue = Math.floor(Math.random() * 360);
        const defaults = {
            speed: 1 + Math.random() * 3,
            width: 4 + Math.random() * 6,
            height: 12 + Math.random() * 8,
            color: `hsl(${hue}, ${80 + Math.random() * 20}%, ${50 + Math.random() * 20}%)`,
            rotationSpeed: -5 + Math.random() * 10
        };
        super(Object.assign(defaults, config));
        this.width = this.config.width;
        this.height = this.config.height;
        this.color = this.config.color;
    }
    reset() {
        super.reset();
        const hue = Math.floor(Math.random() * 360);
        this.width = 8 + Math.random() * 8;
        this.height = 12 + Math.random() * 8;
        this.color = `hsl(${hue}, ${80 + Math.random() * 20}%, ${50 + Math.random() * 20}%)`;
        this.rotationSpeed = -5 + Math.random() * 10;
        this.speed = 1 + Math.random() * 3;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle * Math.PI / 180);
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        ctx.restore();
    }
}

for (let i = 0; i < Math.floor(canvas.width / 80); i++) {
    emojiConfettis.push(createNewEmojiConfetti(
        Math.random() * canvas.width,
        Math.random() * canvas.height
    ));
}
for (let i = 0; i < Math.floor(canvas.width / 160); i++) {
    paperConfettis.push(createNewPaperConfetti(
        Math.random() * canvas.width,
        Math.random() * canvas.height
    ));
}

function createExplosion(x, y) {
    const burstCount = 30;
    for (let i = 0; i < burstCount; i++) {
        if (Math.random() < 0.5) {
            explosionConfettis.push(createNewExplosionEmojiConfetti(x, y));
        } else {
            explosionConfettis.push(createNewExplosionPaperConfetti(x, y));
        }
    }
}

document.addEventListener("pointerdown", function(e) {
    console.log(e);
    const x = e.clientX;
    const y = e.clientY;
    createExplosion(x, y);
});

function createNewEmojiConfetti(x, y) {
    return new EmojiConfetti({
        x: (x !== undefined) ? x : Math.random() * canvas.width,
        y: (y !== undefined) ? y : -20,
        vx: (Math.random() - 0.5) * 10,
        vy: 1 + Math.random() * 2, // explicitly reset vertical velocity to a low value
        speed: 1 + Math.random() * 4,
        fontSize: 10 + Math.random() * 20,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
        gravity: 0.25,
        drag: 0.98
    });
}

function createNewPaperConfetti(x, y) {
    return new PaperConfetti({
        x: (x !== undefined) ? x : Math.random() * canvas.width,
        y: (y !== undefined) ? y : -20,
        vx: (Math.random() - 0.5) * 10,
        vy: 1 + Math.random() * 2, // explicitly reset vertical velocity
        speed: 1 + Math.random() * 3,
        width: 4 + Math.random() * 6,
        height: 12 + Math.random() * 8,
        color: `hsl(${Math.floor(Math.random() * 360)}, ${80 + Math.random() * 20}%, ${50 + Math.random() * 20}%)`,
        rotationSpeed: (Math.random() - 0.5) * 20,
        gravity: 0.25,
        drag: 0.98
    });
}

function createNewExplosionEmojiConfetti(x, y) {
    return new EmojiConfetti({
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.5) * 30,
        gravity: 0.25,
        drag: 0.98,
        explosion: true,
        speed: 1 + Math.random() * 4,
        fontSize: 10 + Math.random() * 20,
        emoji: emojis[Math.floor(Math.random() * emojis.length)]
    });
}

function createNewExplosionPaperConfetti(x, y) {
    return new PaperConfetti({
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.5) * 30,
        gravity: 0.25,
        drag: 0.98,
        explosion: true,
        speed: 1 + Math.random() * 3,
        width: 4 + Math.random() * 6,
        height: 12 + Math.random() * 8,
        color: `hsl(${Math.floor(Math.random() * 360)}, ${80 + Math.random() * 20}%, ${50 + Math.random() * 20}%)`,
        rotationSpeed: -5 + Math.random() * 10
    });
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    for (let i = 0; i < emojiConfettis.length; i++) {
        emojiConfettis[i].update();
        emojiConfettis[i].draw();
        if (
            emojiConfettis[i].x < -50 ||
            emojiConfettis[i].x > canvas.width + 50 ||
            emojiConfettis[i].y < -50 ||
            emojiConfettis[i].y > canvas.height + 50
        ) {
            console.log("Replacing non-explosion EmojiConfetti");
            emojiConfettis[i] = createNewEmojiConfetti();
        }
    }
    
    for (let i = 0; i < paperConfettis.length; i++) {
        paperConfettis[i].update();
        paperConfettis[i].draw();
        if (
            paperConfettis[i].x < -50 ||
            paperConfettis[i].x > canvas.width + 50 ||
            paperConfettis[i].y < -50 ||
            paperConfettis[i].y > canvas.height + 50
        ) {
            console.log("Replacing non-explosion PaperConfetti");
            paperConfettis[i] = createNewPaperConfetti();
        }
    }
    
    explosionConfettis = explosionConfettis.filter(confetti => {
        confetti.update();
        confetti.draw();
        if (
            confetti.x < -50 ||
            confetti.x > canvas.width + 50 ||
            confetti.y < -50 ||
            confetti.y > canvas.height + 50
        ) {
            if (confetti instanceof EmojiConfetti) {
                console.log("Deleting explosion EmojiConfetti");
            } else {
                console.log("Deleting explosion PaperConfetti");
            }
            return false;
        }
        return true;
    });
    
    requestAnimationFrame(animate);
}

animate(); // start loop