const { verifyGoogleToken } = require('./_lib/auth');
const { checkSubscription } = require('./_lib/stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const user = await verifyGoogleToken(auth.slice(7));
  if (!user || user.error) {
    return res.status(401).json({ error: 'Auth failed' });
  }

  try {
    const subscribed = await checkSubscription(user.email);
    if (!subscribed) {
      return res.status(403).json({ subscribed: false });
    }
    return res.status(200).json({ subscribed: true });
  } catch (err) {
    return res.status(500).json({ error: 'Stripe error: ' + err.message });
  }
};
