const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  free: { name: 'Gratuit', price: 0 },
  pro_monthly: { name: 'Pro Mensuel', price: 999, currency: 'eur', interval: 'month' },
  pro_annual: { name: 'Pro Annuel', price: 7999, currency: 'eur', interval: 'year' },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url.split('?')[0];

  if (path === '/status' && req.method === 'GET') {
    return res.json({ status: 'running', mode: 'test' });
  }

  if (path === '/plans' && req.method === 'GET') {
    return res.json({ plans: PLANS });
  }

  if (path === '/create-checkout' && req.method === 'POST') {
    const { plan, email } = req.body;
    if (!plan || plan === 'free') return res.json({ url: null, plan: 'free' });
    const planData = PLANS[plan];
    if (!planData) return res.status(400).json({ error: 'Plan invalide' });

    try {
      const product = await stripe.products.create({ name: 'AvatarLive ' + planData.name });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: planData.price,
        currency: planData.currency,
        recurring: { interval: planData.interval },
      });
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: email || undefined,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: 'https://avatarlive-stripedone.vercel.app/status',
        cancel_url: 'https://avatarlive-stripedone.vercel.app/status',
        locale: 'fr',
      });
      return res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (path === '/stop' && req.method === 'POST') {
    return res.json({ status: 'stopped' });
  }

  return res.status(404).json({ error: 'Route non trouvée' });
};
