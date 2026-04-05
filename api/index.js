const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  free: { name: 'Gratuit', price: 0 },
  pro_monthly: { name: 'Pro Mensuel', price: 999, currency: 'eur', interval: 'month' },
  pro_annual: { name: 'Pro Annuel', price: 7999, currency: 'eur', interval: 'year' },
};

// File de commandes en mémoire (par session)
const commandQueue = {};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parse body
  if (req.method === 'POST' && typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch(e) {}
  }
  if (!req.body && req.method === 'POST') {
    await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { req.body = JSON.parse(data); } catch(e) { req.body = {}; }
        resolve();
      });
    });
  }

  const path = req.url.split('?')[0];

  // ── STATUS ──
  if (path === '/status' && req.method === 'GET') {
    return res.json({ status: 'running', mode: 'test' });
  }

  // ── PLANS ──
  if (path === '/plans' && req.method === 'GET') {
    return res.json({ plans: PLANS });
  }

  // ── MOBILE → envoie une commande au PC ──
  if (path === '/command' && req.method === 'POST') {
    const { session, type, text, style } = req.body;
    if (!session) return res.status(400).json({ error: 'session requise' });
    if (!commandQueue[session]) commandQueue[session] = [];
    commandQueue[session].push({ type, text, style, ts: Date.now() });
    // Garde max 10 commandes
    if (commandQueue[session].length > 10) commandQueue[session].shift();
    return res.json({ status: 'queued' });
  }

  // ── PC → récupère les commandes en attente ──
  if (path === '/poll' && req.method === 'GET') {
    const session = req.url.split('session=')[1];
    if (!session) return res.status(400).json({ error: 'session requise' });
    const commands = commandQueue[session] || [];
    commandQueue[session] = []; // Vide la file après lecture
    return res.json({ commands });
  }

  // ── STRIPE CHECKOUT ──
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
        success_url: 'https://chipper-crostata-ee5e43.netlify.app/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://chipper-crostata-ee5e43.netlify.app',
        locale: 'fr',
      });
      return res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── VERIFY ──
  if (path.startsWith('/verify/') && req.method === 'GET') {
    const sessionId = path.split('/verify/')[1];
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      return res.json({
        status: subscription.status,
        plan: subscription.items.data[0].price.recurring.interval === 'month' ? 'pro_monthly' : 'pro_annual',
        email: session.customer_email,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (path === '/stop' && req.method === 'POST') {
    return res.json({ status: 'stopped' });
  }

  return res.status(404).json({ error: 'Route non trouvée' });
};
