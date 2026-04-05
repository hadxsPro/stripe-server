const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const https = require('https');

const JSONBIN_ID = '69d28277aaba882197c886d1';
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const PLANS = {
  free: { name: 'Gratuit', price: 0 },
  pro_monthly: { name: 'Pro Mensuel', price: 999, currency: 'eur', interval: 'month' },
  pro_annual: { name: 'Pro Annuel', price: 7999, currency: 'eur', interval: 'year' },
};

function jsonbinRequest(method, data) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.jsonbin.io',
      path: `/v3/b/${JSONBIN_ID}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_KEY,
        'X-Bin-Versioning': 'false',
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function getCommands() {
  const res = await jsonbinRequest('GET');
  return res.record?.commands || [];
}

async function addCommand(cmd) {
  const commands = await getCommands();
  commands.push({ ...cmd, ts: Date.now() });
  if (commands.length > 20) commands.splice(0, commands.length - 20);
  await jsonbinRequest('PUT', { commands });
}

async function clearCommands() {
  await jsonbinRequest('PUT', { commands: [] });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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

  if (path === '/status' && req.method === 'GET') {
    return res.json({ status: 'running', mode: 'test' });
  }

  if (path === '/plans' && req.method === 'GET') {
    return res.json({ plans: PLANS });
  }

  // Mobile envoie une commande
  if (path === '/command' && req.method === 'POST') {
    try {
      const { type, text, style } = req.body;
      await addCommand({ type, text, style });
      return res.json({ status: 'queued' });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PC récupère et vide les commandes
  if (path === '/poll' && req.method === 'GET') {
    try {
      const commands = await getCommands();
      if (commands.length > 0) await clearCommands();
      return res.json({ commands });
    } catch(e) {
      return res.status(500).json({ commands: [], error: e.message });
    }
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
        success_url: 'https://chipper-crostata-ee5e43.netlify.app/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://chipper-crostata-ee5e43.netlify.app',
        locale: 'fr',
      });
      return res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

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
