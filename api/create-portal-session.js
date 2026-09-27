// api/create-portal-session.js
//
// Erstellt eine Stripe Billing Portal Session, über die der eingeloggte
// Nutzer sein eigenes Abo verwalten/kündigen kann — ganz ohne eigenes
// Stripe-Konto, nur über seine hinterlegte Zahlungsmethode.
//
// Sicherheit: Wir vertrauen NICHT auf eine vom Client mitgeschickte
// company_id, sondern verifizieren das Supabase-Access-Token server-seitig
// und lesen die zugehörige Firma darüber aus — sonst könnte jemand fremde
// Firmen-IDs raten und deren Abo einsehen/kündigen.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace('Bearer ', '');
  if (!accessToken) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'Zahlungsfunktion ist noch nicht vollständig konfiguriert.' });
  }

  try {
    // 1. Access-Token gegen Supabase Auth verifizieren, echte User-ID ermitteln
    const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Sitzung ungültig oder abgelaufen.' });
    }
    const user = await userRes.json();

    // 2. Firma + Stripe-Kunden-ID dieses Nutzers laden (Service Role, aber
    // ausschließlich anhand der verifizierten eigenen User-ID, nie anhand
    // von Client-Eingaben)
    const profileRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=company_id,companies(stripe_customer_id)`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const profiles = await profileRes.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    const stripeCustomerId = profile?.companies?.stripe_customer_id;

    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'Für deine Firma ist noch kein Abo hinterlegt.' });
    }

    // 3. Portal-Session bei Stripe erstellen
    const baseUrl = process.env.PUBLIC_URL || `https://${req.headers.host}`;
    const params = new URLSearchParams();
    params.append('customer', stripeCustomerId);
    params.append('return_url', `${baseUrl}/settings.html`);

    const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe-Portal-Fehler:', session);
      return res.status(500).json({ error: session.error?.message || 'Portal konnte nicht erstellt werden.' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Unerwarteter Fehler:', err);
    return res.status(500).json({ error: 'Interner Fehler beim Erstellen der Portal-Session.' });
  }
}
