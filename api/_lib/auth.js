const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { verifyGoogleToken };
