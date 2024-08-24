const crypto = require('crypto');

function generateSessionSecret(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

const sessionSecret = generateSessionSecret();
console.log('Generated Session Secret:');
console.log(sessionSecret);
console.log('\nAdd this to your .env file:');
console.log(`SESSION_SECRET=${sessionSecret}`);