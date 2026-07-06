// worker.js - La Centrale Des Affaires
// Cloudflare Worker

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    // API Payplug
    if (path === '/functions/create-payment' && request.method === 'POST') {
      return handleCreatePayment(request, env);
    }
    if (path === '/functions/payment-confirm' && request.method === 'POST') {
      return handlePaymentConfirm(request, env);
    }

    // Sitemap
    if (path === '/sitemap.xml') {
      try {
        const res = await env.ASSETS.fetch(request);
        return new Response(res.body, {
          status: res.status,
          headers: { 'Content-Type': 'application/xml; charset=utf-8' }
        });
      } catch (e) {
        return new Response('Not found', { status: 404 });
      }
    }

    // Robots.txt
    if (path === '/robots.txt') {
      try {
        const res = await env.ASSETS.fetch(request);
        return new Response(res.body, {
          status: res.status,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      } catch (e) {
        return new Response('Not found', { status: 404 });
      }
    }

    // Static files
    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      // 404 - serve index.html
      try {
        const indexReq = new Request(new URL('/index.html', url).toString(), request);
        return await env.ASSETS.fetch(indexReq);
      } catch (e2) {
        return new Response('Not found', { status: 404 });
      }
    }
  }
};

async function handleCreatePayment(request, env) {
  const PAYPLUG_SECRET_KEY = env.PAYPLUG_SECRET_KEY;
  if (!PAYPLUG_SECRET_KEY) {
    return json({ error: 'Cle Payplug manquante' }, 500);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Corps invalide' }, 400); }

  const { amount, currency = 'EUR', email, firstname, lastname, items } = body;
  if (!amount || amount < 100) return json({ error: 'Montant invalide' }, 400);
  if (!email) return json({ error: 'Email requis' }, 400);

  const description = items?.map(i => `${i.name} x${i.qty}`).join(', ') || 'Commande LCDA';
  const baseUrl = new URL(request.url).origin;

  try {
    const res = await fetch('https://api.payplug.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYPLUG_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Payplug-Version': '2019-08-06',
      },
      body: JSON.stringify({
        amount: Math.round(amount),
        currency,
        billing: { email, first_name: firstname || 'Client', last_name: lastname || 'LCDA' },
        shipping: { email, first_name: firstname || 'Client', last_name: lastname || 'LCDA', delivery_type: 'BILLING' },
        hosted_payment: {
          return_url: `${baseUrl}/confirmation.html`,
          cancel_url: `${baseUrl}/checkout.html`,
        },
        notification_url: `${baseUrl}/functions/payment-confirm`,
        metadata: { description },
      }),
    });
    const payment = await res.json();
    if (!res.ok) return json({ error: payment.message || 'Erreur Payplug' }, res.status);
    return json({ payment_url: payment.hosted_payment?.payment_url, payment_id: payment.id });
  } catch (err) {
    return json({ error: 'Erreur serveur: ' + err.message }, 500);
  }
}

async function handlePaymentConfirm(request, env) {
  let notification;
  try { notification = await request.json(); }
  catch { return new Response('Invalid', { status: 400 }); }
  const { id, is_paid, failure } = notification;
  if (is_paid) console.log('Payment confirmed:', id);
  else if (failure) console.log('Payment failed:', id, failure.message);
  return json({ received: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
