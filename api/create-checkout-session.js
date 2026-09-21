// api/create-checkout-session.js
//
// Erstellt eine Stripe Checkout Session server-seitig (Secret Key bleibt
// hier, nie im Frontend). Ohne gesetzten STRIPE_SECRET_KEY in den Vercel
// Environment Variables schlägt jeder Aufruf kontrolliert fehl — das ist
// bewusst der "Aus-Schalter", bis die echten Stripe-Daten eingetragen sind.
//
// Erwartet POST-Body: { priceId, companyId, customerEmail }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { priceId, companyId, customerEmail } = req.body || {};

  if (!priceId || !companyId) {
    return res.status(400).json({ error: 'priceId und companyId sind erforderlich.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({
      error: 'Zahlungsfunktion ist noch nicht aktiviert (STRIPE_SECRET_KEY fehlt in den Vercel Environment Variables).',
    });
  }

  const baseUrl = process.env.PUBLIC_URL || `https://${req.headers.host}`;

  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  // Stripe verwaltet jetzt die 14-Tage-Testphase komplett selbst (Karte wird
  // sofort hinterlegt, erste Abbuchung erst nach Ablauf des Trials, außer der
  // Nutzer kündigt vorher). Keine parallele Trial-Logik mehr in der eigenen DB.
  params.append('subscription_data[trial_period_days]', '14');
  params.append('subscription_data[metadata][company_id]', companyId);
  params.append('client_reference_id', companyId);
  params.append('metadata[company_id]', companyId);
  params.append('success_url', `${baseUrl}/app.html?checkout=success`);
  params.append('cancel_url', `${baseUrl}/app.html?checkout=cancelled`);
  if (customerEmail) params.append('customer_email', customerEmail);

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe-Fehler:', session);
      return res.status(500).json({ error: session.error?.message || 'Stripe-Fehler beim Erstellen der Checkout-Session.' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Unerwarteter Fehler:', err);
    return res.status(500).json({ error: 'Interner Fehler beim Erstellen der Checkout-Session.' });
  }
}
