const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

async function checkSubscription(email) {
  if (!stripe) throw new Error('STRIPE_SECRET_KEY not configured');

  const customers = await stripe.customers.list({ email, limit: 1 });
  if (customers.data.length === 0) return false;

  const customer = customers.data[0];
  const subscriptions = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'active',
    price: process.env.STRIPE_PRICE_ID,
    limit: 1,
  });

  return subscriptions.data.length > 0;
}

module.exports = { checkSubscription };
